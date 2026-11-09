package main

import "time"

// Mode is what the car is doing, as far as the logger can tell. It decides how often each kind of
// reading is taken: often while driving, rarely while parked, never in a way that wakes the car.
type Mode string

const (
	ModeAsleep   Mode = "asleep"   // infotainment asleep: only the no-wake body check
	ModeIdle     Mode = "idle"     // awake, parked, nobody around for a while: let it fall asleep
	ModeParked   Mode = "parked"   // awake and recently in use (someone inside, just arrived)
	ModeCharging Mode = "charging" //
	ModeDriving  Mode = "driving"  // in Drive, Reverse or Neutral
)

// Kind is one group of readings the car reports separately.
type Kind string

const (
	KindBody     Kind = "body" // locks, sleep, presence; works while the car sleeps
	KindDrive    Kind = "drive"
	KindLocation Kind = "location"
	KindCharge   Kind = "charge"
	KindClimate  Kind = "climate"
	KindClosures Kind = "closures"
	KindTires    Kind = "tires"
	KindSoftware Kind = "software"
)

// StateKinds are read in this order, so the ones that change the mode come first.
var StateKinds = []Kind{KindDrive, KindCharge, KindLocation, KindClosures, KindClimate, KindTires, KindSoftware}

// IdleAfter is how long the car must be parked and unattended before reads become rare.
const IdleAfter = 10 * time.Minute

// Facts are what the logger last learned about the car.
type Facts struct {
	Asleep       bool
	UserPresent  bool
	Driving      bool
	Charging     bool
	LastActiveAt time.Time // last time someone was inside, it drove or it charged
}

// Decide picks the mode from the latest facts.
func Decide(f Facts, now time.Time) Mode {
	switch {
	case f.Asleep:
		return ModeAsleep
	case f.Driving:
		return ModeDriving
	case f.Charging:
		return ModeCharging
	case f.UserPresent || now.Sub(f.LastActiveAt) < IdleAfter:
		return ModeParked
	default:
		return ModeIdle
	}
}

// Schedule holds how often each kind is read in each mode. Zero means never.
type Schedule map[Mode]map[Kind]time.Duration

// DefaultSchedule is a first guess, to be tuned once we see whether reads keep the car awake.
func DefaultSchedule(idleEvery time.Duration) Schedule {
	m, h := time.Minute, time.Hour
	return Schedule{
		ModeDriving: {KindBody: m, KindDrive: 15 * time.Second, KindLocation: 15 * time.Second, KindCharge: m,
			KindClimate: 5 * m, KindClosures: 5 * m, KindTires: 10 * m},
		ModeCharging: {KindBody: m, KindDrive: 5 * m, KindLocation: 30 * m, KindCharge: m,
			KindClimate: 10 * m, KindClosures: 10 * m, KindTires: 30 * m, KindSoftware: 6 * h},
		ModeParked: {KindBody: 30 * time.Second, KindDrive: 30 * time.Second, KindLocation: 10 * m, KindCharge: 2 * m,
			KindClimate: 5 * m, KindClosures: 2 * m, KindTires: 30 * m, KindSoftware: 6 * h},
		// Body checks never wake the car; everything else waits long enough that it can doze off.
		// Tires and software ride along too, or a car that's only ever parked would never report them.
		ModeIdle: {KindBody: m, KindDrive: idleEvery, KindLocation: idleEvery, KindCharge: idleEvery,
			KindClimate: idleEvery, KindClosures: idleEvery, KindTires: idleEvery, KindSoftware: 6 * h},
		ModeAsleep: {KindBody: 2 * m},
	}
}

// Due says whether a kind should be read now, given when it was last read (zero if never).
func (s Schedule) Due(mode Mode, kind Kind, last, now time.Time) bool {
	every := s[mode][kind]
	if every <= 0 {
		return false
	}
	return last.IsZero() || now.Sub(last) >= every
}

// KeepConnected says whether to hold the Bluetooth link between rounds. In the quiet modes the
// logger lets go, so a held connection can't be what keeps the car awake.
func KeepConnected(mode Mode) bool {
	return mode == ModeDriving || mode == ModeCharging || mode == ModeParked
}
