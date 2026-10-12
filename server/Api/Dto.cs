using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class Dto
{
    /// <summary>SQLite hands UTC timestamps back without a kind; restore it so JSON carries the Z suffix.</summary>
    public static DateTime? Utc(DateTime? value) => value is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;

    public static object Summary(Event e) => new
    {
        e.Id,
        type = e.Type.ToString().ToLowerInvariant(),
        e.Name,
        e.StartTime,
        e.EndTime,
        e.DurationSec,
        e.TriggerTime,
        e.City,
        e.Lat,
        e.Lon,
        e.Reason,
        e.ReasonValue,
        cameras = Cameras.Parse(e.Cameras),
        e.SegmentCount,
        e.SizeBytes,
        e.Favorite,
        hasNotes = !string.IsNullOrEmpty(e.Notes),
        e.HasThumb,
        e.HasPreview,
        e.NeedsTranscode,
        trashedAt = Utc(e.TrashedAt),
    };

    public static object JobDto(Job j, JobQueue queue, Event? ev = null) => new
    {
        j.Id,
        j.EventId,
        eventName = ev?.Name,
        eventStart = ev?.StartTime,
        kind = j.Kind.ToString().ToLowerInvariant(),
        status = j.Status.ToString().ToLowerInvariant(),
        j.UserRequested,
        progress = j.Status == JobStatus.Running && queue.LiveProgress.TryGetValue(j.Id, out var p) ? p : j.Progress,
        j.Error,
        j.Attempts,
        args = j.ArgsJson,
        j.OutputSizeBytes,
        createdAt = Utc(j.CreatedAt),
        startedAt = Utc(j.StartedAt),
        finishedAt = Utc(j.FinishedAt),
    };
}
