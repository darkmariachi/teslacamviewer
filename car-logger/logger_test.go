package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/carserver"
	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/vcsec"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestDecide(t *testing.T) {
	now := time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name  string
		facts Facts
		want  Mode
	}{
		{"asleep wins", Facts{Asleep: true, Driving: true}, ModeAsleep},
		{"driving", Facts{Driving: true, Charging: true}, ModeDriving},
		{"charging", Facts{Charging: true}, ModeCharging},
		{"someone inside", Facts{UserPresent: true}, ModeParked},
		{"just left", Facts{LastActiveAt: now.Add(-5 * time.Minute)}, ModeParked},
		{"left a while ago", Facts{LastActiveAt: now.Add(-11 * time.Minute)}, ModeIdle},
	}
	for _, c := range cases {
		if got := Decide(c.facts, now); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

func TestAsleepOnlyChecksTheBody(t *testing.T) {
	s := DefaultSchedule(30 * time.Minute)
	now := time.Now()
	for _, kind := range StateKinds {
		if s.Due(ModeAsleep, kind, time.Time{}, now) {
			t.Errorf("%s is due while asleep; reading it would wake the car", kind)
		}
	}
	if !s.Due(ModeAsleep, KindBody, time.Time{}, now) {
		t.Error("the body check should run while asleep")
	}
	if s.Due(ModeAsleep, KindBody, now.Add(-time.Minute), now) {
		t.Error("the body check ran again too soon")
	}
}

func TestStoreStartsAFreshFileAndRotates(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "000007.jsonl"), []byte(`{"kind":"body","da`), 0o600) // cut off by a power loss

	s, err := OpenStore(dir, 300, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if err := s.Append(Record{Kind: KindCharge, Data: json.RawMessage(`{"chargeState":{"batteryLevel":75}}`)}); err != nil {
			t.Fatal(err)
		}
	}
	s.Close()

	numbers, _ := (&Store{dir: dir}).numbers()
	if len(numbers) < 3 || numbers[0] != 7 || numbers[1] != 8 {
		t.Fatalf("expected the damaged file kept and new files from 8, got %v", numbers)
	}
	f, _ := os.Open(filepath.Join(dir, "000008.jsonl"))
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var r Record
		if err := json.Unmarshal(scanner.Bytes(), &r); err != nil {
			t.Fatalf("line is not JSON: %s", scanner.Text())
		}
	}
}

func TestStorePrunesTheOldestFiles(t *testing.T) {
	dir := t.TempDir()
	s, _ := OpenStore(dir, 200, 600)
	for i := 0; i < 40; i++ {
		s.Append(Record{Kind: KindDrive, Data: json.RawMessage(`{"driveState":{"power":2}}`)})
	}
	s.Close()
	numbers, _ := (&Store{dir: dir}).numbers()
	if numbers[0] == 1 {
		t.Fatalf("oldest file was not pruned: %v", numbers)
	}
	var total int64
	for _, n := range numbers {
		info, _ := os.Stat(filepath.Join(dir, fileName(n)))
		total += info.Size()
	}
	if total > 600+200 {
		t.Fatalf("log grew to %d bytes", total)
	}
}

func TestCarClockCarriesTheCarsTimeForward(t *testing.T) {
	var c CarClock
	pi := time.Now()
	if _, ok := c.Estimate(pi); ok {
		t.Fatal("no estimate before the car has reported a time")
	}
	car := time.Date(2026, 3, 2, 17, 0, 0, 0, time.UTC)
	c.Observe(car, pi)
	got, _ := c.Estimate(pi.Add(90 * time.Second))
	if !got.Equal(car.Add(90 * time.Second)) {
		t.Fatalf("got %v", got)
	}
}

func TestStateReadingSpotsDrivingAndCharging(t *testing.T) {
	ts := timestamppb.New(time.Date(2026, 3, 2, 17, 0, 0, 0, time.UTC))
	r, err := stateReading(&carserver.VehicleData{DriveState: &carserver.DriveState{
		Timestamp:  ts,
		ShiftState: &carserver.ShiftState{Type: &carserver.ShiftState_D{D: &carserver.Void{}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	var f Facts
	r.Apply(&f)
	if !f.Driving || !r.CarTime.Equal(ts.AsTime()) {
		t.Fatalf("driving %v, car time %v", f.Driving, r.CarTime)
	}

	r, _ = stateReading(&carserver.VehicleData{ChargeState: &carserver.ChargeState{
		ChargingState: &carserver.ChargeState_ChargingState{Type: &carserver.ChargeState_ChargingState_Charging{Charging: &carserver.Void{}}},
	}})
	r.Apply(&f)
	if !f.Charging {
		t.Fatal("charging not spotted")
	}
}

// fakeCar answers from a script of body states and counts what was asked.
type fakeCar struct {
	body   []*vcsec.VehicleStatus
	asked  []Kind
	closed int
	failOn Kind
}

func (c *fakeCar) Body(ctx context.Context) (Reading, error) {
	c.asked = append(c.asked, KindBody)
	status := c.body[0]
	if len(c.body) > 1 {
		c.body = c.body[1:]
	}
	return bodyReading(status)
}

func (c *fakeCar) State(ctx context.Context, kind Kind) (Reading, error) {
	c.asked = append(c.asked, kind)
	if kind == c.failOn {
		return Reading{}, errors.New("timed out")
	}
	return stateReading(&carserver.VehicleData{ChargeState: &carserver.ChargeState{}})
}

func (c *fakeCar) Close() { c.closed++ }

func newTestLogger(t *testing.T, car *fakeCar, now *time.Time) *Logger {
	store, err := OpenStore(t.TempDir(), 1<<20, 1<<22)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return &Logger{
		store: store, schedule: DefaultSchedule(30 * time.Minute), mode: ModeParked,
		connect: func(context.Context) (Car, error) { return car, nil },
		now:     func() time.Time { return *now },
	}
}

var (
	awakeInside = &vcsec.VehicleStatus{VehicleSleepStatus: vcsec.VehicleSleepStatus_E_VEHICLE_SLEEP_STATUS_AWAKE, UserPresence: vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_PRESENT}
	asleep      = &vcsec.VehicleStatus{VehicleSleepStatus: vcsec.VehicleSleepStatus_E_VEHICLE_SLEEP_STATUS_ASLEEP}
)

func TestLoggerReadsEverythingWhenSomeoneIsInside(t *testing.T) {
	now := time.Now()
	car := &fakeCar{body: []*vcsec.VehicleStatus{awakeInside}}
	l := newTestLogger(t, car, &now)

	l.Round(context.Background())

	if l.mode != ModeParked || len(car.asked) != 1+len(StateKinds) {
		t.Fatalf("mode %s, asked %v", l.mode, car.asked)
	}
	if car.closed != 0 {
		t.Fatal("dropped the connection while someone is in the car")
	}
	if l.status.Records != len(car.asked) {
		t.Fatalf("recorded %d of %d readings", l.status.Records, len(car.asked))
	}
}

func TestLoggerLetsASleepingCarSleep(t *testing.T) {
	now := time.Now()
	car := &fakeCar{body: []*vcsec.VehicleStatus{asleep}}
	l := newTestLogger(t, car, &now)

	l.Round(context.Background())
	if l.mode != ModeAsleep || len(car.asked) != 1 || car.closed != 1 {
		t.Fatalf("mode %s, asked %v, closed %d", l.mode, car.asked, car.closed)
	}

	// Thirty seconds later nothing is due, so it must not even reconnect.
	connects := 0
	l.connect = func(context.Context) (Car, error) { connects++; return car, nil }
	now = now.Add(30 * time.Second)
	wait := l.Round(context.Background())
	if connects != 0 || wait <= 0 {
		t.Fatalf("reconnected %d times, waits %v", connects, wait)
	}
}

func TestLoggerDropsTheConnectionAfterAFailedRead(t *testing.T) {
	now := time.Now()
	car := &fakeCar{body: []*vcsec.VehicleStatus{awakeInside}, failOn: KindCharge}
	l := newTestLogger(t, car, &now)

	l.Round(context.Background())
	if car.closed != 1 || l.car != nil || l.status.LastError == "" {
		t.Fatalf("closed %d, still connected %v, error %q", car.closed, l.car != nil, l.status.LastError)
	}
}
