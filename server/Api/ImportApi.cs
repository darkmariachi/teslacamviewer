using Microsoft.AspNetCore.Http.Features;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class ImportApi
{
    public record CheckRequest(ImportFile[] Files);
    public record FolderRequest(string Folder, bool DeleteAfter);

    public static void MapImportApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/import").RequireAuthorization();

        // Which of the files the browser is about to send the library still needs.
        group.MapPost("/check", (CheckRequest req, ImportService import) =>
        {
            var plan = import.Check(req.Files ?? []);
            return Results.Ok(new { missing = plan.Missing, missingBytes = plan.MissingBytes, plan.AlreadyThere, plan.Ignored });
        });

        // One file per request: a dropped connection costs one file, and the browser can show real progress.
        group.MapPut("/file", (HttpContext ctx, string path, long? size, long? modified, ImportService import) => Guard(async () =>
        {
            // Clips are larger than the server's default request limit.
            if (ctx.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = null;
            var when = modified is { } ms ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : (DateTimeOffset?)null;
            await import.SaveAsync(path, ctx.Request.Body, size, when, ctx.RequestAborted);
        }));

        // The browser is done sending; look at the new folders now rather than at the next scheduled scan.
        group.MapPost("/finish", (Scanner scanner) =>
        {
            scanner.RequestScan();
            return Results.Ok();
        });

        group.MapGet("/status", (ImportService import) => Results.Ok(import.State));

        group.MapPost("/cancel", (ImportService import) =>
        {
            import.Cancel();
            return Results.Ok();
        });

        // Reading folders on this computer only makes sense when the server runs on it: the desktop app.
        group.MapGet("/drives", (ImportService import, DesktopMode desktop) =>
            desktop.Enabled ? Results.Ok(import.Drives()) : Results.NotFound());

        group.MapPost("/plan", (FolderRequest req, ImportService import, DesktopMode desktop) =>
        {
            if (!desktop.Enabled) return Task.FromResult(Results.NotFound());
            return Guard(() =>
            {
                var plan = import.PlanFolder(req.Folder);
                return Task.FromResult<object>(new { files = plan.Missing.Count, bytes = plan.MissingBytes, plan.AlreadyThere });
            });
        });

        group.MapPost("/folder", (FolderRequest req, ImportService import, DesktopMode desktop) =>
        {
            if (!desktop.Enabled) return Task.FromResult(Results.NotFound());
            return Guard(() =>
            {
                import.StartFolderImport(req.Folder, req.DeleteAfter);
                return Task.CompletedTask;
            });
        });
    }

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
            return Results.Json(new { error = $"The library folder could not be written: {ex.Message}" }, statusCode: 409);
        }
    }

    private static async Task<IResult> Guard<T>(Func<Task<T>> action)
    {
        try
        {
            return Results.Ok(await action());
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Results.Json(new { error = $"That folder could not be read: {ex.Message}" }, statusCode: 409);
        }
    }
}
