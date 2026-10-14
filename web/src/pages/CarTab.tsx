import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpFromLine, Car, Check, Copy, ExternalLink, RefreshCw, Thermometer, Wifi, WifiOff, Zap } from 'lucide-react'
import { api, type Archiver, type ArchiverSync } from '../api'
import { cx, formatBytes, formatDateTime, formatDuration, formatRelative } from '../lib/format'
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
  if (flags & 0x4) problems.push({ text: 'Slowed down by heat right now', now: true })
  else if (flags & 0x40000) problems.push({ text: 'Was slowed down by heat at some point since it started', now: false })
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
      const saved = await api.saveSettings({ ...current, archiverUrl: url.trim() || null })
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
