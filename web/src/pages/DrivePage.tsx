import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { api, type CarDriveDetail } from '../api'
import {
  formatDate,
  formatDuration,
  formatEfficiency,
  formatHeight,
  formatSpeed,
  formatTemperature,
  formatTime,
  formatTripDistance,
  speedUnit,
  speedValue,
} from '../lib/format'
import { Card, Spinner } from '../components/ui'
import { CarTabs } from '../components/CarTabs'
import { RouteMap } from '../components/RouteMap'
import { TimeChart, type TimePoint } from '../components/TimeChart'

/** One drive: the route on a map, speed and power over time (hovering one moves a dot along the route), and its numbers. */
export default function DrivePage() {
  const id = Number(useParams().id)
  const drive = useQuery({ queryKey: ['car', 'drive', id], queryFn: () => api.carDrive(id), enabled: Number.isFinite(id), retry: false })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to="/car/drives" className="inline-flex items-center gap-1 text-sm text-dim hover:text-fg">
            <ArrowLeft className="size-4" /> Drives
          </Link>
          {drive.data && <Title drive={drive.data} />}
        </div>
        <CarTabs />
      </div>
      {drive.isPending ? (
        <Spinner />
      ) : drive.isError || !drive.data ? (
        <Card className="p-8 text-center text-sm text-dim">This drive isn't in the car's readings any more.</Card>
      ) : (
        <DriveView drive={drive.data} />
      )}
    </div>
  )
}

function Title({ drive: { summary: d } }: { drive: CarDriveDetail }) {
  return (
    <>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {formatDate(d.start)}, {formatTime(d.start)} – {formatTime(d.end)}
      </h1>
      {(d.from || d.to) && (
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-dim">
          <span className="truncate">{d.from ?? '?'}</span>
          {d.to && d.to !== d.from && (
            <>
              <ArrowRight className="size-4 shrink-0 text-faint" />
              <span className="truncate">{d.to}</span>
            </>
          )}
        </p>
      )}
    </>
  )
}

function DriveView({ drive }: { drive: CarDriveDetail }) {
  const { summary: d, stats: s } = drive
  const [hover, setHover] = useState<number | null>(null)
  const start = new Date(d.start).getTime()
  const end = new Date(d.end).getTime()

  const { speed, power, points, route } = useMemo(() => {
    const at = (iso: string) => new Date(iso).getTime()
    return {
      speed: drive.samples.filter((p) => p.speedMph != null).map((p) => ({ t: at(p.at), v: speedValue(p.speedMph!) })),
      power: drive.samples.filter((p) => p.powerKw != null).map((p) => ({ t: at(p.at), v: p.powerKw! })),
      points: drive.points.map((p) => ({ t: at(p.at), lonLat: [p.lon, p.lat] as [number, number] })),
      route: drive.points.map((p) => [p.lon, p.lat] as [number, number]),
    }
  }, [drive])

  // The GPS reading closest in time to the moment hovered in a chart.
  const marker = useMemo(() => {
    if (hover == null || points.length === 0) return null
    return points.reduce((a, b) => (Math.abs(b.t - hover) < Math.abs(a.t - hover) ? b : a)).lonLat
  }, [hover, points])

  const used = d.batteryStart != null && d.batteryEnd != null ? d.batteryStart - d.batteryEnd : null

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          {route.length > 0 ? (
            <RouteMap route={route} marker={marker} className="h-80 sm:h-[26rem]" />
          ) : (
            <p className="flex h-40 items-center justify-center text-sm text-faint">No GPS readings for this drive.</p>
          )}
        </Card>
        <div className="grid grid-cols-2 content-start gap-3">
          <Stat label="Distance" value={d.miles != null ? formatTripDistance(d.miles) : '–'} />
          <Stat label="Time" value={formatDuration(s.durationSeconds)} note={s.stops ? `${plural(s.stops, 'stop')} along the way` : undefined} />
          <Stat
            label="Average speed"
            value={s.movingSpeedMph != null ? formatSpeed(s.movingSpeedMph) : '–'}
            note={s.avgSpeedMph != null && s.movingSeconds < s.durationSeconds - 30 ? `${formatSpeed(s.avgSpeedMph)} counting stops` : 'while moving'}
          />
          <Stat label="Top speed" value={s.maxSpeedMph != null ? formatSpeed(s.maxSpeedMph) : '–'} />
          <Stat
            label="Energy used"
            value={s.energyKwh != null ? `${s.energyKwh.toFixed(2)} kWh` : '–'}
            note={s.whPerMile != null && s.whPerMile > 0 ? formatEfficiency(s.whPerMile) : undefined}
          />
          <Stat label="Regen" value={s.regenKwh != null ? `${s.regenKwh.toFixed(2)} kWh` : '–'} note="won back braking" />
          <Stat label="Battery" value={used != null ? `${d.batteryStart}% → ${d.batteryEnd}%` : '–'} note={used ? `${used}% used` : undefined} />
          <Stat
            label="Climb"
            value={s.climbM != null ? `↑ ${formatHeight(s.climbM)}` : '–'}
            note={s.descentM != null ? `↓ ${formatHeight(s.descentM)}` : undefined}
          />
          {s.outsideC != null && <Stat label="Outside" value={formatTemperature(s.outsideC)} />}
          {s.maxPowerKw != null && <Stat label="Peak power" value={`${Math.round(s.maxPowerKw)} kW`} />}
        </div>
      </div>

      <Card className="space-y-6 p-5">
        <TimeChart
          title={`Speed (${speedUnit})`}
          points={speed}
          start={start}
          end={end}
          hover={hover}
          onHover={setHover}
          format={(v) => `${Math.round(v)}`}
          ticks={steps(speed, 20, false)}
        />
        <TimeChart
          title="Power (kW) · below zero is regenerative braking"
          points={power}
          start={start}
          end={end}
          hover={hover}
          onHover={setHover}
          format={(v) => `${Math.round(v)}`}
          ticks={steps(power, 25, true)}
        />
        <div className="tabular flex justify-between pl-14 text-[12px] text-faint">
          <span>{formatTime(d.start)}</span>
          <span>{formatTime(d.end)}</span>
        </div>
      </Card>
      <p className="text-[12px] text-faint">
        car-logger reads speed and power about every 15 seconds, so short bursts between readings don't show, and energy is an
        estimate from those readings.
      </p>
    </>
  )
}

/** Round gridlines that cover the data: 0, 20, 40… and, for power, below zero too. */
function steps(points: TimePoint[], step: number, negative: boolean): number[] {
  const max = Math.max(step, ...points.map((p) => p.v))
  const min = negative ? Math.min(0, ...points.map((p) => p.v)) : 0
  const ticks: number[] = []
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step; v += step) ticks.push(v)
  return ticks
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="label">{label}</p>
      <p className="tabular mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-0.5 text-[12px] text-faint">{note}</p>}
    </Card>
  )
}
