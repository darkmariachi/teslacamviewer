using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using TeslaCam.Services;

namespace TeslaCam.Api;

public static class AuthApi
{
    public record PasswordRequest(string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

    public static void MapAuthApi(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapGet("/status", async (HttpContext ctx, AuthService auth, DesktopMode desktop, AppPaths paths) => Results.Ok(new
        {
            // The desktop app has no password; its window is signed in by a cookie.
            setupRequired = !desktop.Enabled && !await auth.IsConfiguredAsync(),
            authenticated = ctx.User.Identity?.IsAuthenticated == true,
            desktop = desktop.Enabled,
            libraryFolder = desktop.Enabled && ctx.User.Identity?.IsAuthenticated == true ? paths.Root : null,
            // False when the clip folder is missing: an unplugged drive, an unmounted share, a deleted folder.
            libraryAvailable = Directory.Exists(paths.Root),
        }));

        // First run only: choose the password.
        group.MapPost("/setup", async (PasswordRequest req, HttpContext ctx, AuthService auth, DesktopMode desktop) =>
        {
            if (desktop.Enabled) return Results.NotFound();
            if (await auth.IsConfiguredAsync()) return Results.Conflict(new { error = "A password is already set." });
            // Until a password exists the app is open, so only someone on the local network may claim it.
            if (!IsLocal(ctx.Connection.RemoteIpAddress) && ctx.RequestServices.GetRequiredService<IConfiguration>()["TESLACAM_ALLOW_REMOTE_SETUP"] != "true")
                return Results.Json(new { error = "First-time setup is only possible from the local network." }, statusCode: 403);
            if (Validate(req.Password) is { } problem) return Results.BadRequest(new { error = problem });
            await auth.SetPasswordAsync(req.Password);
            await SignInAsync(ctx);
            return Results.Ok();
        });

        group.MapPost("/login", async (PasswordRequest req, HttpContext ctx, AuthService auth, DesktopMode desktop) =>
        {
            if (desktop.Enabled) return Results.NotFound();
            var client = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var locked = auth.LockedForSeconds(client);
            if (locked > 0)
                return Results.Json(new { error = $"Too many attempts. Try again in {locked} seconds." }, statusCode: 429);
            if (!await auth.VerifyAsync(req.Password ?? ""))
            {
                auth.RecordFailure(client);
                return Results.Json(new { error = "Wrong password." }, statusCode: 401);
            }
            auth.RecordSuccess(client);
            await SignInAsync(ctx);
            return Results.Ok();
        });

        group.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok();
        });

        group.MapPost("/password", async (ChangePasswordRequest req, AuthService auth) =>
        {
            if (!await auth.VerifyAsync(req.CurrentPassword ?? ""))
                return Results.BadRequest(new { error = "The current password is wrong." });
            if (Validate(req.NewPassword) is { } problem) return Results.BadRequest(new { error = problem });
            await auth.SetPasswordAsync(req.NewPassword);
            return Results.Ok();
        }).RequireAuthorization();
    }

    private static bool IsLocal(System.Net.IPAddress? address)
    {
        if (address == null) return false;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (System.Net.IPAddress.IsLoopback(address)) return true;
        if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return address.IsIPv6LinkLocal || address.IsIPv6UniqueLocal;
        var b = address.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
    }

    private static string? Validate(string? password) =>
        string.IsNullOrEmpty(password) || password.Length < AuthService.MinPasswordLength
            ? $"Use at least {AuthService.MinPasswordLength} characters."
            : null;

    private static Task SignInAsync(HttpContext ctx)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, "owner")], CookieAuthenticationDefaults.AuthenticationScheme);
        return ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
    }
}
