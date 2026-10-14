using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

public record AppSettings
{
    /// <summary>Which events get a merged grid video automatically: all | recent | ondemand.</summary>
    public string PreviewPolicy { get; init; } = "recent";
    public int PreviewRecentDays { get; init; } = 30;
    /// <summary>What to do with clips browsers may not play: auto | ondemand.</summary>
    public string TranscodePolicy { get; init; } = "auto";
    public bool Paused { get; init; }
    public bool WorkHoursEnabled { get; init; }
    public int WorkHoursStart { get; init; } = 1;
    public int WorkHoursEnd { get; init; } = 6;
    public int ScanIntervalMinutes { get; init; } = 5;
    public int TrashRetentionDays { get; init; } = 14;
    /// <summary>Trimming an event keeps this many seconds of footage before the trigger…</summary>
    public int TrimBeforeSec { get; init; } = 120;
    /// <summary>…and this many after it.</summary>
    public int TrimAfterSec { get; init; } = 60;
    /// <summary>Where the car is parked at home; events within <see cref="HomeRadiusM"/> of it count as home events.</summary>
    public double? HomeLat { get; init; }
    public double? HomeLon { get; init; }
    public int HomeRadiusM { get; init; } = 100;
    /// <summary>Move Sentry events recorded at home to the trash once they are <see cref="HomeCleanupDays"/> old.</summary>
    public bool HomeCleanupEnabled { get; init; }
    public int HomeCleanupDays { get; init; } = 3;
    /// <summary>0 lets ffmpeg decide.</summary>
    public int FfmpegThreads { get; init; }
    /// <summary>auto | software | vaapi</summary>
    public string Encoder { get; init; } = "auto";
    public int PreviewCellHeight { get; init; } = 480;
    public int PreviewFps { get; init; } = 24;
    /// <summary>CRF / QP style value, lower is better quality and bigger files.</summary>
    public int PreviewQuality { get; init; } = 27;
    /// <summary>Optional URL that receives a JSON POST when a new Sentry event is indexed.</summary>
    public string? WebhookUrl { get; init; }
    /// <summary>Address of the teslausb web interface on the home network, e.g. http://teslausb.local.</summary>
    public string? ArchiverUrl { get; init; }

    public AppSettings Sanitized() => this with
    {
        PreviewPolicy = PreviewPolicy is "all" or "recent" or "ondemand" ? PreviewPolicy : "recent",
        TranscodePolicy = TranscodePolicy is "auto" or "ondemand" ? TranscodePolicy : "auto",
        Encoder = Encoder is "auto" or "software" or "vaapi" ? Encoder : "auto",
        PreviewRecentDays = Math.Clamp(PreviewRecentDays, 1, 3650),
        WorkHoursStart = Math.Clamp(WorkHoursStart, 0, 23),
        WorkHoursEnd = Math.Clamp(WorkHoursEnd, 0, 23),
        ScanIntervalMinutes = Math.Clamp(ScanIntervalMinutes, 1, 1440),
        TrashRetentionDays = Math.Clamp(TrashRetentionDays, 0, 365),
        TrimBeforeSec = Math.Clamp(TrimBeforeSec, 0, 3600),
        TrimAfterSec = Math.Clamp(TrimAfterSec, 0, 3600),
        HomeLat = HomeLat is >= -90 and <= 90 && HomeLon is >= -180 and <= 180 ? HomeLat : null,
        HomeLon = HomeLat is >= -90 and <= 90 && HomeLon is >= -180 and <= 180 ? HomeLon : null,
        HomeRadiusM = Math.Clamp(HomeRadiusM, 20, 2000),
        HomeCleanupDays = Math.Clamp(HomeCleanupDays, 1, 365),
        FfmpegThreads = Math.Clamp(FfmpegThreads, 0, 64),
        PreviewCellHeight = PreviewCellHeight is 240 or 360 or 480 or 720 ? PreviewCellHeight : 480,
        PreviewFps = Math.Clamp(PreviewFps, 10, 60),
        PreviewQuality = Math.Clamp(PreviewQuality, 18, 36),
        WebhookUrl = string.IsNullOrWhiteSpace(WebhookUrl) ? null : WebhookUrl.Trim(),
        ArchiverUrl = NormalizeUrl(ArchiverUrl),
    };

    /// <summary>Accepts "teslausb.local" as well as a full URL; returns null when it is not a usable http address.</summary>
    private static string? NormalizeUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var text = value.Trim().TrimEnd('/');
        if (!text.Contains("://")) text = "http://" + text;
        return Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? text : null;
    }
}

public class SettingsService(IDbContextFactory<AppDb> dbf)
{
    private const string SettingsKey = "settings";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private AppSettings? _cached;
    private readonly Lock _lock = new();

    public AppSettings Current
    {
        get
        {
            lock (_lock)
            {
                if (_cached != null) return _cached;
                using var db = dbf.CreateDbContext();
                var raw = db.Settings.AsNoTracking().FirstOrDefault(s => s.Key == SettingsKey)?.Value;
                _cached = (raw == null ? new AppSettings() : JsonSerializer.Deserialize<AppSettings>(raw, Json) ?? new AppSettings()).Sanitized();
                return _cached;
            }
        }
    }

    public async Task<AppSettings> SaveAsync(AppSettings settings)
    {
        settings = settings.Sanitized();
        await SetRawAsync(SettingsKey, JsonSerializer.Serialize(settings, Json));
        lock (_lock) _cached = settings;
        return settings;
    }

    public async Task<string?> GetRawAsync(string key)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return (await db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key))?.Value;
    }

    public async Task SetRawAsync(string key, string value)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var row = await db.Settings.FirstOrDefaultAsync(s => s.Key == key);
        if (row == null) db.Settings.Add(new Setting { Key = key, Value = value });
        else row.Value = value;
        await db.SaveChangesAsync();
    }
}
