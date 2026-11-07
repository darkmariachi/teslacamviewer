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
            return Results.Ok(new
            {
                configured = url != null && s.CarLoggerToken != null,
                url,
                lastSync = Dto.Utc(car.LastSync),
                error = car.LastError,
                readings = await db.CarReadings.CountAsync(ct),
                lastReading = Dto.Utc(await db.CarReadings.MaxAsync(r => r.CarTime, ct)),
                now = await car.NowAsync(ct),
                battery = await car.BatteryHistoryAsync(14, ct),
            });
        });

        group.MapPost("/sync", async (CarLogService car, CancellationToken ct) =>
        {
            var added = await car.SyncAsync(ct);
            return car.LastError is { } error ? Results.Json(new { error }, statusCode: 502) : Results.Ok(new { added });
        });
    }
}
