// car-logger runs on the teslausb Raspberry Pi in the car. It reads the car's state over Bluetooth
// with a paired key and appends it to JSON Lines files, so TeslaCam can collect a history of
// drives, charging and battery once the car is home.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/teslamotors/vehicle-command/pkg/protocol"
)

type options struct {
	dir       string
	keyFile   string
	vinFile   string
	idleEvery time.Duration
	once      bool
}

func main() {
	var o options
	flag.StringVar(&o.dir, "dir", "/mutable/car-log", "where the log files go")
	flag.StringVar(&o.keyFile, "key", "/mutable/tesla/private.pem", "private key paired with the car")
	flag.StringVar(&o.vinFile, "vin-file", "/mutable/tesla/vin", "file holding the car's VIN")
	flag.DurationVar(&o.idleEvery, "idle-every", 30*time.Minute, "how often to take full readings while the car is parked and unattended")
	flag.BoolVar(&o.once, "once", false, "take every reading once, print them, and exit (for testing)")
	flag.Parse()
	log.SetFlags(0) // journald adds its own timestamps

	vinBytes, err := os.ReadFile(o.vinFile)
	if err != nil {
		log.Fatalf("read VIN: %v", err)
	}
	vin := strings.TrimSpace(string(vinBytes))
	key, err := protocol.LoadPrivateKey(o.keyFile)
	if err != nil {
		log.Fatalf("load key: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	connect := func(ctx context.Context) (Car, error) { return ConnectBLE(ctx, vin, key) }

	if o.once {
		if err := runOnce(ctx, connect); err != nil {
			log.Fatal(err)
		}
		return
	}

	store, err := OpenStore(o.dir, 4<<20, 150<<20)
	if err != nil {
		log.Fatalf("open log: %v", err)
	}
	defer store.Close()
	l := &Logger{store: store, schedule: DefaultSchedule(o.idleEvery), connect: connect, statusPath: filepath.Join(o.dir, "status.json")}
	l.Run(ctx)
}

func runOnce(ctx context.Context, connect func(context.Context) (Car, error)) error {
	cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	car, err := connect(cctx)
	if err != nil {
		return err
	}
	defer car.Close()
	out := json.NewEncoder(os.Stdout)
	r, err := car.Body(cctx)
	if err != nil {
		return err
	}
	_ = out.Encode(map[string]any{"kind": KindBody, "data": r.Data})
	for _, kind := range StateKinds {
		r, err := car.State(cctx, kind)
		if err != nil {
			return err
		}
		_ = out.Encode(map[string]any{"kind": kind, "carTime": r.CarTime, "data": r.Data})
	}
	return nil
}

// Logger is the main loop: connect, read whatever is due for the current mode, write it down.
type Logger struct {
	store      *Store
	schedule   Schedule
	connect    func(context.Context) (Car, error)
	statusPath string
	now        func() time.Time // for tests

	car      Car
	facts    Facts
	mode     Mode
	lastRead map[Kind]time.Time
	clock    CarClock
	failures int
	status   Status
}

// Status is written next to the log after every round, for checking on the logger over SSH.
type Status struct {
	Mode        Mode      `json:"mode"`
	Connected   bool      `json:"connected"`
	LastError   string    `json:"lastError,omitempty"`
	LastErrorAt time.Time `json:"lastErrorAt,omitzero"`
	LastRecord  time.Time `json:"lastRecord,omitzero"`
	Records     int       `json:"records"`
	Started     time.Time `json:"started"`
}

const tick = 5 * time.Second

func (l *Logger) clockNow() time.Time {
	if l.now != nil {
		return l.now()
	}
	return time.Now()
}

func (l *Logger) Run(ctx context.Context) {
	l.lastRead = map[Kind]time.Time{}
	l.mode = ModeParked
	l.status.Started = l.clockNow()
	log.Printf("car-logger started")
	for ctx.Err() == nil {
		wait := l.Round(ctx)
		l.writeStatus()
		select {
		case <-ctx.Done():
		case <-time.After(wait):
		}
	}
	l.disconnect()
	log.Printf("car-logger stopped")
}

// Round does one pass and returns how long to wait before the next.
func (l *Logger) Round(ctx context.Context) time.Duration {
	if l.lastRead == nil {
		l.lastRead = map[Kind]time.Time{}
	}
	// Between readings in the quiet modes there is no connection; only reconnect when one is due.
	if wait := l.untilDue(l.clockNow()); l.car == nil && wait > 0 {
		return min(wait, time.Minute)
	}
	if l.car == nil {
		cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
		car, err := l.connect(cctx)
		cancel()
		if err != nil {
			l.fail("connect", err)
			// Back off while the car is out of reach or the radio is struggling, up to two minutes.
			return min(time.Duration(l.failures)*15*time.Second, 2*time.Minute)
		}
		l.car = car
		l.failures = 0
	}

	now := l.clockNow()
	if l.schedule.Due(l.mode, KindBody, l.lastRead[KindBody], now) {
		if !l.read(ctx, KindBody, func(ctx context.Context) (Reading, error) { return l.car.Body(ctx) }) {
			return tick
		}
	}
	l.mode = Decide(l.facts, l.clockNow())

	if l.mode != ModeAsleep {
		for _, kind := range StateKinds {
			if !l.schedule.Due(l.mode, kind, l.lastRead[kind], l.clockNow()) {
				continue
			}
			if !l.read(ctx, kind, func(ctx context.Context) (Reading, error) { return l.car.State(ctx, kind) }) {
				return tick
			}
			// A reading can move the car into another mode (it started driving), which changes what's due.
			l.mode = Decide(l.facts, l.clockNow())
		}
	}

	if !KeepConnected(l.mode) {
		l.disconnect()
	}
	return tick
}

// untilDue is how long until the next reading the current mode calls for (zero if one is due now).
func (l *Logger) untilDue(now time.Time) time.Duration {
	kinds := []Kind{KindBody}
	if l.mode != ModeAsleep {
		kinds = append(kinds, StateKinds...)
	}
	soonest := time.Duration(-1)
	for _, kind := range kinds {
		every := l.schedule[l.mode][kind]
		if every <= 0 {
			continue
		}
		last := l.lastRead[kind]
		if last.IsZero() {
			return 0
		}
		wait := max(0, last.Add(every).Sub(now))
		if soonest < 0 || wait < soonest {
			soonest = wait
		}
	}
	if soonest < 0 {
		return time.Minute
	}
	return soonest
}

// read takes one reading and records it. On failure it drops the connection so the next round
// starts clean, and reports false.
func (l *Logger) read(ctx context.Context, kind Kind, get func(context.Context) (Reading, error)) bool {
	rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	r, err := get(rctx)
	cancel()
	now := l.clockNow()
	if err != nil {
		l.fail(string(kind), err)
		l.disconnect()
		return false
	}
	l.lastRead[kind] = now
	if r.Apply != nil {
		r.Apply(&l.facts)
	}
	if l.facts.UserPresent || l.facts.Driving || l.facts.Charging {
		l.facts.LastActiveAt = now
	}

	rec := Record{Kind: kind, Mode: Decide(l.facts, now), PiTime: now.Round(0), Data: r.Data}
	if !r.CarTime.IsZero() {
		t := r.CarTime
		rec.CarTime = &t
		l.clock.Observe(t, now)
	} else if t, ok := l.clock.Estimate(now); ok {
		rec.CarTime, rec.CarTimeEstimated = &t, true
	}
	if err := l.store.Append(rec); err != nil {
		l.fail("write", err)
		return true
	}
	l.status.Records++
	l.status.LastRecord = now.Round(0)
	return true
}

func (l *Logger) fail(what string, err error) {
	l.failures++
	l.status.LastError = what + ": " + err.Error()
	l.status.LastErrorAt = l.clockNow().Round(0)
	// Repeated failures to even reach the car may mean the adapter is wedged; start it fresh.
	if l.failures%5 == 0 && !errors.Is(err, context.Canceled) {
		ResetAdapter()
	}
	log.Printf("%s failed: %v", what, err)
}

func (l *Logger) disconnect() {
	if l.car != nil {
		l.car.Close()
		l.car = nil
	}
}

func (l *Logger) writeStatus() {
	if l.statusPath == "" {
		return
	}
	l.status.Mode = l.mode
	l.status.Connected = l.car != nil
	b, err := json.MarshalIndent(l.status, "", "  ")
	if err != nil {
		return
	}
	tmp := l.statusPath + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, l.statusPath)
	}
}
