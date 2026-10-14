using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Api;

public static class CollectionsApi
{
    public record CollectionRequest(string Name, string? Description);

    public static void MapCollectionsApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/collections").RequireAuthorization();

        group.MapGet("", async (AppDb db) =>
        {
            var rows = await db.Collections.AsNoTracking().OrderBy(c => c.Name).Select(c => new
            {
                c.Id,
                c.Name,
                c.Description,
                c.CreatedAt,
                count = c.Events.Count(e => e.Event.TrashedAt == null),
                // Up to four recent events with thumbnails make the cover.
                covers = c.Events.Where(e => e.Event.TrashedAt == null && e.Event.HasThumb)
                    .OrderByDescending(e => e.Event.StartTime).Select(e => e.EventId).Take(4).ToList(),
            }).ToListAsync();
            return Results.Ok(rows.Select(c => new { c.Id, c.Name, c.Description, createdAt = Dto.Utc(c.CreatedAt), c.count, c.covers }));
        });

        group.MapPost("", async (CollectionRequest req, AppDb db) =>
        {
            var name = req.Name?.Trim();
            if (string.IsNullOrEmpty(name)) return Results.BadRequest(new { error = "Give the collection a name." });
            if (await db.Collections.AnyAsync(c => c.Name == name)) return Results.Conflict(new { error = "A collection with that name exists." });
            var collection = new Collection { Name = name, Description = req.Description?.Trim(), CreatedAt = DateTime.UtcNow };
            db.Collections.Add(collection);
            await db.SaveChangesAsync();
            return Results.Ok(new { collection.Id, collection.Name, collection.Description });
        });

        group.MapPut("/{id:int}", async (int id, CollectionRequest req, AppDb db) =>
        {
            var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == id);
            if (collection == null) return Results.NotFound();
            var name = req.Name?.Trim();
            if (string.IsNullOrEmpty(name)) return Results.BadRequest(new { error = "Give the collection a name." });
            if (await db.Collections.AnyAsync(c => c.Name == name && c.Id != id)) return Results.Conflict(new { error = "A collection with that name exists." });
            collection.Name = name;
            collection.Description = req.Description?.Trim();
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        group.MapDelete("/{id:int}", async (int id, AppDb db) =>
        {
            await db.Collections.Where(c => c.Id == id).ExecuteDeleteAsync();
            return Results.Ok();
        });

        group.MapPut("/{id:int}/events/{eventId:int}", async (int id, int eventId, AppDb db) =>
        {
            if (!await db.Collections.AnyAsync(c => c.Id == id) || !await db.Events.AnyAsync(e => e.Id == eventId)) return Results.NotFound();
            if (!await db.CollectionEvents.AnyAsync(c => c.CollectionId == id && c.EventId == eventId))
            {
                db.CollectionEvents.Add(new CollectionEvent { CollectionId = id, EventId = eventId, AddedAt = DateTime.UtcNow });
                await db.SaveChangesAsync();
            }
            return Results.Ok();
        });

        group.MapDelete("/{id:int}/events/{eventId:int}", async (int id, int eventId, AppDb db) =>
        {
            await db.CollectionEvents.Where(c => c.CollectionId == id && c.EventId == eventId).ExecuteDeleteAsync();
            return Results.Ok();
        });
    }
}
