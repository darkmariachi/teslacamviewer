import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, ExternalLink, FolderPlus, LayoutGrid, MapPin, MoreHorizontal,
  RefreshCw, Scissors, Star, Trash2, X,
} from 'lucide-react'
import { api, type EventDetail, type Job } from '../api'
import {
  cameraLabel, cameraShort, cx, eventTitle, formatBytes, formatClock, formatDay, formatDuration, formatTime, reasonLabel, TYPE_LABEL,
} from '../lib/format'
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Menu, MenuItem, ProgressBar, Spinner, inputClass } from '../components/ui'
import { Player } from '../components/Player'
import { MiniMap } from '../components/MiniMap'
import { CollectionPicker } from '../components/CollectionPicker'

const isActive = (job?: Job) => job?.status === 'queued' || job?.status === 'running'

export default function EventPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [range, setRange] = useState<[number, number] | null>(null)
  const [exportCamera, setExportCamera] = useState('grid')
  const [dialog, setDialog] = useState<'collect' | 'trash' | { segment: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['event', id],
    queryFn: () => api.event(id),
    // Keep the page fresh while something is being processed for this event.
    refetchInterval: (q) => (q.state.data && [...q.state.data.jobs, ...q.state.data.exports].some(isActive) ? 1500 : false),
  })
  const detail = query.data

  useEffect(() => {
    setRange(null)
    setActionError(null)
  }, [id])

  if (query.isPending) {
    return (
      <div className="flex h-[60dvh] items-center justify-center">
        <Spinner className="size-7" />
      </div>
    )
  }
  if (!detail) {
    return (
      <EmptyState icon={<AlertTriangle className="size-6" />} title="Event not found">
        It may have been deleted. <Link to="/" className="text-fg underline">Back to events</Link>
      </EmptyState>
    )
  }

  const { summary } = detail
  const job = (kind: Job['kind']) => detail.jobs.find((j) => j.kind === kind)
  const previewJob = job('preview')
  const transcodeJob = job('transcode')
  const unplayable = detail.segments.flatMap((s) => s.files).filter((f) => !f.playable)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['event', id] })
  const setDetail = (patch: (d: EventDetail) => EventDetail) => queryClient.setQueryData<EventDetail>(['event', id], (d) => d && patch(d))

  async function run(action: () => Promise<unknown>) {
    setActionError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  async function toggleFavorite() {
    const favorite = !summary.favorite
    setDetail((d) => ({ ...d, summary: { ...d.summary, favorite } }))
    await run(() => api.patchEvent(id, { favorite }))
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['facets'] })
  }

  return (
    <div className="rise">
      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          Back
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Newer event" disabled={!detail.newerId} onClick={() => navigate(`/events/${detail.newerId}`, { replace: true })} className="disabled:opacity-30">
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label="Older event" disabled={!detail.olderId} onClick={() => navigate(`/events/${detail.olderId}`, { replace: true })} className="disabled:opacity-30">
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Player
            key={id}
            detail={detail}
            previewJob={previewJob}
            onGeneratePreview={() => run(() => api.process(id, 'preview'))}
            range={range}
            onRangeChange={setRange}
          />

          {unplayable.length > 0 && (
            <Card className="flex flex-wrap items-center gap-3 border-warn/40 bg-warn/5 p-4">
              <AlertTriangle className="size-5 shrink-0 text-warn" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {unplayable.length} {unplayable.length === 1 ? 'clip uses' : 'clips use'} {(unplayable[0].codec ?? 'a format').toUpperCase()}, which some browsers can't play.
                </p>
                {isActive(transcodeJob) ? (
                  <div className="mt-2 max-w-xs">
                    <ProgressBar value={transcodeJob!.progress} />
                  </div>
                ) : (
                  <p className="text-dim">Make compatible copies to play them anywhere. The originals stay untouched.</p>
                )}
              </div>
              {!isActive(transcodeJob) && (
                <Button size="sm" onClick={() => run(() => api.process(id, 'transcode'))}>
                  Make compatible copies
                </Button>
              )}
            </Card>
          )}

          {range && (
            <Card className="rise flex flex-wrap items-center gap-3 border-blue/50 p-4">
              <Scissors className="size-5 shrink-0 text-blue" />
              <div className="tabular min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  Clip {formatClock(range[0])} – {formatClock(range[1])} <span className="font-normal text-dim">({formatDuration(range[1] - range[0])})</span>
                </p>
                <p className="text-dim">Drag the blue handles on the timeline to adjust.</p>
              </div>
              <select value={exportCamera} onChange={(e) => setExportCamera(e.target.value)} className={inputClass + ' !w-auto'} aria-label="Camera to export">
                <option value="grid">All cameras (grid)</option>
                {summary.cameras.map((c) => (
                  <option key={c} value={c}>
                    {cameraLabel(c)}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                icon={<Download className="size-4" />}
                onClick={() =>
                  run(async () => {
                    await api.exportClip(id, exportCamera, range[0], range[1])
                    setRange(null)
                  })
                }
              >
                Export
              </Button>
            </Card>
          )}

          {actionError && <p className="text-sm text-accent-hover">{actionError}</p>}

          {detail.exports.length > 0 && (
            <Card className="p-4">
              <h3 className="label mb-3">Exported clips</h3>
              <ul className="divide-y divide-line">
                {detail.exports.map((e) => (
                  <ExportRow key={e.id} job={e} />
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-hidden">
            <details>
              <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 text-sm font-medium select-none hover:bg-raised">
                Original files
                <span className="text-[13px] font-normal text-dim">
                  {summary.segmentCount} {summary.segmentCount === 1 ? 'segment' : 'segments'} · {formatBytes(summary.sizeBytes)}
                </span>
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {detail.segments.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
                    <span className="tabular w-28 font-medium">{formatTime(s.startTime, true)}</span>
                    <span className="tabular w-12 text-dim">{formatClock(s.durationSec)}</span>
                    <span className="flex flex-1 flex-wrap gap-1.5">
                      {s.files.map((f) => (
                        <a
                          key={f.id}
                          href={`${f.url}?download=true`}
                          title={`Download ${cameraLabel(f.camera)} (${formatBytes(f.sizeBytes)})`}
                          className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-medium text-dim transition-colors hover:border-line-strong hover:text-fg"
                        >
                          <Download className="size-3" />
                          {cameraShort(f.camera)}
                        </a>
                      ))}
                    </span>
                    {detail.segments.length > 1 && (
                      <IconButton label="Delete this segment" className="size-7" onClick={() => setDialog({ segment: s.id })}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Badge tone={summary.type === 'sentry' ? 'accent' : summary.type === 'saved' ? 'neutral' : 'blue'}>{TYPE_LABEL[summary.type].toUpperCase()}</Badge>
                  {summary.hasPreview && <Badge tone="ok">MERGED</Badge>}
                </div>
                <h1 className="text-xl leading-tight font-semibold">{eventTitle(summary)}</h1>
                <p className="mt-1.5 text-sm text-dim">{formatDay(summary.triggerTime ?? summary.startTime)}</p>
                <p className="tabular text-sm text-dim">
                  {formatTime(summary.startTime)} – {formatTime(summary.endTime)}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <IconButton label={summary.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={toggleFavorite} className={summary.favorite ? '!text-warn' : ''}>
                  <Star className="size-5" fill={summary.favorite ? 'currentColor' : 'none'} />
                </IconButton>
                <Menu
                  trigger={(_, toggle) => (
                    <IconButton label="More actions" onClick={toggle}>
                      <MoreHorizontal className="size-5" />
                    </IconButton>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem icon={<FolderPlus className="size-4" />} onClick={() => { close(); setDialog('collect') }}>
                        Add to collection
                      </MenuItem>
                      <MenuItem icon={<RefreshCw className="size-4" />} onClick={() => { close(); run(() => api.process(id, 'thumbnail')) }}>
                        Refresh thumbnail
                      </MenuItem>
                      <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => { close(); setDialog('trash') }}>
                        Delete event
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
              <Fact label="Length" value={formatDuration(summary.durationSec)} />
              <Fact label="Cameras" value={String(summary.cameras.length)} />
              <Fact label="Size" value={formatBytes(summary.sizeBytes)} />
            </dl>
            {summary.reason && reasonLabel(summary.reason) !== summary.reason && (
              <p className="mt-3 truncate font-mono text-[11px] text-faint" title="Tesla's reason code">
                {summary.reason}
              </p>
            )}
          </Card>

          {summary.lat != null && summary.lon != null && (
            <Card className="overflow-hidden">
              <MiniMap lat={summary.lat} lon={summary.lon} className="h-44 w-full" />
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="flex min-w-0 items-center gap-1.5 text-sm">
                  <MapPin className="size-4 shrink-0 text-accent-hover" />
                  <span className="truncate">{summary.city ?? 'Unknown place'}</span>
                </p>
                <div className="flex shrink-0 gap-3 text-[13px] text-dim">
                  <Link to={`/map?focus=${id}`} className="hover:text-fg">
                    All events
                  </Link>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${summary.lat},${summary.lon}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-fg"
                  >
                    Maps <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="label mb-3">Merged video</h3>
            {detail.preview ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-dim">
                  All cameras in one file · {formatBytes(detail.preview.sizeBytes)}
                </p>
                <a href={`${detail.preview.url}?download=true`}>
                  <Button size="sm" icon={<Download className="size-4" />}>
                    Download
                  </Button>
                </a>
              </div>
            ) : isActive(previewJob) ? (
              <div className="space-y-2">
                <p className="text-sm text-dim">{previewJob!.status === 'running' ? `Merging… ${Math.round(previewJob!.progress * 100)}%` : 'Waiting in the queue…'}</p>
                <ProgressBar value={previewJob!.progress} />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-dim">Combine every camera into a single video for phones and sharing.</p>
                {previewJob?.status === 'failed' && <p className="text-sm text-accent-hover">The last attempt failed: {previewJob.error?.slice(0, 160)}</p>}
                <Button size="sm" icon={<LayoutGrid className="size-4" />} onClick={() => run(() => api.process(id, 'preview'))}>
                  Create merged video
                </Button>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="label">Collections</h3>
              <button onClick={() => setDialog('collect')} className="text-[13px] text-dim hover:text-fg">
                Add
              </button>
            </div>
            {detail.collections.length === 0 ? (
              <p className="text-sm text-faint">Not in any collection.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.collections.map((c) => (
                  <span key={c.id} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-raised pr-1 pl-3 text-[13px]">
                    <Link to={`/collections/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                    <button
                      aria-label={`Remove from ${c.name}`}
                      onClick={() => run(() => api.removeFromCollection(c.id, id))}
                      className="flex size-5 items-center justify-center rounded-full text-faint hover:bg-hover hover:text-fg"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Notes key={id} id={id} initial={detail.notes ?? ''} />
        </aside>
      </div>

      {dialog === 'collect' && (
        <CollectionPicker
          current={detail.collections.map((c) => c.id)}
          onPick={(collectionId, isMember) => (isMember ? api.removeFromCollection(collectionId, id) : api.addToCollection(collectionId, id))}
          onClose={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
      {dialog === 'trash' && (
        <ConfirmDialog
          title="Delete this event?"
          message="The clips move to the trash and can be restored from the Admin page until the trash is emptied."
          confirmLabel="Move to trash"
          danger
          onConfirm={async () => {
            await api.trashEvent(id)
            queryClient.invalidateQueries({ queryKey: ['events'] })
            queryClient.invalidateQueries({ queryKey: ['facets'] })
            navigate(detail.olderId ? `/events/${detail.olderId}` : '/', { replace: true })
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog && typeof dialog === 'object' && (
        <ConfirmDialog
          title="Delete this segment?"
          message="Every camera's file for this minute moves to the trash folder. The rest of the event stays, and its merged video is rebuilt when needed."
          confirmLabel="Delete segment"
          danger
          onConfirm={async () => {
            await api.trashSegment(id, dialog.segment)
            // The event is reindexed in the background; give it a moment before reloading.
            await new Promise((r) => setTimeout(r, 1500))
            await refresh()
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tabular mt-1 font-medium">{value}</dd>
    </div>
  )
}

function ExportRow({ job }: { job: Job }) {
  const args = job.args ? (JSON.parse(job.args) as { camera: string; start: number; end: number }) : null
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <div className="tabular min-w-0 flex-1">
        <p className="font-medium">
          {args ? `${cameraLabel(args.camera)} · ${formatClock(args.start)} – ${formatClock(args.end)}` : `Export ${job.id}`}
        </p>
        {job.status === 'running' && (
          <div className="mt-1.5 max-w-52">
            <ProgressBar value={job.progress} />
          </div>
        )}
        {job.status === 'queued' && <p className="text-[13px] text-dim">Waiting in the queue…</p>}
        {job.status === 'failed' && <p className="truncate text-[13px] text-accent-hover">{job.error}</p>}
        {job.status === 'done' && job.outputSizeBytes != null && <p className="text-[13px] text-dim">{formatBytes(job.outputSizeBytes)}</p>}
      </div>
      {job.status === 'done' && (
        <a href={`/api/media/export/${job.id}`}>
          <Button size="sm" icon={<Download className="size-4" />}>
            Download
          </Button>
        </a>
      )}
    </li>
  )
}

function Notes({ id, initial }: { id: number; initial: string }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function save() {
    if (value === saved) return
    setState('saving')
    try {
      await api.patchEvent(id, { notes: value })
      setSaved(value)
      setState('saved')
      queryClient.invalidateQueries({ queryKey: ['events'] })
    } catch {
      setState('error')
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="label">Notes</h3>
        <span className={cx('text-xs', state === 'error' ? 'text-accent-hover' : 'text-faint')}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? "Couldn't save" : ''}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        rows={3}
        placeholder="What happened here?"
        className={inputClass + ' h-auto resize-y py-2.5 leading-relaxed'}
      />
    </Card>
  )
}
