using System.Net;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Api;
using TeslaCam.Data;
using TeslaCam.Services;

var builder = WebApplication.CreateBuilder(args);

var paths = new AppPaths(builder.Configuration);
builder.Services.AddSingleton(paths);
builder.Services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={paths.DbFile};Default Timeout=30",
    sqlite => sqlite.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)));
builder.Services.AddHttpClient();

builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<StorageService>();
builder.Services.AddSingleton<Ffmpeg>();
builder.Services.AddSingleton<JobQueue>();
builder.Services.AddSingleton<MediaProcessor>();
builder.Services.AddSingleton<Scanner>();
builder.Services.AddSingleton<JobRunner>();
builder.Services.AddSingleton<TrashService>();
builder.Services.AddSingleton<ArchiverService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Scanner>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<JobRunner>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<TrashService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<ArchiverService>());

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

// Login cookies must survive container restarts, so the keys live in the data folder.
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(paths.KeysDir)).SetApplicationName("teslacamviewer");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "teslacam";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Lax;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromDays(30);
    o.SlidingExpiration = true;
    // This is an API: answer with status codes instead of redirecting to a login page.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();

// Behind a reverse proxy the real client address and scheme arrive in headers. Only proxies on
// private networks (the Docker bridge, the LAN) are believed.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Parse("10.0.0.0"), 8));
    o.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Parse("172.16.0.0"), 12));
    o.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Parse("192.168.0.0"), 16));
});

var app = builder.Build();

await using (var db = await app.Services.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContextAsync())
{
    await db.Database.MigrateAsync();
    await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
}

// Optional: preset the password from the environment on first start.
if (builder.Configuration["TESLACAM_PASSWORD"] is { Length: >= AuthService.MinPasswordLength } preset)
{
    var auth = app.Services.GetRequiredService<AuthService>();
    if (!await auth.IsConfiguredAsync()) await auth.SetPasswordAsync(preset);
}

app.UseForwardedHeaders();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthApi();
app.MapEventsApi();
app.MapMediaApi();
app.MapCollectionsApi();
app.MapAdminApi();
app.MapArchiverApi();

// Unknown API paths are errors; every other path belongs to the single-page app.
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();
