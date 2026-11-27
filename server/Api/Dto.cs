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
        e.Archived,
        e.StartTime,
        e.EndTime,
        e.DurationSec,
        e.TriggerTime,
        e.City,
        e.Lat,
        e.Lon,
        e.EndLat,
        e.EndLon,
        e.EndCity,
        e.HasDriveData,
        e.Reason,
        e.ReasonValue,
        e.TriggerCamera,
        cameras = Cameras.Parse(e.Cameras),
        e.SegmentCount,
        // Filled only where the query includes them (the event list and a single event).
        collectionIds = e.Collections.Select(c => c.CollectionId),
        e.SizeBytes,
        e.Favorite,
        hasNotes = !string.IsNullOrEmpty(e.Notes),
        e.HasThumb,
        e.HasEventClip,
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
