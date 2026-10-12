namespace TeslaCam.Data;

public enum EventType { Sentry, Saved, Recent }

public enum JobKind { Probe, Thumbnail, Preview, Transcode, Export }

public enum JobStatus { Queued, Running, Done, Failed, Canceled }

/// <summary>One Sentry/Saved event folder, or one contiguous run of RecentClips.</summary>
public class Event
{
    public int Id { get; set; }
    public EventType Type { get; set; }
    /// <summary>Folder name for Sentry/Saved, synthetic name for Recent.</summary>
    public string Name { get; set; } = "";
    /// <summary>Directory holding the clips, relative to the clip root.</summary>
    public string RelPath { get; set; } = "";
    /// <summary>Set while the event sits in the trash; replaces RelPath for file access.</summary>
    public string? TrashPath { get; set; }
    public DateTime? TrashedAt { get; set; }

    // Car-local wall clock times, taken from file names.
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public double DurationSec { get; set; }

    // From event.json (absent on Recent clips and some old events).
    public DateTime? TriggerTime { get; set; }
    public string? City { get; set; }
    public double? Lat { get; set; }
    public double? Lon { get; set; }
    public string? Reason { get; set; }
    public string? TriggerCamera { get; set; }

    /// <summary>Comma separated camera names present in this event.</summary>
    public string Cameras { get; set; } = "";
    public int SegmentCount { get; set; }
    public long SizeBytes { get; set; }
    /// <summary>File count + size + newest mtime; a change triggers a reindex.</summary>
    public string Signature { get; set; } = "";

    public bool Favorite { get; set; }
    public string? Notes { get; set; }

    public bool Probed { get; set; }
    public bool HasThumb { get; set; }
    public bool HasPreview { get; set; }
    /// <summary>Camera order used for the merged grid, comma separated.</summary>
    public string? PreviewLayout { get; set; }
    public double? PreviewDurationSec { get; set; }
    public long? PreviewSizeBytes { get; set; }
    /// <summary>True when any clip is in a codec browsers may not play (e.g. HEVC).</summary>
    public bool NeedsTranscode { get; set; }

    public DateTime IndexedAt { get; set; }

    public List<Segment> Segments { get; set; } = [];
    public List<CollectionEvent> Collections { get; set; } = [];
}

/// <summary>One recording interval (about a minute) with a file per camera.</summary>
public class Segment
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event Event { get; set; } = null!;
    public int Index { get; set; }
    public DateTime StartTime { get; set; }
    public double DurationSec { get; set; }
    public List<ClipFile> Files { get; set; } = [];
}

public class ClipFile
{
    public int Id { get; set; }
    public int SegmentId { get; set; }
    public Segment Segment { get; set; } = null!;
    public string Camera { get; set; } = "";
    public string FileName { get; set; } = "";
    public long SizeBytes { get; set; }
    public string? Codec { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public double? DurationSec { get; set; }
    /// <summary>True once a browser-compatible copy exists in the cache.</summary>
    public bool Transcoded { get; set; }
}

public class Job
{
    public int Id { get; set; }
    public int EventId { get; set; }
    public Event Event { get; set; } = null!;
    public JobKind Kind { get; set; }
    public JobStatus Status { get; set; }
    /// <summary>Higher runs first. User-requested jobs get a boost.</summary>
    public int Priority { get; set; }
    public bool UserRequested { get; set; }
    public double Progress { get; set; }
    public string? Error { get; set; }
    /// <summary>Kind-specific arguments (export range, camera) as JSON.</summary>
    public string? ArgsJson { get; set; }
    public string? OutputFile { get; set; }
    public long? OutputSizeBytes { get; set; }
    public int Attempts { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

public class Collection
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<CollectionEvent> Events { get; set; } = [];
}

public class CollectionEvent
{
    public int CollectionId { get; set; }
    public Collection Collection { get; set; } = null!;
    public int EventId { get; set; }
    public Event Event { get; set; } = null!;
    public DateTime AddedAt { get; set; }
}

public class Setting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
