import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Camera, Check, FolderHeart, LayoutGrid, MapPin, Route, Star, StickyNote, Video } from 'lucide-react'
import { api, eventClipUrl, thumbUrl, type EventSummary } from '../api'
import { cameraLabel, cx, eventTitle, formatClock, formatSpeed, formatTime, formatTripDistance, placeOf, TYPE_LABEL } from '../lib/format'
import type { EventDrive } from '../lib/drives'
import { RouteSketch } from '../pages/DrivesPage'

interface Props {
  event: EventSummary
  drive: EventDrive | null
  selecting: boolean
  selected: boolean
  onToggleSelect: () => void
  onToggleFavorite: () => void
}

const TYPE_STYLE = {
  sentry: 'bg-accent text-white',
  saved: 'bg-fg text-ink',
  recent: 'bg-blue text-white',
} as const

/**
 * One event in the list view: the thumbnail (playing the car's short clip on hover), what happened and when, the
 * drive it belongs to with a sketch of the route, and tags for the kind, cameras and collections.
 */
export function EventRow({ event, drive, selecting, selected, onToggleSelect, onToggleFavorite }: Props) {
  const [broken, setBroken] = useState(false)
  const [hovering, setHovering] = useState(false)
  const navigate = useNavigate()
  const collections = useQuery({ queryKey: ['collections'], queryFn: api.collections, enabled: event.collectionIds.length > 0 })
  const isDrive = event.type === 'recent'
  const camera = event.triggerCamera ? cameraLabel(event.triggerCamera) : null
  const title = eventTitle(event)

  const facts = [
    isDrive ? `${formatTime(event.startTime)} – ${formatTime(event.endTime)}` : formatTime(event.triggerTime ?? event.startTime),
    placeOf(event),
    camera && `${camera.toLowerCase()} camera`,
  ].filter(Boolean)

  // A recording that is the drive shows the drive's numbers; anything else says which drive it happened in.
  const driveLine = drive
    ? isDrive
      ? [drive.miles != null && formatTripDistance(drive.miles), drive.avgSpeedMph != null && `avg ${formatSpeed(drive.avgSpeedMph)}`, drive.maxSpeedMph && `top ${formatSpeed(drive.maxSpeedMph)}`]
          .filter(Boolean)
          .join(' · ')
      : `During a drive · ${formatTime(drive.start)} – ${formatTime(drive.end)}${drive.miles != null ? ` · ${formatTripDistance(drive.miles)}` : ''}`
    : null

  return (
    <div
      className={cx(
        'group relative flex gap-3 rounded-xl border bg-panel p-2.5 transition-colors sm:gap-4',
        selected ? 'border-blue bg-blue/10' : 'border-line hover:border-line-strong hover:bg-raised/60',
      )}
    >
      {/* The whole row opens the event (or selects it); the thumbnail, drive and star sit above this. */}
      {selecting ? (
        <button onClick={onToggleSelect} aria-pressed={selected} aria-label={title} className="absolute inset-0 z-0 rounded-xl" />
      ) : (
        <Link to={`/events/${event.id}`} aria-label={title} className="absolute inset-0 z-0 rounded-xl" />
      )}

      {/* Above the row's link so hovering can play the clip; a click does what the row does. */}
      <div
        onClick={() => (selecting ? onToggleSelect() : navigate(`/events/${event.id}`))}
        className="relative z-10 aspect-video w-32 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-raised sm:w-44"
        // Touch has no hover; a tap there should just open the event.
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        {event.hasThumb && !broken ? (
          <img src={thumbUrl(event.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-line-strong">
            <Video className="size-8" />
          </div>
        )}
        {hovering && event.hasEventClip && (
          <video src={eventClipUrl(event.id)} autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover" />
        )}
        <span className="tabular absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {formatClock(event.durationSec)}
        </span>
        {selecting && (
          <span
            className={cx(
              'absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 text-white',
              selected ? 'border-blue bg-blue' : 'border-white/80 bg-black/40',
            )}
          >
            {selected && <Check className="size-4" strokeWidth={3} />}
          </span>
        )}
      </div>

      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1 py-0.5">
        <p className="truncate text-[15px] font-semibold">{title}</p>
        <p className="tabular flex min-w-0 items-center gap-1.5 truncate text-[13px] text-dim">
          {placeOf(event) && <MapPin className="size-3.5 shrink-0 text-faint" />}
          <span className="truncate">{facts.join(' · ')}</span>
        </p>
        {driveLine &&
          (drive && !selecting ? (
            <Link
              to={drive.to}
              className="pointer-events-auto relative z-10 flex w-fit max-w-full items-center gap-1.5 truncate text-[13px] text-dim hover:text-fg"
            >
              <Route className="size-3.5 shrink-0 text-blue" />
              <span className="truncate">{driveLine}</span>
            </Link>
          ) : (
            <p className="tabular flex items-center gap-1.5 truncate text-[13px] text-dim">
              <Route className="size-3.5 shrink-0 text-blue" />
              <span className="truncate">{driveLine}</span>
            </p>
          ))}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <Tag className={TYPE_STYLE[event.type]}>{TYPE_LABEL[event.type]}</Tag>
          {event.cameras.length > 1 && (
            <Tag>
              <Camera className="size-3" /> {event.cameras.length} cameras
            </Tag>
          )}
          {event.collectionIds.map((id) => {
            const name = collections.data?.find((c) => c.id === id)?.name
            return name ? (
              <Tag key={id}>
                <FolderHeart className="size-3" /> {name}
              </Tag>
            ) : null
          })}
          {event.hasNotes && (
            <Tag>
              <StickyNote className="size-3" /> Note
            </Tag>
          )}
          {event.hasPreview && (
            <Tag>
              <LayoutGrid className="size-3" /> Merged video
            </Tag>
          )}
        </div>
      </div>

      {drive && drive.route.length > 1 && (
        <Link
          to={selecting ? '#' : drive.to}
          tabIndex={-1}
          aria-hidden
          className={cx('relative z-10 hidden shrink-0 self-center sm:block', selecting && 'pointer-events-none')}
        >
          <RouteSketch route={drive.route} marker={drive.at} className="size-20 rounded-lg bg-raised" />
        </Link>
      )}

      {!selecting && (
        <button
          onClick={onToggleFavorite}
          aria-label={event.favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cx(
            'relative z-10 flex size-8 shrink-0 items-center justify-center self-start rounded-full transition-colors',
            event.favorite ? 'text-warn' : 'text-faint hover:text-fg',
          )}
        >
          <Star className="size-[18px]" fill={event.favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  )
}

function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cx('inline-flex h-5 max-w-40 items-center gap-1 truncate rounded-md px-1.5 text-[11px] font-semibold', className ?? 'bg-hover text-dim')}>
      {children}
    </span>
  )
}
