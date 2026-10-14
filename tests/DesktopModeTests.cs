using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using TeslaCam.Services;

namespace TeslaCam.Tests;

public class DesktopModeTests
{
    private const string Token = "0123456789abcdef0123456789abcdef0123456789";

    private static DesktopMode Desktop(string? token) => new(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { [DesktopMode.TokenKey] = token }).Build());

    private static async Task<bool> SignedIn(DesktopMode desktop, string? cookie)
    {
        var ctx = new DefaultHttpContext();
        if (cookie != null) ctx.Request.Headers.Cookie = $"{DesktopMode.CookieName}={cookie}";
        await desktop.Authenticate(ctx, () => Task.CompletedTask);
        return ctx.User.Identity?.IsAuthenticated == true;
    }

    [Fact]
    public async Task Only_the_window_with_the_token_is_signed_in()
    {
        var desktop = Desktop(Token);

        Assert.True(desktop.Enabled);
        Assert.True(await SignedIn(desktop, Token));
        Assert.False(await SignedIn(desktop, Token[..^1] + "x"));
        Assert.False(await SignedIn(desktop, null));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("too-short")]
    public async Task Without_a_proper_token_desktop_mode_is_off(string? token)
    {
        var desktop = Desktop(token);

        Assert.False(desktop.Enabled);
        Assert.False(await SignedIn(desktop, token));
    }
}
