using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>
/// Deleting moves clips into a .trash folder next to the originals, where they stay restorable
/// until the retention period runs out.
/// </summary>
public class TrashService(IDbContextFactory<AppDb> dbf, AppPaths paths, SettingsService settings, Scanner scanner, ILogger<TrashService> log)
    : BackgroundService
{
    private const string SegmentsDir = "_segments";

    public async Task TrashAsync(int eventId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var ev = await db.Events.Include(e => e.Segments).ThenInclude(s => s.Files).FirstAsync(e => e.Id == eventId);
        if (ev.TrashedAt != null) return;

        var source = paths.EventDir(ev);
        var trashRel = $"{AppPaths.TrashDirName}/{ev.Type}/{ev.Name}_{DateTime.UtcNow:yyyyMMddHHmmss}";
        var target = Path.Combine(paths.ClipsBase, trashRel);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        if (ev.Type == EventType.Recent)
        {
            // Recent clips share a folder with other drives, so only this event's files move.
            Directory.CreateDirectory(target);
            foreach (var file in ev.Segments.SelectMany(s => s.Files))
            {
                var from = Path.Combine(source, file.FileName);
                if (File.Exists(from)) File.Move(from, Path.Combine(target, file.FileName));
            }
        }
        else
        {
            Directory.Move(source, target);
        }

        ev.TrashPath = trashRel;
        ev.TrashedAt = DateTime.UtcNow;
        await db.Jobs.Where(j => j.EventId == eventId && j.Status == JobStatus.Queued).ExecuteDeleteAsync();
        await db.SaveChangesAsync();
    }

    public async Task RestoreAsync(int eventId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var ev = await db.Events.Include(e => e.Segments).ThenInclude(s => s.Files).FirstAsync(e => e.Id == eventId);
        if (ev.TrashedAt == null || ev.TrashPath == null) return;

        var source = Path.Combine(paths.ClipsBase, ev.TrashPath);
        var target = Path.Combine(paths.ClipsBase, ev.RelPath);
        if (ev.Type == EventType.Recent)
        {
            Directory.CreateDirectory(target);
            foreach (var file in ev.Segments.SelectMany(s => s.Files))
            {
                var from = Path.Combine(source, file.FileName);
                if (File.Exists(from)) File.Move(from, Path.Combine(target, file.FileName));
            }
            TryDeleteEmpty(source);
        }
        else
        {
            if (Directory.Exists(target)) throw new IOException($"{ev.RelPath} already exists");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            Directory.Move(source, target);
        }
        ev.TrashPath = null;
        ev.TrashedAt = null;
        await db.SaveChangesAsync();
    }

    /// <summary>Removes one recording interval from an event. The files go to the trash folder and the event is reindexed.</summary>
    public async Task TrashSegmentAsync(int eventId, int segmentId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var ev = await db.Events.Include(e => e.Segments).ThenInclude(s => s.Files).FirstAsync(e => e.Id == eventId);
        var segment = ev.Segments.First(s => s.Id == segmentId);
        if (ev.Segments.Count <= 1) throw new InvalidOperationException("This is the only segment; delete the event instead");

        MoveSegments(ev, [segment]);
        await db.SaveChangesAsync();
        scanner.RequestScan();
    }

    /// <summary>
    /// Cuts an event down to the footage around its trigger: segments outside the window set in the settings
    /// go to the trash folder and the event is reindexed. Returns how many segments were removed.
    /// </summary>
    public async Task<int> TrimAsync(int eventId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var ev = await db.Events.Include(e => e.Segments).ThenInclude(s => s.Files).FirstAsync(e => e.Id == eventId);
        if (ev.TrashedAt != null) return 0;
        var outside = Timeline.OutsideTrigger(ev, settings.Current.TrimBeforeSec, settings.Current.TrimAfterSec);
        if (outside.Count == 0) return 0;

        MoveSegments(ev, outside);
        await db.SaveChangesAsync();
        scanner.RequestScan();
        return outside.Count;
    }

    private void MoveSegments(Event ev, List<Segment> segments)
    {
        var target = Path.Combine(paths.TrashDir, SegmentsDir, $"{ev.Name}_{DateTime.UtcNow:yyyyMMddHHmmss}");
        Directory.CreateDirectory(target);
        var source = paths.EventDir(ev);
        foreach (var file in segments.SelectMany(s => s.Files))
        {
            var from = Path.Combine(source, file.FileName);
            if (File.Exists(from)) File.Move(from, Path.Combine(target, file.FileName));
        }
        // The folder contents changed, so its signature no longer matches and the scanner rebuilds the event.
        ev.Signature = "";
    }

    /// <summary>Permanently removes a trashed event.</summary>
    public async Task PurgeAsync(int eventId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var ev = await db.Events.FirstOrDefaultAsync(e => e.Id == eventId && e.TrashedAt != null);
        if (ev?.TrashPath == null) return;
        var dir = Path.Combine(paths.ClipsBase, ev.TrashPath);
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        paths.DeleteEventCache(ev.Id);
        db.Events.Remove(ev);
        await db.SaveChangesAsync();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PurgeExpiredAsync();
            }
            catch (Exception ex)
            {
                log.LogWarning("Trash cleanup failed: {Message}", ex.Message);
            }
            try
            {
                await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task PurgeExpiredAsync()
    {
        var days = settings.Current.TrashRetentionDays;
        var cutoff = DateTime.UtcNow.AddDays(-days);
        List<int> expired;
        await using (var db = await dbf.CreateDbContextAsync())
        {
            expired = await db.Events.Where(e => e.TrashedAt != null && e.TrashedAt < cutoff).Select(e => e.Id).ToListAsync();
        }
        foreach (var id in expired) await PurgeAsync(id);

        var segments = Path.Combine(paths.TrashDir, SegmentsDir);
        if (!Directory.Exists(segments)) return;
        foreach (var dir in new DirectoryInfo(segments).EnumerateDirectories().Where(d => d.CreationTimeUtc < cutoff))
            dir.Delete(true);
    }

    private static void TryDeleteEmpty(string dir)
    {
        try
        {
            if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
        }
        catch (IOException) { }
    }
}
