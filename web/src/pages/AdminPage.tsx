import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, Cpu, HardDrive, LogOut, Pause, Play, RefreshCw, RotateCcw, Trash2, Undo2, XCircle, Zap,
} from 'lucide-react'
import { api, thumbUrl, type EventType, type Job, type JobKind, type Overview, type Settings } from '../api'
import { cx, eventTitle, formatBytes, formatDateTime, formatDuration, formatRelative } from '../lib/format'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, PageHeader, ProgressBar, Segmented, Spinner, Toggle, inputClass,
} from '../components/ui'
import CarTab from './CarTab'

type Tab = 'processing' | 'car' | 'library' | 'settings' | 'trash' | 'account'

const KIND_LABEL: Record<JobKind, string> = {
  probe: 'Read clip details',
  thumbnail: 'Thumbnails',
  preview: 'Merged videos',
  transcode: 'Compatible copies',
  export: 'Exports',
}

const KIND_SHORT: Record<JobKind, string> = { probe: 'Details', thumbnail: 'Thumbnail', preview: 'Merge', transcode: 'Transcode', export: 'Export' }

export default function AdminPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'processing'
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 2000 })

  return (
    <>
      <PageHeader title="Admin" />
      <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented
          value={tab}
          onChange={(value) => setParams(value === 'processing' ? {} : { tab: value }, { replace: true })}
          options={[
            { value: 'processing', label: 'Processing' },
            { value: 'car', label: 'Car' },
            { value: 'library', label: 'Library' },
            { value: 'settings', label: 'Settings' },
            { value: 'trash', label: overview.data?.trash.count ? `Trash (${overview.data.trash.count})` : 'Trash' },
            { value: 'account', label: 'Account' },
          ]}
        />
      </div>
      {overview.isPending ? (
        <Spinner />
      ) : !overview.data ? (
        <EmptyState icon={<AlertTriangle className="size-6" />} title="Couldn't load status" />
      ) : tab === 'processing' ? (
        <Processing overview={overview.data} />
      ) : tab === 'car' ? (
        <CarTab />
      ) : tab === 'library' ? (
        <Library overview={overview.data} />
      ) : tab === 'settings' ? (
        <SettingsForm />
      ) : tab === 'trash' ? (
        <Trash overview={overview.data} />
      ) : (
        <Account />
      )}
    </>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['overview'] })
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
  }
}

function Processing({ overview }: { overview: Overview }) {
  const refresh = useRefresh()
  const { pipeline, library } = overview
  const [confirm, setConfirm] = useState<JobKind | null>(null)
  const totals = overview.jobs.reduce((t, j) => ({ queued: t.queued + j.queued, failed: t.failed + j.failed }), { queued: 0, failed: 0 })

  const state = pipeline.paused
    ? { label: 'Paused', tone: 'warn' as const, text: 'Background work is on hold. Anything you request yourself still runs.' }
    : !pipeline.backgroundAllowed
      ? {
          label: 'Outside working hours',
          tone: 'blue' as const,
          text: `Heavy jobs run between ${pipeline.workHours?.start}:00 and ${pipeline.workHours?.end}:00.`,
        }
      : overview.running.length > 0
        ? { label: 'Working', tone: 'ok' as const, text: `${totals.queued.toLocaleString()} more in the queue.` }
        : totals.queued > 0
          ? { label: 'Starting', tone: 'ok' as const, text: `${totals.queued.toLocaleString()} in the queue.` }
          : { label: 'Idle', tone: 'neutral' as const, text: 'Everything is up to date.' }

  // How much of the library each step has covered.
  const coverage: Partial<Record<JobKind, number>> = { probe: library.probed, thumbnail: library.thumbs, preview: library.previews }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className={cx('flex size-11 shrink-0 items-center justify-center rounded-full', state.tone === 'ok' ? 'bg-ok/15 text-ok' : state.tone === 'warn' ? 'bg-warn/15 text-warn' : 'bg-raised text-dim')}>
          {pipeline.paused ? <Pause className="size-5" /> : overview.running.length ? <Spinner className="size-5 !text-ok" /> : <CheckCircle2 className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-base font-semibold">
            {state.label}
            {pipeline.etaSeconds != null && !pipeline.paused && <span className="text-[13px] font-normal text-dim">about {formatDuration(pipeline.etaSeconds)} of merging left</span>}
          </p>
          <p className="text-sm text-dim">{state.text}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-dim" title={pipeline.ffmpegVersion ? `ffmpeg ${pipeline.ffmpegVersion}` : 'ffmpeg was not found'}>
            {pipeline.encoder === 'vaapi' ? <Zap className="size-4 text-ok" /> : <Cpu className="size-4" />}
            {pipeline.ffmpegVersion ? (pipeline.encoder === 'vaapi' ? 'Hardware encoding' : 'Software encoding') : 'ffmpeg missing'}
          </span>
          <Button
            icon={pipeline.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            onClick={async () => {
              await (pipeline.paused ? api.resume() : api.pause())
              refresh()
            }}
          >
            {pipeline.paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </Card>

      {overview.running.length > 0 && (
        <Card className="p-5">
          <h2 className="label mb-3">Running now</h2>
          <ul className="space-y-4">
            {overview.running.map((job) => (
              <li key={job.id} className="flex items-center gap-3">
                <img src={thumbUrl(job.eventId)} alt="" className="aspect-4/3 w-16 shrink-0 rounded-md bg-raised object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <Link to={`/events/${job.eventId}`} className="truncate font-medium hover:underline">
                      {KIND_SHORT[job.kind]} · {job.eventStart ? formatDateTime(job.eventStart) : job.eventName}
                    </Link>
                    <span className="tabular shrink-0 text-dim">{Math.round(job.progress * 100)}%</span>
                  </div>
                  <ProgressBar value={job.progress} tone="ok" />
                </div>
                <IconButton label="Stop this job" onClick={async () => { await api.cancelJob(job.id); refresh() }}>
                  <XCircle className="size-4.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overview.jobs
          .filter((j) => j.kind !== 'export')
          .map((j) => {
            const covered = j.kind === 'transcode' ? null : (coverage[j.kind] ?? 0)
            const missing = covered == null ? 0 : library.events - covered
            return (
              <Card key={j.kind} className="flex flex-col p-5">
                <p className="label">{KIND_LABEL[j.kind]}</p>
                {covered != null ? (
                  <>
                    <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
                      {covered.toLocaleString()}
                      <span className="text-base font-normal text-faint"> / {library.events.toLocaleString()}</span>
                    </p>
                    <div className="mt-3">
                      <ProgressBar value={library.events ? covered / library.events : 0} tone={covered === library.events ? 'ok' : 'fg'} />
                    </div>
                  </>
                ) : (
                  <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
                    {library.needTranscode.toLocaleString()}
                    <span className="text-base font-normal text-faint"> need it</span>
                  </p>
                )}
                <p className="tabular mt-3 flex flex-wrap gap-x-3 text-[13px] text-dim">
                  <span>{j.queued.toLocaleString()} queued</span>
                  {j.running > 0 && <span className="text-ok">{j.running} running</span>}
                  {j.failed > 0 && <span className="text-accent-hover">{j.failed} failed</span>}
                </p>
                {j.kind === 'preview' && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                    <Button size="sm" disabled={missing - j.queued - j.running <= 0} onClick={() => setConfirm('preview')}>
                      Merge all missing
                    </Button>
                    {j.queued > 0 && (
                      <Button size="sm" variant="ghost" onClick={async () => { await api.cancelBacklog('preview'); refresh() }}>
                        Clear queue
                      </Button>
                    )}
                  </div>
                )}
                {j.kind === 'thumbnail' && missing - j.queued - j.running > 0 && (
                  <div className="mt-4 border-t border-line pt-4">
                    <Button size="sm" onClick={async () => { await api.backlog('thumbnail'); refresh() }}>
                      Make missing
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
      </div>

      <JobsTable failed={totals.failed} />

      {confirm && (
        <ConfirmDialog
          title="Merge every event?"
          message={
            <>
              This queues a merged video for {(library.events - library.previews).toLocaleString()} events. They are processed newest first, one at a time, in the background.
              Depending on the server it can take a long while; you can pause or clear the queue at any point.
            </>
          }
          confirmLabel="Queue them"
          onConfirm={async () => {
            await api.backlog(confirm)
            refresh()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function JobsTable({ failed }: { failed: number }) {
  const refresh = useRefresh()
  const [status, setStatus] = useState<'active' | 'failed' | 'done' | 'all'>('active')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [status])

  // "Active" is two statuses, so it is fetched as two lists and joined.
  const jobs = useQuery({
    queryKey: ['jobs', status, page],
    refetchInterval: 2500,
    queryFn: async () => {
      if (status !== 'active') return api.jobs({ status: status === 'all' ? undefined : status, page })
      const [running, queued] = await Promise.all([api.jobs({ status: 'running' }), api.jobs({ status: 'queued', page })])
      return { ...queued, items: page === 1 ? [...running.items, ...queued.items] : queued.items, total: queued.total + running.total }
    },
  })
  const pages = jobs.data ? Math.max(1, Math.ceil(jobs.data.total / jobs.data.pageSize)) : 1

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <h2 className="mr-auto text-[15px] font-semibold">Jobs</h2>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: 'Queue' },
            { value: 'failed', label: failed ? `Failed (${failed})` : 'Failed' },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
        />
        {status === 'failed' && failed > 0 && (
          <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={async () => { await api.retryFailed(); refresh() }}>
            Retry all
          </Button>
        )}
        {(status === 'done' || status === 'all') && (
          <Button size="sm" variant="ghost" onClick={async () => { await api.clearFinished(); refresh() }}>
            Clear history
          </Button>
        )}
      </div>
      {jobs.isPending ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : jobs.data?.items.length === 0 ? (
        <p className="p-6 text-sm text-faint">{status === 'active' ? 'The queue is empty.' : status === 'failed' ? 'Nothing has failed.' : 'No jobs to show.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {jobs.data?.items.map((job) => <JobRow key={job.id} job={job} onChange={refresh} />)}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px] text-dim">
          <span className="tabular">
            Page {page} of {pages} · {jobs.data?.total.toLocaleString()} jobs
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function JobRow({ job, onChange }: { job: Job; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const tone = job.status === 'done' ? 'ok' : job.status === 'failed' ? 'accent' : job.status === 'running' ? 'blue' : job.status === 'canceled' ? 'warn' : 'neutral'
  const took = job.startedAt && job.finishedAt ? (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000 : null
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-24 shrink-0 font-medium">{KIND_SHORT[job.kind]}</span>
        <Link to={`/events/${job.eventId}`} className="tabular min-w-0 flex-1 truncate text-dim hover:text-fg hover:underline">
          {job.eventStart ? formatDateTime(job.eventStart) : job.eventName}
        </Link>
        {job.userRequested && job.status !== 'done' && <Badge tone="blue">REQUESTED</Badge>}
        {job.status === 'running' ? (
          <div className="flex w-36 items-center gap-2">
            <ProgressBar value={job.progress} tone="ok" />
            <span className="tabular w-9 text-right text-[13px] text-dim">{Math.round(job.progress * 100)}%</span>
          </div>
        ) : (
          <span className="tabular text-[13px] text-faint">
            {job.status === 'done' && took != null ? `took ${took < 60 ? `${Math.max(1, Math.round(took))} sec` : formatDuration(took)}` : job.finishedAt ? formatRelative(job.finishedAt) : ''}
          </span>
        )}
        <Badge tone={tone}>{job.status.toUpperCase()}</Badge>
        {job.status === 'failed' && (
          <>
            <button onClick={() => setOpen((v) => !v)} className="text-[13px] text-dim hover:text-fg">
              {open ? 'Hide' : 'Details'}
            </button>
            <IconButton label="Try again" className="size-7" onClick={async () => { await api.retryJob(job.id); onChange() }}>
              <RotateCcw className="size-4" />
            </IconButton>
          </>
        )}
        {(job.status === 'queued' || job.status === 'running') && (
          <IconButton label={job.status === 'running' ? 'Stop' : 'Remove from queue'} className="size-7" onClick={async () => { await api.cancelJob(job.id); onChange() }}>
            <XCircle className="size-4" />
          </IconButton>
        )}
      </div>
      {open && job.error && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-dim">{job.error}</pre>}
    </li>
  )
}

function Library({ overview }: { overview: Overview }) {
  const refresh = useRefresh()
  const { scan, library, storage } = overview
  const used = storage.clips ? storage.clips.totalBytes - storage.clips.freeBytes : 0

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Clip folder</h2>
            <p className="mt-1 text-sm text-dim">
              {scan.running ? 'Scanning now…' : `Last scanned ${formatRelative(scan.lastRun)}; checked every ${scan.intervalMinutes} min.`}
            </p>
          </div>
          <Button icon={<RefreshCw className={cx('size-4', scan.running && 'animate-spin')} />} disabled={scan.running} onClick={async () => { await api.scan(); refresh() }}>
            Scan now
          </Button>
        </div>
        {scan.lastError && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-accent-soft p-3 text-sm text-accent-hover">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {scan.lastError}
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <Metric label="Events" value={library.events.toLocaleString()} />
          <Metric label="Footage" value={formatDuration(library.durationSec)} />
          <Metric label="Found last scan" value={scan.lastResult ? scan.lastResult.total.toLocaleString() : '–'} />
          <Metric label="Scan took" value={scan.lastResult ? `${scan.lastResult.seconds} s` : '–'} />
        </dl>
        {scan.lastResult && scan.lastResult.added + scan.lastResult.updated + scan.lastResult.removed > 0 && (
          <p className="mt-4 text-[13px] text-dim">
            Last scan: {scan.lastResult.added} added, {scan.lastResult.updated} updated, {scan.lastResult.removed} removed.
          </p>
        )}
        {!storage.clipsWritable && (
          <p className="mt-4 flex items-start gap-2 text-[13px] text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> The clip folder is read-only, so deleting events is not possible.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <HardDrive className="size-4 text-dim" /> Storage
        </h2>
        <div className="mt-5 space-y-5">
          <StorageRow label="Original clips" bytes={library.originalBytes} of={storage.clips?.totalBytes} />
          <StorageRow label="Merged videos, thumbnails and copies" bytes={storage.cacheBytes} of={storage.data?.totalBytes} />
          <StorageRow label="Trash" bytes={overview.trash.bytes} of={storage.clips?.totalBytes} />
        </div>
        {storage.clips && (
          <p className="tabular mt-5 border-t border-line pt-4 text-[13px] text-dim">
            Clip drive: {formatBytes(storage.clips.freeBytes)} free of {formatBytes(storage.clips.totalBytes)} ({Math.round((used / storage.clips.totalBytes) * 100)}% used)
            {storage.data && storage.data.totalBytes !== storage.clips.totalBytes && <> · Data drive: {formatBytes(storage.data.freeBytes)} free</>}
          </p>
        )}
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
    </div>
  )
}

function StorageRow({ label, bytes, of }: { label: string; bytes: number; of?: number }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular text-dim">{formatBytes(bytes)}</span>
      </div>
      <ProgressBar value={of ? bytes / of : 0} />
    </div>
  )
}

function SettingsForm() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [draft, setDraft] = useState<Settings | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle')
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data)
  }, [settings.data, draft])

  if (!draft) return <Spinner />
  const set = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch })
    setState('idle')
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data)

  async function save() {
    if (!draft) return
    setState('saving')
    try {
      const saved = await api.saveSettings(draft)
      queryClient.setQueryData(['settings'], saved)
      setDraft(saved)
      setState('saved')
      queryClient.invalidateQueries({ queryKey: ['overview'] })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : 'Something went wrong' })
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Section title="Merged videos" description="One video with every camera in a grid. Lighter to play on a phone and easy to share.">
        <Field label="Create them automatically for">
          <select value={draft.previewPolicy} onChange={(e) => set({ previewPolicy: e.target.value as Settings['previewPolicy'] })} className={inputClass}>
            <option value="recent">Recent events only</option>
            <option value="all">Every event</option>
            <option value="ondemand">Nothing; only when I ask</option>
          </select>
        </Field>
        {draft.previewPolicy === 'recent' && (
          <Field label="Recent means newer than" hint="Older events are merged when you open them and ask for it.">
            <NumberInput value={draft.previewRecentDays} min={1} max={3650} suffix="days" onChange={(v) => set({ previewRecentDays: v })} />
          </Field>
        )}
        <Field label="Resolution per camera" hint="Higher looks sharper, takes longer and uses more disk.">
          <select value={draft.previewCellHeight} onChange={(e) => set({ previewCellHeight: Number(e.target.value) })} className={inputClass}>
            <option value={360}>480 × 360</option>
            <option value={480}>640 × 480</option>
            <option value={720}>960 × 720</option>
          </select>
        </Field>
        <Field label="Quality" hint="Lower numbers look better and make bigger files. 27 is a good balance.">
          <NumberInput value={draft.previewQuality} min={18} max={36} onChange={(v) => set({ previewQuality: v })} />
        </Field>
        <Field label="Frame rate">
          <NumberInput value={draft.previewFps} min={10} max={60} suffix="fps" onChange={(v) => set({ previewFps: v })} />
        </Field>
      </Section>

      <Section title="Performance" description="Keep encoding from getting in the way of everything else on the server.">
        <Field label="Encoder" hint="Automatic uses the graphics chip when the server exposes one, which is much faster.">
          <select value={draft.encoder} onChange={(e) => set({ encoder: e.target.value as Settings['encoder'] })} className={inputClass}>
            <option value="auto">Automatic</option>
            <option value="vaapi">Hardware (VAAPI)</option>
            <option value="software">Software</option>
          </select>
        </Field>
        <Field label="Processor threads for encoding" hint="0 lets ffmpeg decide. Lower it if other services slow down.">
          <NumberInput value={draft.ffmpegThreads} min={0} max={64} onChange={(v) => set({ ffmpegThreads: v })} />
        </Field>
        <Row label="Only run heavy jobs during set hours" hint="Merges and copies you request yourself always run right away.">
          <Toggle label="Limit working hours" checked={draft.workHoursEnabled} onChange={(v) => set({ workHoursEnabled: v })} />
        </Row>
        {draft.workHoursEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="From">
              <HourSelect value={draft.workHoursStart} onChange={(v) => set({ workHoursStart: v })} />
            </Field>
            <Field label="Until">
              <HourSelect value={draft.workHoursEnd} onChange={(v) => set({ workHoursEnd: v })} />
            </Field>
          </div>
        )}
        <Field label="Clips this browser may not play (HEVC)">
          <select value={draft.transcodePolicy} onChange={(e) => set({ transcodePolicy: e.target.value as Settings['transcodePolicy'] })} className={inputClass}>
            <option value="auto">Make compatible copies automatically</option>
            <option value="ondemand">Only when I ask</option>
          </select>
        </Field>
      </Section>

      <Section title="Library">
        <Field label="Check the clip folder every">
          <NumberInput value={draft.scanIntervalMinutes} min={1} max={1440} suffix="minutes" onChange={(v) => set({ scanIntervalMinutes: v })} />
        </Field>
        <Field label="Keep deleted events in the trash for" hint="After this they are removed from disk for good. 0 removes them at the next cleanup.">
          <NumberInput value={draft.trashRetentionDays} min={0} max={365} suffix="days" onChange={(v) => set({ trashRetentionDays: v })} />
        </Field>
        <Field label="Trimming keeps before the trigger" hint="Trim cuts a long event down to the footage around its trigger. Recordings are a minute long, so whole minutes are kept.">
          <NumberInput value={draft.trimBeforeSec} min={0} max={3600} suffix="seconds" onChange={(v) => set({ trimBeforeSec: v })} />
        </Field>
        <Field label="…and after the trigger">
          <NumberInput value={draft.trimAfterSec} min={0} max={3600} suffix="seconds" onChange={(v) => set({ trimAfterSec: v })} />
        </Field>
      </Section>

      <Section
        title="Sentry at home"
        description="Leaving Sentry on at home keeps the car's USB port powered so uploads finish, but it records everyone who walks past. Those events can clean themselves up."
      >
        <Row
          label="Clean up Sentry events recorded at home"
          hint="Favorites, events in a collection and bumps (something touched the car) are always kept. While this is on, the webhook skips home events too, except bumps."
        >
          <Toggle label="Clean up home events" checked={draft.homeCleanupEnabled} onChange={(v) => set({ homeCleanupEnabled: v })} />
        </Row>
        <Field label="Home location" hint={draft.homeLat == null ? 'Open an event recorded at home and choose "This is home" from its menu.' : undefined}>
          {draft.homeLat != null && draft.homeLon != null ? (
            <div className="flex h-10 items-center gap-3">
              <span className="tabular text-sm">
                {draft.homeLat.toFixed(5)}, {draft.homeLon.toFixed(5)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => set({ homeLat: null, homeLon: null })}>
                Clear
              </Button>
            </div>
          ) : (
            <p className="flex h-10 items-center text-sm text-faint">Not set</p>
          )}
        </Field>
        <Field label="Counts as home within">
          <NumberInput value={draft.homeRadiusM} min={20} max={2000} suffix="metres" onChange={(v) => set({ homeRadiusM: v })} />
        </Field>
        <Field label="Move them to the trash after">
          <NumberInput value={draft.homeCleanupDays} min={1} max={365} suffix="days" onChange={(v) => set({ homeCleanupDays: v })} />
        </Field>
        {draft.homeLat != null && <HomeCleanupPreview draft={draft} />}
      </Section>

      <Section title="Notifications" description="Get a call when the car records a new Sentry event, for example into a Home Assistant webhook.">
        <Field
          label="Webhook URL"
          hint="Receives a JSON POST with the event's time, place and reason. Skips events at home while their clean-up is on, except bumps. Leave empty to turn off."
        >
          <input value={draft.webhookUrl ?? ''} onChange={(e) => set({ webhookUrl: e.target.value || null })} placeholder="https://…" className={inputClass} />
        </Field>
      </Section>

      <div className="sticky bottom-20 z-10 flex items-center justify-end gap-3 rounded-card border border-line bg-raised/95 p-3 backdrop-blur lg:bottom-4">
        <span className={cx('mr-auto pl-2 text-[13px]', typeof state === 'object' ? 'text-accent-hover' : 'text-dim')}>
          {typeof state === 'object' ? state.error : state === 'saved' ? 'Saved.' : dirty ? 'You have unsaved changes.' : ''}
        </span>
        <Button variant="ghost" disabled={!dirty} onClick={() => settings.data && setDraft(settings.data)}>
          Reset
        </Button>
        <Button variant="primary" disabled={!dirty} busy={state === 'saving'} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  )
}

/** What the home rule covers with the values being edited, so nothing is trashed by surprise on save. */
function HomeCleanupPreview({ draft }: { draft: Settings }) {
  const preview = useQuery({
    queryKey: ['home-cleanup', draft.homeLat, draft.homeLon, draft.homeRadiusM, draft.homeCleanupDays],
    queryFn: () => api.homeCleanupPreview(draft),
  })
  const data = preview.data
  return (
    <p className="text-sm text-dim sm:col-span-2">
      {!data ? (
        'Counting home events…'
      ) : (
        <>
          {data.covered.toLocaleString()} Sentry {data.covered === 1 ? 'event was' : 'events were'} recorded here ({formatBytes(data.coveredBytes)}).
          {data.due > 0 && (
            <span className={cx(draft.homeCleanupEnabled && 'text-warn')}>
              {' '}
              {data.due.toLocaleString()} of them ({formatBytes(data.dueBytes)}) {data.due === 1 ? 'is' : 'are'} already older than{' '}
              {draft.homeCleanupDays} {draft.homeCleanupDays === 1 ? 'day' : 'days'}
              {draft.homeCleanupEnabled ? ' and move to the trash within an hour of saving.' : '.'}
            </span>
          )}
        </>
      )}
    </p>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-dim">{description}</p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2 [&>*:only-child]:sm:col-span-2">{children}</div>
    </Card>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 sm:col-span-2">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function NumberInput({ value, min, max, suffix, onChange }: { value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === '' ? min : Math.min(max, Math.max(min, Math.round(Number(e.target.value)))))}
        className={inputClass + (suffix ? ' pr-16' : '')}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-faint">{suffix}</span>}
    </div>
  )
}

function HourSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputClass}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </option>
      ))}
    </select>
  )
}

function Trash({ overview }: { overview: Overview }) {
  const queryClient = useQueryClient()
  const trash = useQuery({ queryKey: ['trash'], queryFn: api.trash })
  const [confirm, setConfirm] = useState<'empty' | { purge: number } | 'retention' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(180)
  const [types, setTypes] = useState<EventType[]>(['sentry'])
  const preview = useQuery({
    queryKey: ['retention', days, types],
    queryFn: () => api.retentionPreview(days, types),
    enabled: types.length > 0,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['trash'] })
    queryClient.invalidateQueries({ queryKey: ['overview'] })
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['facets'] })
    queryClient.invalidateQueries({ queryKey: ['retention'] })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-[15px] font-semibold">Trash</h2>
            <p className="mt-0.5 text-[13px] text-dim">
              {overview.trash.count === 0
                ? 'Deleted events wait here before they are removed for good.'
                : `${overview.trash.count} events · ${formatBytes(overview.trash.bytes)} · removed for good after ${overview.trash.retentionDays} days`}
            </p>
          </div>
          {overview.trash.count > 0 && (
            <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('empty')}>
              Empty trash
            </Button>
          )}
        </div>
        {error && <p className="border-b border-line px-4 py-3 text-sm text-accent-hover">{error}</p>}
        {trash.isPending ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : trash.data?.length === 0 ? (
          <p className="p-6 text-sm text-faint">The trash is empty.</p>
        ) : (
          <ul className="divide-y divide-line">
            {trash.data?.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <img src={thumbUrl(e.id)} alt="" className="aspect-4/3 w-16 shrink-0 rounded-md bg-raised object-cover" onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{eventTitle(e)}</p>
                  <p className="tabular truncate text-[13px] text-dim">
                    {formatDateTime(e.startTime)} · {formatBytes(e.sizeBytes)} · deleted {formatRelative(e.trashedAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  icon={<Undo2 className="size-4" />}
                  onClick={async () => {
                    setError(null)
                    try {
                      await api.restoreEvent(e.id)
                      refresh()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not restore')
                    }
                  }}
                >
                  Restore
                </Button>
                <IconButton label="Delete for good" onClick={() => setConfirm({ purge: e.id })}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="h-fit p-5">
        <h2 className="text-[15px] font-semibold">Clean up old events</h2>
        <p className="mt-1 text-sm text-dim">Moves old events to the trash. Favorites and anything in a collection are always kept.</p>
        <div className="mt-5 space-y-4">
          <Field label="Older than">
            <NumberInput value={days} min={1} max={3650} suffix="days" onChange={setDays} />
          </Field>
          <div>
            <span className="mb-2 block text-[13px] font-medium">Include</span>
            <div className="flex flex-wrap gap-2">
              {(['sentry', 'saved', 'recent'] as EventType[]).map((t) => (
                <button
                  key={t}
                  aria-pressed={types.includes(t)}
                  onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}
                  className={cx(
                    'h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors',
                    types.includes(t) ? 'border-fg bg-fg text-ink' : 'border-line text-dim hover:text-fg',
                  )}
                >
                  {t === 'sentry' ? 'Sentry' : t === 'saved' ? 'Saved' : 'Drives'}
                </button>
              ))}
            </div>
          </div>
          <p className="tabular rounded-lg bg-raised p-3 text-sm">
            {types.length === 0
              ? 'Choose at least one kind of event.'
              : preview.data
                ? preview.data.count === 0
                  ? 'Nothing matches.'
                  : `${preview.data.count.toLocaleString()} events, ${formatBytes(preview.data.bytes)}`
                : 'Counting…'}
          </p>
          <Button variant="danger" disabled={!preview.data?.count || types.length === 0} onClick={() => setConfirm('retention')} className="w-full">
            Move to trash
          </Button>
        </div>
      </Card>

      {confirm === 'empty' && (
        <ConfirmDialog
          title="Empty the trash?"
          message={`${overview.trash.count} events (${formatBytes(overview.trash.bytes)}) will be removed from disk. This can't be undone.`}
          confirmLabel="Delete for good"
          danger
          onConfirm={async () => {
            await api.emptyTrash()
            refresh()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm && typeof confirm === 'object' && (
        <ConfirmDialog
          title="Delete this event for good?"
          message="Its clips will be removed from disk. This can't be undone."
          confirmLabel="Delete for good"
          danger
          onConfirm={async () => {
            await api.purge(confirm.purge)
            refresh()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'retention' && preview.data && (
        <ConfirmDialog
          title={`Move ${preview.data.count.toLocaleString()} events to the trash?`}
          message={`That is ${formatBytes(preview.data.bytes)} of clips older than ${days} days. They stay restorable for ${overview.trash.retentionDays} days.`}
          confirmLabel="Move to trash"
          danger
          onConfirm={async () => {
            await api.retentionApply(days, types)
            refresh()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function Account() {
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle')
  const [signOut, setSignOut] = useState(false)

  async function change() {
    if (next !== repeat) {
      setState({ error: 'The two new passwords do not match.' })
      return
    }
    setState('saving')
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setRepeat('')
      setState('saved')
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : 'Something went wrong' })
    }
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Change password</h2>
        <form
          className="mt-5 grid gap-4 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault()
            change()
          }}
        >
          <Field label="Current password">
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Repeat new password">
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={inputClass} />
          </Field>
          {typeof state === 'object' && <p className="text-sm text-accent-hover">{state.error}</p>}
          {state === 'saved' && <p className="text-sm text-ok">Password changed.</p>}
          <Button type="submit" variant="primary" busy={state === 'saving'} disabled={!current || !next || !repeat} className="w-fit">
            Change password
          </Button>
        </form>
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-[15px] font-semibold">Sign out</h2>
          <p className="mt-1 text-sm text-dim">You'll need the password to get back in on this device.</p>
        </div>
        <Button icon={<LogOut className="size-4" />} onClick={() => setSignOut(true)}>
          Sign out
        </Button>
      </Card>
      {signOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need the password to view your clips again on this device."
          confirmLabel="Sign out"
          onConfirm={async () => {
            await api.logout()
            // Drop everything that was loaded while signed in, then show the login screen.
            queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
            await queryClient.refetchQueries({ queryKey: ['auth'] })
          }}
          onClose={() => setSignOut(false)}
        />
      )}
    </div>
  )
}
