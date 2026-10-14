using TeslaCam.Data;

namespace TeslaCam.Services;

public static class Cameras
{
    /// <summary>Canonical order; also the suffixes Tesla uses in clip file names.</summary>
    public static readonly string[] All =
        ["front", "back", "left_repeater", "right_repeater", "left_pillar", "right_pillar"];

    public static int Order(string camera)
    {
        var i = Array.IndexOf(All, camera);
        return i < 0 ? All.Length : i;
    }

    public static string[] Parse(string csv) =>
        csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>The "camera" index in event.json, as far as it is publicly understood.</summary>
    public static string? FromEventJsonIndex(string? index) => index switch
    {
        "0" => "front",
        "3" => "left_repeater",
        "4" => "right_repeater",
        "5" => "left_pillar",
        "6" => "right_pillar",
        "7" => "back",
        _ => null,
    };

    /// <summary>
    /// The recorded camera to show for <paramref name="camera"/>. Cars that save four cameras still name
    /// a side camera they keep no file for; the other camera on that side saw the same thing.
    /// </summary>
    public static string? Nearest(string? camera, IReadOnlyCollection<string> recorded)
    {
        if (camera == null || recorded.Contains(camera)) return camera;
        var sameSide = camera switch
        {
            "left_pillar" => "left_repeater",
            "right_pillar" => "right_repeater",
            "left_repeater" => "left_pillar",
            "right_repeater" => "right_pillar",
            _ => null,
        };
        return sameSide != null && recorded.Contains(sameSide) ? sameSide : null;
    }

    /// <summary>
    /// Cell order for the merged grid, row by row. Four cameras give a 2x2, six a 3x2 laid out
    /// the way the cameras sit on the car.
    /// </summary>
    public static (string[] Cells, int Columns) GridLayout(IReadOnlyCollection<string> cameras)
    {
        if (cameras.Contains("left_pillar") || cameras.Contains("right_pillar"))
            return (["left_pillar", "front", "right_pillar", "left_repeater", "back", "right_repeater"], 3);
        var ordered = cameras.OrderBy(Order).ToArray();
        if (ordered.Length <= 1) return (ordered, 1);
        if (ordered.Length == 3) return ([.. ordered, ""], 2);
        return (ordered, 2);
    }
}

public static class Timeline
{
    /// <summary>Position of a wall-clock time on the event's concatenated timeline, in seconds.</summary>
    public static double OffsetOf(Event ev, DateTime time)
    {
        double acc = 0;
        foreach (var seg in ev.Segments.OrderBy(s => s.Index))
        {
            if (time < seg.StartTime) return acc;
            var into = (time - seg.StartTime).TotalSeconds;
            if (into < seg.DurationSec) return acc + into;
            acc += seg.DurationSec;
        }
        return Math.Max(0, acc - 1);
    }

    /// <summary>
    /// The segments that lie wholly outside the window around the trigger, i.e. what trimming removes.
    /// Empty when the event has no trigger time or the window misses the recording altogether.
    /// </summary>
    public static List<Segment> OutsideTrigger(Event ev, double beforeSec, double afterSec)
    {
        if (ev.TriggerTime is not { } trigger) return [];
        var from = trigger.AddSeconds(-beforeSec);
        var to = trigger.AddSeconds(afterSec);
        var outside = ev.Segments.Where(s => s.StartTime.AddSeconds(s.DurationSec) <= from || s.StartTime >= to).ToList();
        return outside.Count == ev.Segments.Count ? [] : outside;
    }
}
