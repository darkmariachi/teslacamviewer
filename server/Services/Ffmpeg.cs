using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace TeslaCam.Services;

public record ProbeResult(string Codec, int Width, int Height, double DurationSec);

public class FfmpegException(string message) : Exception(message);

/// <summary>Thin wrapper around the ffmpeg/ffprobe binaries.</summary>
public class Ffmpeg(SettingsService settings, ILogger<Ffmpeg> log)
{
    private const string VaapiDevice = "/dev/dri/renderD128";
    private string? _detectedEncoder;
    // Newer Intel chips only expose the low-power H.264 encoder.
    private bool _vaapiLowPower;
    private string? _version;

    public string? Version => _version;

    /// <summary>The encoder in use after resolving "auto": software or vaapi.</summary>
    public async Task<string> ResolveEncoderAsync(CancellationToken ct = default)
    {
        var wanted = settings.Current.Encoder;
        if (wanted == "software") return "software";
        _detectedEncoder ??= await DetectAsync(ct);
        return wanted == "vaapi" && _detectedEncoder != "vaapi" ? "software" : _detectedEncoder;
    }

    public bool? HardwareAvailable => _detectedEncoder == null ? null : _detectedEncoder == "vaapi";

    private async Task<string> DetectAsync(CancellationToken ct)
    {
        try
        {
            var (code, stdout, _) = await Exec("ffmpeg", ["-hide_banner", "-version"], ct);
            if (code == 0) _version = stdout.Split('\n')[0].Replace("ffmpeg version ", "").Split(' ')[0];
        }
        catch (Exception ex)
        {
            log.LogError(ex, "ffmpeg is not available");
            return "software";
        }
        if (!File.Exists(VaapiDevice)) return "software";
        foreach (var lowPower in new[] { false, true })
        {
            try
            {
                string[] extra = lowPower ? ["-low_power", "1"] : [];
                var (code, _, stderr) = await Exec("ffmpeg",
                [
                    "-hide_banner", "-v", "error", "-vaapi_device", VaapiDevice,
                    "-f", "lavfi", "-i", "testsrc=size=640x480:rate=24", "-t", "0.5",
                    "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", .. extra, "-f", "null", "-",
                ], ct);
                if (code == 0)
                {
                    _vaapiLowPower = lowPower;
                    log.LogInformation("Hardware encoding (VAAPI{Mode}) is available", lowPower ? ", low power" : "");
                    return "vaapi";
                }
                log.LogInformation("VAAPI test encode failed{Mode}: {Err}", lowPower ? " (low power)" : "", Tail(stderr, 300));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogInformation("VAAPI probe failed: {Msg}", ex.Message);
            }
        }
        return "software";
    }

    /// <summary>Arguments placed before the inputs.</summary>
    public static string[] GlobalArgs(string encoder) =>
        encoder == "vaapi" ? ["-vaapi_device", VaapiDevice] : [];

    /// <summary>Appended to the final video filter so frames reach the encoder in the right format.</summary>
    public static string FilterTail(string encoder) =>
        encoder == "vaapi" ? "format=nv12,hwupload" : "format=yuv420p";

    public string[] EncodeArgs(string encoder, int quality, int fps)
    {
        var gop = (fps * 2).ToString();
        string[] args = encoder == "vaapi"
            ? ["-c:v", "h264_vaapi", .. (string[])(_vaapiLowPower ? ["-low_power", "1"] : []), "-qp", quality.ToString(), "-g", gop]
            : ["-c:v", "libx264", "-preset", "veryfast", "-crf", quality.ToString(), "-g", gop];
        var threads = settings.Current.FfmpegThreads;
        return threads > 0 ? [.. args, "-threads", threads.ToString()] : args;
    }

    public async Task<ProbeResult?> ProbeAsync(string file, CancellationToken ct)
    {
        var (code, stdout, _) = await Exec("ffprobe",
        [
            "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height:format=duration",
            "-of", "json", file,
        ], ct);
        if (code != 0) return null;
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var root = doc.RootElement;
            if (!root.TryGetProperty("streams", out var streams) || streams.GetArrayLength() == 0) return null;
            var s = streams[0];
            var duration = 0d;
            if (root.TryGetProperty("format", out var fmt) && fmt.TryGetProperty("duration", out var d))
                double.TryParse(d.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out duration);
            return new ProbeResult(
                s.TryGetProperty("codec_name", out var c) ? c.GetString() ?? "" : "",
                s.TryGetProperty("width", out var w) ? w.GetInt32() : 0,
                s.TryGetProperty("height", out var h) ? h.GetInt32() : 0,
                duration);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Runs ffmpeg at low CPU priority. <paramref name="onProgress"/> receives seconds of output written.
    /// </summary>
    public async Task RunAsync(IEnumerable<string> args, Action<double>? onProgress, CancellationToken ct)
    {
        string[] full = ["-hide_banner", "-nostdin", "-y", "-v", "error", "-progress", "pipe:1", "-nostats", .. args];
        var psi = OperatingSystem.IsWindows()
            ? new ProcessStartInfo("ffmpeg")
            : new ProcessStartInfo("nice") { ArgumentList = { "-n", "15", "ffmpeg" } };
        foreach (var a in full) psi.ArgumentList.Add(a);
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;

        using var proc = Process.Start(psi) ?? throw new FfmpegException("Could not start ffmpeg");
        var stderr = new StringBuilder();
        var errTask = Task.Run(async () =>
        {
            while (await proc.StandardError.ReadLineAsync(CancellationToken.None) is { } line)
                if (stderr.Length < 8000) stderr.AppendLine(line);
        }, CancellationToken.None);
        var outTask = Task.Run(async () =>
        {
            while (await proc.StandardOutput.ReadLineAsync(CancellationToken.None) is { } line)
            {
                if (onProgress == null || !line.StartsWith("out_time_us=")) continue;
                if (long.TryParse(line.AsSpan(12), out var us) && us >= 0) onProgress(us / 1_000_000d);
            }
        }, CancellationToken.None);

        try
        {
            await proc.WaitForExitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
        await Task.WhenAll(errTask, outTask);
        if (proc.ExitCode != 0)
            throw new FfmpegException($"ffmpeg exited with code {proc.ExitCode}: {Tail(stderr.ToString(), 1200)}");
    }

    private static async Task<(int Code, string Stdout, string Stderr)> Exec(string file, string[] args, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(file)
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var proc = Process.Start(psi) ?? throw new FfmpegException($"Could not start {file}");
        var stdout = proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = proc.StandardError.ReadToEndAsync(ct);
        try
        {
            await proc.WaitForExitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
        return (proc.ExitCode, await stdout, await stderr);
    }

    private static string Tail(string s, int max)
    {
        s = s.Trim();
        return s.Length <= max ? s : "…" + s[^max..];
    }
}
