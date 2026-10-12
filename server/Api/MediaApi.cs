using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class MediaApi
{
    public static void MapMediaApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/media").RequireAuthorization();

        // One camera's clip. Served as video with range support so browsers can seek without downloading it all.
        group.MapGet("/clip/{fileId:int}", async (int fileId, bool? download, AppDb db, AppPaths paths) =>
        {
            var file = await db.ClipFiles.AsNoTracking().Include(f => f.Segment).ThenInclude(s => s.Event)
                .FirstOrDefaultAsync(f => f.Id == fileId);
            if (file == null) return Results.NotFound();
            var ev = file.Segment.Event;
            var original = paths.ClipPath(ev, file);
            var transcoded = paths.Transcoded(ev.Id, file.Id);
            var path = download != true && file.Transcoded && File.Exists(transcoded) ? transcoded : original;
            if (!File.Exists(path)) return Results.NotFound();
            return Results.File(path, "video/mp4", download == true ? file.FileName : null, enableRangeProcessing: true,
                lastModified: File.GetLastWriteTimeUtc(path));
        });

        group.MapGet("/thumb/{eventId:int}", (int eventId, AppPaths paths, HttpContext ctx) =>
        {
            var path = paths.Thumb(eventId);
            if (!File.Exists(path)) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "private, max-age=86400";
            return Results.File(path, "image/jpeg", lastModified: File.GetLastWriteTimeUtc(path));
        });

        group.MapGet("/preview/{eventId:int}", async (int eventId, bool? download, AppDb db, AppPaths paths) =>
        {
            var path = paths.Preview(eventId);
            if (!File.Exists(path)) return Results.NotFound();
            var name = download == true
                ? await db.Events.Where(e => e.Id == eventId).Select(e => e.Name).FirstOrDefaultAsync() + "_grid.mp4"
                : null;
            return Results.File(path, "video/mp4", name, enableRangeProcessing: true, lastModified: File.GetLastWriteTimeUtc(path));
        });

        group.MapGet("/export/{jobId:int}", async (int jobId, AppDb db, AppPaths paths) =>
        {
            var job = await db.Jobs.AsNoTracking().Include(j => j.Event)
                .FirstOrDefaultAsync(j => j.Id == jobId && j.Kind == JobKind.Export && j.Status == JobStatus.Done);
            var path = paths.Export(jobId);
            if (job == null || !File.Exists(path)) return Results.NotFound();
            return Results.File(path, "video/mp4", $"{job.Event.Name}_export_{jobId}.mp4", enableRangeProcessing: true);
        });
    }
}
