using System.Text.RegularExpressions;

namespace TeslaCam.Services;

public record ImportFile(string Path, long Size);

/// <summary>What an import would do. <see cref="Encrypted"/> counts clips the car encrypted, which can't be imported.</summary>
public record ImportPlan(List<ImportFile> Missing, int AlreadyThere, int Ignored, int Encrypted = 0)
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

/// <summary>A drive with the car's clips on it, and what importing it would bring in.</summary>
public record ImportDrive(string Path, string Name, long TotalBytes, int NewFiles, long NewBytes, int Encrypted);

/// <summary>What is in a folder someone is about to use as their library.</summary>
public record FolderInfo(bool Exists, string? ClipRoot, int Events, int Encrypted, bool Removable, bool IsLibrary);

/// <summary>
/// Brings clips into the library: files uploaded from a browser, or a folder or USB drive copied by the
/// desktop app. Only files the car writes are accepted, they keep the car's folder layout, and anything
/// already in the library with the same size is skipped. The originals are never changed unless the user
/// asks for the drive to be cleared after copying.
/// </summary>
public partial class ImportService(AppPaths paths, Scanner scanner, ILogger<ImportService> log)
{
    private static readonly string[] ClipFolders = ["SentryClips", "SavedClips", "RecentClips"];
    private const string EncryptedFolder = "EncryptedClips";
    private static readonly TimeSpan DriveCacheTime = TimeSpan.FromSeconds(30);

    [GeneratedRegex(@"^(SentryClips|SavedClips)/[^/]+/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4|event\.json|event\.mp4|thumb\.png)$")]
    private static partial Regex EventFile();

    // The car keeps RecentClips flat; teslausb's archive sorts them into one folder per day.
    [GeneratedRegex(@"^RecentClips/([^/]+/)?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$")]
    private static partial Regex RecentFile();

    private readonly Lock _lock = new();
    private readonly Dictionary<string, (DateTime At, long FreeBytes, int Generation, ImportPlan Plan)> _driveCache = [];
    private CancellationTokenSource? _cts;
    // Bumped whenever the library gains files, so cached drive plans are worked out again.
    private int _generation;

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

    /// <summary>
    /// Whether the library has this file already. It may sit in a TeslaCam folder someone dragged into the
    /// library by hand, which the scanner reads too.
    /// </summary>
    private bool AlreadyThere(string relative, long size)
    {
        foreach (var dir in paths.ClipBases())
        {
            var file = new FileInfo(Path.Combine(dir, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (file.Exists && file.Length == size) return true;
        }
        return false;
    }

    /// <summary>True when one folder is the other or inside it.</summary>
    public static bool Overlaps(string a, string b)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        static string Full(string p) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(p)) + Path.DirectorySeparatorChar;
        var fa = Full(a);
        var fb = Full(b);
        return fa.StartsWith(fb, comparison) || fb.StartsWith(fa, comparison);
    }

    private void EnsureLibraryAvailable()
    {
        if (!Directory.Exists(paths.Root))
            throw new InvalidOperationException($"The library folder {paths.Root} isn't available. Reconnect the drive it's on, or choose another folder.");
    }

    private void EnsureNotLibrary(string folder)
    {
        if (Overlaps(folder, paths.Root))
            throw new InvalidOperationException("That folder is your library folder, or is inside it. Choose the car's USB drive or a copy of it.");
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
        EnsureLibraryAvailable();
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
            Interlocked.Increment(ref _generation);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    /// <summary>
    /// The folder holding SentryClips and friends: the folder itself, or its TeslaCam folder. A drive with only
    /// encrypted clips counts too, so the app can explain why nothing can be imported from it.
    /// </summary>
    public static string? FindClipRoot(string folder)
    {
        if (!Directory.Exists(folder)) return null;
        bool HasClips(string dir) => ClipFolders.Append(EncryptedFolder).Any(f => Directory.Exists(Path.Combine(dir, f)));
        var nested = Path.Combine(folder, "TeslaCam");
        if (Directory.Exists(nested) && HasClips(nested)) return nested;
        return HasClips(folder) ? folder : null;
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

    private static int CountEncrypted(string clipRoot)
    {
        var dir = Path.Combine(clipRoot, EncryptedFolder);
        return Directory.Exists(dir) ? Directory.EnumerateFiles(dir, "*.mp4", SearchOption.AllDirectories).Count() : 0;
    }

    /// <summary>What importing this folder would copy.</summary>
    public ImportPlan PlanFolder(string folder)
    {
        EnsureNotLibrary(folder);
        var root = FindClipRoot(folder) ?? throw new InvalidOperationException("There are no TeslaCam clips in that folder.");
        return Check(Enumerate(root).Select(f => f.File)) with { Encrypted = CountEncrypted(root) };
    }

    /// <summary>Drives and mounted volumes with the car's clips on them, and how much on each is new.</summary>
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
                if (FindClipRoot(root) is not { } clipRoot) continue;
                // The library itself may live on a drive that also has a TeslaCam folder; it is no source.
                if (Overlaps(clipRoot, paths.Root)) continue;
                var plan = CachedPlan(root, clipRoot, drive.AvailableFreeSpace);
                var label = string.IsNullOrWhiteSpace(drive.VolumeLabel) ? root : $"{drive.VolumeLabel} ({root.TrimEnd('\\', '/')})";
                drives.Add(new ImportDrive(root, label, drive.TotalSize, plan.Missing.Count, plan.MissingBytes, plan.Encrypted));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // A drive that goes away while we look is simply not listed.
            }
        }
        return drives;
    }

    /// <summary>
    /// Looking through a whole drive takes a moment, and the app asks every few seconds. The answer is kept until
    /// the drive's free space changes (something was written or deleted), the library gains files, or half a minute passes.
    /// </summary>
    private ImportPlan CachedPlan(string root, string clipRoot, long freeBytes)
    {
        lock (_driveCache)
        {
            if (_driveCache.TryGetValue(root, out var cached) && cached.FreeBytes == freeBytes && cached.Generation == _generation
                && DateTime.UtcNow - cached.At < DriveCacheTime)
                return cached.Plan;
        }
        var plan = Check(Enumerate(clipRoot).Select(f => f.File)) with { Encrypted = CountEncrypted(clipRoot) };
        lock (_driveCache) _driveCache[root] = (DateTime.UtcNow, freeBytes, _generation, plan);
        return plan;
    }

    /// <summary>What is in a folder, for choosing it as the library.</summary>
    public FolderInfo Inspect(string folder)
    {
        if (!Directory.Exists(folder)) return new FolderInfo(false, null, 0, 0, false, false);
        var clipRoot = FindClipRoot(folder);
        var events = 0;
        if (clipRoot != null)
        {
            foreach (var name in new[] { "SentryClips", "SavedClips" })
            {
                var dir = Path.Combine(clipRoot, name);
                if (Directory.Exists(dir)) events += Directory.EnumerateDirectories(dir).Count();
            }
            var recent = Path.Combine(clipRoot, "RecentClips");
            if (Directory.Exists(recent) && Directory.EnumerateFiles(recent, "*.mp4", SearchOption.AllDirectories).Any()) events++;
        }
        return new FolderInfo(true, clipRoot, events, clipRoot != null ? CountEncrypted(clipRoot) : 0, IsRemovable(folder),
            Path.GetFullPath(folder).TrimEnd('\\', '/').Equals(Path.GetFullPath(paths.Root).TrimEnd('\\', '/'),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal));
    }

    /// <summary>
    /// Whether a folder is on a drive that comes and goes: removable media, or the car's own USB drive (which may
    /// be an SSD that reports itself as fixed, so a TeslaCam folder at its root gives it away).
    /// </summary>
    private static bool IsRemovable(string folder)
    {
        try
        {
            var full = Path.GetFullPath(folder);
            if (!OperatingSystem.IsWindows())
                return new[] { "/media/", "/run/media/", "/Volumes/" }.Any(full.StartsWith);
            var root = Path.GetPathRoot(full)!;
            var drive = new DriveInfo(root);
            if (drive.DriveType == DriveType.Removable) return true;
            var system = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
            return !root.Equals(system, StringComparison.OrdinalIgnoreCase) && Directory.Exists(Path.Combine(root, "TeslaCam"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return false;
        }
    }

    /// <summary>Starts copying a folder or drive into the library in the background.</summary>
    public void StartFolderImport(string folder, bool deleteAfter)
    {
        lock (_lock)
        {
            if (State.Running) throw new InvalidOperationException("An import is already running.");
            EnsureNotLibrary(folder);
            EnsureLibraryAvailable();
            var root = FindClipRoot(folder) ?? throw new InvalidOperationException("There are no TeslaCam clips in that folder.");
            var files = Enumerate(root);
            var plan = Check(files.Select(f => f.File));
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
                    // Pulling the drive out makes every remaining file fail; stop and say why instead.
                    if (!Directory.Exists(root))
                    {
                        state.Error = "The drive was unplugged before the import finished. What was copied is kept; plug it in again and import to finish.";
                        return;
                    }
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
            Interlocked.Increment(ref _generation);
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
