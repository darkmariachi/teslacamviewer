using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>Whether an archive folder is set up, and whether events can be copied into it right now.</summary>
public record ArchiveStatus(string? Folder, bool Available, bool Writable);

/// <summary>
/// Copies events from the main clip folder (often a drive brought in from the car) into the archive folder set with
/// TESLACAM_ARCHIVE_ROOT. The originals are left where they are. The event keeps its row, so notes, favorites,
/// collections and thumbnails come along; from then on it is shown from the archive.
/// </summary>
public class EventArchive(IDbContextFactory<AppDb> dbf, AppPaths paths, Scanner scanner, ILogger<EventArchive> log)
{
    /// <summary>Copies land here first and are moved into place at the end, so a scan never sees half an event.</summary>
    public const string StagingDirName = ".archiving";

    private ArchiveStatus? _status;
    private DateTime _checkedUtc;

    /// <summary>Checked at most once a minute: the write test leaves a (deleted) file on what is often a NAS share.</summary>
    public ArchiveStatus Status()
    {
        if (paths.ArchiveRoot is not { } root) return new ArchiveStatus(null, false, false);
        if (_status != null && DateTime.UtcNow - _checkedUtc < TimeSpan.FromMinutes(1)) return _status;
        var available = Directory.Exists(root);
        _status = new ArchiveStatus(root, available, available && StorageService.IsWritable(root));
        _checkedUtc = DateTime.UtcNow;
        return _status;
    }

    /// <summary>Why an event can't be archived, or null when it can.</summary>
    public string? Refusal(Event ev)
    {
        var status = Status();
        if (status.Folder == null) return "No archive folder is set up.";
        if (!status.Available) return $"The archive folder {status.Folder} isn't available.";
        if (!status.Writable) return $"The archive folder {status.Folder} can't be written to.";
        if (ev.Archived) return "This event is already in the archive.";
        if (ev.TrashedAt != null) return "This event is in the trash.";
        return null;
    }

    /// <summary>Where an event goes in the archive, relative to its clip base: its type folder, without any TeslaCam/ prefix.</summary>
    public static string TargetRelPath(Event ev) => ev.Type switch
    {
        EventType.Sentry => $"SentryClips/{ev.Name}",
        EventType.Saved => $"SavedClips/{ev.Name}",
        _ => "RecentClips",
    };

    public async Task CopyAsync(int eventId, Action<double> progress, CancellationToken ct)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await db.Events.Include(e => e.Segments).ThenInclude(s => s.Files).FirstAsync(e => e.Id == eventId, ct);
        if (ev.Archived) return;
        if (Refusal(ev) is { } reason) throw new InvalidOperationException(reason);
        var archiveBase = paths.ArchiveBase!;

        var source = paths.EventDir(ev);
        if (!Directory.Exists(source)) throw new InvalidOperationException("The event's clips aren't there any more. Is the drive still connected?");
        // A Sentry or Saved event is its whole folder (event.json, thumb.png, event.mp4 too); a drive shares
        // RecentClips with other drives, so only its own clips go.
        var files = ev.Type == EventType.Recent
            ? ev.Segments.SelectMany(s => s.Files).Select(f => new FileInfo(Path.Combine(source, f.FileName))).Where(f => f.Exists).ToList()
            : new DirectoryInfo(source).EnumerateFiles().ToList();
        if (files.Count == 0) throw new InvalidOperationException("The event has no files to copy.");

        var rel = TargetRelPath(ev);
        var target = Path.Combine(archiveBase, rel.Replace('/', Path.DirectorySeparatorChar));
        var staging = Path.Combine(archiveBase, StagingDirName, $"{ev.Type}_{ev.Name}");
        Directory.CreateDirectory(staging);

        // Anything already in the archive with the same name and size counts as copied, as with importing.
        var total = Math.Max(1, files.Sum(f => f.Length));
        long done = 0;
        foreach (var file in files)
        {
            ct.ThrowIfCancellationRequested();
            var existing = new FileInfo(Path.Combine(target, file.Name));
            if (existing.Exists)
            {
                if (existing.Length != file.Length)
                    throw new InvalidOperationException($"The archive already has a different {file.Name} for this event. Nothing was changed.");
                done += file.Length;
                continue;
            }
            var staged = Path.Combine(staging, file.Name);
            var start = done;
            await CopyFileAsync(file.FullName, staged, copied => progress(Math.Min(0.99, (start + copied) / (double)total)), ct);
            // Same times as the original, so the scanner sees the same folder and keeps the event as it is.
            File.SetLastWriteTimeUtc(staged, file.LastWriteTimeUtc);
            done += file.Length;
        }

        await scanner.ExclusiveAsync(async () =>
        {
            Directory.CreateDirectory(target);
            foreach (var staged in new DirectoryInfo(staging).EnumerateFiles())
                staged.MoveTo(Path.Combine(target, staged.Name));
            TryDelete(staging);

            // The event moves to the archive. If the archive copy was already indexed as its own event (it was copied
            // there by hand), that one stands and this row is left for the next scan to sort out.
            var taken = await db.Events.AnyAsync(e => e.Id != ev.Id && e.TrashedAt == null && e.Archived
                                                      && e.Type == ev.Type && e.Name == ev.Name && e.RelPath == rel, ct);
            if (!taken)
            {
                ev.Archived = true;
                ev.RelPath = rel;
                await db.SaveChangesAsync(ct);
            }
        }, ct);
        log.LogInformation("Archived {Type} event {Name}", ev.Type, ev.Name);
        progress(1);
        scanner.RequestScan();
    }

    private static async Task CopyFileAsync(string from, string to, Action<long> progress, CancellationToken ct)
    {
        var buffer = new byte[1 << 20];
        await using var input = new FileStream(from, FileMode.Open, FileAccess.Read, FileShare.Read, 1, FileOptions.SequentialScan);
        await using var output = new FileStream(to, FileMode.Create, FileAccess.Write, FileShare.None, 1);
        long copied = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, ct)) > 0)
        {
            await output.WriteAsync(buffer.AsMemory(0, read), ct);
            copied += read;
            progress(copied);
        }
    }

    private static void TryDelete(string dir)
    {
        try
        {
            if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
            var parent = Path.GetDirectoryName(dir);
            if (parent != null && Directory.Exists(parent) && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent);
        }
        catch (IOException) { }
    }
}
