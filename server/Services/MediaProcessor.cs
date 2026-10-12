using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

public record ExportArgs(string Camera, double Start, double End);

/// <summary>The work behind each job kind: probing, thumbnails, merged previews, transcodes and exports.</summary>
public class MediaProcessor(IDbContextFactory<AppDb> dbf, AppPaths paths, Ffmpeg ffmpeg, SettingsService settings, JobQueue queue)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static string F(double v) => v.ToString("0.###", CultureInfo.InvariantCulture);

    public Task RunAsync(Job job, Action<double> progress, CancellationToken ct) => job.Kind switch
    {
        JobKind.Probe => ProbeAsync(job.EventId, progress, ct),
        JobKind.Thumbnail => ThumbnailAsync(job.EventId, ct),
        JobKind.Preview => PreviewAsync(job.EventId, progress, ct),
        JobKind.Transcode => TranscodeAsync(job.EventId, progress, ct),
        JobKind.Export => ExportAsync(job, progress, ct),
        _ => Task.CompletedTask,
    };

    private static async Task<Event> LoadAsync(AppDb db, int eventId, CancellationToken ct) =>
        await db.Events.Include(e => e.Segments.OrderBy(s => s.Index)).ThenInclude(s => s.Files)
            .FirstAsync(e => e.Id == eventId, ct);

    public async Task ProbeAsync(int eventId, Action<double>? progress, CancellationToken ct)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await LoadAsync(db, eventId, ct);
        var files = ev.Segments.SelectMany(s => s.Files).ToList();
        var done = 0;
        // A few files at a time: each probe mostly waits on the disk.
        await Parallel.ForEachAsync(files, new ParallelOptions { MaxDegreeOfParallelism = 3, CancellationToken = ct }, async (file, token) =>
        {
            var result = await ffmpeg.ProbeAsync(paths.ClipPath(ev, file), token);
            if (result != null)
            {
                file.Codec = result.Codec;
                file.Width = result.Width;
                file.Height = result.Height;
                file.DurationSec = result.DurationSec;
            }
            progress?.Invoke(Interlocked.Increment(ref done) / (double)files.Count);
        });
        foreach (var seg in ev.Segments)
        {
            var longest = seg.Files.Max(f => f.DurationSec ?? 0);
            if (longest > 0) seg.DurationSec = longest;
        }
        ev.DurationSec = ev.Segments.Sum(s => s.DurationSec);
        if (ev.Segments.Count > 0)
        {
            var last = ev.Segments[^1];
            ev.EndTime = last.StartTime.AddSeconds(last.DurationSec);
        }
        ev.NeedsTranscode = files.Any(f => f.Codec != null && f.Codec != "h264");
        ev.Probed = true;
        await db.SaveChangesAsync(ct);

        if (ev.NeedsTranscode && settings.Current.TranscodePolicy == "auto")
            await queue.RequestAsync(eventId, JobKind.Transcode, userRequested: false);
    }

    public async Task ThumbnailAsync(int eventId, CancellationToken ct)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await LoadAsync(db, eventId, ct);
        if (ev.Segments.Count == 0) return;

        // The trigger moment is the interesting frame; without one, the middle of the event.
        var target = ev.TriggerTime is { } t ? Timeline.OffsetOf(ev, t) : ev.DurationSec / 2;
        var (segment, into) = Locate(ev, target);
        var file = PickFile(segment, ev.TriggerCamera) ?? ev.Segments.SelectMany(s => s.Files).FirstOrDefault();
        if (file == null) return;

        var output = paths.Thumb(eventId);
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        foreach (var seek in new[] { into, 0 })
        {
            File.Delete(output);
            await ffmpeg.RunAsync(
            [
                "-ss", F(Math.Max(0, seek)), "-i", paths.ClipPath(ev, file),
                "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", output,
            ], null, ct);
            if (File.Exists(output) && new FileInfo(output).Length > 0) break;
        }
        ev.HasThumb = File.Exists(output) && new FileInfo(output).Length > 0;
        await db.SaveChangesAsync(ct);
    }

    public async Task PreviewAsync(int eventId, Action<double> progress, CancellationToken ct)
    {
        await using (var check = await dbf.CreateDbContextAsync(ct))
        {
            if (!await check.Events.Where(e => e.Id == eventId).Select(e => e.Probed).FirstAsync(ct))
                await ProbeAsync(eventId, null, ct);
        }
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await LoadAsync(db, eventId, ct);
        var s = settings.Current;
        var (cells, columns) = Cameras.GridLayout(Cameras.Parse(ev.Cameras));
        var output = paths.Preview(eventId);
        var ranges = ev.Segments.Select(seg => new PartRange(seg, 0, seg.DurationSec)).ToList();

        await BuildAsync(ev, cells, columns, ranges, output, s.PreviewCellHeight, s.PreviewFps, s.PreviewQuality, progress, ct);

        var probe = await ffmpeg.ProbeAsync(output, ct);
        ev.HasPreview = true;
        ev.PreviewLayout = $"{columns}:{string.Join(',', cells)}";
        ev.PreviewDurationSec = probe?.DurationSec ?? ev.DurationSec;
        ev.PreviewSizeBytes = new FileInfo(output).Length;
        await db.SaveChangesAsync(ct);
    }

    public async Task TranscodeAsync(int eventId, Action<double> progress, CancellationToken ct)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await LoadAsync(db, eventId, ct);
        var todo = ev.Segments.SelectMany(seg => seg.Files).Where(f => f.Codec is not (null or "h264") && !f.Transcoded).ToList();
        var encoder = await ffmpeg.ResolveEncoderAsync(ct);
        Directory.CreateDirectory(paths.EventCache(eventId));
        var done = 0;
        foreach (var file in todo)
        {
            var output = paths.Transcoded(eventId, file.Id);
            var temp = output + ".tmp.mp4";
            var total = Math.Max(1, file.DurationSec ?? 60);
            var index = done;
            await ffmpeg.RunAsync(
            [
                .. Ffmpeg.GlobalArgs(encoder), "-i", paths.ClipPath(ev, file),
                "-vf", Ffmpeg.FilterTail(encoder), .. ffmpeg.EncodeArgs(encoder, 23, 30),
                "-an", "-movflags", "+faststart", temp,
            ], sec => progress((index + Math.Min(1, sec / total)) / todo.Count), ct);
            File.Move(temp, output, true);
            file.Transcoded = true;
            await db.SaveChangesAsync(ct);
            done++;
        }
    }

    public async Task ExportAsync(Job job, Action<double> progress, CancellationToken ct)
    {
        var args = JsonSerializer.Deserialize<ExportArgs>(job.ArgsJson ?? "{}", Json)
                   ?? throw new InvalidOperationException("Export arguments are missing");
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await LoadAsync(db, job.EventId, ct);
        var start = Math.Clamp(args.Start, 0, ev.DurationSec);
        var end = Math.Clamp(args.End, start, ev.DurationSec);
        if (end - start < 0.5) throw new InvalidOperationException("The selected range is too short");

        var ranges = new List<PartRange>();
        double acc = 0;
        foreach (var seg in ev.Segments)
        {
            var from = Math.Max(start, acc);
            var to = Math.Min(end, acc + seg.DurationSec);
            if (to - from > 0.05) ranges.Add(new PartRange(seg, from - acc, to - from));
            acc += seg.DurationSec;
        }

        var s = settings.Current;
        var output = paths.Export(job.Id);
        if (args.Camera == "grid")
        {
            var (cells, columns) = Cameras.GridLayout(Cameras.Parse(ev.Cameras));
            await BuildAsync(ev, cells, columns, ranges, output, 720, 30, 23, progress, ct);
        }
        else
        {
            await BuildAsync(ev, [args.Camera], 1, ranges, output, null, 30, 21, progress, ct);
        }
    }

    private record PartRange(Segment Segment, double Start, double Duration);

    /// <summary>
    /// Encodes each range as its own part (a grid of the given cells, or a single camera) and joins the parts.
    /// Working per segment keeps cameras aligned even when a file is missing or lengths differ.
    /// </summary>
    private async Task BuildAsync(Event ev, string[] cells, int columns, List<PartRange> ranges, string output,
        int? cellHeight, int fps, int quality, Action<double> progress, CancellationToken ct)
    {
        if (ranges.Count == 0) throw new InvalidOperationException("Nothing to encode");
        var encoder = await ffmpeg.ResolveEncoderAsync(ct);
        var workDir = Path.Combine(Path.GetDirectoryName(output)!, $"work_{Path.GetFileNameWithoutExtension(output)}");
        if (Directory.Exists(workDir)) Directory.Delete(workDir, true);
        Directory.CreateDirectory(workDir);
        try
        {
            var total = ranges.Sum(r => r.Duration);
            double finished = 0;
            var parts = new List<string>();
            for (var i = 0; i < ranges.Count; i++)
            {
                var range = ranges[i];
                var part = Path.Combine(workDir, $"part_{i:000}.mp4");
                var before = finished;
                var args = cells.Length == 1
                    ? SingleArgs(ev, cells[0], range, encoder, cellHeight, fps, quality, part)
                    : GridArgs(ev, cells, columns, range, encoder, cellHeight ?? 480, fps, quality, part);
                if (args == null) continue;
                await ffmpeg.RunAsync(args, sec => progress(Math.Min(0.99, (before + Math.Min(range.Duration, sec)) / total)), ct);
                finished += range.Duration;
                parts.Add(part);
            }
            if (parts.Count == 0) throw new InvalidOperationException("No clips were available for the selected range");

            var list = Path.Combine(workDir, "parts.txt");
            await File.WriteAllLinesAsync(list, parts.Select(p => $"file '{p.Replace('\\', '/').Replace("'", "'\\''")}'"), ct);
            var temp = Path.Combine(workDir, "joined.mp4");
            await ffmpeg.RunAsync(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", temp], null, ct);
            File.Move(temp, output, true);
            progress(1);
        }
        finally
        {
            try { Directory.Delete(workDir, true); } catch (IOException) { }
        }
    }

    private List<string>? SingleArgs(Event ev, string camera, PartRange range, string encoder, int? height, int fps, int quality, string output)
    {
        var file = range.Segment.Files.FirstOrDefault(f => f.Camera == camera);
        if (file == null) return null;
        var scale = height is { } h ? $"scale=-2:{h}," : "";
        return
        [
            .. Ffmpeg.GlobalArgs(encoder),
            "-ss", F(range.Start), "-t", F(range.Duration), "-i", paths.ClipPath(ev, file),
            "-vf", $"fps={fps},{scale}setsar=1,{Ffmpeg.FilterTail(encoder)}",
            .. ffmpeg.EncodeArgs(encoder, quality, fps), "-an", output,
        ];
    }

    private List<string> GridArgs(Event ev, string[] cells, int columns, PartRange range, string encoder, int cellHeight, int fps, int quality, string output)
    {
        var cellWidth = cellHeight * 4 / 3;
        var args = new List<string>(Ffmpeg.GlobalArgs(encoder));
        var filter = new List<string>();
        var layout = new List<string>();
        for (var i = 0; i < cells.Length; i++)
        {
            var file = cells[i] == "" ? null : range.Segment.Files.FirstOrDefault(f => f.Camera == cells[i]);
            if (file != null)
            {
                args.AddRange(["-ss", F(range.Start), "-t", F(range.Duration), "-i", paths.ClipPath(ev, file)]);
            }
            else
            {
                // A black cell keeps the grid shape when a camera has no file for this segment.
                args.AddRange(["-f", "lavfi", "-i", $"color=c=black:s={cellWidth}x{cellHeight}:r={fps}:d={F(range.Duration)}"]);
            }
            filter.Add($"[{i}:v]fps={fps},scale={cellWidth}:{cellHeight}:force_original_aspect_ratio=decrease," +
                       $"pad={cellWidth}:{cellHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1[c{i}]");
            layout.Add($"{i % columns * cellWidth}_{i / columns * cellHeight}");
        }
        var inputs = string.Concat(Enumerable.Range(0, cells.Length).Select(i => $"[c{i}]"));
        filter.Add($"{inputs}xstack=inputs={cells.Length}:layout={string.Join('|', layout)}:fill=black,{Ffmpeg.FilterTail(encoder)}[out]");
        args.AddRange(["-filter_complex", string.Join(';', filter), "-map", "[out]", "-t", F(range.Duration)]);
        args.AddRange(ffmpeg.EncodeArgs(encoder, quality, fps));
        args.AddRange(["-an", output]);
        return args;
    }

    private static (Segment Segment, double Into) Locate(Event ev, double offset)
    {
        double acc = 0;
        foreach (var seg in ev.Segments)
        {
            if (offset < acc + seg.DurationSec) return (seg, offset - acc);
            acc += seg.DurationSec;
        }
        var last = ev.Segments[^1];
        return (last, Math.Max(0, last.DurationSec - 1));
    }

    private static ClipFile? PickFile(Segment segment, string? preferred) =>
        segment.Files.FirstOrDefault(f => f.Camera == preferred)
        ?? segment.Files.FirstOrDefault(f => f.Camera == "front")
        ?? segment.Files.OrderBy(f => Cameras.Order(f.Camera)).FirstOrDefault();
}
