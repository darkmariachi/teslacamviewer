using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>The car's state as of its latest readings, in plain fields for the Car tab.</summary>
public record CarNow
{
    public CarBattery? Battery { get; init; }
    public CarClosures? Closures { get; init; }
    public CarClimate? Climate { get; init; }
    public CarTires? Tires { get; init; }
    public CarSoftware? Software { get; init; }
    public CarDrive? Drive { get; init; }
    public CarBody? Body { get; init; }
}

public record CarBattery(DateTime? At, int? Level, double? RangeMiles, string? Charging, int? Limit, double? ChargerPowerKw,
    double? RateMph, double? EnergyAddedKwh, bool? PortOpen);
public record CarClosures(DateTime? At, bool? Locked, string? Sentry, bool? UserPresent, List<string> Open);
public record CarClimate(DateTime? At, double? InsideC, double? OutsideC, bool? ClimateOn);
/// <summary>Pressures in bar, as the car reports them; warnings name the tires the car flags as low.</summary>
public record CarTires(DateTime? At, double? FrontLeft, double? FrontRight, double? RearLeft, double? RearRight, List<string> Warnings);
public record CarSoftware(DateTime? At, string? Status, string? Version);
public record CarDrive(DateTime? At, double? OdometerMiles, string? Gear, double? SpeedMph);
public record CarBody(DateTime? At, bool Locked, bool Asleep, bool UserPresent);

/// <summary>
/// Collects car-logger's readings from the teslausb Pi while the car is home, and turns the latest ones
/// into a summary. The Pi keeps its log until a page has been saved here, so a sync cut short when the car
/// leaves just continues next time.
/// </summary>
public class CarLogService(IDbContextFactory<AppDb> dbf, SettingsService settings, IHttpClientFactory http, ILogger<CarLogService> log)
{
    public const int Port = 8722;
    private const string CursorKey = "carLoggerCursor";
    private const int PageSize = 500;
    private const int MaxPagesPerSync = 40;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public DateTime? LastSync { get; private set; }
    public string? LastError { get; private set; }

    /// <summary>car-logger listens on its own port on the same Pi as teslausb's web page.</summary>
    public static string? LoggerUrl(string? archiverUrl) =>
        Uri.TryCreate(archiverUrl, UriKind.Absolute, out var uri) ? $"http://{uri.Host}:{Port}" : null;

    private record PageRecord(string Id, JsonElement Record);
    private record Page(string LogId, List<PageRecord> Records, string Next, bool More);
    private record SavedCursor(string LogId, string Cursor);
    private record LoggedRecord(string Kind, string Mode, DateTime? CarTime, bool CarTimeEstimated, DateTime PiTime, JsonElement Data);

    /// <summary>Pulls everything new from the Pi. Returns how many readings were added.</summary>
    public async Task<int> SyncAsync(CancellationToken ct)
    {
        var s = settings.Current;
        var baseUrl = s.TeslausbEnabled == true ? LoggerUrl(s.ArchiverUrl) : null;
        if (baseUrl == null || s.CarLoggerToken == null) return 0;
        try
        {
            using var client = http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", s.CarLoggerToken);

            var saved = await settings.GetRawAsync(CursorKey) is { } raw ? JsonSerializer.Deserialize<SavedCursor>(raw, Json) : null;
            var added = 0;
            Page? page = null;
            for (var i = 0; i < MaxPagesPerSync; i++)
            {
                var after = saved?.Cursor ?? "";
                page = await client.GetFromJsonAsyncSafe<Page>($"{baseUrl}/records?after={Uri.EscapeDataString(after)}&limit={PageSize}", ct)
                       ?? throw new FormatException("car-logger sent an empty answer.");
                if (saved != null && saved.LogId != page.LogId)
                {
                    // The Pi's log was started afresh; read it from the beginning.
                    saved = null;
                    continue;
                }
                added += await SaveAsync(page, ct);
                saved = new SavedCursor(page.LogId, page.Next);
                await settings.SetRawAsync(CursorKey, JsonSerializer.Serialize(saved, Json));
                if (!page.More) break;
            }
            // Only now may the Pi drop what it has handed over.
            if (saved != null)
            {
                using var ack = await client.PostAsync($"{baseUrl}/ack?upto={Uri.EscapeDataString(saved.Cursor)}&logId={Uri.EscapeDataString(saved.LogId)}", null, ct);
            }
            LastSync = DateTime.UtcNow;
            LastError = null;
            if (added > 0) log.LogInformation("Collected {Count} car readings", added);
            return added;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or FormatException && !ct.IsCancellationRequested)
        {
            LastError = ex switch
            {
                HttpRequestException { StatusCode: System.Net.HttpStatusCode.Unauthorized } => "car-logger refused the token. Copy it again from the Pi.",
                // Most often the car simply left mid-collection; the next visit picks up where this one stopped.
                HttpRequestException { StatusCode: null } or TaskCanceledException => "car-logger on the Pi didn't answer. If the car is home, check that car-logger is running.",
                _ => $"car-logger sent something unexpected: {ex.Message}",
            };
            return 0;
        }
    }

    private async Task<int> SaveAsync(Page page, CancellationToken ct)
    {
        if (page.Records.Count == 0) return 0;
        await using var db = await dbf.CreateDbContextAsync(ct);
        var sources = page.Records.Select(r => $"{page.LogId}/{r.Id}").ToList();
        var existing = (await db.CarReadings.Where(r => sources.Contains(r.Source)).Select(r => r.Source).ToListAsync(ct)).ToHashSet();
        var added = 0;
        foreach (var r in page.Records)
        {
            var source = $"{page.LogId}/{r.Id}";
            if (existing.Contains(source)) continue;
            LoggedRecord? rec;
            try
            {
                rec = r.Record.Deserialize<LoggedRecord>(Json);
            }
            catch (JsonException)
            {
                continue;
            }
            if (rec == null || string.IsNullOrEmpty(rec.Kind)) continue;
            db.CarReadings.Add(new CarReading
            {
                Kind = rec.Kind,
                Mode = rec.Mode,
                CarTime = rec.CarTime?.ToUniversalTime(),
                CarTimeEstimated = rec.CarTimeEstimated,
                PiTime = rec.PiTime.ToUniversalTime(),
                Data = rec.Data.GetRawText(),
                Source = source,
            });
            added++;
        }
        await db.SaveChangesAsync(ct);
        return added;
    }

    /// <summary>The newest reading of each kind, summarised.</summary>
    public async Task<CarNow?> NowAsync(CancellationToken ct = default)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var latestIds = await db.CarReadings.GroupBy(r => r.Kind).Select(g => g.Max(r => r.Id)).ToListAsync(ct);
        if (latestIds.Count == 0) return null;
        var latest = await db.CarReadings.AsNoTracking().Where(r => latestIds.Contains(r.Id)).ToListAsync(ct);
        return Summarize(latest);
    }

    public static CarNow Summarize(IEnumerable<CarReading> latest)
    {
        var now = new CarNow();
        foreach (var r in latest)
        {
            using var doc = JsonDocument.Parse(r.Data);
            var root = doc.RootElement;
            var at = r.CarTime is { } t ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : (DateTime?)null;
            now = r.Kind switch
            {
                "charge" when root.TryGetProperty("chargeState", out var c) => now with
                {
                    Battery = new CarBattery(at, (int?)Num(c, "batteryLevel"), Num(c, "batteryRange"), OneOf(c, "chargingState"),
                        (int?)Num(c, "chargeLimitSoc"), Num(c, "chargerPower"), Num(c, "chargeRateMphFloat") ?? Num(c, "chargeRateMph"),
                        Num(c, "chargeEnergyAdded"), Bool(c, "chargePortDoorOpen")),
                },
                "closures" when root.TryGetProperty("closuresState", out var c) => now with
                {
                    Closures = new CarClosures(at, Bool(c, "locked"), OneOf(c, "sentryModeState"), Bool(c, "isUserPresent"), OpenClosures(c)),
                },
                "climate" when root.TryGetProperty("climateState", out var c) => now with
                {
                    Climate = new CarClimate(at, Num(c, "insideTempCelsius"), Num(c, "outsideTempCelsius"), Bool(c, "isClimateOn")),
                },
                "tires" when root.TryGetProperty("tirePressureState", out var c) => now with
                {
                    Tires = new CarTires(at, Num(c, "tpmsPressureFl"), Num(c, "tpmsPressureFr"), Num(c, "tpmsPressureRl"), Num(c, "tpmsPressureRr"),
                        new[] { ("Fl", "front left"), ("Fr", "front right"), ("Rl", "rear left"), ("Rr", "rear right") }
                            .Where(p => Bool(c, "tpmsSoftWarning" + p.Item1) == true || Bool(c, "tpmsHardWarning" + p.Item1) == true)
                            .Select(p => p.Item2).ToList()),
                },
                "software" when root.TryGetProperty("softwareUpdateState", out var c) => now with
                {
                    Software = new CarSoftware(at, OneOf(c, "status"), Text(c, "version")),
                },
                "drive" when root.TryGetProperty("driveState", out var c) => now with
                {
                    Drive = new CarDrive(at, Num(c, "odometerInHundredthsOfAMile") is { } odo ? odo / 100 : null, OneOf(c, "shiftState"),
                        Num(c, "speedFloat") ?? Num(c, "speed")),
                },
                "body" => now with
                {
                    Body = new CarBody(at, Text(root, "vehicleLockState") is "VEHICLELOCKSTATE_LOCKED" or "VEHICLELOCKSTATE_INTERNAL_LOCKED",
                        Text(root, "vehicleSleepStatus") == "VEHICLE_SLEEP_STATUS_ASLEEP",
                        Text(root, "userPresence") == "VEHICLE_USER_PRESENCE_PRESENT"),
                },
                _ => now,
            };
        }
        return now;
    }

    public record BatteryPoint(DateTime At, int Level, double? RangeMiles);

    /// <summary>Battery level over the last days, thinned out to a few hundred points for the chart.</summary>
    public async Task<List<BatteryPoint>> BatteryHistoryAsync(int days, CancellationToken ct = default)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var since = DateTime.UtcNow.AddDays(-days);
        var rows = await db.CarReadings.AsNoTracking()
            .Where(r => r.Kind == "charge" && r.CarTime != null && r.CarTime >= since)
            .OrderBy(r => r.CarTime).Select(r => new { r.CarTime, r.Data }).ToListAsync(ct);
        var step = Math.Max(1, rows.Count / 400);
        var points = new List<BatteryPoint>();
        for (var i = 0; i < rows.Count; i += step)
        {
            using var doc = JsonDocument.Parse(rows[i].Data);
            if (!doc.RootElement.TryGetProperty("chargeState", out var c) || Num(c, "batteryLevel") is not { } level) continue;
            points.Add(new BatteryPoint(DateTime.SpecifyKind(rows[i].CarTime!.Value, DateTimeKind.Utc), (int)level, Num(c, "batteryRange")));
        }
        return points;
    }

    private static List<string> OpenClosures(JsonElement c)
    {
        var names = new (string Field, string Name)[]
        {
            ("doorOpenDriverFront", "driver door"), ("doorOpenPassengerFront", "passenger door"),
            ("doorOpenDriverRear", "rear left door"), ("doorOpenPassengerRear", "rear right door"),
            ("doorOpenTrunkFront", "frunk"), ("doorOpenTrunkRear", "trunk"),
            ("windowOpenDriverFront", "driver window"), ("windowOpenPassengerFront", "passenger window"),
            ("windowOpenDriverRear", "rear left window"), ("windowOpenPassengerRear", "rear right window"),
        };
        return names.Where(n => Bool(c, n.Field) == true).Select(n => n.Name).ToList();
    }

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number ? p.GetDouble() : null;

    private static bool? Bool(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind is JsonValueKind.True or JsonValueKind.False ? p.GetBoolean() : null;

    private static string? Text(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    /// <summary>Protobuf "oneof" values arrive as an object with a single key naming the choice: {"Charging": {}}.</summary>
    private static string? OneOf(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Object ? p.EnumerateObject().Select(x => x.Name).FirstOrDefault() : null;
}

internal static class HttpJson
{
    /// <summary>GetFromJsonAsync, but a non-success status throws HttpRequestException with the status set.</summary>
    public static async Task<T?> GetFromJsonAsyncSafe<T>(this HttpClient client, string url, CancellationToken ct)
    {
        using var response = await client.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonSerializer.DeserializeAsync<T>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web), ct);
    }
}
