using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

/// <summary>Cuts real (generated) clips with ffmpeg. Passes without checking anything when ffmpeg is not installed.</summary>
public sealed class RangeKeeperTests : IDisposable
{
    private static readonly string[] Cameras = ["front", "back"];
    private readonly string _root = Path.Combine(Path.GetTempPath(), "teslacam-tests", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;

    public RangeKeeperTests()
    {
        var clips = Path.Combine(_root, "clips");
        Directory.CreateDirectory(clips);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["TESLACAM_ROOT"] = clips,
            ["TESLACAM_DATA"] = Path.Combine(_root, "data"),
        }).Build();

        var services = new ServiceCollection();
        var paths = new AppPaths(config);
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton(paths);
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.AddHttpClient();
        services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={paths.DbFile};Pooling=False"));
        services.AddSingleton<SettingsService>();
        services.AddSingleton<Ffmpeg>();
        services.AddSingleton<JobQueue>();
        services.AddSingleton<MediaProcessor>();
        services.AddSingleton<Scanner>();
        services.AddSingleton<JobRunner>();
        services.AddSingleton<RangeKeeper>();
        _services = services.BuildServiceProvider();

        using var db = _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();
        db.Database.Migrate();
    }

    public void Dispose()
    {
        _services.Dispose();
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    private string Clips => _services.GetRequiredService<AppPaths>().Root;
    private Scanner Scanner => _services.GetRequiredService<Scanner>();
    private AppDb Db() => _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();

    private static bool HasFfmpeg()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("ffmpeg", "-version") { RedirectStandardOutput = true, UseShellExecute = false });
            p!.StandardOutput.ReadToEnd();
            p.WaitForExit();
            return p.ExitCode == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>A short test-pattern clip with a keyframe every five seconds, dated in the past so the folder is settled.</summary>
    private void Clip(string relativeDir, string name, int seconds)
    {
        var dir = Path.Combine(Clips, relativeDir);
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, name);
        using var p = Process.Start(new ProcessStartInfo("ffmpeg")
        {
            ArgumentList =
            {
                "-v", "error", "-f", "lavfi", "-i", $"testsrc=size=160x120:rate=10:duration={seconds}",
                "-c:v", "libx264", "-g", "50", "-sc_threshold", "0", "-pix_fmt", "yuv420p", file,
            },
            UseShellExecute = false,
        })!;
        p.WaitForExit();
        Assert.Equal(0, p.ExitCode);
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddHours(-1));
    }

    /// <summary>Scans the folder and probes the one event, the way the app learns each clip's real length.</summary>
    private async Task<Event> IndexAsync()
    {
        await Scanner.ScanAsync(CancellationToken.None);
        var id = (await LoadAsync()).Id;
        await _services.GetRequiredService<MediaProcessor>().ProbeAsync(id, null, CancellationToken.None);
        return await LoadAsync();
    }

    private async Task<Event> LoadAsync()
    {
        await using var db = Db();
        return await db.Events.Include(e => e.Segments.OrderBy(s => s.Index)).ThenInclude(s => s.Files).SingleAsync();
    }

    [Fact]
    public async Task Keeping_a_range_cuts_every_camera_and_moves_the_rest_to_the_trash()
    {
        if (!HasFfmpeg()) return;
        // Three 20-second segments; keep 25 s to 45 s, i.e. the end of the second and the start of the third.
        const string dir = "SavedClips/2026-10-13_15-36-30";
        foreach (var start in new[] { "15-36-00", "15-36-20", "15-36-40" })
            foreach (var camera in Cameras)
                Clip(dir, $"2026-10-13_{start}-{camera}.mp4", 20);
        var before = await IndexAsync();
        foreach (var seg in before.Segments) Assert.Equal(20, seg.DurationSec);
        await using (var db = Db()) await db.Events.ExecuteUpdateAsync(s => s.SetProperty(e => e.Favorite, true));

        var saved = await _services.GetRequiredService<RangeKeeper>().KeepAsync(before.Id, 25, 45);
        await Scanner.ScanAsync(CancellationToken.None);

        Assert.True(saved > 0);
        var after = await LoadAsync();
        Assert.Equal(before.Id, after.Id);
        Assert.True(after.Favorite);
        // The second segment now starts at its 5 s keyframe, so its files carry the new time.
        Assert.Equal(
            ["2026-10-13_15-36-25-back.mp4", "2026-10-13_15-36-25-front.mp4", "2026-10-13_15-36-40-back.mp4", "2026-10-13_15-36-40-front.mp4"],
            Directory.GetFiles(Path.Combine(Clips, dir), "*.mp4").Select(Path.GetFileName).Order());
        Assert.Equal(new DateTime(2026, 10, 13, 15, 36, 25), after.StartTime);

        var ffmpeg = _services.GetRequiredService<Ffmpeg>();
        var first = await ffmpeg.ProbeAsync(Path.Combine(Clips, dir, "2026-10-13_15-36-25-front.mp4"), CancellationToken.None);
        var last = await ffmpeg.ProbeAsync(Path.Combine(Clips, dir, "2026-10-13_15-36-40-front.mp4"), CancellationToken.None);
        Assert.InRange(first!.DurationSec, 14.5, 15.5);
        Assert.InRange(last!.DurationSec, 4.5, 5.5);

        // The first segment, and the originals of both cut segments, are in the trash.
        var trashed = Directory.GetFiles(Path.Combine(Clips, ".trash"), "*.mp4", SearchOption.AllDirectories);
        Assert.Equal(6, trashed.Length);
    }

    [Fact]
    public async Task Keeping_part_of_a_drive_renames_it_and_keeps_the_same_event()
    {
        if (!HasFfmpeg()) return;
        foreach (var start in new[] { "09-00-00", "09-00-20" })
            foreach (var camera in Cameras)
                Clip("RecentClips", $"2026-10-13_{start}-{camera}.mp4", 20);
        var before = await IndexAsync();
        Assert.Equal("drive_2026-10-13_09-00-00", before.Name);

        // The cut snaps back to the keyframe at 10 s, and the drive is renamed for it.
        await _services.GetRequiredService<RangeKeeper>().KeepAsync(before.Id, 12, 40);
        await Scanner.ScanAsync(CancellationToken.None);

        var after = await LoadAsync();
        Assert.Equal(before.Id, after.Id);
        Assert.Equal("drive_2026-10-13_09-00-10", after.Name);
        Assert.Equal(2, after.SegmentCount);
    }
}
