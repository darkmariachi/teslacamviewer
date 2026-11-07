import { useState, type MouseEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BatteryCharging, Car, DoorOpen, Lock, LockOpen, RefreshCw, Thermometer } from 'lucide-react'
import { api, type CarNow, type CarStatus } from '../api'
import { cx, formatDateTime, formatDistance, formatPressure, formatRelative, formatTemperature } from '../lib/format'
import { Button, Card, ProgressBar } from '../components/ui'

const carQuery = { queryKey: ['car'], queryFn: api.car, refetchInterval: 30_000 } as const

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

const GEAR: Record<string, string> = { P: 'Parked', D: 'Driving', R: 'Reversing', N: 'In neutral', Invalid: 'Parked', SNA: 'Parked' }

/**
 * The car's own state, collected from car-logger on the teslausb Pi. Shown above the teslausb details on
 * the Car tab; when car-logger isn't set up, a short note says what it would add.
 */
export default function CarState({ onSetUp }: { onSetUp: () => void }) {
  const car = useQuery(carQuery)
  if (!car.data) return null
  const c = car.data
  if (!c.configured) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <Car className="size-6 shrink-0 text-dim" />
        <p className="min-w-0 flex-1 text-sm text-dim">
          With car-logger on the teslausb Pi, this tab also shows the car's battery, charging, locks, doors and tire pressures. See{' '}
          <a href="/help#car-logger" className="text-fg underline">
            Help
          </a>
          .
        </p>
        <Button size="sm" onClick={onSetUp}>
          Add the token
        </Button>
      </Card>
    )
  }
  if (!c.now) {
    return (
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">The car</h2>
        <p className="mt-1 text-sm text-dim">No readings yet. They arrive the next time the car is home and car-logger answers at {c.url}.</p>
        {c.error && <p className="mt-2 text-sm text-warn">{c.error}</p>}
      </Card>
    )
  }
  return <CarPanel status={c} now={c.now} />
}

function CarPanel({ status, now }: { status: CarStatus; now: CarNow }) {
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const { battery, closures, climate, tires, software, drive, body } = now
  // The body check is the freshest: it runs even while the car sleeps.
  const locked = body?.locked ?? closures?.locked
  const summary = [
    locked == null ? null : locked ? 'Locked' : 'Unlocked',
    closures?.sentry ? SENTRY[closures.sentry] : null,
    body?.asleep ? 'Asleep' : null,
    body?.userPresent ? 'Someone inside' : null,
    drive?.gear && drive.gear !== 'P' && drive.gear !== 'Invalid' && drive.gear !== 'SNA' ? GEAR[drive.gear] : null,
  ].filter(Boolean)

  async function collect() {
    setSyncing(true)
    await api.carSync().catch(() => {})
    await queryClient.invalidateQueries({ queryKey: ['car'] })
    setSyncing(false)
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className={cx('flex size-12 shrink-0 items-center justify-center rounded-full', locked === false ? 'bg-warn/15 text-warn' : 'bg-raised text-dim')}>
          {locked === false ? <LockOpen className="size-6" /> : <Lock className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{summary.join(' · ') || 'The car'}</p>
          <p className="text-sm text-dim">
            Last reading {formatRelative(status.lastReading)}
            {status.lastReading && ` (${formatDateTime(status.lastReading)})`}. Collected from car-logger while the car is home.
          </p>
          {status.error && <p className="mt-1 text-sm text-warn">{status.error}</p>}
        </div>
        <Button variant="ghost" icon={<RefreshCw className="size-4" />} busy={syncing} onClick={collect}>
          Collect now
        </Button>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Battery" icon={<BatteryCharging className="size-4" />}>
          {battery?.level != null ? (
            <>
              <p className="text-2xl font-semibold tracking-tight">{battery.level}%</p>
              <div className="mt-2.5">
                <ProgressBar value={battery.level / 100} tone={battery.charging === 'Charging' ? 'ok' : 'fg'} />
              </div>
              <p className="mt-2 text-[13px] text-dim">
                {[battery.rangeMiles != null ? formatDistance(battery.rangeMiles) : null, battery.limit != null ? `limit ${battery.limit}%` : null].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-[13px] text-dim">{chargingText(battery)}</p>
            </>
          ) : (
            <Empty />
          )}
        </Tile>
        <Tile label="Doors and windows" icon={<DoorOpen className="size-4" />}>
          {closures ? (
            <>
              <p className={cx('text-2xl font-semibold tracking-tight', closures.open.length > 0 && 'text-warn')}>
                {closures.open.length === 0 ? 'All closed' : `${closures.open.length} open`}
              </p>
              <p className="mt-1 text-[13px] text-dim">{closures.open.length > 0 ? sentenceCase(closures.open.join(', ')) : 'Doors, windows, trunk and frunk'}</p>
              <p className="mt-1 text-[13px] text-faint">As of {formatRelative(closures.at)}</p>
            </>
          ) : (
            <Empty />
          )}
        </Tile>
        <Tile label="Tires" icon={<AlertTriangle className="size-4" />}>
          {tires ? (
            <>
              <div className="tabular grid grid-cols-2 gap-x-4 gap-y-1 text-lg font-semibold">
                <Pressure bar={tires.frontLeft} low={tires.warnings.includes('front left')} />
                <Pressure bar={tires.frontRight} low={tires.warnings.includes('front right')} />
                <Pressure bar={tires.rearLeft} low={tires.warnings.includes('rear left')} />
                <Pressure bar={tires.rearRight} low={tires.warnings.includes('rear right')} />
              </div>
              <p className={cx('mt-2 text-[13px]', tires.warnings.length > 0 ? 'text-warn' : 'text-dim')}>
                {tires.warnings.length > 0 ? `Low: ${tires.warnings.join(', ')}` : 'No warnings'}
              </p>
              <p className="mt-1 text-[13px] text-faint">As of {formatRelative(tires.at)}</p>
            </>
          ) : (
            <Empty />
          )}
        </Tile>
        <Tile label="Cabin" icon={<Thermometer className="size-4" />}>
          {climate?.insideC != null ? (
            <>
              <p className="text-2xl font-semibold tracking-tight">{formatTemperature(climate.insideC)}</p>
              <p className="mt-1 text-[13px] text-dim">
                {climate.outsideC != null && `${formatTemperature(climate.outsideC)} outside · `}
                {climate.climateOn ? 'Climate on' : 'Climate off'}
              </p>
              <p className="mt-1 text-[13px] text-faint">As of {formatRelative(climate.at)}</p>
            </>
          ) : (
            <Empty />
          )}
        </Tile>
      </div>

      <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
        {status.battery.length > 1 && <BatteryChart points={status.battery} />}
        <Card className="space-y-3 p-5 text-sm">
          <Row label="Odometer" value={drive?.odometerMiles != null ? formatDistance(drive.odometerMiles) : '–'} />
          <Row label="Software" value={softwareText(software)} />
          <Row label="Readings collected" value={status.readings.toLocaleString()} />
          <Row label="Last collected" value={status.lastSync ? formatRelative(status.lastSync) : 'Not since the app started'} />
        </Card>
      </div>
    </div>
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
      return s.version ? `Update ${s.version} available` : 'Update available'
    case 'Scheduled':
      return 'Update scheduled'
    case 'Installing':
      return 'Installing an update'
    case 'Downloading':
    case 'DownloadingWifiWait':
      return 'Downloading an update'
    default:
      return 'Up to date'
  }
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Pressure({ bar, low }: { bar: number | null; low: boolean }) {
  return <span className={cx(low && 'text-warn')}>{bar != null ? formatPressure(bar) : '–'}</span>
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label">{label}</span>
      <span className="tabular text-right font-medium">{value}</span>
    </div>
  )
}

function Empty() {
  return <p className="text-2xl font-semibold tracking-tight text-faint">–</p>
}

function Tile({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="label mb-2 flex items-center gap-1.5">
        {icon} {label}
      </p>
      {children}
    </Card>
  )
}

// Readings stop while the car sleeps; a gap longer than this is drawn as a break, not a straight line.
const GAP_MS = 3 * 60 * 60 * 1000

/** Battery level over the last two weeks on a real time axis, with a shared hover readout. */
function BatteryChart({ points }: { points: CarStatus['battery'] }) {
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
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 w-full overflow-visible rounded bg-raised/50" role="img" aria-label="Battery level over the last two weeks">
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
