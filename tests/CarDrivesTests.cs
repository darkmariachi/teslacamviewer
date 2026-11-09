using System.Text.Json;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

public class CarDrivesTests
{
    private static readonly DateTime T0 = new(2026, 3, 14, 17, 0, 0, DateTimeKind.Utc);
    private int _id;

    private CarReading Reading(string kind, string mode, double minutes, string data) => new()
    {
        Id = ++_id, Kind = kind, Mode = mode, CarTime = T0.AddMinutes(minutes), PiTime = T0.AddMinutes(minutes), Data = data,
        Source = $"log/{_id}",
    };

    private CarReading Drive(double minutes, int odometer, int speed, string mode = "driving", string? place = null, int? power = null) =>
        Reading("drive", mode, minutes, JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["driveState"] = new { shiftState = new { D = new { } }, speed, power, odometerInHundredthsOfAMile = odometer },
            ["locationState"] = new { locationName = place },
        }));

    private CarReading Location(double minutes, double lat, double lon) =>
        Reading("location", "driving", minutes, JsonSerializer.Serialize(new { locationState = new { latitude = lat, longitude = lon } }));

    private CarReading Charge(double minutes, int level, string mode) =>
        Reading("charge", mode, minutes, JsonSerializer.Serialize(new { chargeState = new { batteryLevel = level, chargingState = new { Disconnected = new { } } } }));

    [Fact]
    public void Pieces_drives_together_from_driving_readings()
    {
        var readings = new List<CarReading>
        {
            Charge(-10, 80, "parked"),
            Drive(0, 100_000, 5, place: "Riverside"),
            Location(0.1, 30.267, -97.78),
            Drive(1, 100_050, 40),
            // A two-minute stop in Park is still the same drive.
            Drive(3, 100_120, 35),
            Location(3.1, 30.27, -97.75),
            Drive(4, 100_200, 0, place: "Oak Hill"),
            Charge(5, 78, "parked"),
            // An hour later, a second drive.
            Drive(65, 100_200, 20),
            Charge(65.5, 78, "driving"),
            Drive(68, 100_350, 30),
            Charge(70, 77, "parked"),
            // Rolling out of a space and back in again is not a drive.
            Drive(200, 100_350, 2),
        };

        var drives = CarDrives.Build(readings);

        Assert.Equal(2, drives.Count);
        var (second, first) = (drives[0], drives[1]);
        Assert.Equal(T0, first.Start);
        Assert.Equal(T0.AddMinutes(4), first.End);
        Assert.Equal(2.0, first.Miles);
        Assert.Equal((80, 78), (first.BatteryStart, first.BatteryEnd));
        Assert.Equal(40, first.MaxSpeedMph);
        Assert.Equal(("Riverside", "Oak Hill"), (first.From, first.To));
        Assert.Equal([-97.78, 30.267], first.Route[0]);
        Assert.Equal(2, first.Route.Count);

        Assert.Equal(1.5, second.Miles);
        Assert.Equal((78, 77), (second.BatteryStart, second.BatteryEnd));
    }

    [Fact]
    public void Works_out_energy_stops_and_moving_time()
    {
        var readings = new List<CarReading>
        {
            Drive(0, 100_000, 30, power: 30),
            Drive(1, 100_050, 30, power: 30),   // one minute at 30 kW: 0.5 kWh
            Drive(2, 100_100, 0, power: -30),   // crossing zero halfway: 0.125 kWh each way
            Drive(3, 100_100, 0, power: -30),   // stopped at a light: 0.5 kWh of regen, not moving
            Drive(4, 100_150, 25, power: 0),    // 0.25 kWh of regen
            Drive(5, 100_200, 0, power: 0),     // coming to rest at the end isn't a stop along the way
            Location(0, 30.267, -97.78),
            Location(5, 30.27, -97.75),
        };

        var id = CarDrives.Build(readings).Single().Id;
        var drive = CarDrives.Detail(readings, id)!;

        Assert.Equal(new DateTimeOffset(T0).ToUnixTimeMilliseconds(), id);
        Assert.Null(CarDrives.Detail(readings, id + 1));
        Assert.Equal(6, drive.Samples.Count);
        Assert.Equal(2, drive.Points.Count);
        Assert.Equal(300, drive.Stats.DurationSeconds);
        Assert.Equal(240, drive.Stats.MovingSeconds);
        Assert.Equal(1, drive.Stats.Stops);
        Assert.Equal(0.88, drive.Stats.RegenKwh);
        Assert.Equal(-0.25, drive.Stats.EnergyKwh);
        Assert.Equal(30, drive.Stats.MaxSpeedMph);
        Assert.Equal(24, drive.Stats.AvgSpeedMph);
    }
}
