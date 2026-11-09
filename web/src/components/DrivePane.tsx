import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronRight, X } from 'lucide-react'
import { api } from '../api'
import { formatDate, formatDuration, formatEfficiency, formatSpeed, formatTime, formatTripDistance, speedUnit, speedValue } from '../lib/format'
import { Spinner } from './ui'
import { TimeChart } from './TimeChart'

/**
 * A drive picked on the map: its numbers and a speed chart. Hovering the chart reports where the car was,
 * so the map can show it.
 */
export function DrivePane({ id, onClose, onHover }: { id: number; onClose: () => void; onHover: (lonLat: [number, number] | null) => void }) {
  const drive = useQuery({ queryKey: ['car', 'drive', id], queryFn: () => api.carDrive(id) })
  const [hover, setHover] = useState<number | null>(null)

  const data = useMemo(() => {
    if (!drive.data) return null
    const at = (iso: string) => new Date(iso).getTime()
    return {
      speed: drive.data.samples.filter((p) => p.speedMph != null).map((p) => ({ t: at(p.at), v: speedValue(p.speedMph!) })),
      points: drive.data.points.map((p) => ({ t: at(p.at), lonLat: [p.lon, p.lat] as [number, number] })),
    }
  }, [drive.data])

  function hoverAt(t: number | null) {
    setHover(t)
    if (t == null || !data?.points.length) return onHover(null)
    onHover(data.points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).lonLat)
  }

  const d = drive.data?.summary
  const s = drive.data?.stats
  return (
    <div className="rise absolute inset-x-3 bottom-3 z-10 max-h-[60%] overflow-y-auto rounded-2xl border border-line bg-panel/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:top-20 sm:right-4 sm:bottom-auto sm:max-h-[calc(100%-7rem)] sm:w-96">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{d ? `${formatDate(d.start)}, ${formatTime(d.start)} – ${formatTime(d.end)}` : 'Drive'}</p>
          {d && (d.from || d.to) && (
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
        </div>
        <button onClick={onClose} aria-label="Close" className="mt-0.5 text-dim hover:text-fg">
          <X className="size-4.5" />
        </button>
      </div>

      {drive.isPending ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : !d || !s || !data ? (
        <p className="p-4 text-sm text-dim">This drive isn't in the car's readings any more.</p>
      ) : (
        <div className="space-y-4 p-4">
          <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
            <Fact label="Distance" value={d.miles != null ? formatTripDistance(d.miles) : '–'} />
            <Fact label="Time" value={formatDuration(s.durationSeconds)} />
            <Fact label="Stops" value={String(s.stops)} />
            <Fact label="Avg speed" value={s.movingSpeedMph != null ? formatSpeed(s.movingSpeedMph) : '–'} />
            <Fact label="Top speed" value={s.maxSpeedMph != null ? formatSpeed(s.maxSpeedMph) : '–'} />
            <Fact label="Battery" value={d.batteryStart != null && d.batteryEnd != null ? `${d.batteryStart}→${d.batteryEnd}%` : '–'} />
            <Fact label="Energy" value={s.energyKwh != null ? `${s.energyKwh.toFixed(2)} kWh` : '–'} />
            <Fact label="Efficiency" value={s.whPerMile != null && s.whPerMile > 0 ? formatEfficiency(s.whPerMile) : '–'} />
            <Fact label="Regen" value={s.regenKwh != null ? `${s.regenKwh.toFixed(2)} kWh` : '–'} />
          </dl>
          {data.speed.length > 1 && (
            <TimeChart
              title={`Speed (${speedUnit})`}
              points={data.speed}
              start={new Date(d.start).getTime()}
              end={new Date(d.end).getTime()}
              hover={hover}
              onHover={hoverAt}
              format={(v) => `${Math.round(v)}`}
              ticks={speedTicks(data.speed.map((p) => p.v))}
            />
          )}
          <Link
            to={`/car/drives/${d.id}`}
            className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px] font-medium transition-colors hover:bg-hover"
          >
            Open the drive, with power and climb <ChevronRight className="size-4 text-dim" />
          </Link>
        </div>
      )}
    </div>
  )
}

/** Gridlines every 20 up to the first one above the top speed. */
function speedTicks(values: number[]): number[] {
  const top = Math.ceil(Math.max(20, ...values) / 20) * 20
  return Array.from({ length: top / 20 + 1 }, (_, i) => i * 20)
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-[14px] font-semibold">{value}</dd>
    </div>
  )
}
