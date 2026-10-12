import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { api, type Stats } from '../api'
import { cx, formatBytes, formatDuration, reasonLabel } from '../lib/format'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function InsightsPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  if (stats.isPending) return <Spinner />
  if (!stats.data || stats.data.total === 0) {
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState icon={<BarChart3 className="size-6" />} title="Nothing to chart yet">
          Insights appear once your library has events.
        </EmptyState>
      </>
    )
  }
  const s = stats.data
  const busiest = s.byDay.reduce((best, d) => (d.count > best.count ? d : best), s.byDay[0])
  const peakHour = s.byHour.reduce((best, h) => (h.count > best.count ? h : best), s.byHour[0])

  return (
    <>
      <PageHeader title="Insights" subtitle="Patterns across your whole library." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Events" value={s.total.toLocaleString()} />
        <Stat label="Footage" value={formatDuration(s.durationSec)} hint="per camera" />
        <Stat label="Storage" value={formatBytes(s.sizeBytes)} />
        <Stat
          label="Busiest day"
          value={`${busiest.count} ${busiest.count === 1 ? 'event' : 'events'}`}
          hint={new Date(busiest.day + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Events per month" legend>
          <MonthChart data={s.byMonth} />
        </Panel>
        <Panel title="Activity" subtitle="Each square is a day; brighter means more events.">
          <Heatmap days={s.byDay} />
        </Panel>
        <Panel title="Time of day" subtitle={`Most events start around ${hourLabel(peakHour.hour)}.`}>
          <Bars
            items={s.byHour.map((h) => ({ key: String(h.hour), label: h.hour % 6 === 0 ? hourLabel(h.hour) : '', value: h.count, title: `${hourLabel(h.hour)}: ${h.count}` }))}
          />
        </Panel>
        <Panel title="Day of the week">
          <Bars items={s.byWeekday.map((d) => ({ key: String(d.weekday), label: WEEKDAYS[d.weekday], value: d.count, title: `${WEEKDAYS[d.weekday]}: ${d.count}` }))} />
        </Panel>
        <Panel title="What triggered them">
          <Ranking items={s.byReason.map((r) => ({ label: reasonLabel(r.reason) ?? r.reason, value: r.count, to: `/?reason=${encodeURIComponent(r.reason)}` }))} />
        </Panel>
        <Panel title="Where">
          <Ranking items={s.byCity.map((c) => ({ label: c.city, value: c.count, to: `/?city=${encodeURIComponent(c.city)}` }))} />
        </Panel>
      </div>
    </>
  )
}

const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' })

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="label">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]">{value}</p>
      {hint && <p className="mt-0.5 text-[13px] text-faint">{hint}</p>}
    </Card>
  )
}

function Panel({ title, subtitle, legend, children }: { title: string; subtitle?: string; legend?: boolean; children: ReactNode }) {
  return (
    <Card className="min-w-0 p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-dim">{subtitle}</p>}
        </div>
        {legend && (
          <div className="flex gap-3 text-xs text-dim">
            <Key color="bg-accent" label="Sentry" />
            <Key color="bg-fg" label="Saved" />
            <Key color="bg-blue" label="Drives" />
          </div>
        )}
      </div>
      {children}
    </Card>
  )
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('size-2.5 rounded-sm', color)} /> {label}
    </span>
  )
}

function MonthChart({ data }: { data: Stats['byMonth'] }) {
  const max = Math.max(1, ...data.map((m) => m.sentry + m.saved + m.recent))
  return (
    <div className="overflow-x-auto">
      <div className="flex h-44 items-end gap-1.5" style={{ minWidth: data.length * 22 }}>
        {data.map((m) => {
          const total = m.sentry + m.saved + m.recent
          const date = new Date(m.month + '-01T00:00')
          return (
            <Link
              key={m.month}
              to={`/?from=${m.month}-01&to=${m.month}-${new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()}`}
              title={`${date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: ${total} events`}
              className="group flex h-full min-w-4 flex-1 flex-col justify-end"
            >
              <span className="tabular mb-1 text-center text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">{total}</span>
              <div className="flex flex-col overflow-hidden rounded-t-sm opacity-90 transition-opacity group-hover:opacity-100" style={{ height: `${(total / max) * 100}%` }}>
                <div className="bg-blue" style={{ flexGrow: m.recent }} />
                <div className="bg-fg" style={{ flexGrow: m.saved }} />
                <div className="bg-accent" style={{ flexGrow: m.sentry }} />
              </div>
            </Link>
          )
        })}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-line pt-2" style={{ minWidth: data.length * 22 }}>
        {data.map((m, i) => {
          const date = new Date(m.month + '-01T00:00')
          const showYear = i === 0 || date.getMonth() === 0
          return (
            <span key={m.month} className="min-w-4 flex-1 text-center text-[10px] leading-tight text-faint">
              {date.toLocaleDateString(undefined, { month: 'narrow' })}
              {showYear && <span className="block text-dim">{String(date.getFullYear()).slice(2)}</span>}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Bars({ items }: { items: { key: string; label: string; value: number; title: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div>
      <div className="flex h-36 items-end gap-1">
        {items.map((i) => (
          <div key={i.key} title={i.title} className="flex h-full flex-1 flex-col justify-end">
            <div className={cx('rounded-t-sm transition-colors', i.value === max ? 'bg-accent' : 'bg-line-strong hover:bg-dim')} style={{ height: `${Math.max(i.value ? 3 : 0, (i.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1 border-t border-line pt-2">
        {items.map((i) => (
          <span key={i.key} className="flex-1 overflow-visible text-center text-[10px] whitespace-nowrap text-faint">
            {i.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Ranking({ items }: { items: { label: string; value: number; to: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <p className="text-sm text-faint">No data recorded.</p>
  return (
    <ul className="space-y-2.5">
      {items.slice(0, 8).map((i) => (
        <li key={i.label}>
          <Link to={i.to} className="group block">
            <div className="mb-1 flex justify-between gap-3 text-[13px]">
              <span className="truncate group-hover:underline">{i.label}</span>
              <span className="tabular text-dim">{i.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-line">
              <div className="h-full rounded-full bg-fg/80" style={{ width: `${(i.value / max) * 100}%` }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The most recent year of data as week columns, like a contribution graph. */
function Heatmap({ days }: { days: Stats['byDay'] }) {
  const { weeks, max } = useMemo(() => {
    const counts = new Map(days.map((d) => [d.day, d.count]))
    const end = new Date(days[days.length - 1].day + 'T00:00')
    const start = new Date(end)
    start.setDate(start.getDate() - 52 * 7 - end.getDay())
    const columns: { day: string; count: number; date: Date }[][] = []
    const cursor = new Date(start)
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      if (cursor.getDay() === 0 || columns.length === 0) columns.push([])
      columns[columns.length - 1].push({ day: key, count: counts.get(key) ?? 0, date: new Date(cursor) })
      cursor.setDate(cursor.getDate() + 1)
    }
    return { weeks: columns, max: Math.max(1, ...columns.flat().map((d) => d.count)) }
  }, [days])

  const shade = (count: number) => {
    if (count === 0) return 'var(--color-raised)'
    const level = Math.min(1, 0.25 + (count / max) * 0.75)
    return `rgb(232 33 39 / ${level})`
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 14 }}>
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-1 flex-col gap-[3px]">
            {week.map((d) => (
              <Link
                key={d.day}
                to={`/?from=${d.day}&to=${d.day}`}
                title={`${d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: ${d.count} ${d.count === 1 ? 'event' : 'events'}`}
                className="aspect-square rounded-[3px] transition-transform hover:scale-125"
                style={{ background: shade(d.count) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
