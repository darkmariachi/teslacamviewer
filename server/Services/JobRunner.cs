using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;

namespace TeslaCam.Services;

/// <summary>
/// Runs queued jobs. Two lanes run side by side so quick work (probing, thumbnails) is never
/// stuck behind a long encode; each lane handles one job at a time.
/// </summary>
public class JobRunner(IDbContextFactory<AppDb> dbf, JobQueue queue, MediaProcessor processor, SettingsService settings, AppPaths paths, ILogger<JobRunner> log)
    : BackgroundService
{
    private readonly ConcurrentDictionary<int, CancellationTokenSource> _running = new();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await using (var db = await dbf.CreateDbContextAsync(stoppingToken))
        {
            // Anything marked running belongs to a previous process.
            await db.Jobs.Where(j => j.Status == JobStatus.Running)
                .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, JobStatus.Queued).SetProperty(j => j.Progress, 0d), stoppingToken);
        }
        await Task.WhenAll(LaneAsync(false, stoppingToken), LaneAsync(true, stoppingToken));
    }

    /// <summary>Stops a running job, or drops a queued one.</summary>
    public async Task<bool> CancelAsync(int jobId)
    {
        if (_running.TryGetValue(jobId, out var cts))
        {
            await cts.CancelAsync();
            return true;
        }
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Jobs.Where(j => j.Id == jobId && j.Status == JobStatus.Queued)
            .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, JobStatus.Canceled).SetProperty(j => j.FinishedAt, DateTime.UtcNow)) > 0;
    }

    /// <summary>
    /// Cancels every queued or running job for an event and waits for the running ones to let go of its files,
    /// so the clips can be moved or rewritten.
    /// </summary>
    public async Task StopEventJobsAsync(int eventId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var active = await db.Jobs.Where(j => j.EventId == eventId && (j.Status == JobStatus.Queued || j.Status == JobStatus.Running))
            .Select(j => j.Id).ToListAsync();
        foreach (var id in active) await CancelAsync(id);
        for (var i = 0; i < 100 && active.Any(_running.ContainsKey); i++) await Task.Delay(100);
        if (active.Any(_running.ContainsKey)) throw new InvalidOperationException("A job for this event is still running. Try again in a moment.");
    }

    public bool BackgroundAllowed()
    {
        var s = settings.Current;
        if (s.Paused) return false;
        if (!s.WorkHoursEnabled || s.WorkHoursStart == s.WorkHoursEnd) return true;
        var hour = DateTime.Now.Hour;
        return s.WorkHoursStart < s.WorkHoursEnd
            ? hour >= s.WorkHoursStart && hour < s.WorkHoursEnd
            : hour >= s.WorkHoursStart || hour < s.WorkHoursEnd;
    }

    private async Task LaneAsync(bool heavy, CancellationToken stoppingToken)
    {
        var kinds = heavy ? JobQueue.HeavyKinds : JobQueue.LightKinds;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var job = await NextAsync(kinds, heavy, stoppingToken);
                if (job == null)
                {
                    await queue.WaitAsync(heavy, stoppingToken);
                    continue;
                }
                await RunAsync(job, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Job lane error");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task<Job?> NextAsync(JobKind[] kinds, bool heavy, CancellationToken ct)
    {
        await using var db = await dbf.CreateDbContextAsync(ct);
        var query = db.Jobs.AsNoTracking().Where(j => j.Status == JobStatus.Queued && kinds.Contains(j.Kind) && j.Event.TrashedAt == null);
        // Pausing and work hours hold back background work only; anything the user asked for still runs.
        var background = settings.Current.Paused ? false : !heavy || BackgroundAllowed();
        if (!background) query = query.Where(j => j.UserRequested);
        return await query.OrderByDescending(j => j.Priority).ThenByDescending(j => j.Event.StartTime).ThenBy(j => j.Id).FirstOrDefaultAsync(ct);
    }

    private async Task RunAsync(Job job, CancellationToken stoppingToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        _running[job.Id] = cts;
        queue.LiveProgress[job.Id] = 0;
        await UpdateAsync(job.Id, j =>
        {
            j.Status = JobStatus.Running;
            j.StartedAt = DateTime.UtcNow;
            j.FinishedAt = null;
            j.Error = null;
            j.Attempts++;
        });
        try
        {
            await processor.RunAsync(job, p => queue.LiveProgress[job.Id] = Math.Clamp(p, 0, 1), cts.Token);
            await UpdateAsync(job.Id, j =>
            {
                j.Status = JobStatus.Done;
                j.Progress = 1;
                j.FinishedAt = DateTime.UtcNow;
                if (j.Kind == JobKind.Export)
                {
                    j.OutputFile = Path.GetFileName(paths.Export(j.Id));
                    j.OutputSizeBytes = new FileInfo(paths.Export(j.Id)).Length;
                }
            });
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down: leave the job for the next start.
            await UpdateAsync(job.Id, j => { j.Status = JobStatus.Queued; j.Progress = 0; });
            throw;
        }
        catch (OperationCanceledException)
        {
            await UpdateAsync(job.Id, j => { j.Status = JobStatus.Canceled; j.FinishedAt = DateTime.UtcNow; });
        }
        catch (Exception ex)
        {
            log.LogWarning("Job {Id} ({Kind}) for event {Event} failed: {Message}", job.Id, job.Kind, job.EventId, ex.Message);
            await UpdateAsync(job.Id, j =>
            {
                j.Status = JobStatus.Failed;
                j.FinishedAt = DateTime.UtcNow;
                j.Error = ex.Message.Length > 2000 ? ex.Message[..2000] : ex.Message;
            });
        }
        finally
        {
            _running.TryRemove(job.Id, out _);
            queue.LiveProgress.TryRemove(job.Id, out _);
        }
    }

    private async Task UpdateAsync(int jobId, Action<Job> change)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var job = await db.Jobs.FirstOrDefaultAsync(j => j.Id == jobId);
        if (job == null) return;
        change(job);
        await db.SaveChangesAsync();
    }
}
