using System.Globalization;
using System.Text.RegularExpressions;

namespace TeslaCam.Services;

/// <summary>One pass of teslausb's archive loop: it checks the dashcam drive and copies whatever is new.</summary>
public record ArchiverRun
{
    /// <summary>The Pi's own wall-clock time, with no zone (like clip times, which come from the car).</summary>
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public int? EventFolders { get; set; }
    /// <summary>Files teslausb found waiting to be copied.</summary>
    public int? Files { get; set; }
    public int? Archived { get; set; }
    /// <summary>running, nothing (no new clips), done, error (stopped partway), or noArchive (share not mounted).</summary>
    public string Outcome { get; set; } = "running";
    public List<string> Problems { get; set; } = [];
}

/// <summary>What the tail of teslausb's archiveloop.log says about the device.</summary>
public record ArchiverLog
{
    /// <summary>starting, waitingForArchive, reachable, archiving, done (waiting for the car to leave), or null.</summary>
    public string? State { get; set; }
    public DateTime? StateSince { get; set; }
    public ArchiverRun? LastRun { get; set; }
    /// <summary>The most recent run that had files to copy, which is the one people care about.</summary>
    public ArchiverRun? LastCopy { get; set; }
    /// <summary>Connection errors logged while waiting to reach the archive share.</summary>
    public List<string> WaitProblems { get; set; } = [];
}

public record ArchiverWarning(string Level, string Text, string? Detail = null);

public static partial class ArchiverLogParser
{
    // "Fri Nov  6 09:17:02 PM CST 2026: message", or the 24-hour form some locales print.
    [GeneratedRegex(@"^\w{3} (\w{3}) +(\d{1,2}) (\d{1,2}):(\d\d):(\d\d)(?: ([AP]M))?(?: [A-Z][A-Za-z+\-0-9]*)? (\d{4}): (.*)$")]
    private static partial Regex Stamped();
    [GeneratedRegex(@"There are (\d+) event folder\(s\) with (\d+) file\(s\)")]
    private static partial Regex Found();
    [GeneratedRegex(@"Archived (\d+) files")]
    private static partial Regex Archived();
    [GeneratedRegex(@"connection dead|rsync error|Failed to mount|mount error|Couldn't connect archive|Error during archiving", RegexOptions.IgnoreCase)]
    private static partial Regex Problem();

    private const int MaxProblems = 5;

    public static ArchiverLog Parse(string text)
    {
        var log = new ArchiverLog();
        ArchiverRun? run = null;

        void Close()
        {
            if (run == null) return;
            if (run.Outcome == "running" && run.FinishedAt != null) run.Outcome = run.Files > 0 ? "done" : "nothing";
            if (run.Files > 0) log.LastCopy = run;
        }
        void Note(List<string> list, string message)
        {
            message = message.Trim();
            if (message.Length > 200) message = message[..200] + "…";
            if (list.Count < MaxProblems && !list.Contains(message)) list.Add(message);
        }
        void SetState(string state, DateTime? at)
        {
            log.State = state;
            log.StateSince = at;
        }

        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            var m = Stamped().Match(line);
            var at = m.Success ? StampTime(m) : null;
            var msg = m.Success ? m.Groups[8].Value : line;

            if (msg == "Archiving...")
            {
                Close();
                run = new ArchiverRun { StartedAt = at };
                log.LastRun = run;
                SetState("archiving", at);
            }
            else if (msg.StartsWith("Starting archiveloop", StringComparison.Ordinal))
            {
                SetState("starting", at);
                log.WaitProblems.Clear();
            }
            else if (msg.StartsWith("Waiting for archive to be reachable", StringComparison.Ordinal))
            {
                SetState("waitingForArchive", at);
                log.WaitProblems.Clear();
            }
            else if (msg.StartsWith("Archive is reachable", StringComparison.Ordinal))
            {
                SetState("reachable", at);
            }
            else if (msg.StartsWith("Waiting for archive to be unreachable", StringComparison.Ordinal))
            {
                SetState("done", at);
            }
            else if (run is { Outcome: "running" } && Found().Match(msg) is { Success: true } found)
            {
                run.EventFolders = int.Parse(found.Groups[1].Value, CultureInfo.InvariantCulture);
                run.Files = int.Parse(found.Groups[2].Value, CultureInfo.InvariantCulture);
            }
            else if (run != null && msg.StartsWith("Archiving completed successfully", StringComparison.Ordinal))
            {
                run.Archived = Count(Archived().Match(msg));
                run.Outcome = "done";
                run.FinishedAt = at;
            }
            else if (run != null && msg.StartsWith("Error during archiving", StringComparison.Ordinal))
            {
                run.Archived = Count(Archived().Match(msg));
                run.Outcome = "error";
                run.FinishedAt = at;
                Note(run.Problems, msg);
            }
            else if (run != null && msg.StartsWith("Couldn't connect archive", StringComparison.Ordinal))
            {
                run.Outcome = "noArchive";
                Note(run.Problems, msg);
            }
            else if (run != null && msg == "Finished archiving.")
            {
                run.FinishedAt ??= at;
                Close();
                SetState("done", at);
            }
            else if (Problem().IsMatch(msg))
            {
                // A problem belongs to the run in progress; between runs it explains why the share can't be reached.
                Note(log.State == "archiving" && run != null ? run.Problems : log.WaitProblems, msg);
            }
        }
        // A run still open at the end of the log is either in progress or was cut off when the car left.
        Close();
        return log;
    }

    private static int? Count(Match m) => m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;

    private static DateTime? StampTime(Match m)
    {
        if (!DateTime.TryParseExact(m.Groups[1].Value, "MMM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var month)) return null;
        var hour = int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture);
        if (m.Groups[6].Success)
        {
            hour %= 12;
            if (m.Groups[6].Value == "PM") hour += 12;
        }
        try
        {
            return new DateTime(int.Parse(m.Groups[7].Value, CultureInfo.InvariantCulture), month.Month, int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture),
                hour, int.Parse(m.Groups[4].Value, CultureInfo.InvariantCulture), int.Parse(m.Groups[5].Value, CultureInfo.InvariantCulture), DateTimeKind.Unspecified);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    /// <summary>Whether the Pi reported a power dip at any point during one visit home.</summary>
    public record VisitPower(int SessionId, bool Dipped);

    /// <summary>Turns the log and the recent history into the few things worth telling the owner about.</summary>
    public static List<ArchiverWarning> Warnings(ArchiverLog? log, bool online, DateTime? onlineSince, IReadOnlyList<VisitPower> visits, DateTime now)
    {
        var warnings = new List<ArchiverWarning>();
        if (log != null)
        {
            if (online && log.State == "waitingForArchive" && onlineSince is { } since && now - since > TimeSpan.FromMinutes(10))
                warnings.Add(new("error", "The car is home, but teslausb can't reach the archive share, so no clips are being copied.",
                    log.WaitProblems.LastOrDefault()));
            if (log.LastRun is { Outcome: "error" } failed)
                warnings.Add(new("warn",
                    $"The last upload stopped partway{(failed.Files != null ? $": {failed.Archived ?? 0} of {failed.Files} files copied" : "")}. teslausb tries again the next time it connects.",
                    failed.Problems.FirstOrDefault(p => !p.StartsWith("Error during", StringComparison.Ordinal))));
            else if (log.LastRun is { Outcome: "noArchive" } skipped)
                warnings.Add(new("warn", "The last upload was skipped because teslausb couldn't connect to the archive share.", skipped.Problems.FirstOrDefault()));
        }
        var dipped = visits.Count(v => v.Dipped);
        if (visits.Count >= 2 && dipped >= 2 && dipped * 2 >= visits.Count)
            warnings.Add(new("warn", $"Power dipped too low during {dipped} of the last {visits.Count} visits home.",
                "A sturdier USB cable or a different port usually fixes this. Low power can corrupt clips."));
        return warnings;
    }
}
