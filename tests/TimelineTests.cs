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
