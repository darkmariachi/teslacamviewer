using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>
/// With Sentry on at home to keep the archiver powered, most home events are people walking past.
/// These rules decide which of them clean themselves up after a few days.
/// </summary>
public static class HomeCleanup
{
    /// <summary>Great-circle distance in metres.</summary>
    public static double DistanceM(double lat1, double lon1, double lat2, double lon2)
    {
        const double earthRadius = 6_371_000;
        double Rad(double deg) => deg * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * earthRadius * Math.Asin(Math.Sqrt(a));
    }

    public static bool IsAtHome(Event e, AppSettings s) =>
        s is { HomeLat: { } homeLat, HomeLon: { } homeLon } && e is { Lat: { } lat, Lon: { } lon }
        && DistanceM(lat, lon, homeLat, homeLon) <= s.HomeRadiusM;

    /// <summary>Something touched the car; worth keeping even at home.</summary>
    public static bool IsBump(string? reason) => reason?.Contains("accel", StringComparison.Ordinal) == true;

    /// <summary>
    /// When the event moves to the trash, or null if the rule leaves it alone.
    /// Favorites and events in a collection are always kept; <see cref="Event.Collections"/> must be loaded.
    /// </summary>
    public static DateTime? DueAt(Event e, AppSettings s)
    {
        if (!s.HomeCleanupEnabled || e.Type != EventType.Sentry || e.TrashedAt != null) return null;
        if (e.Favorite || e.Collections.Count > 0 || IsBump(e.Reason) || !IsAtHome(e, s)) return null;
        return e.StartTime.AddDays(s.HomeCleanupDays);
    }
}
