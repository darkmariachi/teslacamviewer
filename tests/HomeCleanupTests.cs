using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

public class HomeCleanupTests
{
    private static readonly AppSettings Home = new() { HomeLat = 30.267, HomeLon = -97.7841, HomeRadiusM = 100, HomeCleanupEnabled = true, HomeCleanupDays = 3 };

    private static Event Sentry(double lat, double lon, string? reason = "sentry_aware_object_detection") => new()
    {
        Type = EventType.Sentry,
        StartTime = new DateTime(2026, 10, 13, 15, 25, 0),
        Lat = lat,
        Lon = lon,
        Reason = reason,
    };

    [Fact]
    public void Distance_matches_a_known_value()
    {
        // One thousandth of a degree of latitude is about 111 metres anywhere.
        Assert.Equal(111.2, HomeCleanup.DistanceM(30.267, -97.7841, 30.268, -97.7841), 1);
    }

    [Fact]
    public void A_sentry_event_at_home_is_due_after_the_set_number_of_days()
    {
        Assert.Equal(new DateTime(2026, 10, 16, 15, 25, 0), HomeCleanup.DueAt(Sentry(30.2672, -97.7842), Home));
    }

    [Fact]
    public void Events_away_from_home_bumps_favorites_and_collected_events_are_kept()
    {
        Assert.Null(HomeCleanup.DueAt(Sentry(30.2673, -97.7354), Home));
        Assert.Null(HomeCleanup.DueAt(Sentry(30.267, -97.7841, "sentry_aware_accel"), Home));
        Assert.Null(HomeCleanup.DueAt(Sentry(30.267, -97.7841, "sentry_panic_accel"), Home));

        var favorite = Sentry(30.267, -97.7841);
        favorite.Favorite = true;
        Assert.Null(HomeCleanup.DueAt(favorite, Home));

        var collected = Sentry(30.267, -97.7841);
        collected.Collections.Add(new CollectionEvent());
        Assert.Null(HomeCleanup.DueAt(collected, Home));
    }

    [Fact]
    public void Nothing_is_due_while_the_rule_is_off_or_for_saved_clips()
    {
        Assert.Null(HomeCleanup.DueAt(Sentry(30.267, -97.7841), Home with { HomeCleanupEnabled = false }));

        var saved = Sentry(30.267, -97.7841);
        saved.Type = EventType.Saved;
        Assert.Null(HomeCleanup.DueAt(saved, Home));
    }

    [Fact]
    public void A_home_location_without_both_coordinates_is_dropped()
    {
        Assert.Null(new AppSettings { HomeLat = 30.267 }.Sanitized().HomeLat);
        Assert.Null(new AppSettings { HomeLat = 95, HomeLon = 0 }.Sanitized().HomeLat);
    }
}
