using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

public record ScanResult(int Added, int Updated, int Removed, int Total, double Seconds);

public class ScanState
{
    public bool Running { get; set; }
    public DateTime? LastRunUtc { get; set; }
    public ScanResult? LastResult { get; set; }
    public string? LastError { get; set; }
}

/// <summary>Keeps the database in step with the clip folders on disk.</summary>
public partial class Scanner(IDbContextFactory<AppDb> dbf, AppPaths paths, JobQueue queue, SettingsService settings,
    IHttpClientFactory http, ILogger<Scanner> log) : BackgroundService
{
    // Folders still being written by the archiver are left for the next pass.
    private static readonly TimeSpan SettleTime = TimeSpan.FromSeconds(90);
    // Recent clips further apart than this belong to different drives.
    private static readonly TimeSpan RecentGap = TimeSpan.FromSeconds(100);

    // Raise this when event.json parsing changes so existing rows pick up the new fields without a full reindex.
    private const int CurrentMetaVersion = 3;

    private readonly SemaphoreSlim _trigger = new(0);
    private readonly SemaphoreSlim _scanLock = new(1);

    public ScanState State { get; } = new();

    [GeneratedRegex(@"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$", RegexOptions.IgnoreCase)]
    private static partial Regex ClipName();

    // "sentry_aware_accel_0.532005": a reason code followed by a measurement.
    [GeneratedRegex(@"^(.*?)_(\d+(?:\.\d+)?)$")]
    private static partial Regex ReasonWithValue();

    public void RequestScan()
    {
        if (_trigger.CurrentCount == 0) _trigger.Release();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ScanAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Scan failed");
                State.LastError = ex.Message;
            }
            try
            {
                await _trigger.WaitAsync(TimeSpan.FromMinutes(settings.Current.ScanIntervalMinutes), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private record PhysicalFile(DateTime Time, string Camera, string FileName, long Size);

    private record PhysicalEvent(EventType Type, string Name, string RelPath, List<PhysicalFile> Files, string? EventJsonPath, string Signature);

    public async Task<ScanResult> ScanAsync(CancellationToken ct)
    {
        await _scanLock.WaitAsync(ct);
        State.Running = true;
        var started = DateTime.UtcNow;
        try
        {
            var baseDir = paths.ClipsBase;
            if (!Directory.Exists(baseDir)) throw new DirectoryNotFoundException($"Clip folder {baseDir} does not exist");

            var found = new Dictionary<(EventType, string, string), PhysicalEvent>();
            // An event copied into both the library and a TeslaCam folder inside it is listed once, from the library.
            var seen = new HashSet<(EventType, string)>();
            void Add(PhysicalEvent pe)
            {
                if (seen.Add((pe.Type, pe.Name))) found[(pe.Type, pe.Name, pe.RelPath)] = pe;
            }
            var anyTypeDir = false;
            foreach (var clipDir in paths.ClipBases())
            {
                var relative = Path.GetRelativePath(baseDir, clipDir);
                var prefix = relative == "." ? "" : relative.Replace('\\', '/') + "/";
                foreach (var (type, dirName) in new[] { (EventType.Sentry, "SentryClips"), (EventType.Saved, "SavedClips") })
                {
                    var dir = Path.Combine(clipDir, dirName);
                    if (!Directory.Exists(dir)) continue;
                    anyTypeDir = true;
                    foreach (var sub in Directory.EnumerateDirectories(dir))
                    {
                        ct.ThrowIfCancellationRequested();
                        if (ReadFolder(type, sub, Path.GetFileName(sub), $"{prefix}{dirName}/{Path.GetFileName(sub)}") is { } pe) Add(pe);
                    }
                }
                var recentDir = Path.Combine(clipDir, "RecentClips");
                if (Directory.Exists(recentDir))
                {
                    anyTypeDir = true;
                    foreach (var pe in ReadRecent(recentDir, baseDir, ct)) Add(pe);
                }
            }

            await using var db = await dbf.CreateDbContextAsync(ct);
            var existing = await db.Events.Where(e => e.TrashedAt == null)
                .Select(e => new { e.Id, e.Type, e.Name, e.RelPath, e.Signature, e.MetaVersion }).ToListAsync(ct);
            var existingByKey = existing.ToDictionary(e => (e.Type, e.Name, e.RelPath));

            int added = 0, updated = 0, removed = 0;
            var fresh = new List<Event>();
            var pending = 0;
            foreach (var pe in found.Values.OrderByDescending(p => p.Name))
            {
                ct.ThrowIfCancellationRequested();
                if (existingByKey.TryGetValue((pe.Type, pe.Name, pe.RelPath), out var known))
                {
                    if (known.Signature == pe.Signature)
                    {
                        if (known.MetaVersion == CurrentMetaVersion) continue;
                        // Same files, older parsing: refresh the event.json fields only.
                        var stale = await db.Events.FirstAsync(e => e.Id == known.Id, ct);
                        var shown = stale.TriggerCamera;
                        ReadMetadata(stale, pe.EventJsonPath);
                        // The thumbnail job also converts the car's event.mp4; run it again when either is out of date.
                        if (stale.TriggerCamera != shown || (!stale.HasEventClip && File.Exists(paths.CarEventClip(stale))))
                            db.Jobs.Add(JobQueue.NewJob(stale, JobKind.Thumbnail));
                        pending++;
                        continue;
                    }
                    var ev = await db.Events.Include(e => e.Segments).FirstAsync(e => e.Id == known.Id, ct);
                    await db.Jobs.Where(j => j.EventId == ev.Id && j.Status == JobStatus.Queued).ExecuteDeleteAsync(ct);
                    db.Segments.RemoveRange(ev.Segments);
                    ev.Segments.Clear();
                    Fill(ev, pe);
                    ev.Probed = ev.HasThumb = ev.HasEventClip = ev.HasPreview = ev.NeedsTranscode = false;
                    ev.PreviewLayout = null;
                    ev.PreviewDurationSec = null;
                    ev.PreviewSizeBytes = null;
                    paths.DeleteEventCache(ev.Id);
                    queue.AddInitialJobs(db, ev);
                    updated++;
                }
                else
                {
                    var ev = new Event { Type = pe.Type, Name = pe.Name, RelPath = pe.RelPath, IndexedAt = DateTime.UtcNow };
                    Fill(ev, pe);
                    db.Events.Add(ev);
                    queue.AddInitialJobs(db, ev);
                    fresh.Add(ev);
                    added++;
                }
                if (++pending >= 40)
                {
                    await db.SaveChangesAsync(ct);
                    queue.Wake();
                    pending = 0;
                }
            }
            await db.SaveChangesAsync(ct);

            // If the share is not mounted nothing is found; never treat that as "everything was deleted".
            if (anyTypeDir)
            {
                foreach (var gone in existing.Where(e => !found.ContainsKey((e.Type, e.Name, e.RelPath))))
                {
                    await db.Events.Where(e => e.Id == gone.Id).ExecuteDeleteAsync(ct);
                    paths.DeleteEventCache(gone.Id);
                    removed++;
                }
            }

            queue.Wake();
            var result = new ScanResult(added, updated, removed, found.Count, Math.Round((DateTime.UtcNow - started).TotalSeconds, 1));
            State.LastResult = result;
            State.LastError = anyTypeDir ? null : $"No SentryClips, SavedClips or RecentClips folder found in {baseDir}";
            State.LastRunUtc = DateTime.UtcNow;
            if (added + updated + removed > 0)
                log.LogInformation("Scan: {Added} added, {Updated} updated, {Removed} removed", added, updated, removed);
            _ = NotifyAsync(fresh);
            return result;
        }
        finally
        {
            State.Running = false;
            _scanLock.Release();
        }
    }

    private PhysicalEvent? ReadFolder(EventType type, string dir, string name, string relPath)
    {
        var files = new List<PhysicalFile>();
        long size = 0;
        var newest = DateTime.MinValue;
        string? json = null;
        foreach (var info in new DirectoryInfo(dir).EnumerateFiles())
        {
            if (info.LastWriteTimeUtc > newest) newest = info.LastWriteTimeUtc;
            if (info.Name.Equals("event.json", StringComparison.OrdinalIgnoreCase))
            {
                json = info.FullName;
                continue;
            }
            if (ParseClip(info) is { } file)
            {
                files.Add(file);
                size += file.Size;
            }
        }
        if (files.Count == 0) return null;
        if (DateTime.UtcNow - newest < SettleTime) return null;
        return new PhysicalEvent(type, name, relPath, files, json, $"{files.Count}:{size}:{newest.Ticks}:{(json != null ? 1 : 0)}");
    }

    private IEnumerable<PhysicalEvent> ReadRecent(string recentDir, string baseDir, CancellationToken ct)
    {
        foreach (var dir in Directory.EnumerateDirectories(recentDir, "*", SearchOption.AllDirectories).Prepend(recentDir))
        {
            ct.ThrowIfCancellationRequested();
            var infos = new DirectoryInfo(dir).EnumerateFiles("*.mp4").ToList();
            var files = infos.Select(i => (Info: i, Clip: ParseClip(i))).Where(x => x.Clip != null)
                .OrderBy(x => x.Clip!.Time).ToList();
            if (files.Count == 0) continue;
            var relPath = Path.GetRelativePath(baseDir, dir).Replace('\\', '/');

            // Split into drives wherever recording stopped for a while.
            var group = new List<(FileInfo Info, PhysicalFile Clip)>();
            foreach (var item in files)
            {
                if (group.Count > 0 && item.Clip!.Time - group[^1].Clip.Time > RecentGap)
                {
                    if (Build(group) is { } built) yield return built;
                    group = [];
                }
                group.Add((item.Info, item.Clip!));
            }
            if (Build(group) is { } last) yield return last;

            PhysicalEvent? Build(List<(FileInfo Info, PhysicalFile Clip)> items)
            {
                var newest = items.Max(i => i.Info.LastWriteTimeUtc);
                if (DateTime.UtcNow - newest < SettleTime) return null;
                var clips = items.Select(i => i.Clip).ToList();
                var name = "drive_" + clips[0].Time.ToString("yyyy-MM-dd_HH-mm-ss");
                return new PhysicalEvent(EventType.Recent, name, relPath, clips, null,
                    $"{clips.Count}:{clips.Sum(c => c.Size)}:{newest.Ticks}:0");
            }
        }
    }

    private static PhysicalFile? ParseClip(FileInfo info)
    {
        var m = ClipName().Match(info.Name);
        if (!m.Success) return null;
        if (!DateTime.TryParseExact(m.Groups[1].Value, "yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
            return null;
        return new PhysicalFile(time, m.Groups[2].Value.ToLowerInvariant(), info.Name, info.Length);
    }

    private static void Fill(Event ev, PhysicalEvent pe)
    {
        // Cameras occasionally start a second apart; those files still belong to one segment.
        var segments = new List<Segment>();
        foreach (var group in pe.Files.GroupBy(f => f.Time).OrderBy(g => g.Key))
        {
            var seg = segments.Count > 0 && (group.Key - segments[^1].StartTime).TotalSeconds <= 2 ? segments[^1] : null;
            if (seg == null)
            {
                seg = new Segment { Index = segments.Count, StartTime = group.Key, DurationSec = 60 };
                segments.Add(seg);
            }
            foreach (var f in group.OrderBy(f => Cameras.Order(f.Camera)))
            {
                if (seg.Files.Any(x => x.Camera == f.Camera)) continue;
                seg.Files.Add(new ClipFile { Camera = f.Camera, FileName = f.FileName, SizeBytes = f.Size });
            }
        }
        // Until the files are probed, assume a segment runs to the start of the next one.
        for (var i = 0; i < segments.Count - 1; i++)
        {
            var gap = (segments[i + 1].StartTime - segments[i].StartTime).TotalSeconds;
            segments[i].DurationSec = Math.Clamp(gap, 1, 61);
        }

        ev.Segments = segments;
        ev.SegmentCount = segments.Count;
        ev.Signature = pe.Signature;
        ev.SizeBytes = pe.Files.Sum(f => f.Size);
        ev.Cameras = string.Join(',', pe.Files.Select(f => f.Camera).Distinct().OrderBy(Cameras.Order));
        ev.StartTime = segments[0].StartTime;
        ev.DurationSec = segments.Sum(s => s.DurationSec);
        ev.EndTime = segments[^1].StartTime.AddSeconds(segments[^1].DurationSec);
        ReadMetadata(ev, pe.EventJsonPath);
    }

    private static void ReadMetadata(Event ev, string? eventJsonPath)
    {
        ev.TriggerTime = null;
        ev.City = ev.Reason = ev.TriggerCamera = null;
        ev.Lat = ev.Lon = ev.ReasonValue = null;
        ev.MetaVersion = CurrentMetaVersion;
        if (eventJsonPath != null) ReadEventJson(ev, eventJsonPath);
    }

    private static void ReadEventJson(Event ev, string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            string? Get(string name) => root.TryGetProperty(name, out var p)
                ? p.ValueKind == JsonValueKind.String ? p.GetString() : p.ToString()
                : null;

            if (DateTime.TryParse(Get("timestamp"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var ts))
                ev.TriggerTime = DateTime.SpecifyKind(ts, DateTimeKind.Unspecified);
            ev.City = string.IsNullOrWhiteSpace(Get("city")) ? null : Get("city");
            if (Get("reason") is { Length: > 0 } reason)
            {
                var match = ReasonWithValue().Match(reason);
                ev.Reason = match.Success ? match.Groups[1].Value : reason;
                if (match.Success && double.TryParse(match.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                    ev.ReasonValue = value;
            }
            ev.TriggerCamera = Cameras.Nearest(Cameras.FromEventJsonIndex(Get("camera")), Cameras.Parse(ev.Cameras));
            if (double.TryParse(Get("est_lat"), NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) &&
                double.TryParse(Get("est_lon"), NumberStyles.Float, CultureInfo.InvariantCulture, out var lon) &&
                // The car writes zeros (or denormal garbage) when it has no GPS fix.
                Math.Abs(lat) <= 90 && Math.Abs(lon) <= 180 && (Math.Abs(lat) > 1e-4 || Math.Abs(lon) > 1e-4))
            {
                ev.Lat = lat;
                ev.Lon = lon;
            }
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            // A broken event.json only costs the metadata.
        }
    }

    /// <summary>
    /// Whether a newly indexed event is worth a webhook call: a Sentry event from the last day (not an imported
    /// archive), and not one the home rule will clean up anyway. Bumps at home still count.
    /// </summary>
    public static bool ShouldNotify(Event e, AppSettings s, DateTime now) =>
        e.Type == EventType.Sentry && e.StartTime >= now.AddHours(-24) && HomeCleanup.DueAt(e, s) == null;

    /// <summary>Tells the configured webhook about Sentry events that just happened.</summary>
    private async Task NotifyAsync(List<Event> fresh)
    {
        var s = settings.Current;
        var url = s.WebhookUrl;
        if (url == null) return;
        var now = DateTime.Now;
        foreach (var ev in fresh.Where(e => ShouldNotify(e, s, now)).Take(10))
        {
            try
            {
                using var client = http.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(10);
                await client.PostAsJsonAsync(url, new
                {
                    type = "sentry_event", id = ev.Id, name = ev.Name, time = ev.TriggerTime ?? ev.StartTime,
                    city = ev.City, reason = ev.Reason, lat = ev.Lat, lon = ev.Lon,
                });
            }
            catch (Exception ex)
            {
                log.LogWarning("Webhook call failed: {Message}", ex.Message);
            }
        }
    }
}
