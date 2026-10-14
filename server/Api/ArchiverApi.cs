using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class ArchiverApi
{
    public record HookBody(string? Value1, string? Value2);

    public static void MapArchiverApi(this IEndpointRouteBuilder app)
    {
        // Called by teslausb from the car, which has no login; the token in the path is the credential.
        app.MapPost("/api/archiver/hook/{token}", async (string token, HookBody body, ArchiverService archiver) =>
        {
            if (!await archiver.IsValidTokenAsync(token)) return Results.NotFound();
            await archiver.HandleNotificationAsync(body.Value2);
            return Results.Ok();
        });

        var group = app.MapGroup("/api/archiver").RequireAuthorization();

        group.MapGet("", async (AppDb db, ArchiverService archiver, SettingsService settings) =>
        {
            var enabled = settings.Current.TeslausbEnabled == true;
            var url = enabled ? settings.Current.ArchiverUrl : null;
            var sessions = await db.ArchiverSessions.AsNoTracking().OrderByDescending(s => s.Id).Take(15).ToListAsync();
            var syncs = await db.ArchiverSyncs.AsNoTracking().OrderByDescending(s => s.Id).Take(15).ToListAsync();
            var latest = sessions.FirstOrDefault();
            var online = latest is { Open: true } && DateTime.UtcNow - latest.LastSeenAt < TimeSpan.FromMinutes(3);
            var running = syncs.FirstOrDefault(s => s.FinishedAt == null && s.StartedAt > DateTime.UtcNow.AddHours(-12));
            var live = db.Events.AsNoTracking().Where(e => e.TrashedAt == null);

            return Results.Ok(new
            {
                enabled,
                configured = url != null,
                url,
                hookPath = $"/api/archiver/hook/{await archiver.GetTokenAsync()}",
                online,
                lastSeen = Dto.Utc(latest?.LastSeenAt),
                onlineSince = online ? Dto.Utc(latest!.StartedAt) : null,
                status = latest?.LastStatusJson is { } json ? JsonSerializer.Deserialize<ArchiverStatus>(json, JsonSerializerOptions.Web) : null,
                error = archiver.LastError,
                // An upload that never reported finishing is only "running" while the car is still here.
                uploading = running != null && online ? SyncDto(running) : null,
                syncs = syncs.Select(SyncDto),
                sessions = sessions.Select(s => new
                {
                    s.Id,
                    startedAt = Dto.Utc(s.StartedAt),
                    lastSeenAt = Dto.Utc(s.LastSeenAt),
                    open = s.Open && online && s.Id == latest!.Id,
                }),
                // Car-local time of the newest footage, and when the library last gained an event.
                newestClip = await live.MaxAsync(e => (DateTime?)e.EndTime),
                lastIndexed = Dto.Utc(await live.MaxAsync(e => (DateTime?)e.IndexedAt)),
            });
        });

        group.MapPost("/sync", async (ArchiverService archiver, CancellationToken ct) =>
        {
            try
            {
                await archiver.TriggerSyncAsync(ct);
                return Results.Ok();
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
            {
                return Results.Json(new { error = "The car's archiver did not answer. It may be away or asleep." }, statusCode: 502);
            }
        });

        group.MapPost("/poll", async (ArchiverService archiver, CancellationToken ct) =>
        {
            await archiver.PollAsync(ct);
            return Results.Ok();
        });

        group.MapPost("/token", async (ArchiverService archiver) =>
            Results.Ok(new { hookPath = $"/api/archiver/hook/{await archiver.RegenerateTokenAsync()}" }));
    }

    private static object SyncDto(ArchiverSync s) => new
    {
        s.Id,
        startedAt = Dto.Utc(s.StartedAt),
        finishedAt = Dto.Utc(s.FinishedAt),
        s.FilesPlanned,
        s.EventsPlanned,
        s.FilesArchived,
    };
}
