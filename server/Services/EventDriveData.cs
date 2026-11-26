using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>What an event's drive data adds up to: where it starts and ends, and the route between.</summary>
public record DriveDataResult(string Json, (double Lat, double Lon)? Start, (double Lat, double Lon)? End, List<double[]> Route);

/// <summary>
/// Turns the driving data in an event's clips into what the app keeps: a compact per-segment file the player
/// draws its HUD from, the start and end points, and a thinned route for the map.
/// </summary>
public static class EventDriveData
{
    /// <summary>Raise when the reading or the file format changes, so every event is read again.</summary>
    public const int Version = 1;

    // Ten readings a second keeps the HUD smooth while the file stays small (about 60 KB a minute).
    private const double Step = 0.1;
    // Route points closer together than this add nothing to a line on the map.
    private const double RouteSpacingMeters = 25;
    // A city borrowed from another event must be this close.
    private const double CityRadiusKm = 5;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Builds the stored form from each segment's frames (segment index, frames with times from the clip's start).</summary>
    public static DriveDataResult? Build(IEnumerable<(int Index, List<DriveFrame> Frames)> segments)
    {
        var parts = new List<object>();
        (double, double)? start = null, end = null;
        var route = new List<double[]>();
        foreach (var (index, frames) in segments.OrderBy(s => s.Index))
        {
            if (frames.Count == 0) continue;
            var kept = new List<DriveFrame>();
            foreach (var f in frames)
                if (kept.Count == 0 || f.T - kept[^1].T >= Step - 0.005) kept.Add(f);

            // The ends come from every frame, so the last fix isn't lost to the thinning.
            foreach (var f in frames)
            {
                if (f.Lat is not { } lat || f.Lon is not { } lon) continue;
                start ??= (lat, lon);
                end = (lat, lon);
            }
            foreach (var f in kept)
            {
                if (f.Lat is not { } lat || f.Lon is not { } lon) continue;
                if (route.Count == 0 || Meters(route[^1][1], route[^1][0], lat, lon) >= RouteSpacingMeters)
                    route.Add([Math.Round(lon, 5), Math.Round(lat, 5)]);
            }

            parts.Add(new
            {
                index,
                t = kept.Select(f => Math.Round(f.T, 2)),
                speed = kept.Select(f => Math.Round(f.SpeedMps, 2)),
                gear = kept.Select(f => f.Gear),
                pedal = kept.Select(f => Math.Round(f.PedalPct)),
                steer = kept.Select(f => Math.Round(f.SteeringDeg, 1)),
                brake = kept.Select(f => f.Brake ? 1 : 0),
                // Bit 1 left, bit 2 right.
                blinker = kept.Select(f => (f.BlinkerLeft ? 1 : 0) | (f.BlinkerRight ? 2 : 0)),
                autopilot = kept.Select(f => f.Autopilot),
                heading = kept.Select(f => Math.Round(f.HeadingDeg)),
                // The car's x axis points sideways and y backwards (checked against the speed and steering on
                // real clips), so forward acceleration is -y.
                accel = kept.Select(f => Math.Round(-f.AccelY, 2)),
                lateral = kept.Select(f => Math.Round(f.AccelX, 2)),
                lat = kept.Select(f => f.Lat is { } v ? Math.Round(v, 6) : (double?)null),
                lon = kept.Select(f => f.Lon is { } v ? Math.Round(v, 6) : (double?)null),
            });
        }
        if (parts.Count == 0) return null;
        if (end is { } last && route.Count > 0 && (route[^1][0] != Math.Round(last.Item2, 5) || route[^1][1] != Math.Round(last.Item1, 5)))
            route.Add([Math.Round(last.Item2, 5), Math.Round(last.Item1, 5)]);
        return new DriveDataResult(JsonSerializer.Serialize(new { version = Version, segments = parts }, Json), start, end, route);
    }

    /// <summary>
    /// Reads the drive data of every segment (front camera first; every camera carries the same data) and stores
    /// the result on the event. The caller saves.
    /// </summary>
    public static async Task ApplyAsync(AppDb db, Event ev, AppPaths paths, CancellationToken ct)
    {
        var segments = new List<(int, List<DriveFrame>)>();
        foreach (var seg in ev.Segments.OrderBy(s => s.Index))
        {
            ct.ThrowIfCancellationRequested();
            var file = seg.Files.OrderBy(f => f.Camera == "front" ? 0 : 1).ThenBy(f => Cameras.Order(f.Camera)).FirstOrDefault();
            if (file == null) continue;
            var path = paths.ClipPath(ev, file);
            try
            {
                var frames = await Task.Run(() => DriveData.ReadClip(path), ct);
                if (frames.Count > 0) segments.Add((seg.Index, frames));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
            {
                // A damaged or missing clip only costs its share of the data.
            }
        }

        var result = Build(segments);
        var cache = paths.DriveData(ev.Id);
        var track = await db.EventTracks.FirstOrDefaultAsync(t => t.EventId == ev.Id, ct);
        ev.DriveDataVersion = Version;
        ev.HasDriveData = result != null;
        ev.EndLat = ev.EndLon = null;
        ev.EndCity = null;
        if (result == null)
        {
            if (File.Exists(cache)) File.Delete(cache);
            if (track != null) db.EventTracks.Remove(track);
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(cache)!);
        await File.WriteAllTextAsync(cache, result.Json, ct);

        // event.json's own place wins; drives have none, so they take the first GPS fix.
        if (result.Start is { } start && ev.Lat == null)
        {
            ev.Lat = Math.Round(start.Lat, 6);
            ev.Lon = Math.Round(start.Lon, 6);
        }
        if (result.End is { } end)
        {
            ev.EndLat = Math.Round(end.Lat, 6);
            ev.EndLon = Math.Round(end.Lon, 6);
        }
        if (ev.City == null && ev.Lat is { } lat && ev.Lon is { } lon) ev.City = await NearestCityAsync(db, ev.Id, lat, lon, ct);
        if (ev.EndLat is { } endLat && ev.EndLon is { } endLon) ev.EndCity = await NearestCityAsync(db, ev.Id, endLat, endLon, ct);

        if (result.Route.Count >= 2)
        {
            var points = JsonSerializer.Serialize(result.Route);
            if (track == null) db.EventTracks.Add(new EventTrack { EventId = ev.Id, Points = points });
            else track.Points = points;
        }
        else if (track != null) db.EventTracks.Remove(track);
    }

    /// <summary>
    /// The car only names the place in event.json, so a drive borrows the name of the closest event that has one.
    /// Only event.json names count (those events have a trigger time), so borrowed names never spread further.
    /// </summary>
    public static async Task<string?> NearestCityAsync(AppDb db, int selfId, double lat, double lon, CancellationToken ct)
    {
        var dLat = CityRadiusKm / 111.0;
        var dLon = CityRadiusKm / (111.0 * Math.Max(0.1, Math.Cos(lat * Math.PI / 180)));
        var near = await db.Events.AsNoTracking()
            .Where(e => e.Id != selfId && e.City != null && e.TriggerTime != null && e.Lat != null && e.Lon != null
                        && e.Lat > lat - dLat && e.Lat < lat + dLat && e.Lon > lon - dLon && e.Lon < lon + dLon)
            .Select(e => new { e.City, e.Lat, e.Lon })
            .Take(500)
            .ToListAsync(ct);
        return near
            .Select(e => (e.City, Km: Meters(lat, lon, e.Lat!.Value, e.Lon!.Value) / 1000))
            .Where(x => x.Km <= CityRadiusKm)
            .OrderBy(x => x.Km)
            .Select(x => x.City)
            .FirstOrDefault();
    }

    public static double Meters(double lat1, double lon1, double lat2, double lon2)
    {
        const double r = 6371000;
        var p1 = lat1 * Math.PI / 180;
        var p2 = lat2 * Math.PI / 180;
        var dp = p2 - p1;
        var dl = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dp / 2) * Math.Sin(dp / 2) + Math.Cos(p1) * Math.Cos(p2) * Math.Sin(dl / 2) * Math.Sin(dl / 2);
        return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
