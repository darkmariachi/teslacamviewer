namespace TeslaCam.Services;

/// <summary>Disk usage figures for the admin panel. Walking the cache is slow on big libraries, so results are reused briefly.</summary>
public class StorageService(AppPaths paths)
{
    private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(2);
    private readonly Lock _lock = new();
    private object? _snapshot;
    private DateTime _takenUtc;

    public object Snapshot()
    {
        lock (_lock)
        {
            if (_snapshot != null && DateTime.UtcNow - _takenUtc < MaxAge) return _snapshot;
            _snapshot = new
            {
                cacheBytes = DirectorySize(paths.Cache),
                exportBytes = DirectorySize(paths.ExportsDir),
                clips = Drive(paths.ClipsBase),
                data = Drive(paths.Cache),
                clipsWritable = IsWritable(paths.ClipsBase),
            };
            _takenUtc = DateTime.UtcNow;
            return _snapshot;
        }
    }

    private static long DirectorySize(string dir)
    {
        try
        {
            return Directory.Exists(dir)
                ? new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length)
                : 0;
        }
        catch (IOException)
        {
            return 0;
        }
    }

    private static object? Drive(string path)
    {
        try
        {
            var info = new DriveInfo(Path.GetFullPath(path));
            return new { freeBytes = info.AvailableFreeSpace, totalBytes = info.TotalSize };
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static bool IsWritable(string dir)
    {
        try
        {
            var probe = Path.Combine(dir, $".write-test-{Guid.NewGuid():N}");
            File.WriteAllText(probe, "");
            File.Delete(probe);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
