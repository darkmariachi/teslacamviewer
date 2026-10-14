import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Upload, VideoOff } from 'lucide-react'
import { authQuery } from '../api'
import { EventBrowser } from '../components/EventBrowser'
import { ImportDialog } from '../components/ImportDialog'
import { Button, EmptyState, PageHeader } from '../components/ui'
import { cx, formatRelative } from '../lib/format'
import { archiverQuery } from './CarTab'

export default function EventsPage() {
  const auth = useQuery(authQuery)
  const [importing, setImporting] = useState(false)
  const openImport = () => setImporting(true)

  return (
    <>
      <PageHeader
        title="Events"
        actions={
          <div className="flex items-center gap-2">
            <CarStatus />
            <Button size="sm" icon={<Upload className="size-4" />} onClick={openImport}>
              Import
            </Button>
          </div>
        }
      />
      <EventBrowser
        empty={
          <EmptyState icon={<VideoOff className="size-6" />} title="No clips yet">
            <p>Import the clips from your car's USB drive to get started.</p>
            <div className="mt-4">
              <Button variant="primary" icon={<Upload className="size-4" />} onClick={openImport}>
                Import clips
              </Button>
            </div>
            <p className="mt-4">
              Already copying clips into the library folder, or using teslausb? They show up here after the next scan.{' '}
              <Link to="/help#getting-clips-in" className="text-fg underline">
                More ways to get clips in
              </Link>
            </p>
          </EmptyState>
        }
      />
      {importing && <ImportDialog desktop={auth.data?.desktop ?? false} onClose={() => setImporting(false)} />}
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
