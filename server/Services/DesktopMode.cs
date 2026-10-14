using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace TeslaCam.Services;

/// <summary>
/// Running inside the desktop app. The server listens only on this computer, and the app's window proves
/// who it is with a secret cookie the app sets, instead of a password.
/// </summary>
public class DesktopMode(IConfiguration config)
{
    public const string TokenKey = "TESLACAM_DESKTOP_TOKEN";
    public const string CookieName = "teslacam_desktop";

    private readonly byte[]? _token = config[TokenKey] is { Length: >= 32 } token ? Encoding.UTF8.GetBytes(token) : null;

    public bool Enabled => _token != null;

    /// <summary>Signs in requests that carry the window's cookie. Anything else stays anonymous.</summary>
    public Task Authenticate(HttpContext ctx, Func<Task> next)
    {
        if (_token != null && ctx.Request.Cookies.TryGetValue(CookieName, out var value) && value != null
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(value), _token))
        {
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "owner")], "desktop"));
        }
        return next();
    }
}
