import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, LayoutGrid, MapPin, Star, StickyNote, Video } from 'lucide-react'
import { eventClipUrl, thumbUrl, type EventSummary } from '../api'
import { cx, eventTitle, formatClock, formatTime, TYPE_LABEL } from '../lib/format'

interface Props {
  event: EventSummary
  selecting: boolean
  selected: boolean
  onToggleSelect: () => void
  onToggleFavorite: () => void
}

export function EventCard({ event, selecting, selected, onToggleSelect, onToggleFavorite }: Props) {
  const [broken, setBroken] = useState(false)
  const [hovering, setHovering] = useState(false)
  const when = event.triggerTime ?? event.startTime

  const body = (
    <>
      <div
        className="relative aspect-4/3 overflow-hidden rounded-xl bg-raised"
        // Touch has no hover; a tap there should just open the event.
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        {event.hasThumb && !broken ? (
          <img
            src={thumbUrl(event.id)}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-line-strong">
            <Video className="size-10" />
          </div>
        )}
        {hovering && event.hasEventClip && (
          <video src={eventClipUrl(event.id)} autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-black/30" />

        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          <span
            className={cx(
              'inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-bold tracking-wider uppercase',
              event.type === 'sentry' ? 'bg-accent text-white' : event.type === 'saved' ? 'bg-fg text-ink' : 'bg-blue text-white',
            )}
          >
            {TYPE_LABEL[event.type]}
          </span>
        </div>

        <div className="tabular absolute right-2.5 bottom-2.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold">
          {formatClock(event.durationSec)}
        </div>
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 text-white/80">
          {event.hasPreview && <LayoutGrid className="size-3.5" aria-label="Merged video ready" />}
          {event.hasNotes && <StickyNote className="size-3.5" aria-label="Has notes" />}
        </div>

        {selecting && (
          <div
            className={cx(
              'absolute inset-0 flex items-start justify-end p-2.5 transition-colors',
              selected ? 'bg-blue/25 ring-2 ring-blue ring-inset' : 'bg-black/10',
            )}
          >
            <span className={cx('flex size-6 items-center justify-center rounded-full border-2', selected ? 'border-blue bg-blue' : 'border-white/80 bg-black/40')}>
              {selected && <Check className="size-4" strokeWidth={3} />}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{eventTitle(event)}</p>
          <p className="tabular mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-dim">
            {formatTime(when)}
            {event.city && (
              <>
                <span className="text-faint">·</span>
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{event.city}</span>
              </>
            )}
          </p>
        </div>
      </div>
    </>
  )

  return (
    <div className="group relative">
      {selecting ? (
        <button onClick={onToggleSelect} className="block w-full text-left" aria-pressed={selected}>
          {body}
        </button>
      ) : (
        <Link to={`/events/${event.id}`} className="block">
          {body}
        </Link>
      )}
      {!selecting && (
        <button
          onClick={onToggleFavorite}
          aria-label={event.favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cx(
            'absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full transition-all',
            event.favorite ? 'text-warn' : 'text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-70',
          )}
        >
          <Star className="size-[18px] drop-shadow" fill={event.favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  )
}
