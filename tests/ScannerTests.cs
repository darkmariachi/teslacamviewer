using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

/// <summary>Runs the scanner against a throwaway clip folder and a real SQLite file.</summary>
public sealed class ScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "teslacam-tests", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;

    public ScannerTests()
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
        services.AddSingleton(paths);
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.AddHttpClient();
        services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={paths.DbFile};Pooling=False"));
        services.AddSingleton<SettingsService>();
        services.AddSingleton<JobQueue>();
        services.AddSingleton<Scanner>();
        services.AddSingleton<TrashService>();
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

    /// <summary>Writes an empty clip file dated well in the past, so the scanner treats the folder as settled.</summary>
    private void Clip(string relativeDir, string name)
    {
        var dir = Path.Combine(Clips, relativeDir);
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, name);
        File.WriteAllBytes(file, new byte[16]);
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddHours(-1));
    }

    private void EventJson(string relativeDir, string json)
    {
        var file = Path.Combine(Clips, relativeDir, "event.json");
        File.WriteAllText(file, json);
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddHours(-1));
    }

    private static readonly string[] FourCameras = ["front", "back", "left_repeater", "right_repeater"];

    [Fact]
    public async Task Indexes_a_sentry_event_with_its_segments_and_metadata()
    {
        const string dir = "SentryClips/2022-06-25_19-30-55";
        foreach (var camera in FourCameras)
        {
            Clip(dir, $"2022-06-25_19-28-45-{camera}.mp4");
            Clip(dir, $"2022-06-25_19-29-45-{camera}.mp4");
        }
        EventJson(dir, """{"timestamp":"2022-06-25T19:29:54","city":"Riverside","est_lat":"30.267","est_lon":"-97.7841","reason":"sentry_aware_object_detection","camera":"4"}""");

        var result = await Scanner.ScanAsync(CancellationToken.None);

        Assert.Equal(1, result.Added);
        await using var db = Db();
        var ev = await db.Events.Include(e => e.Segments).ThenInclude(s => s.Files).SingleAsync();
        Assert.Equal(EventType.Sentry, ev.Type);
        Assert.Equal("front,back,left_repeater,right_repeater", ev.Cameras);
        Assert.Equal(2, ev.Segments.Count);
        Assert.All(ev.Segments, s => Assert.Equal(4, s.Files.Count));
        Assert.Equal(new DateTime(2022, 6, 25, 19, 28, 45), ev.StartTime);
        Assert.Equal(new DateTime(2022, 6, 25, 19, 29, 54), ev.TriggerTime);
        Assert.Equal("Riverside", ev.City);
        Assert.Equal(30.267, ev.Lat);
        Assert.Equal("right_repeater", ev.TriggerCamera);
        // Thumbnail and probe are queued for every new event; old events get no automatic merge.
        Assert.Equal([JobKind.Probe, JobKind.Thumbnail], (await db.Jobs.Select(j => j.Kind).ToListAsync()).Order());
    }

    [Fact]
    public async Task Shows_the_repeater_when_the_trigger_names_a_side_camera_the_car_did_not_save()
    {
        const string dir = "SentryClips/2026-10-13_15-36-30";
        foreach (var camera in FourCameras) Clip(dir, $"2026-10-13_15-35-32-{camera}.mp4");
        // Newer cars also write a short clip of the trigger; it is not one of the cameras.
        Clip(dir, "event.mp4");
        EventJson(dir, """{"timestamp":"2026-10-13T15:35:27","city":"Riverside","street":"","est_lat":"30.267","est_lon":"-97.7841","reason":"sentry_aware_object_detection","camera":"5"}""");

        await Scanner.ScanAsync(CancellationToken.None);

        await using var db = Db();
        var ev = await db.Events.SingleAsync();
        Assert.Equal("left_repeater", ev.TriggerCamera);
        Assert.Equal("front,back,left_repeater,right_repeater", ev.Cameras);
        Assert.Equal(1, ev.SegmentCount);
    }

    [Fact]
    public async Task Trimming_moves_the_minutes_away_from_the_trigger_to_the_trash_and_reindexes()
    {
        const string dir = "SentryClips/2026-10-13_15-36-30";
        foreach (var minute in Enumerable.Range(25, 11))
            foreach (var camera in FourCameras)
                Clip(dir, $"2026-10-13_15-{minute}-00-{camera}.mp4");
        EventJson(dir, """{"timestamp":"2026-10-13T15:35:27","city":"Riverside","reason":"sentry_aware_object_detection","camera":"5"}""");
        await Scanner.ScanAsync(CancellationToken.None);
        int id;
        await using (var db = Db()) id = (await db.Events.SingleAsync()).Id;

        var removed = await _services.GetRequiredService<TrashService>().TrimAsync(id);
        await Scanner.ScanAsync(CancellationToken.None);

        Assert.Equal(8, removed);
        await using var after = Db();
        var ev = await after.Events.SingleAsync();
        Assert.Equal(id, ev.Id);
        Assert.Equal(3, ev.SegmentCount);
        Assert.Equal(new DateTime(2026, 10, 13, 15, 33, 0), ev.StartTime);
        var trashed = Directory.GetFiles(Path.Combine(Clips, ".trash"), "*.mp4", SearchOption.AllDirectories);
        Assert.Equal(8 * 4, trashed.Length);
        // A second trim has nothing left to remove.
        Assert.Equal(0, await _services.GetRequiredService<TrashService>().TrimAsync(id));
    }

    [Fact]
    public async Task Splits_the_measurement_off_bump_reasons_and_drops_empty_gps_fixes()
    {
        const string dir = "SentryClips/2022-01-01_10-00-30";
        Clip(dir, "2022-01-01_10-00-00-front.mp4");
        EventJson(dir, """{"timestamp":"2022-01-01T10:00:10","city":"","est_lat":"2.35754e-311","est_lon":"0","reason":"sentry_aware_accel_0.532005","camera":"0"}""");

        await Scanner.ScanAsync(CancellationToken.None);

        await using var db = Db();
        var ev = await db.Events.SingleAsync();
        Assert.Equal("sentry_aware_accel", ev.Reason);
        Assert.Equal(0.532005, ev.ReasonValue);
        Assert.Null(ev.Lat);
        Assert.Null(ev.Lon);
        Assert.Null(ev.City);
    }

    [Fact]
    public async Task Works_without_event_json_and_with_six_cameras()
    {
        const string dir = "SavedClips/2025-03-02_08-15-00";
        foreach (var camera in Cameras.All) Clip(dir, $"2025-03-02_08-14-00-{camera}.mp4");

        await Scanner.ScanAsync(CancellationToken.None);

        await using var db = Db();
        var ev = await db.Events.SingleAsync();
        Assert.Equal(EventType.Saved, ev.Type);
        Assert.Null(ev.Reason);
        Assert.Equal(6, Cameras.Parse(ev.Cameras).Length);
    }

    [Fact]
    public async Task Groups_recent_clips_into_drives_by_gaps_in_recording()
    {
        // Two minutes of driving, a long stop, then one more minute.
        foreach (var time in new[] { "2025-03-02_08-00-00", "2025-03-02_08-01-00", "2025-03-02_09-30-00" })
            foreach (var camera in FourCameras)
                Clip("RecentClips", $"{time}-{camera}.mp4");

        await Scanner.ScanAsync(CancellationToken.None);

        await using var db = Db();
        var drives = await db.Events.OrderBy(e => e.StartTime).ToListAsync();
        Assert.Equal(2, drives.Count);
        Assert.All(drives, d => Assert.Equal(EventType.Recent, d.Type));
        Assert.Equal(2, drives[0].SegmentCount);
        Assert.Equal(1, drives[1].SegmentCount);
    }

    [Fact]
    public async Task Leaves_folders_alone_while_they_are_still_being_written()
    {
        var dir = Path.Combine(Clips, "SentryClips", "2025-03-02_08-15-00");
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, "2025-03-02_08-14-00-front.mp4"), new byte[16]);

        var result = await Scanner.ScanAsync(CancellationToken.None);

        Assert.Equal(0, result.Added);
    }

    [Fact]
    public async Task Removes_events_whose_folder_is_gone_but_keeps_everything_when_the_share_is_missing()
    {
        const string dir = "SentryClips/2022-06-25_19-30-55";
        Clip(dir, "2022-06-25_19-29-45-front.mp4");
        Clip("SentryClips/2022-06-26_10-00-00", "2022-06-26_09-59-00-front.mp4");
        await Scanner.ScanAsync(CancellationToken.None);

        Directory.Delete(Path.Combine(Clips, dir), true);
        var afterDelete = await Scanner.ScanAsync(CancellationToken.None);
        Assert.Equal(1, afterDelete.Removed);

        // An unmounted share looks like an empty folder; that must not wipe the library.
        Directory.Delete(Path.Combine(Clips, "SentryClips"), true);
        var unmounted = await Scanner.ScanAsync(CancellationToken.None);
        Assert.Equal(0, unmounted.Removed);
        await using var db = Db();
        Assert.Equal(1, await db.Events.CountAsync());
    }

    [Fact]
    public async Task Reindexes_an_event_when_its_files_change_and_keeps_user_data()
    {
        const string dir = "SentryClips/2022-06-25_19-30-55";
        Clip(dir, "2022-06-25_19-28-45-front.mp4");
        await Scanner.ScanAsync(CancellationToken.None);
        await using (var db = Db())
        {
            var ev = await db.Events.SingleAsync();
            ev.Favorite = true;
            ev.Notes = "keep me";
            await db.SaveChangesAsync();
        }

        Clip(dir, "2022-06-25_19-29-45-front.mp4");
        var result = await Scanner.ScanAsync(CancellationToken.None);

        Assert.Equal(1, result.Updated);
        await using var after = Db();
        var updated = await after.Events.SingleAsync();
        Assert.Equal(2, updated.SegmentCount);
        Assert.True(updated.Favorite);
        Assert.Equal("keep me", updated.Notes);
    }
}
