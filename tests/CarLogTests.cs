using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

public sealed class CarLogTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "teslacam-tests", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;
    private readonly FakeLogger _pi = new();

    public CarLogTests()
    {
        Directory.CreateDirectory(Path.Combine(_root, "clips"));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["TESLACAM_ROOT"] = Path.Combine(_root, "clips"),
            ["TESLACAM_DATA"] = Path.Combine(_root, "data"),
        }).Build();
        var services = new ServiceCollection();
        var paths = new AppPaths(config);
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton(paths);
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.AddSingleton<IHttpClientFactory>(new FakeHttp(_pi));
        services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={paths.DbFile};Pooling=False"));
        services.AddSingleton<SettingsService>();
        services.AddSingleton<CarLogService>();
        _services = services.BuildServiceProvider();
        using var db = _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();
        db.Database.Migrate();
    }

    public void Dispose()
    {
        _services.Dispose();
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    private CarLogService Car => _services.GetRequiredService<CarLogService>();
    private AppDb Db() => _services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext();

    private async Task Configure(string token = "secret") =>
        await _services.GetRequiredService<SettingsService>().SaveAsync(new AppSettings
        {
            ArchiverUrl = "http://teslausb.local", TeslausbEnabled = true, CarLoggerToken = token,
        });

    // Shaped like car-logger's records: the car's own report, with nanosecond timestamps from Go.
    private static string ChargeRecord(int level, string time) => """
        {"kind":"charge","mode":"idle","carTime":"TIME","piTime":"2026-03-02T11:00:00.123456789-06:00",
         "data":{"chargeState":{"chargingState":{"Charging":{}},"batteryLevel":LEVEL,"batteryRange":194.66666,
         "chargeLimitSoc":90,"chargerPower":7,"chargeRateMphFloat":28.5,"chargeEnergyAdded":12.5,"chargePortDoorOpen":true,
         "timestamp":"TIME"}}}
        """.Replace("TIME", time).Replace("LEVEL", level.ToString());

    [Fact]
    public async Task Collects_every_page_once_and_acknowledges_it()
    {
        await Configure();
        for (var i = 0; i < 1201; i++) _pi.Add(ChargeRecord(50 + i % 40, "2026-03-02T17:00:00.264Z"));

        Assert.Equal(1201, await Car.SyncAsync(CancellationToken.None));
        Assert.Null(Car.LastError);
        Assert.Equal(1201, _pi.AckedUpTo);
        // Nothing new: nothing added, and the same records are never stored twice.
        Assert.Equal(0, await Car.SyncAsync(CancellationToken.None));
        await using var db = Db();
        Assert.Equal(1201, await db.CarReadings.CountAsync());
    }

    [Fact]
    public async Task Starts_over_when_the_Pi_log_is_new()
    {
        await Configure();
        _pi.Add(ChargeRecord(60, "2026-03-02T17:00:00Z"));
        await Car.SyncAsync(CancellationToken.None);

        _pi.Reset("second-log");
        _pi.Add(ChargeRecord(61, "2026-03-02T18:00:00Z"));
        Assert.Equal(1, await Car.SyncAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Says_when_the_token_is_wrong()
    {
        await Configure("wrong");
        _pi.Add(ChargeRecord(60, "2026-03-02T17:00:00Z"));

        Assert.Equal(0, await Car.SyncAsync(CancellationToken.None));
        Assert.Contains("token", Car.LastError);
    }

    [Fact]
    public async Task Summarises_the_latest_readings()
    {
        await Configure();
        _pi.Add(ChargeRecord(70, "2026-03-02T17:00:00Z"));
        _pi.Add(ChargeRecord(72, "2026-03-02T17:05:00Z"));
        _pi.Add("""
            {"kind":"closures","mode":"parked","carTime":"2026-03-02T17:05:01Z","piTime":"2026-03-02T11:05:01-06:00",
             "data":{"closuresState":{"doorOpenDriverFront":true,"windowOpenPassengerRear":true,"locked":false,"isUserPresent":true,"sentryModeState":{"Armed":{}}}}}
            """);
        _pi.Add("""
            {"kind":"tires","mode":"parked","carTime":"2026-03-02T17:05:02Z","piTime":"2026-03-02T11:05:02-06:00",
             "data":{"tirePressureState":{"tpmsPressureFl":2.3,"tpmsPressureFr":2.9,"tpmsPressureRl":2.9,"tpmsPressureRr":2.9,"tpmsSoftWarningFl":true,"tpmsHardWarningRr":false}}}
            """);
        _pi.Add("""
            {"kind":"drive","mode":"parked","carTime":"2026-03-02T17:05:03Z","piTime":"2026-03-02T11:05:03-06:00",
             "data":{"driveState":{"shiftState":{"P":{}},"odometerInHundredthsOfAMile":1234567}}}
            """);
        _pi.Add("""
            {"kind":"body","mode":"parked","carTime":"2026-03-02T17:05:04.095571313Z","carTimeEstimated":true,"piTime":"2026-03-02T11:05:04-06:00",
             "data":{"vehicleLockState":"VEHICLELOCKSTATE_LOCKED","vehicleSleepStatus":"VEHICLE_SLEEP_STATUS_AWAKE","userPresence":"VEHICLE_USER_PRESENCE_NOT_PRESENT"}}
            """);
        await Car.SyncAsync(CancellationToken.None);

        var now = await Car.NowAsync();

        Assert.NotNull(now);
        Assert.Equal(72, now.Battery!.Level);
        Assert.Equal("Charging", now.Battery.Charging);
        Assert.Equal(90, now.Battery.Limit);
        Assert.Equal(28.5, now.Battery.RateMph);
        Assert.Equal(new DateTime(2026, 3, 2, 17, 5, 0, DateTimeKind.Utc), now.Battery.At);
        Assert.Equal("Armed", now.Closures!.Sentry);
        Assert.Equal(["driver door", "rear right window"], now.Closures.Open);
        Assert.Equal(["front left"], now.Tires!.Warnings);
        Assert.Equal(12345.67, now.Drive!.OdometerMiles);
        Assert.Equal("P", now.Drive.Gear);
        Assert.True(now.Body!.Locked);
        Assert.False(now.Body.Asleep);
        Assert.Null(now.Climate);

        var history = await Car.BatteryHistoryAsync(36500);
        Assert.Equal([70, 72], history.Select(p => p.Level));
    }

    [Fact]
    public void Finds_car_logger_next_to_teslausb()
    {
        Assert.Equal("http://teslausb.local:8722", CarLogService.LoggerUrl("http://teslausb.local"));
        Assert.Equal("http://192.168.1.50:8722", CarLogService.LoggerUrl("https://192.168.1.50:8443/"));
        Assert.Null(CarLogService.LoggerUrl(null));
    }

    /// <summary>Stands in for car-logger: one log file, records numbered from 1, pages of what the client asks.</summary>
    private sealed class FakeLogger
    {
        private readonly List<string> _records = [];
        private string _logId = "first-log";
        public int AckedUpTo { get; private set; }

        public void Add(string json) => _records.Add(JsonDocument.Parse(json).RootElement.GetRawText());

        public void Reset(string logId)
        {
            _records.Clear();
            _logId = logId;
        }

        public HttpResponseMessage Handle(HttpRequestMessage request)
        {
            if (request.Headers.Authorization?.Parameter != "secret") return new HttpResponseMessage(HttpStatusCode.Unauthorized);
            var query = System.Web.HttpUtility.ParseQueryString(request.RequestUri!.Query);
            if (request.RequestUri.AbsolutePath == "/ack")
            {
                if (query["logId"] == _logId) AckedUpTo = int.Parse(query["upto"]!.Split(':')[1]);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
            }
            var after = query["after"] is { Length: > 0 } a ? int.Parse(a.Split(':')[1]) : 0;
            var limit = int.Parse(query["limit"]!);
            var slice = _records.Skip(after).Take(limit).Select((r, i) => $$"""{"id":"000001:{{after + i + 1}}","record":{{r}}}""");
            var next = Math.Min(after + limit, _records.Count);
            var body = $$"""{"logId":"{{_logId}}","records":[{{string.Join(",", slice)}}],"next":"000001:{{next}}","more":{{(next < _records.Count ? "true" : "false")}}}""";
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class FakeHttp(FakeLogger pi) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(pi));

        private sealed class Handler(FakeLogger pi) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
                Task.FromResult(pi.Handle(request));
        }
    }
}
