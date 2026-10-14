using System.Text.RegularExpressions;

namespace TeslaCam.Services;

public record ImportFile(string Path, long Size);

public record ImportPlan(List<ImportFile> Missing, int AlreadyThere, int Ignored)
{
    public long MissingBytes => Missing.Sum(f => f.Size);
}

/// <summary>Progress of a copy from a folder or drive, as the desktop app shows it.</summary>
public class ImportState
{
    public bool Running { get; set; }
    public string? Source { get; set; }
    public int TotalFiles { get; set; }
    public long TotalBytes { get; set; }
    public int DoneFiles { get; set; }
    public long DoneBytes { get; set; }
    public int AlreadyThere { get; set; }
    public int Failed { get; set; }
    public int Deleted { get; set; }
    public bool DeleteAfter { get; set; }
    public bool Canceled { get; set; }
    public string? Error { get; set; }
    public DateTime? StartedUtc { get; set; }
    public DateTime? FinishedUtc { get; set; }
}

public record ImportDrive(string Path, string Name, long TotalBytes);

/// <summary>
/// Brings clips into the library: files uploaded from a browser, or a folder or USB drive copied by the
/// desktop app. Only files the car writes are accepted, they keep the car's folder layout, and anything
/// already in the library with the same size is skipped. The originals are never changed unless the user
/// asks for the drive to be cleared after copying.
/// </summary>
public partial class ImportService(AppPaths paths, Scanner scanner, ILogger<ImportService> log)
{
    private static readonly string[] ClipFolders = ["SentryClips", "SavedClips", "RecentClips"];

    [GeneratedRegex(@"^(SentryClips|SavedClips)/[^/]+/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4|event\.json|event\.mp4|thumb\.png)$")]
    private static partial Regex EventFile();

    // The car keeps RecentClips flat; teslausb's archive sorts them into one folder per day.
    [GeneratedRegex(@"^RecentClips/([^/]+/)?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$")]
    private static partial Regex RecentFile();

    private readonly Lock _lock = new();
    private CancellationTokenSource? _cts;

    public ImportState State { get; private set; } = new();

    /// <summary>
    /// Turns a path from the car's drive (with or without a leading TeslaCam/ or drive name) into one relative
    /// to the clip folder, or null when it is not a file the car writes.
    /// </summary>
    public static string? Normalize(string path)
    {
        var parts = path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Any(p => p is "." or "..")) return null;
        var start = Array.FindIndex(parts, p => ClipFolders.Contains(p));
        if (start < 0) return null;
        var relative = string.Join('/', parts[start..]);
        return EventFile().IsMatch(relative) || RecentFile().IsMatch(relative) ? relative : null;
    }

    private string Destination(string relative) => Path.Combine(paths.ClipsBase, relative.Replace('/', Path.DirectorySeparatorChar));

    private bool AlreadyThere(string relative, long size)
    {
        var dest = new FileInfo(Destination(relative));
        return dest.Exists && dest.Length == size;
    }

    /// <summary>Which of these files the library still needs.</summary>
    public ImportPlan Check(IEnumerable<ImportFile> files)
    {
        var missing = new List<ImportFile>();
        int there = 0, ignored = 0;
        foreach (var file in files)
        {
            if (Normalize(file.Path) is not { } relative) ignored++;
            else if (AlreadyThere(relative, file.Size)) there++;
            // Paths go back as they came, so the caller can match them to its own files.
            else missing.Add(file);
        }
        return new ImportPlan(missing, there, ignored);
    }

    /// <summary>Stores one uploaded file. It is written beside its final name first, so a broken upload never looks complete.</summary>
    public async Task SaveAsync(string path, Stream body, long? expectedSize, DateTimeOffset? modified, CancellationToken ct)
    {
        var relative = Normalize(path) ?? throw new InvalidOperationException($"{path} is not a file the car writes.");
        if (expectedSize is { } size && AlreadyThere(relative, size)) return;
        var dest = Destination(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        var temp = dest + ".part";
        try
        {
            await using (var output = File.Create(temp))
                await body.CopyToAsync(output, 1 << 20, ct);
            if (expectedSize is { } wanted && new FileInfo(temp).Length != wanted)
                throw new InvalidOperationException($"{relative} arrived incomplete.");
            File.Move(temp, dest, true);
            // Keep the car's timestamp so the folder counts as finished straight away.
            if (modified is { } when) File.SetLastWriteTimeUtc(dest, when.UtcDateTime);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    /// <summary>The folder holding SentryClips and friends: the folder itself, or its TeslaCam folder.</summary>
    public static string? FindClipRoot(string folder)
    {
        if (!Directory.Exists(folder)) return null;
        var nested = Path.Combine(folder, "TeslaCam");
        if (Directory.Exists(nested) && ClipFolders.Any(f => Directory.Exists(Path.Combine(nested, f)))) return nested;
        return ClipFolders.Any(f => Directory.Exists(Path.Combine(folder, f))) ? folder : null;
    }

    private static List<(string Full, ImportFile File)> Enumerate(string clipRoot)
    {
        var found = new List<(string, ImportFile)>();
        foreach (var name in ClipFolders)
        {
            var dir = Path.Combine(clipRoot, name);
            if (!Directory.Exists(dir)) continue;
            foreach (var info in new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(clipRoot, info.FullName).Replace('\\', '/');
                found.Add((info.FullName, new ImportFile(relative, info.Length)));
            }
        }
        return found;
    }

    /// <summary>What importing this folder would copy.</summary>
    public ImportPlan PlanFolder(string folder)
    {
        var root = FindClipRoot(folder) ?? throw new InvalidOperationException("There are no TeslaCam clips in that folder.");
        return Check(Enumerate(root).Select(f => f.File));
    }

    /// <summary>Drives and mounted volumes with a TeslaCam folder on them, such as the car's USB drive.</summary>
    public List<ImportDrive> Drives()
    {
        var drives = new List<ImportDrive>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady || drive.DriveType is DriveType.Network or DriveType.CDRom or DriveType.Ram) continue;
                var root = drive.RootDirectory.FullName;
                // On Linux and macOS every mount is listed; removable media live under these.
                if (!OperatingSystem.IsWindows() && !new[] { "/media/", "/run/media/", "/mnt/", "/Volumes/" }.Any(root.StartsWith)) continue;
                if (FindClipRoot(root) == null) continue;
                var label = string.IsNullOrWhiteSpace(drive.VolumeLabel) ? root : $"{drive.VolumeLabel} ({root.TrimEnd('\\', '/')})";
                drives.Add(new ImportDrive(root, label, drive.TotalSize));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // A drive that goes away while we look is simply not listed.
            }
        }
        return drives;
    }

    /// <summary>Starts copying a folder or drive into the library in the background.</summary>
    public void StartFolderImport(string folder, bool deleteAfter)
    {
        lock (_lock)
        {
            if (State.Running) throw new InvalidOperationException("An import is already running.");
            var root = FindClipRoot(folder) ?? throw new InvalidOperationException("There are no TeslaCam clips in that folder.");
            var files = Enumerate(root);
            var plan = Check(files.Select(f => f.File));
            Directory.CreateDirectory(paths.ClipsBase);
            var free = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(paths.ClipsBase))!).AvailableFreeSpace;
            if (plan.MissingBytes > free)
                throw new InvalidOperationException($"The library folder needs {plan.MissingBytes / 1_000_000_000.0:0.#} GB but has {free / 1_000_000_000.0:0.#} GB free.");

            State = new ImportState
            {
                Running = true, Source = folder, TotalFiles = plan.Missing.Count, TotalBytes = plan.MissingBytes,
                AlreadyThere = plan.AlreadyThere, DeleteAfter = deleteAfter, StartedUtc = DateTime.UtcNow,
            };
            _cts = new CancellationTokenSource();
            var state = State;
            var token = _cts.Token;
            _ = Task.Run(() => CopyAsync(root, files, state, token));
        }
    }

    public void Cancel() => _cts?.Cancel();

    /// <summary>
    /// Looks for the new folders now, and once more after the scanner's settle time, since it skips folders
    /// that changed in the last minute and a half.
    /// </summary>
    public void ScanSoon()
    {
        scanner.RequestScan();
        _ = Task.Delay(TimeSpan.FromSeconds(100)).ContinueWith(_ => scanner.RequestScan(), TaskScheduler.Default);
    }

    private async Task CopyAsync(string root, List<(string Full, ImportFile File)> files, ImportState state, CancellationToken ct)
    {
        var copied = new List<string>();
        try
        {
            var buffer = new byte[1 << 20];
            foreach (var (full, file) in files)
            {
                ct.ThrowIfCancellationRequested();
                if (Normalize(file.Path) is not { } relative) continue;
                if (AlreadyThere(relative, file.Size))
                {
                    copied.Add(full);
                    continue;
                }
                var dest = Destination(relative);
                var temp = dest + ".part";
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    await using (var input = File.OpenRead(full))
                    await using (var output = File.Create(temp))
                    {
                        int read;
                        while ((read = await input.ReadAsync(buffer, ct)) > 0)
                        {
                            await output.WriteAsync(buffer.AsMemory(0, read), ct);
                            state.DoneBytes += read;
                        }
                    }
                    File.Move(temp, dest, true);
                    File.SetLastWriteTimeUtc(dest, File.GetLastWriteTimeUtc(full));
                    state.DoneFiles++;
                    copied.Add(full);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    state.Failed++;
                    log.LogWarning("Could not import {File}: {Message}", file.Path, ex.Message);
                }
                finally
                {
                    if (File.Exists(temp)) File.Delete(temp);
                }
            }

            if (state.DeleteAfter)
            {
                foreach (var full in copied)
                {
                    try
                    {
                        File.Delete(full);
                        state.Deleted++;
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        log.LogWarning("Could not remove {File} from the drive: {Message}", full, ex.Message);
                    }
                }
                RemoveEmptyFolders(root);
            }
        }
        catch (OperationCanceledException)
        {
            state.Canceled = true;
        }
        catch (Exception ex)
        {
            state.Error = ex.Message;
            log.LogError(ex, "Import failed");
        }
        finally
        {
            state.Running = false;
            state.FinishedUtc = DateTime.UtcNow;
            ScanSoon();
        }
    }

    /// <summary>Removes event folders the import emptied. The top-level clip folders stay, as the car expects them.</summary>
    private static void RemoveEmptyFolders(string root)
    {
        foreach (var name in ClipFolders)
        {
            var dir = Path.Combine(root, name);
            if (!Directory.Exists(dir)) continue;
            foreach (var sub in Directory.EnumerateDirectories(dir, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length))
            {
                try
                {
                    // Leftovers the car adds to an event (such as its thumbnail) go once the clips are gone.
                    if (!Directory.EnumerateFiles(sub, "*.mp4", SearchOption.AllDirectories).Any()) Directory.Delete(sub, true);
                }
                catch (IOException) { }
            }
        }
    }
}
