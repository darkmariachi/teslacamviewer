import { useState, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Gauge, Lock, LockOpen, RefreshCw, Route, Shield, Snowflake, Thermometer, Download, Zap } from 'lucide-react'
import { api, carQuery, type CarDriveSummary, type CarNow, type CarStatus } from '../api'
import {
  cx,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatRelative,
  formatSpeed,
  formatTemperature,
  formatTime,
  formatTripDistance,
} from '../lib/format'
import { Button, Card, Spinner } from '../components/ui'
import CarGraphic from '../components/CarGraphic'
import { RouteMap } from '../components/RouteMap'

const CHARGING: Record<string, string> = {
  Disconnected: 'Unplugged',
  Charging: 'Charging',
  Starting: 'Starting to charge',
  Complete: 'Charged',
  Stopped: 'Plugged in, not charging',
  NoPower: 'Plugged in, no power',
  Calibrating: 'Calibrating',
}

const SENTRY: Record<string, string> = {
  Off: 'Sentry off',
  Idle: 'Sentry paused',
  Armed: 'Sentry armed',
  Aware: 'Sentry noticed someone',
  Panic: 'Sentry alarm',
  Quiet: 'Sentry quiet',
}

const MOVING: Record<string, string> = { D: 'Driving', R: 'Reversing', N: 'In neutral' }

/** The car at a glance: a drawing of it with tire pressures and anything open, and its battery and cabin. */
export default function CarPage() {
  const car = useQuery(carQuery)
  if (car.isPending) return <Spinner />
  const c = car.data
  if (!c?.configured || !c.now) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">Car</h1>
        <p className="mt-2 text-sm text-dim">
          {c?.configured
            ? 'No readings yet. They arrive the next time the car is home and car-logger answers.'
            : 'This page shows the car once car-logger runs on the teslausb Pi and its token is in Admin → Car.'}
        </p>
        <Link to="/admin?tab=car" className="mt-4 inline-block text-sm text-fg underline">
          Open Admin → Car
        </Link>
      </div>
    )
  }
  return <CarView status={c} now={c.now} />
}

function CarView({ status, now }: { status: CarStatus; now: CarNow }) {
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const { battery, closures, climate, tires, software, drive, body } = now
  // The body check is the freshest: it runs even while the car sleeps.
  const locked = body?.locked ?? closures?.locked ?? null
  const sentry = closures?.sentry ?? null
  const moving = drive?.gear ? MOVING[drive.gear] : undefined
  const open = closures?.open ?? []

  async function collect() {
    setSyncing(true)
    await api.carSync().catch(() => {})
    await queryClient.invalidateQueries({ queryKey: ['car'] })
    setSyncing(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Car</h1>
          <p className="mt-1 text-sm text-dim">
            Last reading {formatRelative(status.lastReading)}
            {status.lastReading && <span className="text-faint"> · {formatDateTime(status.lastReading)}</span>}
          </p>
          {!status.home && (
            <p className="mt-1 text-sm text-dim">
              The car is away{status.lastHome && ` (left ${formatRelative(status.lastHome)})`}. These are its last readings; car-logger keeps
              recording, and the rest arrive when it's back home.
            </p>
          )}
          {status.error && <p className="mt-1 text-sm text-warn">{status.error}</p>}
        </div>
        {status.home && (
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} busy={syncing} onClick={collect}>
            Collect now
          </Button>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden px-4 pt-6 pb-5 sm:px-8">
          <div className="flex flex-wrap justify-center gap-2">
            {locked != null && (
              <Chip tone={locked ? 'plain' : 'warn'} icon={locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}>
                {locked ? 'Locked' : 'Unlocked'}
              </Chip>
            )}
            {sentry && (
              <Chip tone={sentry === 'Armed' || sentry === 'Aware' ? 'accent' : 'plain'} icon={<Shield className="size-3.5" />}>
                {SENTRY[sentry] ?? sentry}
              </Chip>
            )}
            {moving && <Chip tone="ok" icon={<Gauge className="size-3.5" />}>{moving}</Chip>}
            {body?.asleep && <Chip tone="plain">Asleep</Chip>}
            {body?.userPresent && <Chip tone="plain">Someone inside</Chip>}
            {climate?.climateOn && <Chip tone="plain" icon={<Snowflake className="size-3.5" />}>Climate on</Chip>}
          </div>
          <div className="mt-2">
            <CarGraphic
              state={{
                tires,
                open,
                locked,
                sentryArmed: sentry === 'Armed' || sentry === 'Aware' || sentry === 'Panic',
                charging: battery?.charging ?? null,
                portOpen: battery?.portOpen ?? false,
              }}
            />
          </div>
          <p className={cx('mt-1 text-center text-sm', open.length || tires?.warnings.length ? 'text-warn' : 'text-dim')}>
            {statusLine(open, tires?.warnings ?? [])}
          </p>
          {tires?.at && <p className="mt-1 text-center text-[12px] text-faint">Tire pressures as of {formatRelative(tires.at)}</p>}
        </Card>

        <div className="space-y-5">
          <BatteryCard battery={battery} />
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={<Thermometer className="size-4" />} label="Cabin" value={climate?.insideC != null ? formatTemperature(climate.insideC) : '–'} />
            <Stat icon={<Thermometer className="size-4" />} label="Outside" value={climate?.outsideC != null ? formatTemperature(climate.outsideC) : '–'} />
            <Stat icon={<Gauge className="size-4" />} label="Odometer" value={drive?.odometerMiles != null ? formatDistance(drive.odometerMiles) : '–'} />
            <Stat icon={<Download className="size-4" />} label="Software" value={softwareText(software)} small />
          </div>
          <p className="text-[12px] text-faint">
            Collected from car-logger on the teslausb Pi while the car is home · {status.readings.toLocaleString()} readings
          </p>
        </div>
      </div>

      <Drives />

      {status.battery.length > 1 && <BatteryChart points={status.battery} />}
    </div>
  )
}

/** The last month of drives as a list, with the picked one's route on a map. */
function Drives() {
  const drives = useQuery({ queryKey: ['car', 'drives'], queryFn: () => api.carDrives(30) })
  const [picked, setPicked] = useState(0)
  const list = drives.data ?? []
  if (list.length === 0) return null
  const drive = list[Math.min(picked, list.length - 1)]
  const totalMiles = list.reduce((sum, d) => sum + (d.miles ?? 0), 0)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Route className="size-4 text-dim" /> Drives, last 30 days
        </h2>
        <span className="tabular text-[13px] text-dim">
          {list.length} {list.length === 1 ? 'drive' : 'drives'} · {formatTripDistance(totalMiles)}
        </span>
      </div>
      <div className="mt-4 grid border-t border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="max-h-[26rem] overflow-y-auto border-line lg:border-r">
          {list.map((d, i) => (
            <li key={d.start}>
              <DriveRow drive={d} active={d === drive} onPick={() => setPicked(i)} />
            </li>
          ))}
        </ul>
        {drive.route.length > 0 ? (
          <RouteMap route={drive.route} className="h-72 border-t border-line lg:h-auto lg:min-h-[26rem] lg:border-t-0" />
        ) : (
          <p className="flex h-40 items-center justify-center border-t border-line text-sm text-faint lg:h-auto lg:border-t-0">
            No GPS readings for this drive.
          </p>
        )}
      </div>
    </Card>
  )
}

function DriveRow({ drive: d, active, onPick }: { drive: CarDriveSummary; active: boolean; onPick: () => void }) {
  const seconds = (new Date(d.end).getTime() - new Date(d.start).getTime()) / 1000
  const used = d.batteryStart != null && d.batteryEnd != null ? d.batteryStart - d.batteryEnd : null
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cx(
        'block w-full border-b border-line px-5 py-3.5 text-left transition-colors last:border-b-0',
        active ? 'bg-raised' : 'hover:bg-raised/60',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium">
          {formatDate(d.start)}
          <span className="text-dim">
            {' '}
            · {formatTime(d.start)} – {formatTime(d.end)}
          </span>
        </span>
        <span className="tabular shrink-0 text-[14px] font-semibold">{d.miles != null ? formatTripDistance(d.miles) : '–'}</span>
      </div>
      {(d.from || d.to) && (
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-dim">
          <span className="truncate">{d.from ?? '?'}</span>
          {d.to && d.to !== d.from && (
            <>
              <ArrowRight className="size-3.5 shrink-0 text-faint" />
              <span className="truncate">{d.to}</span>
            </>
          )}
        </p>
      )}
      <p className="tabular mt-1 text-[12.5px] text-faint">
        {formatDuration(seconds)}
        {d.batteryStart != null && d.batteryEnd != null && (
          <>
            {' '}
            · Battery {d.batteryStart}% → {d.batteryEnd}%{used != null && used > 0 && ` (−${used}%)`}
          </>
        )}
        {d.maxSpeedMph != null && d.maxSpeedMph > 0 && <> · Top {formatSpeed(d.maxSpeedMph)}</>}
      </p>
    </button>
  )
}

function statusLine(open: string[], lowTires: string[]): string {
  const parts: string[] = []
  if (open.length) parts.push(`Open: ${open.join(', ')}`)
  if (lowTires.length) parts.push(`Low pressure: ${lowTires.join(', ')}`)
  return parts.length ? parts.join(' · ') : 'Everything closed · tire pressures normal'
}

function BatteryCard({ battery }: { battery: CarNow['battery'] }) {
  const level = battery?.level
  const charging = battery?.charging === 'Charging' || battery?.charging === 'Starting'
  return (
    <Card className="p-6">
      <p className="label flex items-center gap-1.5">
        <Zap className="size-4" /> Battery
      </p>
      {level != null ? (
        <>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-5xl font-semibold tracking-tight tabular">{level}%</span>
            {battery?.rangeMiles != null && <span className="text-xl font-medium text-dim">{formatDistance(battery.rangeMiles)}</span>}
          </div>
          <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-raised">
            <div
              className={cx('absolute inset-y-0 left-0 rounded-full transition-[width]', charging ? 'bg-ok' : level <= 20 ? 'bg-warn' : 'bg-fg')}
              style={{ width: `${level}%` }}
            />
            {battery?.limit != null && battery.limit < 100 && (
              <div className="absolute inset-y-0 w-0.5 bg-dim" style={{ left: `${battery.limit}%` }} title={`Charge limit ${battery.limit}%`} />
            )}
          </div>
          <div className="mt-2 flex justify-between text-[13px] text-dim">
            <span className={cx(charging && 'text-ok')}>{chargingText(battery!)}</span>
            {battery?.limit != null && <span>Limit {battery.limit}%</span>}
          </div>
          {battery?.at && <p className="mt-1 text-[12px] text-faint">As of {formatRelative(battery.at)}</p>}
        </>
      ) : (
        <p className="mt-3 text-3xl font-semibold text-faint">–</p>
      )}
    </Card>
  )
}

function chargingText(b: NonNullable<CarNow['battery']>): string {
  const state = b.charging ? (CHARGING[b.charging] ?? b.charging) : 'Charging state unknown'
  if (b.charging !== 'Charging') return b.portOpen && b.charging === 'Disconnected' ? `${state}, charge port open` : state
  const parts = [b.chargerPowerKw ? `${b.chargerPowerKw} kW` : null, b.rateMph ? `+${formatDistance(b.rateMph)}/h` : null]
  return [state, ...parts].filter(Boolean).join(' · ')
}

function softwareText(s: CarNow['software']): string {
  if (!s?.status) return '–'
  switch (s.status) {
    case 'Available':
      return s.version ? `${s.version} ready` : 'Update ready'
    case 'Scheduled':
      return 'Update scheduled'
    case 'Installing':
      return 'Installing'
    case 'Downloading':
    case 'DownloadingWifiWait':
      return 'Downloading'
    default:
      return 'Up to date'
  }
}

function Chip({ tone, icon, children }: { tone: 'plain' | 'warn' | 'accent' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium',
        tone === 'plain' && 'border-line bg-raised text-fg',
        tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        tone === 'accent' && 'border-accent/40 bg-accent-soft text-accent-hover',
        tone === 'ok' && 'border-ok/40 bg-ok/10 text-ok',
      )}
    >
      {icon}
      {children}
    </span>
  )
}

function Stat({ icon, label, value, small }: { icon: ReactNode; label: string; value: string; small?: boolean }) {
  return (
    <Card className="p-4">
      <p className="label flex items-center gap-1.5">
        {icon} {label}
      </p>
      <p className={cx('tabular mt-2 font-semibold tracking-tight', small ? 'text-base' : 'text-2xl')}>{value}</p>
    </Card>
  )
}

// Readings stop while the car sleeps; a gap longer than this is drawn as a break, not a straight line.
const GAP_MS = 3 * 60 * 60 * 1000

/** Battery level over the last two weeks on a real time axis, with a hover readout. */
export function BatteryChart({ points }: { points: CarStatus['battery'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const times = points.map((p) => new Date(p.at).getTime())
  const start = times[0]
  const span = Math.max(1, times[times.length - 1] - start)
  const x = (i: number) => ((times[i] - start) / span) * 100
  let d = ''
  points.forEach((p, i) => {
    const pt = `${x(i)} ${100 - p.level}`
    d += i > 0 && times[i] - times[i - 1] < GAP_MS ? `L${pt}` : `M${pt}L${pt}`
  })
  const shown = points[hover ?? points.length - 1]

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const target = start + ((e.clientX - box.left) / box.width) * span
    let best = 0
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - target) < Math.abs(times[best] - target)) best = i
    setHover(best)
  }

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Battery, last two weeks</h2>
        <span className="tabular text-[13px]">
          <span className="font-semibold text-fg">{shown.level}%</span>
          {shown.rangeMiles != null && <span className="ml-2 text-dim">{formatDistance(shown.rangeMiles)}</span>}
        </span>
      </div>
      <div className="relative mt-4" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-36 w-full overflow-visible rounded bg-raised/50" role="img" aria-label="Battery level over the last two weeks">
          {[25, 50, 75].map((y) => (
            <line key={y} x1={0} x2={100} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={d} fill="none" stroke="var(--color-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover != null && <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(hover)}%` }} />}
      </div>
      <div className="tabular mt-2 flex justify-between text-[12px] text-faint">
        <span>{formatDateTime(points[0].at)}</span>
        <span className={cx(hover != null && 'text-fg')}>{formatDateTime(shown.at)}</span>
      </div>
    </Card>
  )
}
