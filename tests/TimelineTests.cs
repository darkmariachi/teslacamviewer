using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

public class TimelineTests
{
    private static Event EventWith(params (string Start, double Duration)[] segments) => new()
    {
        Segments = segments.Select((s, i) => new Segment { Index = i, StartTime = DateTime.Parse(s.Start), DurationSec = s.Duration }).ToList(),
    };

    [Fact]
    public void Offset_counts_played_time_not_wall_clock_gaps()
    {
        // The second clip starts a second "late"; the timeline has no hole there.
        var ev = EventWith(("2022-06-25T19:28:45", 59.8), ("2022-06-25T19:29:46", 60));

        Assert.Equal(10, Timeline.OffsetOf(ev, DateTime.Parse("2022-06-25T19:28:55")), 3);
        Assert.Equal(59.8 + 8, Timeline.OffsetOf(ev, DateTime.Parse("2022-06-25T19:29:54")), 3);
    }

    [Fact]
    public void Offset_is_clamped_to_the_event()
    {
        var ev = EventWith(("2022-06-25T19:28:45", 60));

        Assert.Equal(0, Timeline.OffsetOf(ev, DateTime.Parse("2022-06-25T19:00:00")));
        Assert.Equal(59, Timeline.OffsetOf(ev, DateTime.Parse("2022-06-25T20:00:00")));
    }

    [Fact]
    public void Four_cameras_make_a_two_by_two_grid()
    {
        var (cells, columns) = Cameras.GridLayout(["right_repeater", "front", "left_repeater", "back"]);

        Assert.Equal(2, columns);
        Assert.Equal(["front", "back", "left_repeater", "right_repeater"], cells);
    }

    [Fact]
    public void Pillar_cameras_make_a_three_by_two_grid_laid_out_like_the_car()
    {
        var (cells, columns) = Cameras.GridLayout(Cameras.All);

        Assert.Equal(3, columns);
        Assert.Equal(["left_pillar", "front", "right_pillar", "left_repeater", "back", "right_repeater"], cells);
    }

    [Fact]
    public void Three_cameras_leave_one_cell_empty()
    {
        var (cells, columns) = Cameras.GridLayout(["front", "back", "left_repeater"]);

        Assert.Equal(2, columns);
        Assert.Equal(["front", "back", "left_repeater", ""], cells);
    }

    [Theory]
    [InlineData("left_pillar", "left_repeater")]
    [InlineData("right_pillar", "right_repeater")]
    [InlineData("front", "front")]
    [InlineData(null, null)]
    public void A_camera_the_car_did_not_save_falls_back_to_the_one_on_the_same_side(string? named, string? expected)
    {
        Assert.Equal(expected, Cameras.Nearest(named, ["front", "back", "left_repeater", "right_repeater"]));
    }

    [Fact]
    public void A_saved_pillar_camera_is_used_as_is()
    {
        Assert.Equal("left_pillar", Cameras.Nearest("left_pillar", Cameras.All));
    }

    [Fact]
    public void Trimming_removes_the_segments_that_miss_the_window_around_the_trigger()
    {
        // Eleven minutes leading up to the trigger, the way newer cars save a Sentry event.
        var ev = EventWith(Enumerable.Range(0, 11).Select(i => ($"2026-10-13T15:{25 + i}:00", 60d)).ToArray());
        ev.TriggerTime = DateTime.Parse("2026-10-13T15:35:27");

        var outside = Timeline.OutsideTrigger(ev, beforeSec: 120, afterSec: 60);

        // 15:33:27 falls in the 15:33 segment, so that one and the two after it stay.
        Assert.Equal(Enumerable.Range(0, 8), outside.Select(s => s.Index));
    }

    [Fact]
    public void Trimming_leaves_events_alone_when_there_is_no_trigger_or_the_window_misses_the_recording()
    {
        var ev = EventWith(("2026-10-13T15:25:00", 60), ("2026-10-13T15:26:00", 60));
        Assert.Empty(Timeline.OutsideTrigger(ev, 120, 60));

        ev.TriggerTime = DateTime.Parse("2026-10-13T18:00:00");
        Assert.Empty(Timeline.OutsideTrigger(ev, 120, 60));
    }

    [Theory]
    [InlineData("all", "all")]
    [InlineData("nonsense", "recent")]
    public void Settings_fall_back_to_safe_values(string policy, string expected)
    {
        var settings = new AppSettings { PreviewPolicy = policy, PreviewQuality = 99, ScanIntervalMinutes = 0, WebhookUrl = "  " }.Sanitized();

        Assert.Equal(expected, settings.PreviewPolicy);
        Assert.Equal(36, settings.PreviewQuality);
        Assert.Equal(1, settings.ScanIntervalMinutes);
        Assert.Null(settings.WebhookUrl);
    }
}
