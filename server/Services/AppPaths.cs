using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>Resolves the clip root (originals) and the data directory (database + derived files).</summary>
public class AppPaths
{
    public const string TrashDirName = ".trash";

    public string Root { get; }
    /// <summary>
    /// An optional second clip folder for keeping events for good (TESLACAM_ARCHIVE_ROOT), while Root is often a drive
    /// brought in from the car. Events can be copied into it from the app.
    /// </summary>
    public string? ArchiveRoot { get; }
    public string Data { get; }
    public string Cache { get; }
    public string DbFile { get; }
    public string KeysDir { get; }

    public AppPaths(IConfiguration config)
    {
        Root = Path.GetFullPath(config["TESLACAM_ROOT"] ?? "/teslacam");
        ArchiveRoot = config["TESLACAM_ARCHIVE_ROOT"] is { Length: > 0 } archive ? Path.GetFullPath(archive) : null;
        Data = Path.GetFullPath(config["TESLACAM_DATA"] ?? "/data");
        Cache = Path.GetFullPath(config["TESLACAM_CACHE"] ?? Path.Combine(Data, "cache"));
        DbFile = Path.Combine(Data, "teslacam.db");
        KeysDir = Path.Combine(Data, "keys");
        Directory.CreateDirectory(Data);
        Directory.CreateDirectory(Cache);
        Directory.CreateDirectory(KeysDir);
        Directory.CreateDirectory(ExportsDir);
    }

    /// <summary>
    /// Where the Sentry/Saved/Recent folders live. teslausb archives them at the share root,
    /// a raw USB drive copy has them under TeslaCam/.
    /// </summary>
    public string ClipsBase => BaseOf(Root);

    /// <summary>The archive's clip base, or null when no archive folder is set up.</summary>
    public string? ArchiveBase => ArchiveRoot == null ? null : BaseOf(ArchiveRoot);

    private static string BaseOf(string root)
    {
        var nested = Path.Combine(root, "TeslaCam");
        return !Directory.Exists(Path.Combine(root, "SentryClips"))
               && !Directory.Exists(Path.Combine(root, "SavedClips"))
               && Directory.Exists(nested)
            ? nested
            : root;
    }

    /// <summary>The clip base an event lives under: the archive's for archived events, the main one otherwise.</summary>
    public string BaseFor(Event e) => e.Archived ? ArchiveBase ?? Path.Combine(ClipsBase, ".archive-not-set-up") : ClipsBase;

    /// <summary>
    /// Every folder clips are read from: the clip base, then a TeslaCam folder inside it. The second happens when
    /// someone drags the whole folder off the car's drive into a library that already has clips.
    /// </summary>
    public IEnumerable<string> ClipBases(bool archive = false)
    {
        var main = archive ? ArchiveBase : ClipsBase;
        if (main == null) yield break;
        yield return main;
        var nested = Path.Combine(main, "TeslaCam");
        if (Directory.Exists(nested)) yield return nested;
    }

    public string TrashDir => Path.Combine(ClipsBase, TrashDirName);
    /// <summary>The trash next to an event's own clips, so deleting never copies across drives.</summary>
    public string TrashDirFor(Event e) => Path.Combine(BaseFor(e), TrashDirName);
    public string ExportsDir => Path.Combine(Cache, "exports");

    public string EventDir(Event e) => Path.Combine(BaseFor(e), e.TrashPath ?? e.RelPath);
    public string ClipPath(Event e, ClipFile f) => Path.Combine(EventDir(e), f.FileName);
    /// <summary>The short clip of the trigger that newer cars write next to the camera files.</summary>
    public string CarEventClip(Event e) => Path.Combine(EventDir(e), "event.mp4");

    public string EventCache(int eventId) => Path.Combine(Cache, "events", eventId.ToString());
    public string Thumb(int eventId) => Path.Combine(EventCache(eventId), "thumb.jpg");
    public string EventClip(int eventId) => Path.Combine(EventCache(eventId), "event.mp4");
    public string Preview(int eventId) => Path.Combine(EventCache(eventId), "preview.mp4");
    public string DriveData(int eventId) => Path.Combine(EventCache(eventId), "drive.json");
    public string Transcoded(int eventId, int fileId) => Path.Combine(EventCache(eventId), $"t_{fileId}.mp4");
    public string Export(int jobId) => Path.Combine(ExportsDir, $"{jobId}.mp4");

    public void DeleteEventCache(int eventId)
    {
        var dir = EventCache(eventId);
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (IOException) { }
    }
}
