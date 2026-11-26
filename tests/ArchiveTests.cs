using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

/// <summary>
/// A main clip folder (a drive brought in from the car) and an archive folder side by side, in throwaway folders
/// with a real SQLite file.
/// </summary>
public sealed class ArchiveTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "teslacam-tests", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;

    public ArchiveTests() : this(archive: true) { }

    private ArchiveTests(bool archive)
    {
        Directory.CreateDirectory(Main);
        if (archive) Directory.CreateDirectory(Archive);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["TESLACAM_ROOT"] = Main,
            ["TESLACAM_ARCHIVE_ROOT"] = archive ? Archive : null,
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
        services.AddSingleton<EventArchive>();
        _services = services.BuildServiceProvider();

        using var db = _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();
        db.Database.Migrate();
    }

    public void Dispose()
    {
        _services.Dispose();
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    private string Main => Path.Combine(_root, "usb");
    private string Archive => Path.Combine(_root, "archive");
    private Scanner Scanner => _services.GetRequiredService<Scanner>();
    private EventArchive Archiver => _services.GetRequiredService<EventArchive>();
    private AppDb Db() => _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();

    private static readonly string[] Cameras = ["front", "back", "left_repeater", "right_repeater"];

    /// <summary>A Sentry event with two minutes of four cameras, its event.json and thumbnail, dated in the past.</summary>
    private static void SentryEvent(string root, string name = "2026-11-02_09-15-40", int size = 16)
    {
        var dir = Path.Combine(root, "SentryClips", name);
        Directory.CreateDirectory(dir);
        foreach (var camera in Cameras)
        {
            File.WriteAllBytes(Path.Combine(dir, $"2026-11-02_09-13-40-{camera}.mp4"), new byte[size]);
            File.WriteAllBytes(Path.Combine(dir, $"2026-11-02_09-14-40-{camera}.mp4"), new byte[size]);
        }
        File.WriteAllText(Path.Combine(dir, "event.json"), """{"timestamp":"2026-11-02T09:15:30","city":"Riverside","est_lat":"30.267","est_lon":"-97.78","reason":"sentry_aware_object_detection","camera":"0"}""");
        File.WriteAllBytes(Path.Combine(dir, "thumb.png"), new byte[8]);
        Age(dir);
    }

    private static void Age(string dir)
    {
        foreach (var file in Directory.EnumerateFiles(dir)) File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddHours(-1));
    }

    private Task Scan() => Scanner.ScanAsync(CancellationToken.None);

    private async Task<Event> Single()
    {
        await using var db = Db();
        return await db.Events.SingleAsync();
    }

    [Fact]
    public async Task Archiving_copies_the_whole_folder_and_keeps_the_event()
    {
        SentryEvent(Main);
        await Scan();
        int id;
        await using (var db = Db())
        {
            var ev = await db.Events.SingleAsync();
            id = ev.Id;
            ev.Favorite = true;
            ev.Notes = "Keep this";
            await db.SaveChangesAsync();
        }

        await Archiver.CopyAsync(id, _ => { }, CancellationToken.None);

        var copied = Path.Combine(Archive, "SentryClips", "2026-11-02_09-15-40");
        Assert.Equal(10, Directory.GetFiles(copied).Length);
        Assert.True(File.Exists(Path.Combine(copied, "event.json")));
        Assert.True(File.Exists(Path.Combine(copied, "thumb.png")));
        // The original is left where it was, and nothing is left half-copied.
        Assert.Equal(10, Directory.GetFiles(Path.Combine(Main, "SentryClips", "2026-11-02_09-15-40")).Length);
        Assert.False(Directory.Exists(Path.Combine(Archive, EventArchive.StagingDirName)));

        var archived = await Single();
        Assert.Equal(id, archived.Id);
        Assert.True(archived.Archived);
        Assert.Equal("SentryClips/2026-11-02_09-15-40", archived.RelPath);

        // A scan finds the event in both folders and keeps the one row, shown from the archive, notes and all.
        await Scan();
        var after = await Single();
        Assert.Equal(id, after.Id);
        Assert.True(after.Archived);
        Assert.True(after.Favorite);
        Assert.Equal("Keep this", after.Notes);
        Assert.Equal(archived.Signature, after.Signature);
    }

    [Fact]
    public async Task Unplugging_the_drive_leaves_both_folders_events_alone()
    {
        SentryEvent(Main, "2026-11-02_09-15-40");
        SentryEvent(Archive, "2026-10-01_08-00-00");
        await Scan();
        await using (var db = Db()) Assert.Equal(2, await db.Events.CountAsync());

        // The drive is gone: its folder is empty.
        Directory.Delete(Path.Combine(Main, "SentryClips"), true);
        await Scan();
        await using (var db = Db()) Assert.Equal(2, await db.Events.CountAsync());

        // An event deleted from the archive itself does go.
        Directory.Delete(Path.Combine(Archive, "SentryClips", "2026-10-01_08-00-00"), true);
        SentryEvent(Main, "2026-11-02_09-15-40");
        await Scan();
        await using (var db = Db())
        {
            var left = await db.Events.SingleAsync();
            Assert.False(left.Archived);
        }
    }

    [Fact]
    public async Task An_event_in_both_folders_is_listed_once_from_the_archive()
    {
        SentryEvent(Main);
        SentryEvent(Archive);

        await Scan();

        var ev = await Single();
        Assert.True(ev.Archived);
    }

    [Fact]
    public async Task A_drive_takes_only_its_own_recent_clips()
    {
        var recent = Path.Combine(Main, "RecentClips");
        Directory.CreateDirectory(recent);
        // Two drives an hour apart share the folder.
        foreach (var camera in Cameras)
        {
            File.WriteAllBytes(Path.Combine(recent, $"2026-11-03_07-00-00-{camera}.mp4"), new byte[16]);
            File.WriteAllBytes(Path.Combine(recent, $"2026-11-03_07-01-00-{camera}.mp4"), new byte[16]);
            File.WriteAllBytes(Path.Combine(recent, $"2026-11-03_08-30-00-{camera}.mp4"), new byte[16]);
        }
        Age(recent);
        await Scan();
        int first;
        await using (var db = Db()) first = await db.Events.Where(e => e.Name == "drive_2026-11-03_07-00-00").Select(e => e.Id).SingleAsync();

        await Archiver.CopyAsync(first, _ => { }, CancellationToken.None);

        Assert.Equal(8, Directory.GetFiles(Path.Combine(Archive, "RecentClips")).Length);
        await Scan();
        await using (var db = Db())
        {
            Assert.Equal(2, await db.Events.CountAsync());
            Assert.True(await db.Events.Where(e => e.Id == first).Select(e => e.Archived).SingleAsync());
            Assert.False(await db.Events.Where(e => e.Name == "drive_2026-11-03_08-30-00").Select(e => e.Archived).SingleAsync());
        }
    }

    [Fact]
    public async Task A_different_copy_already_in_the_archive_is_never_overwritten()
    {
        SentryEvent(Main);
        await Scan();
        var id = (await Single()).Id;
        // Hand-copied earlier, and different.
        var existing = Path.Combine(Archive, "SentryClips", "2026-11-02_09-15-40");
        Directory.CreateDirectory(existing);
        File.WriteAllBytes(Path.Combine(existing, "2026-11-02_09-13-40-front.mp4"), new byte[99]);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Archiver.CopyAsync(id, _ => { }, CancellationToken.None));

        Assert.Contains("different", error.Message);
        Assert.Equal(99, new FileInfo(Path.Combine(existing, "2026-11-02_09-13-40-front.mp4")).Length);
        Assert.False((await Single()).Archived);
    }

    [Fact]
    public async Task Deleting_an_archived_event_uses_the_archive_trash()
    {
        SentryEvent(Main);
        await Scan();
        var id = (await Single()).Id;
        await Archiver.CopyAsync(id, _ => { }, CancellationToken.None);

        await _services.GetRequiredService<TrashService>().TrashAsync(id);

        Assert.False(Directory.Exists(Path.Combine(Archive, "SentryClips", "2026-11-02_09-15-40")));
        Assert.Single(Directory.GetDirectories(Path.Combine(Archive, AppPaths.TrashDirName, "Sentry")));
        // The drive's copy is untouched; with the archived one gone it shows up again on the next scan.
        Assert.True(Directory.Exists(Path.Combine(Main, "SentryClips", "2026-11-02_09-15-40")));
    }

    [Fact]
    public void Without_an_archive_folder_nothing_can_be_archived()
    {
        using var plain = new ArchiveTests(archive: false);

        Assert.Null(plain.Archiver.Status().Folder);
        Assert.Equal("No archive folder is set up.", plain.Archiver.Refusal(new Event()));
    }
}
