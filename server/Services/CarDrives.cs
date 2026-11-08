using System.Text.Json;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>
/// One drive, pieced together from car-logger's readings: when, how far, the battery it took and the
/// route as [longitude, latitude] pairs (the order maps use).
/// </summary>
public record DriveSummary(DateTime Start, DateTime End, double? Miles, int? BatteryStart, int? BatteryEnd, double? MaxSpeedMph,
    string? From, string? To, List<double[]> Route);

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

    private const int MaxRoutePoints = 300;

    public static DateTime At(CarReading r) => DateTime.SpecifyKind(r.CarTime ?? r.PiTime, DateTimeKind.Utc);

    /// <summary>
    /// Builds drives from readings that were taken while driving plus every charge reading around them (for
    /// the battery level before and after). Newest first.
    /// </summary>
    public static List<DriveSummary> Build(IEnumerable<CarReading> readings)
    {
        var ordered = readings.OrderBy(At).ThenBy(r => r.Id).ToList();
        var charges = ordered.Where(r => r.Kind == "charge").Select(r => (At: At(r), Level: BatteryLevel(r))).Where(c => c.Level != null).ToList();

        var groups = new List<List<CarReading>>();
        foreach (var r in ordered.Where(r => r.Mode == "driving"))
        {
            if (groups.Count == 0 || At(r) - At(groups[^1][^1]) > MaxStop) groups.Add([]);
            groups[^1].Add(r);
        }

        var drives = new List<DriveSummary>();
        foreach (var g in groups)
        {
            var start = At(g[0]);
            var end = At(g[^1]);
            double? firstOdo = null, lastOdo = null, maxSpeed = null;
            string? from = null, to = null;
            var route = new List<double[]>();
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
                    if ((Num(d, "speedFloat") ?? Num(d, "speed")) is { } speed && speed > (maxSpeed ?? 0)) maxSpeed = speed;
                }
                if (root.TryGetProperty("locationState", out var l))
                {
                    if (Text(l, "locationName") is { Length: > 0 } name)
                    {
                        from ??= name;
                        to = name;
                    }
                    if (Num(l, "latitude") is { } lat && Num(l, "longitude") is { } lon && (lat != 0 || lon != 0))
                        route.Add([Math.Round(lon, 6), Math.Round(lat, 6)]);
                }
            }
            var miles = firstOdo != null && lastOdo != null ? Math.Round((lastOdo.Value - firstOdo.Value) / 100, 1) : (double?)null;
            // Pulling out of a space and back in again isn't a drive worth listing.
            if ((miles ?? 0) < 0.1 && end - start < TimeSpan.FromMinutes(1)) continue;

            var before = charges.LastOrDefault(c => c.At <= start && start - c.At <= BatteryWindow);
            var after = charges.FirstOrDefault(c => c.At >= end && c.At - end <= BatteryWindow);
            var during = charges.Where(c => c.At >= start && c.At <= end).ToList();
            var batteryStart = before.Level ?? during.FirstOrDefault().Level;
            var batteryEnd = after.Level ?? during.LastOrDefault().Level;

            drives.Add(new DriveSummary(start, end, miles, batteryStart, batteryEnd, maxSpeed, from, to, Thin(route)));
        }
        drives.Reverse();
        return drives;
    }

    private static int? BatteryLevel(CarReading r)
    {
        using var doc = JsonDocument.Parse(r.Data);
        return doc.RootElement.TryGetProperty("chargeState", out var c) && Num(c, "batteryLevel") is { } level ? (int)level : null;
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
