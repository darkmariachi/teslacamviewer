import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderX, Upload, VideoOff } from 'lucide-react'
import { authQuery } from '../api'
import { EventBrowser } from '../components/EventBrowser'
import { useImport } from '../components/Library'
import { Button, EmptyState, PageHeader } from '../components/ui'
import { cx, formatRelative } from '../lib/format'
import { archiverQuery } from './CarTab'

export default function EventsPage() {
  const { open } = useImport()
  const openImport = () => open()
  const libraryMissing = useQuery(authQuery).data?.libraryAvailable === false

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
          libraryMissing ? (
            <EmptyState icon={<FolderX className="size-6" />} title="Waiting for the library folder">
              Your events show up again as soon as the folder is back.
            </EmptyState>
          ) : (
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
          )
        }
      />
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
