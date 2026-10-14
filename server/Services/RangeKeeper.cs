using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>
/// Cuts an event's own clips down to a range picked on the timeline, to save space. Every camera keeps the same
/// footage; the minutes outside go to the trash folder whole, and the clips at the edges are rewritten without
/// re-encoding (so the cut lands on a keyframe, keeping up to a second or two more than asked) with their originals
/// going to the trash too.
/// </summary>
public class RangeKeeper(IDbContextFactory<AppDb> dbf, AppPaths paths, Ffmpeg ffmpeg, Scanner scanner, JobRunner runner, ILogger<RangeKeeper> log)
{
    private static string F(double v) => v.ToString("0.######", CultureInfo.InvariantCulture);

    /// <summary>Returns roughly how many bytes leave the event.</summary>
    public async Task<long> KeepAsync(int eventId, double start, double end, CancellationToken ct = default)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var ev = await db.Events.Include(e => e.Segments.OrderBy(s => s.Index)).ThenInclude(s => s.Files)
            .FirstOrDefaultAsync(e => e.Id == eventId, ct) ?? throw new InvalidOperationException("Event not found");
        if (ev.TrashedAt != null) throw new InvalidOperationException("This event is in the trash");
        start = Math.Clamp(start, 0, ev.DurationSec);
        end = Math.Clamp(end, start, ev.DurationSec);
        if (end - start < 1) throw new InvalidOperationException("Pick a range of at least one second");

        var plan = Timeline.KeepRange(ev, start, end);
        if (plan.Drop.Count == 0 && plan.Cuts.Count == 0) return 0;

        // Probes and previews read these files; they must let go before anything moves.
        await runner.StopEventJobsAsync(eventId);

        var dir = paths.EventDir(ev);
        var trash = Path.Combine(paths.TrashDir, TrashService.SegmentsDir, $"{ev.Name}_{DateTime.UtcNow:yyyyMMddHHmmss}");
        var work = Path.Combine(trash, ".cut");
        Directory.CreateDirectory(work);
        var before = ev.Segments.SelectMany(s => s.Files).Sum(f => f.SizeBytes);

        // Write every cut first, so a failure leaves the event untouched.
        var outputs = new List<(ClipFile File, string Temp, string Name)>();
        try
        {
            foreach (var cut in plan.Cuts)
            {
                foreach (var file in cut.Segment.Files)
                {
                    var source = Path.Combine(dir, file.FileName);
                    if (!File.Exists(source)) continue;
                    var from = 0d;
                    if (cut.From > 0)
                    {
                        // Start on the last keyframe at or before the cut, and name the file for when that is.
                        var keys = await ffmpeg.KeyframesAsync(source, ct);
                        if (keys.Count > 0) from = keys.Select(k => k - keys[0]).LastOrDefault(k => k <= cut.From + 0.001);
                    }
                    var temp = Path.Combine(work, file.FileName);
                    List<string> args = ["-ss", F(from), "-i", source];
                    if (cut.To is { } to) args.AddRange(["-t", F(to - from)]);
                    args.AddRange(["-map", "0:v", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", temp]);
                    await ffmpeg.RunAsync(args, null, ct);
                    var startTime = cut.Segment.StartTime.AddSeconds(Math.Floor(from));
                    outputs.Add((file, temp, $"{startTime:yyyy-MM-dd_HH-mm-ss}-{file.Camera}.mp4"));
                }
            }
        }
        catch
        {
            TryDelete(trash);
            throw;
        }

        // Originals go to the trash; the cut copies take their place, keeping the original dates so the
        // scanner sees a settled folder rather than one the car is still writing.
        foreach (var file in plan.Drop.SelectMany(s => s.Files).Concat(outputs.Select(o => o.File)))
        {
            var from = Path.Combine(dir, file.FileName);
            if (File.Exists(from)) File.Move(from, Path.Combine(trash, file.FileName));
        }
        foreach (var (file, temp, name) in outputs)
        {
            var target = Path.Combine(dir, name);
            File.Move(temp, target, true);
            File.SetLastWriteTimeUtc(target, File.GetLastWriteTimeUtc(Path.Combine(trash, file.FileName)));
        }
        TryDelete(work);

        var rewritten = outputs.Select(o => o.File).ToHashSet();
        var after = ev.Segments.Where(s => !plan.Drop.Contains(s)).SelectMany(s => s.Files).Where(f => !rewritten.Contains(f)).Sum(f => f.SizeBytes)
                    + outputs.Sum(o => new FileInfo(Path.Combine(dir, o.Name)).Length);
        if (ev.Type == EventType.Recent)
        {
            // A drive is named for its first clip; follow the rename so the scanner keeps this event (and its
            // favorite, notes and collections) instead of seeing a new one.
            var names = ev.Segments.Where(s => !plan.Drop.Contains(s)).SelectMany(s => s.Files).Where(f => !rewritten.Contains(f))
                .Select(f => f.FileName).Concat(outputs.Select(o => o.Name));
            ev.Name = "drive_" + names.Select(n => n[..19]).Min(StringComparer.Ordinal);
        }
        ev.Signature = "";
        await db.SaveChangesAsync(ct);
        scanner.RequestScan();
        log.LogInformation("Kept {Start:0.#}–{End:0.#} s of event {Id}", start, end, eventId);
        return Math.Max(0, before - after);
    }

    private static void TryDelete(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (IOException) { }
    }
}
