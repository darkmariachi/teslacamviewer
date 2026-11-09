import { useState, type MouseEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpFromLine, Car, Check, Copy, ExternalLink, RefreshCw, Thermometer, Wifi, WifiOff, Zap } from 'lucide-react'
import { api, type Archiver, type ArchiverLog, type ArchiverRun, type ArchiverSample, type ArchiverSync } from '../api'
import CarState from './CarState'
import { cx, formatBytes, formatDate, formatDateTime, formatDuration, formatRelative, formatTime } from '../lib/format'
import { Badge, Button, Card, Field, ProgressBar, Spinner, inputClass } from '../components/ui'

export const archiverQuery = { queryKey: ['archiver'], queryFn: api.archiver, refetchInterval: 15_000 } as const

const secondsBetween = (from: string, to: string | number) => (new Date(to).getTime() - new Date(from).getTime()) / 1000

/** Status of the teslausb device in the car: is it home, is it uploading, and how healthy is it. */
export default function CarTab() {
  const queryClient = useQueryClient()
  const archiver = useQuery(archiverQuery)
  const [syncState, setSyncState] = useState<'idle' | 'busy' | 'sent' | { error: string }>('idle')
  const [editing, setEditing] = useState(false)

  if (archiver.isPending) return <Spinner />
  if (!archiver.data) return <p className="text-sm text-accent-hover">Couldn't load the car's status.</p>
  const a = archiver.data
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['archiver'] })

  if (!a.configured || editing) {
    return <Setup archiver={a} onDone={() => { setEditing(false); refresh() }} canCancel={a.configured} />
  }

  const lastSync = a.syncs.find((s) => s.finishedAt)
  const status = a.status

  async function sync() {
    setSyncState('busy')
    try {
      await api.archiverSync()
      setSyncState('sent')
      refresh()
    } catch (e) {
      setSyncState({ error: e instanceof Error ? e.message : 'Something went wrong' })
    }
  }

  return (
    <div className="space-y-4">
      <CarState onSetUp={() => setEditing(true)} />

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className={cx('flex size-12 shrink-0 items-center justify-center rounded-full', a.online ? 'bg-ok/15 text-ok' : 'bg-raised text-dim')}>
          {a.online ? <Wifi className="size-6" /> : <WifiOff className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">
            {a.online ? 'Home and connected' : a.lastSeen ? 'Away' : 'Not seen yet'}
          </p>
          <p className="text-sm text-dim">
            {a.online && a.onlineSince
              ? `On the home network for ${formatDuration(secondsBetween(a.onlineSince, Date.now()))}${status?.wifiSsid ? ` · ${status.wifiSsid}` : ''}`
              : a.lastSeen
                ? `Last on the home network ${formatRelative(a.lastSeen)} (${formatDateTime(a.lastSeen)})`
                : `Waiting for ${a.url} to answer. It only responds while the car is in Wi-Fi range and awake.`}
          </p>
          {a.error && <p className="mt-1 text-sm text-warn">{a.error}</p>}
        </div>
        {a.warnings.length > 0 && (
          <ul className="w-full space-y-2 border-t border-line pt-4">
            {a.warnings.map((w) => (
              <li key={w.text} className={cx('flex items-start gap-2 text-sm', w.level === 'error' ? 'text-accent-hover' : 'text-warn')}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {w.text}
                  {w.detail && <span className="mt-0.5 block text-[13px] text-dim">{w.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {typeof syncState === 'object' && <span className="text-[13px] text-accent-hover">{syncState.error}</span>}
          {syncState === 'sent' && <span className="text-[13px] text-ok">Upload requested</span>}
          <Button icon={<ArrowUpFromLine className="size-4" />} disabled={!a.online} busy={syncState === 'busy'} onClick={sync}>
            Upload now
          </Button>
          <a href={a.url ?? '#'} target="_blank" rel="noreferrer">
            <Button variant="ghost" icon={<ExternalLink className="size-4" />}>
              teslausb
            </Button>
          </a>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={a.uploading ? 'Upload' : 'Last upload'}>
          {a.uploading ? (
            <>
              <p className="text-2xl font-semibold tracking-tight text-ok">In progress</p>
              <p className="mt-1 text-[13px] text-dim">
                {a.uploading.filesPlanned != null && `${a.uploading.filesPlanned} files`}
                {a.uploading.eventsPlanned ? `, ${a.uploading.eventsPlanned} events` : ''} · started {formatRelative(a.uploading.startedAt)}
              </p>
            </>
          ) : lastSync ? (
            <>
              <p className="text-2xl font-semibold tracking-tight">{formatRelative(lastSync.finishedAt)}</p>
              <p className="mt-1 text-[13px] text-dim">{syncSummary(lastSync)}</p>
            </>
          ) : a.log?.lastCopy?.startedAt ? (
            // Without the webhook, teslausb's log still says when clips were last copied.
            <>
              <p className="text-2xl font-semibold tracking-tight">{formatRelative(a.log.lastCopy.finishedAt ?? a.log.lastCopy.startedAt)}</p>
              <p className="mt-1 text-[13px] text-dim">{runSummary(a.log.lastCopy)}</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold tracking-tight text-faint">None yet</p>
              <p className="mt-1 text-[13px] text-dim">Uploads appear once teslausb's webhook is set.</p>
            </>
          )}
        </Tile>
        <Tile label="Newest footage">
          <p className="text-2xl font-semibold tracking-tight">{a.newestClip ? formatRelative(a.newestClip) : '–'}</p>
          <p className="mt-1 text-[13px] text-dim">{a.newestClip ? formatDateTime(a.newestClip) : 'The library is empty.'}</p>
        </Tile>
        <Tile label="Wi-Fi">
          {status?.wifiStrength != null ? (
            <>
              <p className="text-2xl font-semibold tracking-tight">{Math.round(status.wifiStrength * 100)}%</p>
              <div className="mt-2.5">
                <ProgressBar value={status.wifiStrength} tone={status.wifiStrength > 0.5 ? 'ok' : 'fg'} />
              </div>
              <p className="mt-2 truncate text-[13px] text-dim">{[status.wifiSsid, status.wifiIp].filter(Boolean).join(' · ')}</p>
            </>
          ) : (
            <p className="text-2xl font-semibold tracking-tight text-faint">–</p>
          )}
        </Tile>
        <Tile label="Drive in the car">
          {status?.totalBytes && status.freeBytes != null ? (
            <>
              <p className="text-2xl font-semibold tracking-tight">{formatBytes(status.freeBytes)} free</p>
              <div className="mt-2.5">
                <ProgressBar value={1 - status.freeBytes / status.totalBytes} />
              </div>
              <p className="mt-2 text-[13px] text-dim">
                of {formatBytes(status.totalBytes)}
                {status.snapshots != null && ` · ${status.snapshots} snapshots`}
              </p>
            </>
          ) : (
            <p className="text-2xl font-semibold tracking-tight text-faint">–</p>
          )}
        </Tile>
      </div>

      {status && <Health archiver={a} />}

      {(a.log || a.history.length > 1) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {a.log && <LogCard log={a.log} online={a.online} />}
          {a.history.length > 1 && <Trends history={a.history} />}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-5 py-4 text-[15px] font-semibold">Recent uploads</h2>
          {a.syncs.length === 0 ? (
            <p className="p-5 text-sm text-faint">No uploads recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {a.syncs.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="tabular font-medium">{formatDateTime(s.startedAt)}</p>
                    <p className="text-[13px] text-dim">{syncSummary(s)}</p>
                  </div>
                  {s.finishedAt ? <Badge tone="ok">DONE</Badge> : a.uploading?.id === s.id ? <Badge tone="blue">UPLOADING</Badge> : <Badge tone="warn">INTERRUPTED</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-5 py-4 text-[15px] font-semibold">Times at home</h2>
          {a.sessions.length === 0 ? (
            <p className="p-5 text-sm text-faint">The car has not been seen on the network yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {a.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="tabular font-medium">{formatDateTime(s.startedAt)}</p>
                    <p className="text-[13px] text-dim">
                      {s.open ? 'Still connected' : `Connected for ${formatDuration(Math.max(30, secondsBetween(s.startedAt, s.lastSeenAt)))}`}
                    </p>
                  </div>
                  {s.open && <Badge tone="ok">NOW</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <button onClick={() => setEditing(true)} className="text-[13px] text-dim hover:text-fg">
        Change the teslausb address or webhook
      </button>
    </div>
  )
}

function syncSummary(s: ArchiverSync): string {
  const files = s.filesArchived ?? s.filesPlanned
  const parts = [files != null ? `${files} files` : null, s.eventsPlanned ? `${s.eventsPlanned} events` : null]
  if (s.finishedAt) parts.push(`took ${formatDuration(Math.max(1, secondsBetween(s.startedAt, s.finishedAt)))}`)
  return parts.filter(Boolean).join(' · ') || 'No details reported'
}

function runSummary(r: ArchiverRun): string {
  const events = r.eventFolders ? ` from ${r.eventFolders} ${r.eventFolders === 1 ? 'event' : 'events'}` : ''
  switch (r.outcome) {
    case 'running':
      return r.files != null ? `Copying ${r.files} files${events}` : 'Checking for new clips'
    case 'nothing':
      return 'No new clips to copy'
    case 'done':
      return `Copied ${r.archived ?? r.files ?? 0} files${events}`
    case 'error':
      return `Stopped after ${r.archived ?? 0} of ${r.files ?? '?'} files`
    case 'noArchive':
      return "Skipped: couldn't connect to the archive share"
  }
}

const STATE_TEXT: Record<NonNullable<ArchiverLog['state']>, string> = {
  starting: 'Starting up',
  waitingForArchive: 'Looking for the archive share',
  reachable: 'Connected, waiting for the car to stop writing',
  archiving: 'Copying clips',
  done: 'Finished, waiting for the car to leave',
}

/** What teslausb wrote in its own log: the latest pass, and the latest one that actually copied clips. */
function LogCard({ log, online }: { log: ArchiverLog; online: boolean }) {
  const runs = [
    { label: 'Latest check', run: log.lastRun },
    // Only worth a second row when the latest check found nothing to copy.
    ...(log.lastCopy && log.lastCopy !== log.lastRun && log.lastCopy.startedAt !== log.lastRun?.startedAt ? [{ label: 'Last copy', run: log.lastCopy }] : []),
  ]
  const problems = online && log.state === 'waitingForArchive' ? log.waitProblems : (log.lastRun?.problems ?? [])
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">teslausb's log</h2>
      <p className="mt-0.5 text-[13px] text-dim">
        {online && log.state ? `${STATE_TEXT[log.state]}${log.stateSince ? ` since ${formatTime(log.stateSince)}` : ''}.` : 'As of the last visit home.'} Times are from the
        device's own clock.
      </p>
      <dl className="mt-4 space-y-3">
        {runs.map(({ label, run }) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="label shrink-0">{label}</dt>
            <dd className="min-w-0 text-right">
              {run ? (
                <>
                  <span className={cx('font-medium', run.outcome === 'error' || run.outcome === 'noArchive' ? 'text-warn' : '')}>{runSummary(run)}</span>
                  {run.startedAt && <span className="tabular block text-[13px] text-dim">{formatDateTime(run.startedAt)}</span>}
                </>
              ) : (
                <span className="text-faint">Nothing in the recent log</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {problems.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-line pt-3 font-mono text-[12px] text-dim">
          {problems.map((p) => (
            <li key={p} className="break-words">
              {p}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// Visits home are drawn side by side with the time away left out; otherwise a few hours home a day would be slivers.
const VISIT_GAP = 6

const TRENDS: { label: string; value: (s: ArchiverSample) => number | null; format: (v: number) => string; domain: (lo: number, hi: number) => [number, number] }[] = [
  { label: 'Temperature', value: (s) => s.cpuTempC, format: (v) => `${v.toFixed(0)} °C`, domain: (lo, hi) => [Math.min(lo, 40) - 2, Math.max(hi, 70) + 2] },
  { label: 'Supply', value: (s) => s.supplyVolts, format: (v) => `${v.toFixed(2)} V`, domain: (lo, hi) => [Math.min(lo, 4.7), Math.max(hi, 5.2)] },
  { label: 'Wi-Fi', value: (s) => s.wifiStrength, format: (v) => `${Math.round(v * 100)}%`, domain: () => [0, 1] },
]

/** Two weeks of health readings as three small line charts that share one hover position. */
function Trends({ history }: { history: ArchiverSample[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const xs: number[] = []
  let x = 0
  history.forEach((s, i) => {
    if (i > 0) x += s.sessionId === history[i - 1].sessionId ? 1 : VISIT_GAP
    xs.push(x)
  })
  const width = Math.max(1, x)
  const visits = new Set(history.map((s) => s.sessionId)).size
  const shown = hover ?? history.length - 1

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const target = ((e.clientX - box.left) / box.width) * width
    let best = 0
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - target) < Math.abs(xs[best] - target)) best = i
    setHover(best)
  }

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">Trends</h2>
      <p className="mt-0.5 text-[13px] text-dim">
        {visits} {visits === 1 ? 'visit' : 'visits'} home in the last two weeks, side by side. Time away is left out.
      </p>
      <div className="relative mt-4 space-y-4" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {TRENDS.map((t) => {
          const values = history.map(t.value)
          const known = values.filter((v): v is number => v != null)
          if (known.length === 0) return null
          const [lo, hi] = t.domain(Math.min(...known), Math.max(...known))
          let d = ''
          values.forEach((v, i) => {
            if (v == null) return
            const joined = i > 0 && values[i - 1] != null && history[i].sessionId === history[i - 1].sessionId
            const point = `${(xs[i] / width) * 100} ${100 - ((v - lo) / (hi - lo)) * 100}`
            // A zero-length segment at each start draws a dot, so a visit with a single reading still shows.
            d += joined ? `L${point}` : `M${point}L${point}`
          })
          const current = values[shown]
          return (
            <div key={t.label}>
              <div className="mb-1 flex items-baseline justify-between text-[13px]">
                <span className="label">{t.label}</span>
                <span className="tabular">
                  <span className="font-semibold text-fg">{current != null ? t.format(current) : '–'}</span>
                  <span className="ml-2 text-faint">
                    {t.format(Math.min(...known))} – {t.format(Math.max(...known))}
                  </span>
                </span>
              </div>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-14 w-full overflow-visible rounded bg-raised/50" role="img" aria-label={`${t.label} over recent visits`}>
                <path d={d} fill="none" stroke="var(--color-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )
        })}
        {hover != null && (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${(xs[hover] / width) * 100}%` }} />
        )}
      </div>
      <div className="tabular mt-2 flex justify-between text-[12px] text-faint">
        <span>{formatDate(history[0].at)}</span>
        <span className={cx(hover != null && 'text-fg')}>{formatDateTime(history[shown].at)}</span>
      </div>
    </Card>
  )
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="label mb-2">{label}</p>
      {children}
    </Card>
  )
}

/** The Raspberry Pi firmware reports power and heat problems as bit flags; turn them into plain statements. */
function Health({ archiver }: { archiver: Archiver }) {
  const s = archiver.status!
  const flags = s.throttled ?? 0
  const problems: { text: string; now: boolean }[] = []
  if (flags & 0x1) problems.push({ text: 'Not getting enough power right now', now: true })
  else if (flags & 0x10000) problems.push({ text: 'Power dipped too low at some point since it started', now: false })
  // Throttling (0x4) can come from low power or heat; the soft temperature limit (0x8) is the heat-only flag.
  if (flags & 0x8) problems.push({ text: 'Slowed down by heat right now', now: true })
  else if (flags & 0x80000) problems.push({ text: 'Was slowed down by heat at some point since it started', now: false })
  else if (flags & 0x4) problems.push({ text: 'Running slowed down right now to protect itself', now: true })
  else if (flags & 0x40000) problems.push({ text: 'Slowed itself down at some point since it started', now: false })
  const hot = s.cpuTempC != null && s.cpuTempC >= 80

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">Device health</h2>
      <p className="mt-0.5 text-[13px] text-dim">{archiver.online ? 'Live readings.' : `As of ${formatRelative(archiver.lastSeen)}, when the car was last home.`}</p>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Reading icon={<Thermometer className="size-4" />} label="Temperature" value={s.cpuTempC != null ? `${s.cpuTempC.toFixed(0)} °C` : '–'} warn={hot} />
        <Reading icon={<Zap className="size-4" />} label="Supply" value={s.supplyVolts != null ? `${s.supplyVolts.toFixed(2)} V` : flags & 0x1 ? 'Low' : 'OK'} warn={!!(flags & 0x1)} />
        <Reading icon={<RefreshCw className="size-4" />} label="Running for" value={s.uptimeSec != null ? formatDuration(s.uptimeSec) : '–'} />
        <Reading icon={<Car className="size-4" />} label="Dashcam drive" value={s.drivesActive == null ? '–' : s.drivesActive ? 'Recording' : 'Detached to upload'} />
      </dl>
      {(problems.length > 0 || hot) && (
        <ul className="mt-5 space-y-2 border-t border-line pt-4">
          {hot && (
            <li className="flex items-start gap-2 text-sm text-warn">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Running hot. A heatsink case or a fan would help.
            </li>
          )}
          {problems.map((p) => (
            <li key={p.text} className={cx('flex items-start gap-2 text-sm', p.now ? 'text-accent-hover' : 'text-warn')}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {p.text}.
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Reading({ icon, label, value, warn }: { icon: ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="label flex items-center gap-1.5">
        {icon} {label}
      </dt>
      <dd className={cx('tabular mt-1.5 text-lg font-semibold', warn && 'text-warn')}>{value}</dd>
    </div>
  )
}

function Setup({ archiver, onDone, canCancel }: { archiver: Archiver; onDone: () => void; canCancel: boolean }) {
  const [url, setUrl] = useState(archiver.url ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const hookUrl = `${window.location.origin}${archiver.hookPath}`
  const snippet = `export WEBHOOK_ENABLED=true\nexport WEBHOOK_URL=${hookUrl}`

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const current = await api.settings()
      const saved = await api.saveSettings({ ...current, archiverUrl: url.trim() || null, carLoggerToken: token?.trim() ? token.trim() : current.carLoggerToken })
      if (url.trim() && !saved.archiverUrl) throw new Error("That doesn't look like an address. Try something like http://teslausb.local")
      await api.archiverPoll().catch(() => {})
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">1. Where is teslausb?</h2>
        <p className="mt-1 text-sm text-dim">
          The address of the teslausb web page on your home network. This app checks it every 30 seconds; whenever it answers, the car is home.
        </p>
        <div className="mt-4">
          <Field label="teslausb address" hint="A host name or IP address. Leave empty to turn this feature off.">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://teslausb.local" className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">2. Tell teslausb to report uploads</h2>
        <p className="mt-1 text-sm text-dim">
          Add these two lines to <code className="rounded bg-raised px-1 py-0.5 text-[13px]">teslausb_setup_variables.conf</code> on the device, then
          run its setup again. teslausb will then announce each upload as it starts and finishes.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-ink p-4 font-mono text-[12px] leading-relaxed text-dim">{snippet}</pre>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            onClick={async () => {
              await navigator.clipboard.writeText(snippet)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <p className="text-xs text-faint">
            The address must be one the car can reach from your Wi-Fi. If you opened this page through a public domain, swap in the server's local address.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">3. Car state (optional)</h2>
        <p className="mt-1 text-sm text-dim">
          If car-logger runs on the teslausb Pi, paste the token it created (<code className="rounded bg-raised px-1 py-0.5 text-[13px]">/mutable/tesla/sync-token</code>
          ). The app then collects the car's battery, charging, locks and tire pressures whenever the car is home.
        </p>
        <div className="mt-4">
          <Field label="car-logger token" hint="Leave empty to keep the current one.">
            <input
              value={token ?? ''}
              onChange={(e) => setToken(e.target.value)}
              placeholder={archiver.configured ? 'Unchanged' : ''}
              className={cx(inputClass, 'font-mono')}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
      </Card>

      {error && <p className="text-sm text-accent-hover">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" busy={busy} onClick={save}>
          Save
        </Button>
        {canCancel && (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
