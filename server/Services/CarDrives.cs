using System.Text.Json;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>
/// One drive, pieced together from car-logger's readings. Id is the start time in Unix milliseconds, which is
/// stable as long as the readings are. The route is [longitude, latitude] pairs (the order maps use).
/// </summary>
public record DriveSummary(long Id, DateTime Start, DateTime End, double? Miles, int? BatteryStart, int? BatteryEnd, double? MaxSpeedMph,
    double? AvgSpeedMph, double? EnergyKwh, string? From, string? To, List<double[]> Route);

/// <summary>Speed and power at one moment of a drive; power is negative while regenerative braking.</summary>
public record DriveSample(DateTime At, double? SpeedMph, double? PowerKw);

/// <summary>Where the car was at one moment of a drive.</summary>
public record DrivePoint(DateTime At, double Lon, double Lat, double? ElevationM);

public record DriveStats(
    double DurationSeconds, double MovingSeconds, int Stops,
    double? AvgSpeedMph, double? MovingSpeedMph, double? MaxSpeedMph,
    double? EnergyKwh, double? RegenKwh, double? WhPerMile,
    double? ClimbM, double? DescentM, double? OutsideC, double? MaxPowerKw);

public record DriveDetail(DriveSummary Summary, DriveStats Stats, List<DriveSample> Samples, List<DrivePoint> Points);

/// <summary>
/// Drives are not stored; they are worked out from the readings car-logger tags as "driving", which come
/// every 15 seconds or so while the car is in gear.
/// </summary>
public static class CarDrives
{
    /// <summary>A stop in Park shorter than this (dropping someone off) stays part of the same drive.</summary>
    public static readonly TimeSpan MaxStop = TimeSpan.FromMinutes(3);

    /// <summary>Battery readings this close before or after a drive count as its start and end level.</summary>
    private static readonly TimeSpan BatteryWindow = TimeSpan.FromMinutes(30);

    /// <summary>Power readings further apart than this (a lost link) aren't joined up when adding up energy.</summary>
    private static readonly TimeSpan MaxEnergyGap = TimeSpan.FromMinutes(2);

    /// <summary>GPS height wobbles by a few metres; only changes bigger than this count as climbing.</summary>
    private const double ClimbStepM = 3;

    private const int MaxRoutePoints = 300;

    public static DateTime At(CarReading r) => DateTime.SpecifyKind(r.CarTime ?? r.PiTime, DateTimeKind.Utc);

    /// <summary>
    /// Builds drives from readings that were taken while driving plus every reading around them that helps
    /// (charge readings for the battery before and after, climate for the outside temperature). Newest first.
    /// </summary>
    public static List<DriveSummary> Build(IEnumerable<CarReading> readings) =>
        Analyse(readings).Select(d => d.Summary).Reverse().ToList();

    /// <summary>One drive in full, by its id, or null when there is no such drive.</summary>
    public static DriveDetail? Detail(IEnumerable<CarReading> readings, long id) =>
        Analyse(readings).FirstOrDefault(d => d.Summary.Id == id);

    private static List<DriveDetail> Analyse(IEnumerable<CarReading> readings)
    {
        var ordered = readings.OrderBy(At).ThenBy(r => r.Id).ToList();
        var charges = new List<(DateTime At, int Level)>();
        var outside = new List<(DateTime At, double C)>();
        foreach (var r in ordered)
        {
            if (r.Kind == "charge" && Group(r, "chargeState", c => Num(c, "batteryLevel")) is { } level) charges.Add((At(r), (int)level));
            if (r.Kind == "climate" && Group(r, "climateState", c => Num(c, "outsideTempCelsius")) is { } temp) outside.Add((At(r), temp));
        }

        var groups = new List<List<CarReading>>();
        foreach (var r in ordered.Where(r => r.Mode == "driving"))
        {
            if (groups.Count == 0 || At(r) - At(groups[^1][^1]) > MaxStop) groups.Add([]);
            groups[^1].Add(r);
        }

        var drives = new List<DriveDetail>();
        foreach (var g in groups)
        {
            var start = At(g[0]);
            var end = At(g[^1]);
            double? firstOdo = null, lastOdo = null;
            string? from = null, to = null;
            var samples = new List<DriveSample>();
            var points = new List<DrivePoint>();
            foreach (var r in g)
            {
                using var doc = JsonDocument.Parse(r.Data);
                var root = doc.RootElement;
                if (r.Kind == "drive" && root.TryGetProperty("driveState", out var d))
                {
                    if (Num(d, "odometerInHundredthsOfAMile") is { } odo)
                    {
                        firstOdo ??= odo;
                        lastOdo = odo;
                    }
                    // In Reverse the speed is still a positive number; the gear says which way.
                    samples.Add(new DriveSample(At(r), Num(d, "speedFloat") ?? Num(d, "speed") ?? 0, Num(d, "power")));
                }
                if (root.TryGetProperty("locationState", out var l))
                {
                    if (Text(l, "locationName") is { Length: > 0 } name)
                    {
                        from ??= name;
                        to = name;
                    }
                    if (Num(l, "latitude") is { } lat && Num(l, "longitude") is { } lon && (lat != 0 || lon != 0))
                        points.Add(new DrivePoint(At(r), Math.Round(lon, 6), Math.Round(lat, 6), Num(l, "geoElevation")));
                }
            }
            var miles = firstOdo != null && lastOdo != null ? Math.Round((lastOdo.Value - firstOdo.Value) / 100, 1) : (double?)null;
            // Pulling out of a space and back in again isn't a drive worth listing.
            if ((miles ?? 0) < 0.1 && end - start < TimeSpan.FromMinutes(1)) continue;

            var before = charges.LastOrDefault(c => c.At <= start && start - c.At <= BatteryWindow);
            var after = charges.FirstOrDefault(c => c.At >= end && c.At - end <= BatteryWindow);
            var during = charges.Where(c => c.At >= start && c.At <= end).ToList();
            int? batteryStart = before != default ? before.Level : during.Count > 0 ? during[0].Level : null;
            int? batteryEnd = after != default ? after.Level : during.Count > 0 ? during[^1].Level : null;
            var temps = outside.Where(c => c.At >= start - BatteryWindow && c.At <= end).Select(c => c.C).ToList();

            var stats = Stats(start, end, miles, samples, points, temps.Count > 0 ? Math.Round(temps.Average(), 1) : null);
            var summary = new DriveSummary(new DateTimeOffset(start).ToUnixTimeMilliseconds(), start, end, miles, batteryStart, batteryEnd,
                stats.MaxSpeedMph, stats.AvgSpeedMph, stats.EnergyKwh, from, to, Thin(points.Select(p => new[] { p.Lon, p.Lat }).ToList()));
            drives.Add(new DriveDetail(summary, stats, samples, points));
        }
        return drives;
    }

    private static DriveStats Stats(DateTime start, DateTime end, double? miles, List<DriveSample> samples, List<DrivePoint> points, double? outsideC)
    {
        var duration = end - start;
        // Time between two readings counts as moving if the car was moving at either end of it.
        var moving = TimeSpan.Zero;
        var stops = 0;
        double used = 0, regen = 0;
        var hasPower = false;
        for (var i = 1; i < samples.Count; i++)
        {
            var (a, b) = (samples[i - 1], samples[i]);
            var gap = b.At - a.At;
            if ((a.SpeedMph ?? 0) > 0 || (b.SpeedMph ?? 0) > 0) moving += gap;
            if ((a.SpeedMph ?? 0) > 0 && (b.SpeedMph ?? 0) == 0) stops++;
            if (a.PowerKw is { } pa && b.PowerKw is { } pb && gap <= MaxEnergyGap)
            {
                hasPower = true;
                // Trapezoids, split where the power crosses zero so regen isn't netted against driving.
                var hours = gap.TotalHours;
                if (pa >= 0 && pb >= 0) used += (pa + pb) / 2 * hours;
                else if (pa <= 0 && pb <= 0) regen += -(pa + pb) / 2 * hours;
                else
                {
                    var cross = Math.Abs(pa) / (Math.Abs(pa) + Math.Abs(pb));
                    var (pos, neg) = pa > 0 ? (pa, pb) : (pb, pa);
                    var (posShare, negShare) = pa > 0 ? (cross, 1 - cross) : (1 - cross, cross);
                    used += pos / 2 * hours * posShare;
                    regen += -neg / 2 * hours * negShare;
                }
            }
        }
        // The last reading of a drive is usually the car coming to rest, which isn't a stop along the way.
        if (stops > 0 && (samples.LastOrDefault()?.SpeedMph ?? 0) == 0) stops--;

        double? climb = null, descent = null;
        var heights = points.Where(p => p.ElevationM != null).Select(p => p.ElevationM!.Value).ToList();
        if (heights.Count > 1)
        {
            climb = 0;
            descent = 0;
            var anchor = heights[0];
            foreach (var h in heights.Skip(1))
            {
                if (h - anchor >= ClimbStepM) (climb, anchor) = (climb + (h - anchor), h);
                else if (anchor - h >= ClimbStepM) (descent, anchor) = (descent + (anchor - h), h);
            }
        }

        var net = used - regen;
        var speeds = samples.Where(s => s.SpeedMph != null).Select(s => s.SpeedMph!.Value).ToList();
        var powers = samples.Where(s => s.PowerKw != null).Select(s => s.PowerKw!.Value).ToList();
        return new DriveStats(
            Math.Round(duration.TotalSeconds), Math.Round(moving.TotalSeconds), stops,
            miles is { } m && duration > TimeSpan.Zero ? Math.Round(m / duration.TotalHours, 1) : null,
            miles is { } mm && moving > TimeSpan.Zero ? Math.Round(mm / moving.TotalHours, 1) : null,
            speeds.Count > 0 ? speeds.Max() : null,
            hasPower ? Math.Round(net, 2) : null,
            hasPower ? Math.Round(regen, 2) : null,
            hasPower && miles is > 0.2 ? Math.Round(net * 1000 / miles.Value) : null,
            climb is { } c ? Math.Round(c) : null, descent is { } dd ? Math.Round(dd) : null,
            outsideC,
            powers.Count > 0 ? powers.Max() : null);
    }

    private static double? Group(CarReading r, string group, Func<JsonElement, double?> pick)
    {
        using var doc = JsonDocument.Parse(r.Data);
        return doc.RootElement.TryGetProperty(group, out var g) ? pick(g) : null;
    }

    private static List<double[]> Thin(List<double[]> route)
    {
        if (route.Count <= MaxRoutePoints) return route;
        var step = (double)route.Count / MaxRoutePoints;
        var thinned = Enumerable.Range(0, MaxRoutePoints - 1).Select(i => route[(int)(i * step)]).ToList();
        thinned.Add(route[^1]);
        return thinned;
    }

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number ? p.GetDouble() : null;

    private static string? Text(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}
