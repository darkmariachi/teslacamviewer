package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/teslamotors/vehicle-command/pkg/connector/ble"
	"github.com/teslamotors/vehicle-command/pkg/protocol"
	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/carserver"
	universal "github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/universalmessage"
	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/vcsec"
	"github.com/teslamotors/vehicle-command/pkg/vehicle"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Reading is one answer from the car, turned into JSON plus the facts the logger steers by.
type Reading struct {
	Data    json.RawMessage
	CarTime time.Time // zero when the reading carries no timestamp
	Apply   func(*Facts)
}

// Car is the part of the vehicle the logger uses, so the loop can be tested without a car.
type Car interface {
	Body(ctx context.Context) (Reading, error)
	State(ctx context.Context, kind Kind) (Reading, error)
	Close()
}

var stateCategory = map[Kind]vehicle.StateCategory{
	KindDrive:    vehicle.StateCategoryDrive,
	KindLocation: vehicle.StateCategoryLocation,
	KindCharge:   vehicle.StateCategoryCharge,
	KindClimate:  vehicle.StateCategoryClimate,
	KindClosures: vehicle.StateCategoryClosures,
	KindTires:    vehicle.StateCategoryTirePressure,
	KindSoftware: vehicle.StateCategorySoftwareUpdate,
}

// bleCar talks to the car over Bluetooth with Tesla's vehicle-command library.
type bleCar struct {
	car     *vehicle.Vehicle
	session bool // an authenticated infotainment session, started only once the car is awake
}

var adapterReady bool

// ConnectBLE finds the car by VIN and opens a link. It does not start an authenticated session,
// because that would wake infotainment; the body check works without one.
func ConnectBLE(ctx context.Context, vin string, key protocol.ECDHPrivateKey) (Car, error) {
	if !adapterReady {
		if err := ble.InitAdapterWithID(""); err != nil {
			return nil, fmt.Errorf("bluetooth adapter: %w", err)
		}
		adapterReady = true
	}
	conn, err := ble.NewConnection(ctx, vin)
	if err != nil {
		return nil, err
	}
	car, err := vehicle.NewVehicle(conn, key, nil)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if err := car.Connect(ctx); err != nil {
		conn.Close()
		return nil, err
	}
	return &bleCar{car: car}, nil
}

// ResetAdapter drops the adapter so the next connection starts from scratch, after repeated failures.
func ResetAdapter() {
	if adapterReady {
		_ = ble.CloseAdapter()
		adapterReady = false
	}
}

func (b *bleCar) Close() {
	b.car.Disconnect()
}

func (b *bleCar) Body(ctx context.Context) (Reading, error) {
	status, err := b.car.BodyControllerState(ctx)
	if err != nil {
		return Reading{}, err
	}
	return bodyReading(status)
}

func bodyReading(status *vcsec.VehicleStatus) (Reading, error) {
	data, err := marshal(status)
	if err != nil {
		return Reading{}, err
	}
	asleep := status.GetVehicleSleepStatus() == vcsec.VehicleSleepStatus_E_VEHICLE_SLEEP_STATUS_ASLEEP
	present := status.GetUserPresence() == vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_PRESENT
	return Reading{Data: data, Apply: func(f *Facts) {
		f.Asleep, f.UserPresent = asleep, present
	}}, nil
}

func (b *bleCar) State(ctx context.Context, kind Kind) (Reading, error) {
	category, ok := stateCategory[kind]
	if !ok {
		return Reading{}, fmt.Errorf("unknown kind %q", kind)
	}
	if !b.session {
		if err := b.car.StartSession(ctx, []universal.Domain{protocol.DomainInfotainment}); err != nil {
			return Reading{}, fmt.Errorf("start session: %w", err)
		}
		b.session = true
	}
	data, err := b.car.GetState(ctx, category)
	if err != nil {
		return Reading{}, err
	}
	return stateReading(data)
}

func stateReading(data *carserver.VehicleData) (Reading, error) {
	raw, err := marshal(data)
	if err != nil {
		return Reading{}, err
	}
	r := Reading{Data: raw, CarTime: carTimestamp(raw)}
	if drive := data.GetDriveState(); drive != nil {
		var moving bool
		switch drive.GetShiftState().GetType().(type) {
		case *carserver.ShiftState_D, *carserver.ShiftState_R, *carserver.ShiftState_N:
			moving = true
		}
		r.Apply = func(f *Facts) { f.Driving = moving }
	}
	if charge := data.GetChargeState(); charge != nil {
		var charging bool
		switch charge.GetChargingState().GetType().(type) {
		case *carserver.ChargeState_ChargingState_Charging, *carserver.ChargeState_ChargingState_Starting:
			charging = true
		}
		r.Apply = func(f *Facts) { f.Charging = charging }
	}
	return r, nil
}

func marshal(m proto.Message) (json.RawMessage, error) {
	b, err := protojson.MarshalOptions{UseProtoNames: false}.Marshal(m)
	return json.RawMessage(b), err
}

// carTimestamp finds the "timestamp" inside the single state group a reading holds.
func carTimestamp(raw json.RawMessage) time.Time {
	var groups map[string]struct {
		Timestamp time.Time `json:"timestamp"`
	}
	if json.Unmarshal(raw, &groups) != nil {
		return time.Time{}
	}
	for _, g := range groups {
		if !g.Timestamp.IsZero() {
			return g.Timestamp
		}
	}
	return time.Time{}
}
