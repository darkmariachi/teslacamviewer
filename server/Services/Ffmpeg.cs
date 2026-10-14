using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace TeslaCam.Services;

public record ProbeResult(string Codec, int Width, int Height, double DurationSec);

public class FfmpegException(string message) : Exception(message);

/// <summary>Thin wrapper around the ffmpeg/ffprobe binaries.</summary>
public class Ffmpeg(SettingsService settings, IConfiguration config, ILogger<Ffmpeg> log)
{
    private const string VaapiDevice = "/dev/dri/renderD128";

    /// <summary>Values the encoder setting accepts.</summary>
    public static readonly string[] KnownEncoders = ["auto", "software", "vaapi", "qsv", "nvenc", "amf", "videotoolbox"];

    private readonly SemaphoreSlim _detectLock = new(1);
    private List<string>? _available;
    // Newer Intel chips only expose the low-power H.264 encoder through VAAPI.
    private bool _vaapiLowPower;
    private string? _version;

    public string? Version => _version;

    /// <summary>
    /// ffmpeg and ffprobe come from TESLACAM_FFMPEG (a folder, used by the desktop app's bundled copy)
    /// or from the PATH.
    /// </summary>
    private string Tool(string name)
    {
        var dir = config["TESLACAM_FFMPEG"];
        if (string.IsNullOrEmpty(dir)) return name;
        return Path.Combine(dir, OperatingSystem.IsWindows() ? name + ".exe" : name);
    }

    /// <summary>The encoder in use after resolving "auto": software or one of the hardware encoders.</summary>
    public async Task<string> ResolveEncoderAsync(CancellationToken ct = default)
    {
        var wanted = settings.Current.Encoder;
        if (wanted == "software") return "software";
        var available = await DetectAsync(ct);
        if (wanted == "auto") return available.FirstOrDefault() ?? "software";
        return available.Contains(wanted) ? wanted : "software";
    }

    /// <summary>Null until detection has run.</summary>
    public bool? HardwareAvailable => _available == null ? null : _available.Count > 0;

    public IReadOnlyList<string> AvailableEncoders => _available ?? [];

    /// <summary>The hardware encoders worth trying on this system, best first.</summary>
    private static string[] Candidates() =>
        OperatingSystem.IsMacOS() ? ["videotoolbox"]
        : OperatingSystem.IsWindows() ? ["nvenc", "qsv", "amf"]
        : ["vaapi", "nvenc", "qsv"];

    /// <summary>Encodes half a second of test pattern with each candidate; the ones that work are available.</summary>
    private async Task<List<string>> DetectAsync(CancellationToken ct)
    {
        if (_available != null) return _available;
        await _detectLock.WaitAsync(ct);
        try
        {
            if (_available != null) return _available;
            try
            {
                var (code, stdout, _) = await Exec(Tool("ffmpeg"), ["-hide_banner", "-version"], ct);
                if (code == 0) _version = stdout.Split('\n')[0].Replace("ffmpeg version ", "").Split(' ')[0];
            }
            catch (Exception ex)
            {
                log.LogError(ex, "ffmpeg is not available");
                return _available = [];
            }
            var found = new List<string>();
            foreach (var encoder in Candidates())
            {
                if (encoder == "vaapi" && !File.Exists(VaapiDevice)) continue;
                var variants = encoder == "vaapi" ? new[] { false, true } : [false];
                foreach (var lowPower in variants)
                {
                    try
                    {
                        _vaapiLowPower = lowPower;
                        var (code, _, stderr) = await Exec(Tool("ffmpeg"),
                        [
                            "-hide_banner", "-v", "error", .. GlobalArgs(encoder),
                            "-f", "lavfi", "-i", "testsrc=size=640x480:rate=24", "-t", "0.5",
                            "-vf", FilterTail(encoder), .. EncodeArgs(encoder, 27, 24), "-f", "null", "-",
                        ], ct);
                        if (code == 0)
                        {
                            found.Add(encoder);
                            log.LogInformation("Hardware encoding ({Encoder}{Mode}) is available", encoder, lowPower ? ", low power" : "");
                            break;
                        }
                        log.LogInformation("{Encoder} test encode failed: {Err}", encoder, Tail(stderr, 300));
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        log.LogInformation("{Encoder} probe failed: {Msg}", encoder, ex.Message);
                    }
                }
            }
            return _available = found;
        }
        finally
        {
            _detectLock.Release();
        }
    }

    /// <summary>Arguments placed before the inputs.</summary>
    public static string[] GlobalArgs(string encoder) =>
        encoder == "vaapi" ? ["-vaapi_device", VaapiDevice] : [];

    /// <summary>Appended to the final video filter so frames reach the encoder in the right format.</summary>
    public static string FilterTail(string encoder) => encoder switch
    {
        "vaapi" => "format=nv12,hwupload",
        "qsv" or "amf" => "format=nv12",
        _ => "format=yuv420p",
    };

    /// <summary>
    /// Encoder arguments. <paramref name="quality"/> is on the x264 CRF scale (18 to 36, lower is better);
    /// each hardware encoder gets its nearest equivalent.
    /// </summary>
    public string[] EncodeArgs(string encoder, int quality, int fps)
    {
        var gop = (fps * 2).ToString();
        var q = quality.ToString();
        string[] args = encoder switch
        {
            "vaapi" => ["-c:v", "h264_vaapi", .. (string[])(_vaapiLowPower ? ["-low_power", "1"] : []), "-qp", q, "-g", gop],
            "nvenc" => ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", q, "-b:v", "0", "-g", gop],
            "qsv" => ["-c:v", "h264_qsv", "-global_quality", q, "-g", gop],
            "amf" => ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", q, "-qp_p", q, "-g", gop],
            // VideoToolbox's quality runs the other way, from 1 to 100.
            "videotoolbox" => ["-c:v", "h264_videotoolbox", "-q:v", Math.Clamp(100 - (quality - 18) * 3, 30, 95).ToString(), "-g", gop],
            _ => ["-c:v", "libx264", "-preset", "veryfast", "-crf", q, "-g", gop],
        };
        var threads = settings.Current.FfmpegThreads;
        return threads > 0 && encoder == "software" ? [.. args, "-threads", threads.ToString()] : args;
    }

    public async Task<ProbeResult?> ProbeAsync(string file, CancellationToken ct)
    {
        var (code, stdout, _) = await Exec(Tool("ffprobe"),
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
        var ffmpeg = Tool("ffmpeg");
        var psi = OperatingSystem.IsWindows()
            ? new ProcessStartInfo(ffmpeg)
            : new ProcessStartInfo("nice") { ArgumentList = { "-n", "15", ffmpeg } };
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
