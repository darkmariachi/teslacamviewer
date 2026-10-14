using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>Resolves the clip root (originals) and the data directory (database + derived files).</summary>
public class AppPaths
{
    public const string TrashDirName = ".trash";

    public string Root { get; }
    public string Data { get; }
    public string Cache { get; }
    public string DbFile { get; }
    public string KeysDir { get; }

    public AppPaths(IConfiguration config)
    {
        Root = Path.GetFullPath(config["TESLACAM_ROOT"] ?? "/teslacam");
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
    public string ClipsBase
    {
        get
        {
            var nested = Path.Combine(Root, "TeslaCam");
            return !Directory.Exists(Path.Combine(Root, "SentryClips"))
                   && !Directory.Exists(Path.Combine(Root, "SavedClips"))
                   && Directory.Exists(nested)
                ? nested
                : Root;
        }
    }

    public string TrashDir => Path.Combine(ClipsBase, TrashDirName);
    public string ExportsDir => Path.Combine(Cache, "exports");

    public string EventDir(Event e) => Path.Combine(ClipsBase, e.TrashPath ?? e.RelPath);
    public string ClipPath(Event e, ClipFile f) => Path.Combine(EventDir(e), f.FileName);
    /// <summary>The short clip of the trigger that newer cars write next to the camera files.</summary>
    public string CarEventClip(Event e) => Path.Combine(EventDir(e), "event.mp4");

    public string EventCache(int eventId) => Path.Combine(Cache, "events", eventId.ToString());
    public string Thumb(int eventId) => Path.Combine(EventCache(eventId), "thumb.jpg");
    public string EventClip(int eventId) => Path.Combine(EventCache(eventId), "event.mp4");
    public string Preview(int eventId) => Path.Combine(EventCache(eventId), "preview.mp4");
    public string Transcoded(int eventId, int fileId) => Path.Combine(EventCache(eventId), $"t_{fileId}.mp4");
    public string Export(int jobId) => Path.Combine(ExportsDir, $"{jobId}.mp4");

    public void DeleteEventCache(int eventId)
    {
        var dir = EventCache(eventId);
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (IOException) { }
    }
}
