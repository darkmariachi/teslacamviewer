using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>Creates jobs and wakes the runner. Light jobs (probe, thumbnail) and heavy ones run in separate lanes.</summary>
public class JobQueue(IDbContextFactory<AppDb> dbf, SettingsService settings)
{
    public const int UserBoost = 1000;

    public static readonly JobKind[] LightKinds = [JobKind.Probe, JobKind.Thumbnail];
    public static readonly JobKind[] HeavyKinds = [JobKind.Export, JobKind.Transcode, JobKind.Preview];

    private readonly SemaphoreSlim _wakeLight = new(0);
    private readonly SemaphoreSlim _wakeHeavy = new(0);

    /// <summary>Progress (0..1) of running jobs, kept in memory to avoid hammering the database.</summary>
    public ConcurrentDictionary<int, double> LiveProgress { get; } = new();

    public void Wake()
    {
        if (_wakeLight.CurrentCount == 0) _wakeLight.Release();
        if (_wakeHeavy.CurrentCount == 0) _wakeHeavy.Release();
    }

    /// <summary>Waits until new work may be available for a lane, or a poll interval passes.</summary>
    public Task WaitAsync(bool heavy, CancellationToken ct) =>
        (heavy ? _wakeHeavy : _wakeLight).WaitAsync(TimeSpan.FromSeconds(10), ct);

    public static int BasePriority(JobKind kind) => kind switch
    {
        // Thumbnails first: they make the library usable while the slower steps catch up.
        JobKind.Thumbnail => 100,
        JobKind.Probe => 90,
        JobKind.Export => 60,
        JobKind.Transcode => 40,
        _ => 10,
    };

    public bool ShouldAutoPreview(Event ev)
    {
        var s = settings.Current;
        return s.PreviewPolicy switch
        {
            "all" => true,
            "recent" => ev.StartTime >= DateTime.Now.AddDays(-s.PreviewRecentDays),
            _ => false,
        };
    }

    /// <summary>Adds the jobs every freshly indexed event needs to the context. The caller saves.</summary>
    public void AddInitialJobs(AppDb db, Event ev)
    {
        db.Jobs.Add(NewJob(ev, JobKind.Thumbnail));
        db.Jobs.Add(NewJob(ev, JobKind.Probe));
        if (ShouldAutoPreview(ev)) db.Jobs.Add(NewJob(ev, JobKind.Preview));
    }

    public static Job NewJob(Event ev, JobKind kind, bool userRequested = false, string? argsJson = null) => new()
    {
        Event = ev,
        Kind = kind,
        Status = JobStatus.Queued,
        Priority = BasePriority(kind) + (userRequested ? UserBoost : 0),
        UserRequested = userRequested,
        ArgsJson = argsJson,
        CreatedAt = DateTime.UtcNow,
    };

    /// <summary>
    /// Queues a job on behalf of the user. An existing queued job of the same kind is promoted instead of duplicated.
    /// </summary>
    public async Task<Job> RequestAsync(int eventId, JobKind kind, string? argsJson = null, bool userRequested = true)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var ev = await db.Events.FirstAsync(e => e.Id == eventId);
        if (kind != JobKind.Export)
        {
            var existing = await db.Jobs
                .Where(j => j.EventId == eventId && j.Kind == kind && (j.Status == JobStatus.Queued || j.Status == JobStatus.Running))
                .FirstOrDefaultAsync();
            if (existing != null)
            {
                if (existing.Status == JobStatus.Queued && userRequested && !existing.UserRequested)
                {
                    existing.UserRequested = true;
                    existing.Priority = BasePriority(kind) + UserBoost;
                    await db.SaveChangesAsync();
                    Wake();
                }
                return existing;
            }
        }
        var job = NewJob(ev, kind, userRequested, argsJson);
        db.Jobs.Add(job);
        await db.SaveChangesAsync();
        Wake();
        return job;
    }

    /// <summary>Queues a background job for every event that is missing the given output. Returns how many were added.</summary>
    public async Task<int> RequestBacklogAsync(JobKind kind)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var pending = db.Jobs.Where(j => j.Kind == kind && (j.Status == JobStatus.Queued || j.Status == JobStatus.Running)).Select(j => j.EventId);
        var query = db.Events.Where(e => e.TrashedAt == null && !pending.Contains(e.Id));
        query = kind switch
        {
            JobKind.Preview => query.Where(e => !e.HasPreview),
            JobKind.Thumbnail => query.Where(e => !e.HasThumb),
            JobKind.Probe => query.Where(e => !e.Probed),
            JobKind.Transcode => query.Where(e => e.NeedsTranscode && e.Segments.Any(s => s.Files.Any(f => f.Codec != null && f.Codec != "h264" && !f.Transcoded))),
            _ => query.Where(e => false),
        };
        var events = await query.ToListAsync();
        foreach (var ev in events) db.Jobs.Add(NewJob(ev, kind));
        await db.SaveChangesAsync();
        Wake();
        return events.Count;
    }
}
