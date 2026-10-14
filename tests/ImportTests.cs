using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

/// <summary>Imports into a throwaway library from a throwaway "USB drive".</summary>
public sealed class ImportTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "teslacam-tests", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;

    public ImportTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["TESLACAM_ROOT"] = Path.Combine(_root, "library"),
            ["TESLACAM_DATA"] = Path.Combine(_root, "data"),
        }).Build();
        Directory.CreateDirectory(Path.Combine(_root, "library"));

        var services = new ServiceCollection();
        var paths = new AppPaths(config);
        services.AddSingleton(paths);
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.AddHttpClient();
        services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={paths.DbFile};Pooling=False"));
        services.AddSingleton<SettingsService>();
        services.AddSingleton<JobQueue>();
        services.AddSingleton<Scanner>();
        services.AddSingleton<ImportService>();
        _services = services.BuildServiceProvider();

        using var db = _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();
        db.Database.Migrate();
    }

    public void Dispose()
    {
        _services.Dispose();
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    private ImportService Import => _services.GetRequiredService<ImportService>();
    private string Library => Path.Combine(_root, "library");
    private string Drive => Path.Combine(_root, "drive");

    private void DriveFile(string relative, int bytes = 16)
    {
        var file = Path.Combine(Drive, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllBytes(file, new byte[bytes]);
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddHours(-2));
    }

    [Theory]
    [InlineData("TeslaCam/SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-front.mp4", "SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-front.mp4")]
    [InlineData(@"E:\TeslaCam\SavedClips\2026-10-13_15-36-30\event.json", "SavedClips/2026-10-13_15-36-30/event.json")]
    [InlineData("TESLA DRIVE/TeslaCam/SentryClips/2026-10-13_15-36-30/event.mp4", "SentryClips/2026-10-13_15-36-30/event.mp4")]
    [InlineData("RecentClips/2026-10-13_15-35-32-back.mp4", "RecentClips/2026-10-13_15-35-32-back.mp4")]
    [InlineData("RecentClips/2026-10-13/2026-10-13_15-35-32-back.mp4", "RecentClips/2026-10-13/2026-10-13_15-35-32-back.mp4")]
    public void Paths_from_the_car_keep_its_layout(string path, string expected)
    {
        Assert.Equal(expected, ImportService.Normalize(path));
    }

    [Theory]
    [InlineData("SentryClips/../../secrets/2026-10-13_15-35-32-front.mp4")]
    [InlineData("SentryClips/2026-10-13_15-36-30/setup.exe")]
    [InlineData("TeslaTrackMode/lap.mp4")]
    [InlineData("Music/song.mp3")]
    [InlineData("SentryClips/2026-10-13_15-35-32-front.mp4")]
    public void Anything_the_car_does_not_write_is_refused(string path)
    {
        Assert.Null(ImportService.Normalize(path));
    }

    [Fact]
    public async Task An_uploaded_file_is_stored_once_and_then_reported_as_present()
    {
        const string path = "TeslaCam/SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-front.mp4";
        var before = Import.Check([new ImportFile(path, 5), new ImportFile("notes.txt", 3)]);
        Assert.Single(before.Missing);
        Assert.Equal(1, before.Ignored);

        await Import.SaveAsync(path, new MemoryStream([1, 2, 3, 4, 5]), 5, DateTimeOffset.UtcNow.AddDays(-1), CancellationToken.None);

        var after = Import.Check([new ImportFile(path, 5)]);
        Assert.Empty(after.Missing);
        Assert.Equal(1, after.AlreadyThere);
        Assert.True(File.Exists(Path.Combine(Library, "SentryClips", "2026-10-13_15-36-30", "2026-10-13_15-35-32-front.mp4")));
    }

    [Fact]
    public async Task An_upload_that_arrives_short_is_not_kept()
    {
        const string path = "SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-front.mp4";

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Import.SaveAsync(path, new MemoryStream([1, 2]), 5, null, CancellationToken.None));

        Assert.Empty(Directory.EnumerateFiles(Library, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task A_drive_is_copied_skipping_what_the_library_has_and_cleared_when_asked()
    {
        DriveFile("TeslaCam/SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-front.mp4", 100);
        DriveFile("TeslaCam/SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-back.mp4", 100);
        DriveFile("TeslaCam/SentryClips/2026-10-13_15-36-30/event.json", 10);
        DriveFile("TeslaCam/RecentClips/2026-10-13_15-35-32-front.mp4", 50);
        DriveFile("TeslaCam/notes.txt", 5);
        // The library already has one of the files.
        Directory.CreateDirectory(Path.Combine(Library, "SentryClips", "2026-10-13_15-36-30"));
        File.WriteAllBytes(Path.Combine(Library, "SentryClips", "2026-10-13_15-36-30", "2026-10-13_15-35-32-back.mp4"), new byte[100]);

        var plan = Import.PlanFolder(Drive);
        Assert.Equal(3, plan.Missing.Count);
        Assert.Equal(1, plan.AlreadyThere);

        Import.StartFolderImport(Drive, deleteAfter: true);
        while (Import.State.Running) await Task.Delay(20);

        Assert.Null(Import.State.Error);
        Assert.Equal(3, Import.State.DoneFiles);
        Assert.Equal(160, Import.State.DoneBytes);
        Assert.Equal(4, Import.State.Deleted);
        Assert.True(File.Exists(Path.Combine(Library, "RecentClips", "2026-10-13_15-35-32-front.mp4")));
        // Copied clips and their emptied event folder are gone from the drive; other files and the car's folders stay.
        Assert.False(Directory.Exists(Path.Combine(Drive, "TeslaCam", "SentryClips", "2026-10-13_15-36-30")));
        Assert.True(Directory.Exists(Path.Combine(Drive, "TeslaCam", "SentryClips")));
        Assert.True(File.Exists(Path.Combine(Drive, "TeslaCam", "notes.txt")));
        Assert.Empty(Directory.EnumerateFiles(Library, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public void A_folder_without_clips_is_refused()
    {
        Directory.CreateDirectory(Path.Combine(Drive, "Music"));

        Assert.Throws<InvalidOperationException>(() => Import.StartFolderImport(Drive, deleteAfter: false));
    }
}
