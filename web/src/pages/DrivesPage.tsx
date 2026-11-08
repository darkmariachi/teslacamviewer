import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { drivesQuery, type CarDriveSummary } from '../api'
import { formatDate, formatDuration, formatSpeed, formatTime, formatTripDistance } from '../lib/format'
import { Card, Spinner } from '../components/ui'
import { CarTabs } from '../components/CarTabs'

/** The last month of drives, newest first, each leading to its own page. */
export default function DrivesPage() {
  const drives = useQuery(drivesQuery)
  const list = drives.data ?? []
  const miles = list.reduce((sum, d) => sum + (d.miles ?? 0), 0)
  const seconds = list.reduce((sum, d) => sum + duration(d), 0)
  const kwh = list.reduce((sum, d) => sum + (d.energyKwh ?? 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Car</h1>
          <p className="mt-1 text-sm text-dim">Drives over the last 30 days, worked out from car-logger's readings.</p>
        </div>
        <CarTabs />
      </div>

      {drives.isPending ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-dim">No drives in the last 30 days. They show up once the car is back home after one.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total label="Drives" value={list.length.toLocaleString()} />
            <Total label="Distance" value={formatTripDistance(miles)} />
            <Total label="Time driving" value={formatDuration(seconds)} />
            <Total label="Energy used" value={kwh > 0 ? `${kwh.toFixed(1)} kWh` : '–'} />
          </div>
          <Card className="overflow-hidden">
            <ul>
              {list.map((d) => (
                <li key={d.id} className="border-b border-line last:border-b-0">
                  <DriveRow drive={d} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

const duration = (d: CarDriveSummary) => (new Date(d.end).getTime() - new Date(d.start).getTime()) / 1000

function Total({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="label">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  )
}

export function DriveRow({ drive: d }: { drive: CarDriveSummary }) {
  const used = d.batteryStart != null && d.batteryEnd != null ? d.batteryStart - d.batteryEnd : null
  return (
    <Link to={`/car/drives/${d.id}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-raised sm:px-5">
      <RouteSketch route={d.route} className="size-14 shrink-0 rounded-md bg-raised" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[14px] font-medium">
            {formatDate(d.start)}
            <span className="text-dim">
              {' '}
              · {formatTime(d.start)} – {formatTime(d.end)}
            </span>
          </span>
          <span className="tabular shrink-0 text-[14px] font-semibold">{d.miles != null ? formatTripDistance(d.miles) : '–'}</span>
        </div>
        {(d.from || d.to) && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-dim">
            <span className="truncate">{d.from ?? '?'}</span>
            {d.to && d.to !== d.from && (
              <>
                <ArrowRight className="size-3.5 shrink-0 text-faint" />
                <span className="truncate">{d.to}</span>
              </>
            )}
          </p>
        )}
        <p className="tabular mt-0.5 truncate text-[12.5px] text-faint">
          {formatDuration(duration(d))}
          {used != null && <> · Battery {d.batteryStart}% → {d.batteryEnd}%</>}
          {d.avgSpeedMph != null && <> · Avg {formatSpeed(d.avgSpeedMph)}</>}
          {d.maxSpeedMph != null && d.maxSpeedMph > 0 && <> · Top {formatSpeed(d.maxSpeedMph)}</>}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </Link>
  )
}

/** The route's shape, drawn small without a map, so a long list stays quick. */
export function RouteSketch({ route, className }: { route: [number, number][]; className?: string }) {
  if (route.length < 2) return <div className={className} />
  // Longitude degrees shrink away from the equator; scale them so the shape isn't stretched.
  const k = Math.cos((route[0][1] * Math.PI) / 180)
  const xs = route.map((p) => p[0] * k)
  const ys = route.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const size = Math.max(maxX - minX, maxY - minY, 1e-6)
  const pad = 8
  const fit = (v: number, min: number, extent: number) => pad + ((v - min) / size) * (100 - 2 * pad) + ((100 - 2 * pad) * (1 - extent / size)) / 2
  const pts = route.map((_, i) => [fit(xs[i], minX, maxX - minX), 100 - fit(ys[i], minY, maxY - minY)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
  const [sx, sy] = pts[0]
  const [ex, ey] = pts[pts.length - 1]
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <path d={d} fill="none" stroke="var(--color-blue)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx} cy={sy} r={6} fill="var(--color-blue)" stroke="var(--color-fg)" strokeWidth={2.5} />
      <circle cx={ex} cy={ey} r={6} fill="var(--color-ink)" stroke="var(--color-fg)" strokeWidth={3} />
    </svg>
  )
}
