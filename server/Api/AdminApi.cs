using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class AdminApi
{
    public record BacklogRequest(string Kind);
    public record RetentionRequest(int OlderThanDays, string[]? Types);

    public static void MapAdminApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin").RequireAuthorization();

        group.MapGet("/overview", async (AppDb db, JobQueue queue, JobRunner runner, Scanner scanner, Ffmpeg ffmpeg,
            SettingsService settings, StorageService storage) =>
        {
            var live = db.Events.AsNoTracking().Where(e => e.TrashedAt == null);
            var counts = await db.Jobs.AsNoTracking().GroupBy(j => new { j.Kind, j.Status })
                .Select(g => new { g.Key.Kind, g.Key.Status, count = g.Count() }).ToListAsync();
            var running = await db.Jobs.AsNoTracking().Include(j => j.Event).Where(j => j.Status == JobStatus.Running).ToListAsync();

            // Estimate the remaining encode time from how long recent merges took.
            var recent = await db.Jobs.AsNoTracking()
                .Where(j => j.Kind == JobKind.Preview && j.Status == JobStatus.Done && j.StartedAt != null && j.FinishedAt != null)
                .OrderByDescending(j => j.Id).Take(10).Select(j => new { j.StartedAt, j.FinishedAt }).ToListAsync();
            var queuedPreviews = counts.Where(c => c is { Kind: JobKind.Preview, Status: JobStatus.Queued }).Sum(c => c.count);
            double? etaSeconds = recent.Count > 0 && queuedPreviews > 0
                ? recent.Average(r => (r.FinishedAt!.Value - r.StartedAt!.Value).TotalSeconds) * queuedPreviews
                : null;

            var total = await live.CountAsync();
            var s = settings.Current;
            return Results.Ok(new
            {
                pipeline = new
                {
                    s.Paused,
                    backgroundAllowed = runner.BackgroundAllowed(),
                    workHours = s.WorkHoursEnabled ? new { start = s.WorkHoursStart, end = s.WorkHoursEnd } : null,
                    encoder = await ffmpeg.ResolveEncoderAsync(),
                    hardwareAvailable = ffmpeg.HardwareAvailable,
                    ffmpegVersion = ffmpeg.Version,
                    etaSeconds,
                },
                jobs = Enum.GetValues<JobKind>().Select(kind => new
                {
                    kind = kind.ToString().ToLowerInvariant(),
                    queued = Count(kind, JobStatus.Queued),
                    running = Count(kind, JobStatus.Running),
                    done = Count(kind, JobStatus.Done),
                    failed = Count(kind, JobStatus.Failed),
                }),
                running = running.Select(j => Dto.JobDto(j, queue, j.Event)),
                scan = new
                {
                    scanner.State.Running,
                    lastRun = scanner.State.LastRunUtc,
                    scanner.State.LastResult,
                    scanner.State.LastError,
                    intervalMinutes = s.ScanIntervalMinutes,
                },
                library = new
                {
                    events = total,
                    probed = await live.CountAsync(e => e.Probed),
                    thumbs = await live.CountAsync(e => e.HasThumb),
                    previews = await live.CountAsync(e => e.HasPreview),
                    needTranscode = await live.CountAsync(e => e.NeedsTranscode),
                    durationSec = await live.SumAsync(e => (double?)e.DurationSec) ?? 0,
                    originalBytes = await live.SumAsync(e => (long?)e.SizeBytes) ?? 0,
                    previewBytes = await live.SumAsync(e => e.PreviewSizeBytes) ?? 0,
                },
                storage = storage.Snapshot(),
                trash = new
                {
                    count = await db.Events.CountAsync(e => e.TrashedAt != null),
                    bytes = await db.Events.Where(e => e.TrashedAt != null).SumAsync(e => (long?)e.SizeBytes) ?? 0,
                    retentionDays = s.TrashRetentionDays,
                },
            });

            int Count(JobKind kind, JobStatus status) => counts.Where(c => c.Kind == kind && c.Status == status).Sum(c => c.count);
        });

        group.MapGet("/jobs", async (AppDb db, JobQueue queue, string? status, string? kind, int? page, int? pageSize) =>
        {
            var query = db.Jobs.AsNoTracking().Include(j => j.Event).AsQueryable();
            if (Enum.TryParse<JobStatus>(status, true, out var st)) query = query.Where(j => j.Status == st);
            if (Enum.TryParse<JobKind>(kind, true, out var k)) query = query.Where(j => j.Kind == k);
            var size = Math.Clamp(pageSize ?? 25, 1, 100);
            var number = Math.Max(1, page ?? 1);
            var total = await query.CountAsync();
            // Running first, then what is next in line, then history.
            var items = await query
                .OrderBy(j => j.Status == JobStatus.Running ? 0 : j.Status == JobStatus.Queued ? 1 : 2)
                .ThenByDescending(j => j.Status == JobStatus.Queued ? j.Priority : 0)
                .ThenByDescending(j => j.FinishedAt ?? j.CreatedAt)
                .Skip((number - 1) * size).Take(size).ToListAsync();
            return Results.Ok(new { items = items.Select(j => Dto.JobDto(j, queue, j.Event)), total, page = number, pageSize = size });
        });

        group.MapPost("/jobs/{id:int}/retry", async (int id, AppDb db, JobQueue queue) =>
        {
            var changed = await db.Jobs.Where(j => j.Id == id && (j.Status == JobStatus.Failed || j.Status == JobStatus.Canceled))
                .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, JobStatus.Queued).SetProperty(j => j.Error, (string?)null).SetProperty(j => j.Progress, 0d));
            queue.Wake();
            return changed > 0 ? Results.Ok() : Results.NotFound();
        });

        group.MapPost("/jobs/{id:int}/cancel", async (int id, JobRunner runner) =>
            await runner.CancelAsync(id) ? Results.Ok() : Results.NotFound());

        group.MapPost("/jobs/retry-failed", async (AppDb db, JobQueue queue) =>
        {
            var changed = await db.Jobs.Where(j => j.Status == JobStatus.Failed)
                .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, JobStatus.Queued).SetProperty(j => j.Error, (string?)null).SetProperty(j => j.Progress, 0d));
            queue.Wake();
            return Results.Ok(new { changed });
        });

        group.MapPost("/jobs/clear-finished", async (AppDb db) =>
        {
            var removed = await db.Jobs.Where(j => (j.Status == JobStatus.Done || j.Status == JobStatus.Canceled) && j.Kind != JobKind.Export)
                .ExecuteDeleteAsync();
            return Results.Ok(new { removed });
        });

        group.MapPost("/pause", async (SettingsService settings) =>
        {
            await settings.SaveAsync(settings.Current with { Paused = true });
            return Results.Ok();
        });

        group.MapPost("/resume", async (SettingsService settings, JobQueue queue) =>
        {
            await settings.SaveAsync(settings.Current with { Paused = false });
            queue.Wake();
            return Results.Ok();
        });

        group.MapPost("/scan", (Scanner scanner) =>
        {
            scanner.RequestScan();
            return Results.Accepted();
        });

        // Queue the given step for every event that still lacks it.
        group.MapPost("/backlog", async (BacklogRequest req, JobQueue queue) =>
        {
            if (!Enum.TryParse<JobKind>(req.Kind, true, out var kind) || kind == JobKind.Export)
                return Results.BadRequest(new { error = "Unknown job kind." });
            return Results.Ok(new { queued = await queue.RequestBacklogAsync(kind) });
        });

        group.MapPost("/backlog/cancel", async (BacklogRequest req, AppDb db) =>
        {
            if (!Enum.TryParse<JobKind>(req.Kind, true, out var kind)) return Results.BadRequest(new { error = "Unknown job kind." });
            var removed = await db.Jobs.Where(j => j.Kind == kind && j.Status == JobStatus.Queued && !j.UserRequested).ExecuteDeleteAsync();
            return Results.Ok(new { removed });
        });

        group.MapGet("/settings", (SettingsService settings) => Results.Ok(settings.Current));

        group.MapPut("/settings", async (AppSettings body, SettingsService settings, JobQueue queue, Scanner scanner) =>
        {
            var saved = await settings.SaveAsync(body);
            queue.Wake();
            return Results.Ok(saved);
        });

        group.MapGet("/trash", async (AppDb db) =>
        {
            var items = await db.Events.AsNoTracking().Where(e => e.TrashedAt != null).OrderByDescending(e => e.TrashedAt).ToListAsync();
            return Results.Ok(items.Select(Dto.Summary));
        });

        group.MapDelete("/trash/{id:int}", async (int id, TrashService trash) =>
        {
            await trash.PurgeAsync(id);
            return Results.Ok();
        });

        group.MapDelete("/trash", async (AppDb db, TrashService trash) =>
        {
            var ids = await db.Events.Where(e => e.TrashedAt != null).Select(e => e.Id).ToListAsync();
            foreach (var id in ids) await trash.PurgeAsync(id);
            return Results.Ok(new { purged = ids.Count });
        });

        // What the home rule would do with the settings being edited, before they are saved.
        group.MapPost("/home-cleanup/preview", async (AppSettings draft, TrashService trash) =>
        {
            var s = draft.Sanitized() with { HomeCleanupEnabled = true };
            var covered = await trash.HomeCandidatesAsync(s, dueOnly: false);
            var due = await trash.HomeCandidatesAsync(s, dueOnly: true);
            return Results.Ok(new
            {
                covered = covered.Count,
                coveredBytes = covered.Sum(e => e.SizeBytes),
                due = due.Count,
                dueBytes = due.Sum(e => e.SizeBytes),
            });
        });

        // Housekeeping: old events that are neither favorites nor in a collection.
        group.MapPost("/retention/preview", async (RetentionRequest req, AppDb db) =>
        {
            var query = Retention(db, req);
            return Results.Ok(new { count = await query.CountAsync(), bytes = await query.SumAsync(e => (long?)e.SizeBytes) ?? 0 });
        });

        group.MapPost("/retention/apply", async (RetentionRequest req, AppDb db, TrashService trash) =>
        {
            var ids = await Retention(db, req).Select(e => e.Id).ToListAsync();
            var moved = 0;
            try
            {
                foreach (var id in ids)
                {
                    await trash.TrashAsync(id);
                    moved++;
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return Results.Json(new { error = $"Stopped after {moved} events: {ex.Message}", moved }, statusCode: 409);
            }
            return Results.Ok(new { moved });
        });

        app.MapGet("/api/stats", async (AppDb db) =>
        {
            var rows = await db.Events.AsNoTracking().Where(e => e.TrashedAt == null)
                .Select(e => new { e.StartTime, e.Type, e.Reason, e.City, e.DurationSec, e.SizeBytes, e.TriggerTime }).ToListAsync();
            return Results.Ok(new
            {
                total = rows.Count,
                durationSec = rows.Sum(r => r.DurationSec),
                sizeBytes = rows.Sum(r => r.SizeBytes),
                byMonth = rows.GroupBy(r => r.StartTime.ToString("yyyy-MM")).OrderBy(g => g.Key).Select(g => new
                {
                    month = g.Key,
                    sentry = g.Count(r => r.Type == EventType.Sentry),
                    saved = g.Count(r => r.Type == EventType.Saved),
                    recent = g.Count(r => r.Type == EventType.Recent),
                    sizeBytes = g.Sum(r => r.SizeBytes),
                }),
                byDay = rows.GroupBy(r => r.StartTime.ToString("yyyy-MM-dd")).OrderBy(g => g.Key).Select(g => new { day = g.Key, count = g.Count() }),
                byHour = Enumerable.Range(0, 24).Select(h => new { hour = h, count = rows.Count(r => (r.TriggerTime ?? r.StartTime).Hour == h) }),
                byWeekday = Enumerable.Range(0, 7).Select(d => new { weekday = d, count = rows.Count(r => (int)r.StartTime.DayOfWeek == d) }),
                byReason = rows.Where(r => r.Reason != null).GroupBy(r => r.Reason!).OrderByDescending(g => g.Count())
                    .Select(g => new { reason = g.Key, count = g.Count() }),
                byCity = rows.Where(r => r.City != null).GroupBy(r => r.City!).OrderByDescending(g => g.Count()).Take(12)
                    .Select(g => new { city = g.Key, count = g.Count() }),
            });
        }).RequireAuthorization();
    }

    private static IQueryable<Event> Retention(AppDb db, RetentionRequest req)
    {
        var cutoff = DateTime.Now.AddDays(-Math.Max(1, req.OlderThanDays));
        var types = (req.Types ?? ["sentry"]).Select(t => Enum.TryParse<EventType>(t, true, out var v) ? v : (EventType?)null)
            .Where(t => t != null).Select(t => t!.Value).ToArray();
        return db.Events.Where(e => e.TrashedAt == null && !e.Favorite && !e.Collections.Any()
                                    && e.StartTime < cutoff && types.Contains(e.Type));
    }
}
