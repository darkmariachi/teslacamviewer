using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>What teslausb reports about the device in the car.</summary>
public record ArchiverStatus
{
    public double? CpuTempC { get; init; }
    /// <summary>Raspberry Pi throttling flags (under-voltage, thermal limits), as reported by the firmware.</summary>
    public int? Throttled { get; init; }
    public string? WifiSsid { get; init; }
    /// <summary>Link quality from 0 to 1.</summary>
    public double? WifiStrength { get; init; }
    public string? WifiIp { get; init; }
    public string? EtherIp { get; init; }
    public double? UptimeSec { get; init; }
    /// <summary>True while the car can see the USB drives; false while clips are being archived.</summary>
    public bool? DrivesActive { get; init; }
    public long? TotalBytes { get; init; }
    public long? FreeBytes { get; init; }
    public int? Snapshots { get; init; }
    public DateTime? NewestSnapshotUtc { get; init; }
    public int? FanRpm { get; init; }
    public double? SupplyVolts { get; init; }
}

public record ArchiverNotification(bool IsStart, int? Files, int? Events);

/// <summary>
/// Follows the teslausb device in the car: polls its status page to know when it is on the home
/// network, keeps health readings and the gist of its archive log, and records the upload runs it
/// announces through its webhook.
/// </summary>
public partial class ArchiverService(IDbContextFactory<AppDb> dbf, SettingsService settings, Scanner scanner,
    IHttpClientFactory http, CarLogService carLog, ILogger<ArchiverService> log) : BackgroundService
{
    private const string TokenKey = "archiverToken";
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);
    // A couple of missed polls are normal on car Wi-Fi; after this long the visit counts as over.
    private static readonly TimeSpan OfflineAfter = TimeSpan.FromMinutes(3);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public string? LastError { get; private set; }

    [GeneratedRegex(@"Archived (\d+)")]
    private static partial Regex ArchivedCount();
    [GeneratedRegex(@"(\d+) file\(s\)")]
    private static partial Regex PlannedFiles();
    [GeneratedRegex(@"(\d+) event folder")]
    private static partial Regex PlannedEvents();

    /// <summary>The secret that lets teslausb post notifications without a login. Created on first use.</summary>
    public async Task<string> GetTokenAsync()
    {
        var token = await settings.GetRawAsync(TokenKey);
        if (!string.IsNullOrEmpty(token)) return token;
        return await RegenerateTokenAsync();
    }

    public async Task<string> RegenerateTokenAsync()
    {
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(20));
        await settings.SetRawAsync(TokenKey, token);
        return token;
    }

    public async Task<bool> IsValidTokenAsync(string candidate)
    {
        var token = await settings.GetRawAsync(TokenKey);
        return !string.IsNullOrEmpty(token) && CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(candidate), System.Text.Encoding.UTF8.GetBytes(token));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PollAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogWarning("Archiver poll failed: {Message}", ex.Message);
            }
            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    public async Task PollAsync(CancellationToken ct)
    {
        var url = settings.Current.TeslausbEnabled == true ? settings.Current.ArchiverUrl : null;
        ArchiverStatus? status = null;
        ArchiverLog? archiveLog = null;
        if (url != null)
        {
            try
            {
                using var client = http.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(6);
                var body = await client.GetStringAsync($"{url}/cgi-bin/status.sh", ct);
                status = ParseStatus(body) ?? throw new FormatException("The device answered, but not with a teslausb status report.");
                LastError = null;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or FormatException && !ct.IsCancellationRequested)
            {
                // Being unreachable is the normal state while the car is away.
                LastError = ex is FormatException ? ex.Message : null;
            }
            // The log changes far less often than the status, except when the drive is handed back and forth.
            if (status != null && (DateTime.UtcNow - _lastLogRead > LogInterval || status.DrivesActive != _lastDrivesActive))
            {
                archiveLog = await ReadLogAsync(url, ct);
                _lastLogRead = DateTime.UtcNow;
                _lastDrivesActive = status.DrivesActive;
            }
        }
        await RecordAsync(status, archiveLog, ct);

        // car-logger lives on the same Pi, so it is only reachable while teslausb answers.
        if (status != null && DateTime.UtcNow - _lastCarSync >= CarSyncInterval)
        {
            _lastCarSync = DateTime.UtcNow;
            await carLog.SyncAsync(ct);
        }
    }

    private static readonly TimeSpan CarSyncInterval = TimeSpan.FromMinutes(1);
    private DateTime _lastCarSync = DateTime.MinValue;

    private static readonly TimeSpan LogInterval = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan SampleInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan KeepSamples = TimeSpan.FromDays(90);
    // Enough of the log to cover a run that copied a few hundred files, without pulling the whole file over car Wi-Fi.
    private const int LogTailBytes = 128 * 1024;
    private DateTime _lastLogRead = DateTime.MinValue;
    private bool? _lastDrivesActive;

    /// <summary>Reads the end of teslausb's archiveloop.log, which its web server publishes. Older setups may not have it.</summary>
    private async Task<ArchiverLog?> ReadLogAsync(string url, CancellationToken ct)
    {
        try
        {
            using var client = http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{url}/archiveloop.log");
            request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(null, LogTailBytes);
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) return null;
            var text = System.Text.Encoding.UTF8.GetString(await response.Content.ReadAsByteArrayAsync(ct));
            // A partial read starts mid-line; drop that fragment.
            if (response.StatusCode == System.Net.HttpStatusCode.PartialContent && text.IndexOf('\n') is var nl and >= 0) text = text[(nl + 1)..];
            return ArchiverLogParser.Parse(text);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>Opens, extends or closes the current "at home" session, and keeps a reading every few minutes.</summary>
    private async Task RecordAsync(ArchiverStatus? status, ArchiverLog? archiveLog, CancellationToken ct)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var now = DateTime.UtcNow;
        var open = await db.ArchiverSessions.Where(s => s.Open).OrderByDescending(s => s.Id).FirstOrDefaultAsync(ct);
        if (open != null && now - open.LastSeenAt > OfflineAfter)
        {
            open.Open = false;
            open = null;
        }
        if (status != null)
        {
            if (open == null)
            {
                open = new ArchiverSession { StartedAt = now, Open = true };
                db.ArchiverSessions.Add(open);
                log.LogInformation("The car's archiver is on the network");
                await db.ArchiverSamples.Where(s => s.At < now - KeepSamples).ExecuteDeleteAsync(ct);
            }
            open.LastSeenAt = now;
            open.LastStatusJson = JsonSerializer.Serialize(status, Json);
            if (archiveLog != null)
            {
                // Compare with the last log read, even if that was on an earlier visit.
                var previousJson = open.LastLogJson ?? await db.ArchiverSessions.Where(s => s.LastLogJson != null)
                    .OrderByDescending(s => s.Id).Select(s => s.LastLogJson).FirstOrDefaultAsync(ct);
                var previous = previousJson is { } json ? JsonSerializer.Deserialize<ArchiverLog>(json, Json) : null;
                open.LastLogJson = JsonSerializer.Serialize(archiveLog, Json);
                // Without the webhook, a finished copy in the log is the only sign that new clips have landed.
                if (previous != null && archiveLog.LastCopy is { FinishedAt: not null, Archived: > 0 } copy
                    && copy.StartedAt != previous.LastCopy?.StartedAt)
                    _ = Task.Delay(TimeSpan.FromSeconds(100)).ContinueWith(_ => scanner.RequestScan(), TaskScheduler.Default);
            }
        }
        await db.SaveChangesAsync(ct);

        if (status != null && open != null)
        {
            var last = await db.ArchiverSamples.Where(s => s.SessionId == open.Id).MaxAsync(s => (DateTime?)s.At, ct);
            if (last == null || now - last >= SampleInterval)
            {
                db.ArchiverSamples.Add(new ArchiverSample
                {
                    SessionId = open.Id,
                    At = now,
                    CpuTempC = status.CpuTempC,
                    SupplyVolts = status.SupplyVolts,
                    WifiStrength = status.WifiStrength,
                    Throttled = status.Throttled,
                    FreeBytes = status.FreeBytes,
                });
                await db.SaveChangesAsync(ct);
            }
        }
    }

    /// <summary>Handles a teslausb webhook call ({"value1": title, "value2": message}).</summary>
    public async Task HandleNotificationAsync(string? message)
    {
        var parsed = ParseNotification(message ?? "");
        if (parsed == null) return;
        await using var db = await dbf.CreateDbContextAsync();
        var now = DateTime.UtcNow;
        if (parsed.IsStart)
        {
            db.ArchiverSyncs.Add(new ArchiverSync { StartedAt = now, FilesPlanned = parsed.Files, EventsPlanned = parsed.Events, Message = message });
        }
        else
        {
            var running = await db.ArchiverSyncs.Where(s => s.FinishedAt == null && s.StartedAt > now.AddHours(-12))
                .OrderByDescending(s => s.Id).FirstOrDefaultAsync();
            running ??= db.ArchiverSyncs.Add(new ArchiverSync { StartedAt = now }).Entity;
            running.FinishedAt = now;
            running.FilesArchived = parsed.Files;
            running.Message = message;
            // New clips have just landed; index them once the files have settled.
            _ = Task.Delay(TimeSpan.FromSeconds(100)).ContinueWith(_ => scanner.RequestScan(), TaskScheduler.Default);
        }
        await db.SaveChangesAsync();
    }

    /// <summary>Asks teslausb to start archiving now instead of waiting for its own schedule.</summary>
    public async Task TriggerSyncAsync(CancellationToken ct)
    {
        var url = (settings.Current.TeslausbEnabled == true ? settings.Current.ArchiverUrl : null)
                  ?? throw new InvalidOperationException("No teslausb address is configured.");
        using var client = http.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);
        using var response = await client.GetAsync($"{url}/cgi-bin/trigger_sync.sh", ct);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>teslausb says "Archiving 48 file(s) including 2 event folder(s) starting at …" and later "Archived 48 files in 3 minutes".</summary>
    public static ArchiverNotification? ParseNotification(string message)
    {
        if (ArchivedCount().Match(message) is { Success: true } done)
            return new ArchiverNotification(false, int.Parse(done.Groups[1].Value, CultureInfo.InvariantCulture), null);
        if (!message.Contains("Archiving", StringComparison.Ordinal)) return null;
        int? Number(Match m) => m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;
        return new ArchiverNotification(true, Number(PlannedFiles().Match(message)), Number(PlannedEvents().Match(message)));
    }

    /// <summary>Reads teslausb's status report. Every value arrives as a string, and some may be empty or "N/A".</summary>
    public static ArchiverStatus? ParseStatus(string body)
    {
        var start = body.IndexOf('{');
        if (start < 0) return null;
        try
        {
            using var doc = JsonDocument.Parse(body[start..]);
            var root = doc.RootElement;
            if (!root.TryGetProperty("uptime", out _) && !root.TryGetProperty("cpu_temp", out _)) return null;

            string? Text(string name) => root.TryGetProperty(name, out var p) && p.GetString() is { Length: > 0 } v && v != "N/A" ? v : null;
            double? Number(string name) => double.TryParse(Text(name), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
            long? Whole(string name) => long.TryParse(Text(name), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;

            double? strength = null;
            if (Text("wifi_strength")?.Split('/') is [var have, var max]
                && double.TryParse(have, NumberStyles.Float, CultureInfo.InvariantCulture, out var h)
                && double.TryParse(max, NumberStyles.Float, CultureInfo.InvariantCulture, out var m) && m > 0)
                strength = Math.Clamp(h / m, 0, 1);

            int? throttled = null;
            if (Text("throttled") is { } hex && int.TryParse(hex.Replace("0x", ""), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var flags))
                throttled = flags;

            return new ArchiverStatus
            {
                CpuTempC = Number("cpu_temp") is { } milli ? Math.Round(milli / 1000, 1) : null,
                Throttled = throttled,
                WifiSsid = Text("wifi_ssid"),
                WifiStrength = strength,
                WifiIp = Text("wifi_ip"),
                EtherIp = Text("ether_ip"),
                UptimeSec = Number("uptime"),
                DrivesActive = Text("drives_active") is { } drives ? drives == "yes" : null,
                TotalBytes = Whole("total_space"),
                FreeBytes = Whole("free_space"),
                Snapshots = (int?)Whole("num_snapshots"),
                NewestSnapshotUtc = Whole("snapshot_newest") is { } epoch and > 0 ? DateTimeOffset.FromUnixTimeSeconds(epoch).UtcDateTime : null,
                FanRpm = (int?)Whole("fan_speed"),
                SupplyVolts = Number("external_5v"),
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
