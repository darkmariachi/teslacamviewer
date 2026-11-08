using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class CarApi
{
    public static void MapCarApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/car").RequireAuthorization();

        group.MapGet("", async (AppDb db, CarLogService car, SettingsService settings, CancellationToken ct) =>
        {
            var s = settings.Current;
            var url = s.TeslausbEnabled == true ? CarLogService.LoggerUrl(s.ArchiverUrl) : null;
            // car-logger is only reachable while teslausb is: while the car is away, readings simply wait on the Pi.
            var visit = await db.ArchiverSessions.AsNoTracking().OrderByDescending(v => v.Id).FirstOrDefaultAsync(ct);
            var home = visit is { Open: true } && DateTime.UtcNow - visit.LastSeenAt < TimeSpan.FromMinutes(3);
            return Results.Ok(new
            {
                configured = url != null && s.CarLoggerToken != null,
                url,
                home,
                lastHome = Dto.Utc(visit?.LastSeenAt),
                lastSync = Dto.Utc(car.LastSync),
                error = home ? car.LastError : null,
                readings = await db.CarReadings.CountAsync(ct),
                lastReading = Dto.Utc(await db.CarReadings.MaxAsync(r => r.CarTime, ct)),
                now = await car.NowAsync(ct),
                battery = await car.BatteryHistoryAsync(14, ct),
            });
        });

        group.MapGet("/drives", async (CarLogService car, int? days, CancellationToken ct) =>
            Results.Ok(await car.DrivesAsync(Math.Clamp(days ?? 30, 1, 365), ct)));

        group.MapGet("/drives/{id:long}", async (CarLogService car, long id, CancellationToken ct) =>
            await car.DriveAsync(id, ct) is { } drive ? Results.Ok(drive) : Results.NotFound());

        group.MapPost("/sync", async (CarLogService car, CancellationToken ct) =>
        {
            var added = await car.SyncAsync(ct);
            return car.LastError is { } error ? Results.Json(new { error }, statusCode: 502) : Results.Ok(new { added });
        });
    }
}
