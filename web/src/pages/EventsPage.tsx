import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EventBrowser } from '../components/EventBrowser'
import { PageHeader } from '../components/ui'
import { cx, formatRelative } from '../lib/format'
import { archiverQuery } from './CarTab'

export default function EventsPage() {
  return (
    <>
      <PageHeader title="Events" actions={<CarStatus />} />
      <EventBrowser />
    </>
  )
}

/** A one-line summary of where the car's archiver is; the details live in Admin. Hidden until it is set up. */
function CarStatus() {
  const archiver = useQuery({ ...archiverQuery, refetchInterval: 30_000 })
  const a = archiver.data
  if (!a?.configured) return null
  const text = a.uploading
    ? 'Uploading clips…'
    : a.online
      ? 'Car is home'
      : a.lastSeen
        ? `Car last home ${formatRelative(a.lastSeen)}`
        : 'Car not seen yet'
  return (
    <Link
      to="/admin?tab=car"
      className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-panel px-3 text-[13px] text-dim transition-colors hover:border-line-strong hover:text-fg"
    >
      <span className={cx('size-2 rounded-full', a.uploading ? 'animate-pulse bg-blue' : a.online ? 'bg-ok' : 'bg-faint')} />
      {text}
    </Link>
  )
}
