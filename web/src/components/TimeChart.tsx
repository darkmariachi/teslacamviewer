import { useId, type MouseEvent } from 'react'
import { cx } from '../lib/format'

export interface TimePoint {
  t: number
  v: number
}

// Readings come every 15 seconds or so; a longer silence is a lost link, drawn as a break rather than a guess.
const GAP_MS = 2 * 60 * 1000

/**
 * One measure over the time of a drive, on a shared time axis so several charts can hover together.
 * Values below zero (regenerative braking) are filled in a second colour under a zero line.
 */
export function TimeChart({
  title,
  points,
  start,
  end,
  hover,
  onHover,
  format,
  ticks,
  className,
}: {
  title: string
  points: TimePoint[]
  start: number
  end: number
  hover: number | null
  onHover: (t: number | null) => void
  format: (v: number) => string
  /** Gridline values, which also set the scale; the chart grows to fit values beyond them. */
  ticks: number[]
  className?: string
}) {
  const clip = useId()
  const span = Math.max(1, end - start)
  const lo = Math.min(0, ...ticks, ...points.map((p) => p.v))
  const hi = Math.max(...ticks, ...points.map((p) => p.v), lo + 1)
  const x = (t: number) => ((t - start) / span) * 100
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100
  const zero = y(0)

  // One path per unbroken run, for the line and the area to the zero line.
  let line = ''
  let area = ''
  let runStart = 0
  points.forEach((p, i) => {
    const joined = i > 0 && p.t - points[i - 1].t < GAP_MS
    if (!joined) {
      if (i > 0) area += `L${x(points[i - 1].t)} ${zero}L${x(points[runStart].t)} ${zero}Z`
      runStart = i
      line += `M${x(p.t)} ${y(p.v)}`
      area += `M${x(p.t)} ${y(p.v)}`
    } else {
      line += `L${x(p.t)} ${y(p.v)}`
      area += `L${x(p.t)} ${y(p.v)}`
    }
  })
  if (points.length) area += `L${x(points[points.length - 1].t)} ${zero}L${x(points[runStart].t)} ${zero}Z`

  const nearest = hover == null || points.length === 0 ? null : points.reduce((a, b) => (Math.abs(b.t - hover) < Math.abs(a.t - hover) ? b : a))

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    onHover(start + ((e.clientX - box.left) / box.width) * span)
  }

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-dim">{title}</h3>
        <span className={cx('tabular text-[13px] font-semibold', !nearest && 'text-faint')}>{nearest ? format(nearest.v) : '–'}</span>
      </div>
      <div className="relative mt-2 flex gap-2">
        <div className="tabular relative w-12 shrink-0 text-right text-[11px] text-faint">
          {ticks.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(v)}%` }}>
              {format(v)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => onHover(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 w-full overflow-visible" role="img" aria-label={title}>
            <defs>
              <clipPath id={`${clip}-up`}>
                <rect x={0} y={0} width={100} height={zero} />
              </clipPath>
              <clipPath id={`${clip}-down`}>
                <rect x={0} y={zero} width={100} height={100 - zero} />
              </clipPath>
            </defs>
            {ticks.map((v) => (
              <line key={v} x1={0} x2={100} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill="var(--color-blue)" fillOpacity={0.18} clipPath={`url(#${clip}-up)`} />
            <path d={area} fill="var(--color-ok)" fillOpacity={0.22} clipPath={`url(#${clip}-down)`} />
            <path d={line} fill="none" stroke="var(--color-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {nearest && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(nearest.t)}%` }} />
              <div
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-fg"
                style={{ left: `${x(nearest.t)}%`, top: `${y(nearest.v)}%` }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
