using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class EventsApi
{
    public record PatchEvent(bool? Favorite, string? Notes);
    public record ProcessRequest(string Kind);
    public record ExportRequest(string Camera, double Start, double End);
    public record BulkRequest(int[] Ids, string Action, int? CollectionId);

    public static void MapEventsApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/events").RequireAuthorization();

        group.MapGet("", async (AppDb db, string? type, bool? favorite, int? collection, string? reason, string? city,
            DateOnly? from, DateOnly? to, string? q, bool? located, string? sort, int? page, int? pageSize) =>
        {
            var query = Filter(db, type, favorite, collection, reason, city, from, to, q, located);
            query = sort switch
            {
                "oldest" => query.OrderBy(e => e.StartTime),
                "longest" => query.OrderByDescending(e => e.DurationSec).ThenByDescending(e => e.StartTime),
                "largest" => query.OrderByDescending(e => e.SizeBytes).ThenByDescending(e => e.StartTime),
                _ => query.OrderByDescending(e => e.StartTime),
            };
            var size = Math.Clamp(pageSize ?? 48, 1, 200);
            var number = Math.Max(1, page ?? 1);
            var total = await query.CountAsync();
            var items = await query.Skip((number - 1) * size).Take(size).ToListAsync();
            return Results.Ok(new { items = items.Select(Dto.Summary), total, page = number, pageSize = size });
        });

        // Everything needed to build the filter controls.
        group.MapGet("/facets", async (AppDb db) =>
        {
            var live = db.Events.AsNoTracking().Where(e => e.TrashedAt == null);
            var types = await live.GroupBy(e => e.Type).Select(g => new { type = g.Key, count = g.Count() }).ToListAsync();
            var reasons = await live.Where(e => e.Reason != null).GroupBy(e => e.Reason!)
                .Select(g => new { value = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToListAsync();
            var cities = await live.Where(e => e.City != null).GroupBy(e => e.City!)
                .Select(g => new { value = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToListAsync();
            return Results.Ok(new
            {
                total = await live.CountAsync(),
                favorites = await live.CountAsync(e => e.Favorite),
                types = types.ToDictionary(t => t.type.ToString().ToLowerInvariant(), t => t.count),
                reasons,
                cities,
                firstDay = await live.MinAsync(e => (DateTime?)e.StartTime),
                lastDay = await live.MaxAsync(e => (DateTime?)e.StartTime),
            });
        });

        // Lightweight list for the map.
        group.MapGet("/map", async (AppDb db, string? type, bool? favorite, int? collection, string? reason, string? city,
            DateOnly? from, DateOnly? to, string? q) =>
        {
            var points = await Filter(db, type, favorite, collection, reason, city, from, to, q, true)
                .OrderByDescending(e => e.StartTime)
                .Select(e => new { e.Id, e.Lat, e.Lon, e.StartTime, e.Type, e.Reason, e.City, e.HasThumb, e.Favorite })
                .ToListAsync();
            return Results.Ok(points.Select(p => new
            {
                p.Id, p.Lat, p.Lon, p.StartTime, type = p.Type.ToString().ToLowerInvariant(), p.Reason, p.City, p.HasThumb, p.Favorite,
            }));
        });

        group.MapGet("/{id:int}", async (int id, AppDb db, JobQueue queue, SettingsService settings) =>
        {
            var ev = await db.Events.AsNoTracking()
                .Include(e => e.Segments.OrderBy(s => s.Index)).ThenInclude(s => s.Files)
                .Include(e => e.Collections).ThenInclude(c => c.Collection)
                .AsSplitQuery()
                .FirstOrDefaultAsync(e => e.Id == id);
            if (ev == null) return Results.NotFound();

            var jobs = await db.Jobs.AsNoTracking().Where(j => j.EventId == id && j.Kind != JobKind.Export)
                .OrderByDescending(j => j.Id).ToListAsync();
            var exports = await db.Jobs.AsNoTracking().Where(j => j.EventId == id && j.Kind == JobKind.Export)
                .OrderByDescending(j => j.Id).Take(20).ToListAsync();
            var newer = await db.Events.Where(e => e.TrashedAt == null && e.StartTime > ev.StartTime)
                .OrderBy(e => e.StartTime).Select(e => (int?)e.Id).FirstOrDefaultAsync();
            var older = await db.Events.Where(e => e.TrashedAt == null && e.StartTime < ev.StartTime)
                .OrderByDescending(e => e.StartTime).Select(e => (int?)e.Id).FirstOrDefaultAsync();
            var trimSettings = settings.Current;
            var outside = Timeline.OutsideTrigger(ev, trimSettings.TrimBeforeSec, trimSettings.TrimAfterSec);

            return Results.Ok(new
            {
                summary = Dto.Summary(ev),
                ev.Notes,
                ev.TriggerCamera,
                triggerOffsetSec = ev.TriggerTime is { } t ? Timeline.OffsetOf(ev, t) : (double?)null,
                ev.Probed,
                preview = ev.HasPreview
                    ? new { url = $"/api/media/preview/{ev.Id}", layout = ev.PreviewLayout, durationSec = ev.PreviewDurationSec, sizeBytes = ev.PreviewSizeBytes }
                    : null,
                // What trimming to the trigger would remove; null when there is nothing to trim.
                trim = outside.Count > 0
                    ? new
                    {
                        segments = outside.Count,
                        bytes = outside.Sum(x => x.Files.Sum(f => f.SizeBytes)),
                        beforeSec = trimSettings.TrimBeforeSec,
                        afterSec = trimSettings.TrimAfterSec,
                    }
                    : null,
                segments = ev.Segments.Select(s => new
                {
                    s.Id,
                    s.Index,
                    s.StartTime,
                    s.DurationSec,
                    files = s.Files.OrderBy(f => Cameras.Order(f.Camera)).Select(f => new
                    {
                        f.Id,
                        f.Camera,
                        url = $"/api/media/clip/{f.Id}",
                        f.Codec,
                        f.Width,
                        f.Height,
                        f.DurationSec,
                        f.SizeBytes,
                        playable = f.Codec is null or "h264" || f.Transcoded,
                    }),
                }),
                collections = ev.Collections.Select(c => new { c.Collection.Id, c.Collection.Name }),
                // The most recent job of each kind tells the page what is running or failed.
                jobs = jobs.GroupBy(j => j.Kind).Select(g => Dto.JobDto(g.First(), queue)),
                exports = exports.Select(j => Dto.JobDto(j, queue)),
                newerId = newer,
                olderId = older,
            });
        });

        group.MapPatch("/{id:int}", async (int id, PatchEvent patch, AppDb db) =>
        {
            var ev = await db.Events.FirstOrDefaultAsync(e => e.Id == id);
            if (ev == null) return Results.NotFound();
            if (patch.Favorite is { } favorite) ev.Favorite = favorite;
            if (patch.Notes != null) ev.Notes = patch.Notes.Trim() is { Length: > 0 } n ? n[..Math.Min(n.Length, 4000)] : null;
            await db.SaveChangesAsync();
            return Results.Ok(Dto.Summary(ev));
        });

        group.MapDelete("/{id:int}", (int id, TrashService trash) => Guard(() => trash.TrashAsync(id)));

        group.MapPost("/{id:int}/restore", (int id, TrashService trash) => Guard(() => trash.RestoreAsync(id)));

        group.MapDelete("/{id:int}/segments/{segmentId:int}", (int id, int segmentId, TrashService trash) =>
            Guard(() => trash.TrashSegmentAsync(id, segmentId)));

        group.MapPost("/{id:int}/trim", (int id, TrashService trash) => Guard(() => trash.TrimAsync(id)));

        // Ask for a merged preview, a compatibility transcode, or fresh metadata right now.
        group.MapPost("/{id:int}/process", async (int id, ProcessRequest req, JobQueue queue, AppDb db) =>
        {
            if (!Enum.TryParse<JobKind>(req.Kind, true, out var kind) || kind == JobKind.Export)
                return Results.BadRequest(new { error = "Unknown job kind." });
            if (!await db.Events.AnyAsync(e => e.Id == id)) return Results.NotFound();
            var job = await queue.RequestAsync(id, kind);
            return Results.Ok(Dto.JobDto(job, queue));
        });

        group.MapPost("/{id:int}/export", async (int id, ExportRequest req, JobQueue queue, AppDb db) =>
        {
            var ev = await db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id);
            if (ev == null) return Results.NotFound();
            if (req.Camera != "grid" && !Cameras.Parse(ev.Cameras).Contains(req.Camera))
                return Results.BadRequest(new { error = "Unknown camera." });
            if (req.End - req.Start < 1) return Results.BadRequest(new { error = "Pick a range of at least one second." });
            var args = JsonSerializer.Serialize(new ExportArgs(req.Camera, req.Start, req.End), JsonSerializerOptions.Web);
            var job = await queue.RequestAsync(id, JobKind.Export, args);
            return Results.Ok(Dto.JobDto(job, queue));
        });

        // One action applied to many events from the list's selection mode.
        group.MapPost("/bulk", async (BulkRequest req, AppDb db, TrashService trash, JobQueue queue) =>
        {
            var ids = (req.Ids ?? []).Distinct().Take(500).ToArray();
            switch (req.Action)
            {
                case "favorite":
                case "unfavorite":
                    var value = req.Action == "favorite";
                    await db.Events.Where(e => ids.Contains(e.Id)).ExecuteUpdateAsync(s => s.SetProperty(e => e.Favorite, value));
                    break;
                case "collect" when req.CollectionId is { } collectionId:
                    var present = await db.CollectionEvents.Where(c => c.CollectionId == collectionId && ids.Contains(c.EventId))
                        .Select(c => c.EventId).ToListAsync();
                    foreach (var id in ids.Except(present))
                        db.CollectionEvents.Add(new CollectionEvent { CollectionId = collectionId, EventId = id, AddedAt = DateTime.UtcNow });
                    await db.SaveChangesAsync();
                    break;
                case "preview":
                    foreach (var id in ids) await queue.RequestAsync(id, JobKind.Preview);
                    break;
                case "trim":
                    return await Guard(async () =>
                    {
                        foreach (var id in ids) await trash.TrimAsync(id);
                    });
                case "trash":
                    return await Guard(async () =>
                    {
                        foreach (var id in ids) await trash.TrashAsync(id);
                    });
                default:
                    return Results.BadRequest(new { error = "Unknown action." });
            }
            return Results.Ok();
        });
    }

    private static IQueryable<Event> Filter(AppDb db, string? type, bool? favorite, int? collection, string? reason, string? city,
        DateOnly? from, DateOnly? to, string? q, bool? located)
    {
        var query = db.Events.AsNoTracking().Where(e => e.TrashedAt == null);
        if (Enum.TryParse<EventType>(type, true, out var eventType)) query = query.Where(e => e.Type == eventType);
        if (favorite == true) query = query.Where(e => e.Favorite);
        if (collection is { } c) query = query.Where(e => e.Collections.Any(x => x.CollectionId == c));
        if (!string.IsNullOrEmpty(reason)) query = query.Where(e => e.Reason == reason);
        if (!string.IsNullOrEmpty(city)) query = query.Where(e => e.City == city);
        if (from is { } f) query = query.Where(e => e.StartTime >= f.ToDateTime(TimeOnly.MinValue));
        if (to is { } t) query = query.Where(e => e.StartTime < t.AddDays(1).ToDateTime(TimeOnly.MinValue));
        if (located == true) query = query.Where(e => e.Lat != null && e.Lon != null);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q.Trim().Replace(' ', '_')}%";
            query = query.Where(e => EF.Functions.Like(e.Name, like) || EF.Functions.Like(e.City!, like)
                                     || EF.Functions.Like(e.Reason!, like) || EF.Functions.Like(e.Notes!, like));
        }
        return query;
    }

    /// <summary>File operations fail when the clip share is read-only or a folder is in use; report that plainly.</summary>
    private static async Task<IResult> Guard(Func<Task> action)
    {
        try
        {
            await action();
            return Results.Ok();
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Results.Json(new { error = $"The clip folder could not be changed: {ex.Message}" }, statusCode: 409);
        }
    }
}
