import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, Crosshair, LayoutGrid, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Scissors, VideoOff } from 'lucide-react'
import type { EventDetail, Job } from '../api'
import { cameraLabel, cameraShort, cx, formatClock, formatTime, parseLocal } from '../lib/format'
import { Button, Menu, MenuItem, ProgressBar, Segmented } from './ui'

const RATES = [0.5, 1, 1.5, 2, 4]
// Followers are nudged back in line once they drift this far from the main camera.
const MAX_DRIFT = 0.3

export type PlayerMode = 'cams' | 'grid'

interface Props {
  detail: EventDetail
  previewJob?: Job
  onGeneratePreview: () => void
  /** Export selection on the event timeline, in seconds. */
  range: [number, number] | null
  onRangeChange: (range: [number, number] | null) => void
  onPosition?: (seconds: number) => void
}

/**
 * Plays an event as one continuous timeline. In camera mode every camera has its own video element,
 * kept in step with the main one; in grid mode a single pre-merged video is used instead.
 */
export function Player({ detail, previewJob, onGeneratePreview, range, onRangeChange, onPosition }: Props) {
  const { segments, summary, preview } = detail
  const cameras = summary.cameras
  const offsets = useMemo(() => {
    const out: number[] = []
    let acc = 0
    for (const s of segments) {
      out.push(acc)
      acc += s.durationSec
    }
    return out
  }, [segments])
  const total = useMemo(() => segments.reduce((sum, s) => sum + s.durationSec, 0), [segments])

  const [mode, setMode] = useState<PlayerMode>(() =>
    preview && window.matchMedia('(max-width: 640px)').matches ? 'grid' : 'cams',
  )
  const [main, setMain] = useState(() =>
    detail.triggerCamera && cameras.includes(detail.triggerCamera) ? detail.triggerCamera : cameras.includes('front') ? 'front' : cameras[0],
  )
  // Sentry events record ten minutes before the trigger; open a few seconds ahead of it instead of at the start.
  const initial = useMemo(() => {
    const want = detail.triggerOffsetSec != null && detail.triggerOffsetSec > 20 ? detail.triggerOffsetSec - 10 : 0
    let index = 0
    while (index < segments.length - 1 && want >= offsets[index] + segments[index].durationSec) index++
    return { index, local: Math.max(0, want - offsets[index]), global: want }
    // Only the first render matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [segIndex, setSegIndex] = useState(initial.index)
  const [position, setPosition] = useState(initial.global)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [failed, setFailed] = useState<Set<number>>(new Set())

  const container = useRef<HTMLDivElement>(null)
  const videos = useRef<Record<string, HTMLVideoElement | null>>({})
  const gridVideo = useRef<HTMLVideoElement | null>(null)
  // Where freshly loaded videos should start; tagged so a stale request is never applied to another segment.
  const pending = useRef<{ seg: number; time: number } | null>(initial.global > 0 ? { seg: initial.index, time: initial.local } : null)
  const playingRef = useRef(false)
  const rateRef = useRef(1)
  const positionRef = useRef(initial.global)
  playingRef.current = playing
  rateRef.current = rate

  const segment = segments[segIndex]
  const fileFor = useCallback((camera: string) => segment?.files.find((f) => f.camera === camera), [segment])
  const master = fileFor(main) ? main : (cameras.find((c) => fileFor(c)) ?? main)

  const locate = useCallback(
    (seconds: number) => {
      const t = Math.min(Math.max(0, seconds), Math.max(0, total - 0.05))
      let i = segments.length - 1
      for (let k = 0; k < segments.length; k++) {
        if (t < offsets[k] + segments[k].durationSec) {
          i = k
          break
        }
      }
      return { index: i, local: t - offsets[i], global: t }
    },
    [offsets, segments, total],
  )

  const updatePosition = useCallback(
    (seconds: number) => {
      positionRef.current = seconds
      setPosition(seconds)
      onPosition?.(seconds)
    },
    [onPosition],
  )

  const seek = useCallback(
    (seconds: number) => {
      const target = locate(seconds)
      updatePosition(target.global)
      if (mode === 'grid') {
        if (gridVideo.current) gridVideo.current.currentTime = target.global
        return
      }
      if (target.index === segIndex) {
        for (const v of Object.values(videos.current)) {
          if (v && v.readyState >= 1) v.currentTime = Math.min(target.local, Math.max(0, (v.duration || target.local) - 0.05))
        }
      } else {
        pending.current = { seg: target.index, time: target.local }
        setSegIndex(target.index)
      }
    },
    [locate, mode, segIndex, updatePosition],
  )

  const playAll = useCallback(() => {
    if (mode === 'grid') gridVideo.current?.play().catch(() => {})
    else for (const v of Object.values(videos.current)) v?.play().catch(() => {})
  }, [mode])

  const pauseAll = useCallback(() => {
    gridVideo.current?.pause()
    for (const v of Object.values(videos.current)) v?.pause()
  }, [])

  const toggle = useCallback(() => {
    if (playingRef.current) {
      pauseAll()
      setPlaying(false)
      return
    }
    if (positionRef.current >= total - 0.3) seek(0)
    setPlaying(true)
    playAll()
  }, [pauseAll, playAll, seek, total])

  // Drives the clock from the main camera and keeps the others in step. Animation frames give smooth
  // updates; the videos' own timeupdate events call the same step so it keeps working when frames are throttled.
  const step = useRef<() => void>(() => {})
  useEffect(() => {
    let frame = 0
    const run = () => {
      if (mode === 'grid') {
        const g = gridVideo.current
        if (g && g.readyState >= 1 && Math.abs(g.currentTime - positionRef.current) > 0.05) updatePosition(Math.min(total, g.currentTime))
        return
      }
      const m = videos.current[master]
      if (!m || m.readyState < 1) return
      if (pending.current) {
        // A segment change is settled once the new main clip has data at the requested spot.
        if (pending.current.seg !== segIndex || m.readyState < 2 || m.seeking) return
        pending.current = null
      }
      const t = m.currentTime
      const global = Math.min(total, offsets[segIndex] + t)
      if (Math.abs(global - positionRef.current) > 0.05) updatePosition(global)
      for (const [camera, v] of Object.entries(videos.current)) {
        if (!v || camera === master || v.readyState < 2) continue
        if (!v.ended && Math.abs(v.currentTime - t) > MAX_DRIFT && t < (v.duration || Infinity) - 0.1) v.currentTime = t
        if (playingRef.current && v.paused && !v.ended && !m.paused) v.play().catch(() => {})
      }
    }
    step.current = run
    const tick = () => {
      frame = requestAnimationFrame(tick)
      run()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [master, mode, offsets, segIndex, total, updatePosition])

  function handleLoaded(v: HTMLVideoElement) {
    v.playbackRate = rateRef.current
    const p = pending.current
    if (p && p.seg === segIndex) v.currentTime = Math.min(p.time, Math.max(0, v.duration - 0.05))
    if (playingRef.current) v.play().catch(() => {})
  }

  function handleEnded(camera: string) {
    if (camera !== master) return
    if (segIndex < segments.length - 1) {
      pending.current = { seg: segIndex + 1, time: 0 }
      updatePosition(offsets[segIndex + 1])
      setSegIndex(segIndex + 1)
    } else {
      setPlaying(false)
    }
  }

  function changeMode(next: PlayerMode) {
    if (next === mode) return
    pauseAll()
    if (next === 'cams') {
      const target = locate(positionRef.current)
      pending.current = { seg: target.index, time: target.local }
      setSegIndex(target.index)
    }
    setMode(next)
  }

  useEffect(() => {
    rateRef.current = rate
    if (gridVideo.current) gridVideo.current.playbackRate = rate
    for (const v of Object.values(videos.current)) if (v) v.playbackRate = rate
  }, [rate, mode, segIndex])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === container.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen()
    else container.current?.requestFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') seek(positionRef.current - (e.shiftKey ? 1 : 5))
      else if (e.key === 'ArrowRight') seek(positionRef.current + (e.shiftKey ? 1 : 5))
      else if (e.key === 'f') toggleFullscreen()
      else if (e.key === 'g') changeMode(mode === 'grid' ? 'cams' : 'grid')
      else if (e.key === 't' && detail.triggerOffsetSec != null) seek(Math.max(0, detail.triggerOffsetSec - 3))
      else if (/^[1-6]$/.test(e.key) && cameras[Number(e.key) - 1]) {
        setMain(cameras[Number(e.key) - 1])
        if (mode === 'grid') changeMode('cams')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle, seek, toggleFullscreen, mode, cameras, detail.triggerOffsetSec])

  const current = locate(position)
  const wallClock = new Date(parseLocal(segments[current.index].startTime).getTime() + current.local * 1000)
  const others = cameras.filter((c) => c !== main)
  const wide = others.length > 3
  const gridLayout = preview ? parseLayout(preview.layout) : null

  return (
    <div ref={container} className={cx('flex flex-col bg-black', fullscreen ? 'h-full' : 'overflow-hidden rounded-card border border-line')}>
      <div className={cx('relative min-h-0 bg-black', fullscreen && 'flex flex-1 items-center justify-center')}>
        {mode === 'cams' ? (
          <div
            className={cx(
              'grid w-full gap-px bg-black',
              // Phones: main camera on top, the rest in a strip. Larger screens: the rest in a column beside it.
              others.length === 0 ? 'grid-cols-1' : others.length <= 3 ? 'grid-cols-3 sm:grid-cols-[3fr_1fr] sm:grid-rows-3' : 'grid-cols-5 sm:grid-cols-[3fr_1fr_1fr] sm:grid-rows-3',
              fullscreen ? 'max-h-full' : others.length === 0 ? 'aspect-4/3 max-h-[78dvh]' : wide ? 'sm:aspect-20/9' : 'sm:aspect-video',
              fullscreen && (wide ? 'aspect-20/9' : others.length ? 'aspect-video' : 'aspect-4/3'),
            )}
            style={fullscreen ? { maxWidth: `calc((100dvh - 7rem) * ${wide ? 20 / 9 : others.length ? 16 / 9 : 4 / 3})` } : undefined}
          >
            {cameras.map((camera) => {
              const file = fileFor(camera)
              const isMain = camera === main
              const broken = file ? failed.has(file.id) || !file.playable : false
              return (
                <div
                  key={camera}
                  onClick={() => !isMain && setMain(camera)}
                  role={isMain ? undefined : 'button'}
                  aria-label={isMain ? undefined : `Show ${cameraLabel(camera)} camera`}
                  className={cx(
                    'group/tile relative overflow-hidden bg-[#050505]',
                    isMain
                      ? cx('order-first aspect-4/3 sm:aspect-auto sm:row-span-3', others.length <= 3 ? 'col-span-3 sm:col-span-1' : 'col-span-5 sm:col-span-1')
                      : 'aspect-4/3 cursor-pointer sm:aspect-auto',
                  )}
                >
                  {file && !broken ? (
                    <video
                      key={file.id}
                      ref={(el) => {
                        videos.current[camera] = el
                      }}
                      src={file.url}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(e) => handleLoaded(e.currentTarget)}
                      onEnded={() => handleEnded(camera)}
                      onTimeUpdate={camera === master ? () => step.current() : undefined}
                      onError={() => setFailed((prev) => new Set(prev).add(file.id))}
                      onClick={isMain ? toggle : undefined}
                      className="absolute inset-0 size-full object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-center text-faint">
                      {broken ? <AlertTriangle className="size-5 text-warn" /> : <VideoOff className="size-5" />}
                      <span className="text-[11px]">{broken ? "Can't play this clip here" : 'No footage'}</span>
                    </div>
                  )}
                  <span
                    className={cx(
                      'pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 font-semibold tracking-wide',
                      isMain ? 'text-xs sm:bottom-3 sm:left-3' : 'text-[10px]',
                    )}
                  >
                    {isMain ? cameraLabel(camera) : cameraShort(camera)}
                    {camera === detail.triggerCamera && <span className="ml-1.5 text-accent-hover">●</span>}
                  </span>
                  {!isMain && <span className="pointer-events-none absolute inset-0 ring-1 ring-white/0 transition-all ring-inset group-hover/tile:ring-white/60" />}
                </div>
              )
            })}
          </div>
        ) : preview && gridLayout ? (
          <div
            className={cx('relative w-full', fullscreen && 'max-h-full')}
            style={{
              aspectRatio: `${gridLayout.columns * 4} / ${gridLayout.rows * 3}`,
              maxWidth: fullscreen ? `calc((100dvh - 7rem) * ${(gridLayout.columns * 4) / (gridLayout.rows * 3)})` : undefined,
              maxHeight: fullscreen ? undefined : '78dvh',
              margin: '0 auto',
            }}
          >
            <video
              key={preview.url}
              ref={gridVideo}
              src={preview.url}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                e.currentTarget.playbackRate = rateRef.current
                e.currentTarget.currentTime = Math.min(positionRef.current, e.currentTarget.duration - 0.05)
                if (playingRef.current) e.currentTarget.play().catch(() => {})
              }}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={() => step.current()}
              className="absolute inset-0 size-full object-contain"
            />
            {/* Each cell is a shortcut to that camera at full resolution. */}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${gridLayout.columns}, 1fr)` }}>
              {gridLayout.cells.map((camera, i) => (
                <button
                  key={i}
                  disabled={!camera}
                  onClick={() => {
                    setMain(camera)
                    changeMode('cams')
                  }}
                  aria-label={camera ? `Open ${cameraLabel(camera)} camera` : undefined}
                  className="group/cell relative ring-white/0 transition-all ring-inset hover:ring-1 hover:ring-white/50"
                >
                  {camera && (
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide sm:text-xs">
                      {cameraShort(camera)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 px-6 text-center">
            <LayoutGrid className="size-9 text-faint" />
            {previewJob && (previewJob.status === 'queued' || previewJob.status === 'running') ? (
              <div className="w-full max-w-xs space-y-3">
                <p className="text-sm text-dim">
                  {previewJob.status === 'running' ? `Merging cameras… ${Math.round(previewJob.progress * 100)}%` : 'Waiting in the queue…'}
                </p>
                <ProgressBar value={previewJob.progress} />
              </div>
            ) : (
              <>
                <div>
                  <p className="font-semibold">No merged video yet</p>
                  <p className="mt-1 max-w-sm text-sm text-dim">
                    A merged video shows every camera in one stream, which is lighter to play on a phone and easy to share.
                  </p>
                  {previewJob?.status === 'failed' && <p className="mt-2 text-sm text-accent-hover">The last attempt failed. You can try again.</p>}
                </div>
                <Button variant="primary" onClick={onGeneratePreview} icon={<LayoutGrid className="size-4" />}>
                  Create merged video
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-panel px-3 pt-3 pb-2 sm:px-4">
        <TimelineBar
          total={total}
          position={position}
          offsets={offsets}
          trigger={detail.triggerOffsetSec}
          range={range}
          onRangeChange={onRangeChange}
          onSeek={seek}
          timeAt={(seconds) => {
            const at = locate(seconds)
            return formatTime(new Date(parseLocal(segments[at.index].startTime).getTime() + at.local * 1000), true)
          }}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-2">
          <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="flex size-10 items-center justify-center rounded-full bg-fg text-ink transition-transform hover:scale-105">
            {playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="ml-0.5 size-5" fill="currentColor" />}
          </button>
          <ControlButton label="Back 10 seconds" onClick={() => seek(position - 10)}>
            <RotateCcw className="size-[18px]" />
          </ControlButton>
          <ControlButton label="Forward 10 seconds" onClick={() => seek(position + 10)}>
            <RotateCw className="size-[18px]" />
          </ControlButton>
          <div className="tabular ml-1 text-[13px]">
            <span className="font-semibold">{formatClock(position)}</span>
            <span className="text-faint"> / {formatClock(total)}</span>
            <span className="ml-3 text-dim max-sm:hidden">{formatTime(wallClock, true)}</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {detail.triggerOffsetSec != null && (
              <ControlButton label="Jump to the trigger (T)" onClick={() => seek(Math.max(0, detail.triggerOffsetSec! - 3))}>
                <Crosshair className="size-[18px] text-accent-hover" />
              </ControlButton>
            )}
            <ControlButton
              label={range ? 'Cancel clip selection' : 'Select a clip to export'}
              active={!!range}
              onClick={() => onRangeChange(range ? null : [Math.max(0, position - 5), Math.min(total, position + 10)])}
            >
              <Scissors className="size-[18px]" />
            </ControlButton>
            <Menu
              trigger={(_, toggleMenu) => (
                <button onClick={toggleMenu} className="tabular h-9 rounded-lg px-2.5 text-[13px] font-semibold text-dim transition-colors hover:bg-hover hover:text-fg" aria-label="Playback speed">
                  {rate}×
                </button>
              )}
            >
              {(close) =>
                RATES.map((r) => (
                  <MenuItem key={r} onClick={() => { setRate(r); close() }} icon={r === rate ? '●' : null}>
                    {r}× {r === 1 && <span className="text-faint">Normal</span>}
                  </MenuItem>
                ))
              }
            </Menu>
            <div className="max-sm:order-last max-sm:basis-full">
              <Segmented value={mode} onChange={changeMode} options={[{ value: 'cams', label: 'Cameras' }, { value: 'grid', label: 'Merged' }]} />
            </div>
            <ControlButton label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function ControlButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx('flex size-9 items-center justify-center rounded-lg transition-colors', active ? 'bg-fg text-ink' : 'text-dim hover:bg-hover hover:text-fg')}
    >
      {children}
    </button>
  )
}

function parseLayout(layout: string): { columns: number; rows: number; cells: string[] } {
  const [cols, list] = layout.split(':')
  const columns = Math.max(1, Number(cols) || 1)
  const cells = (list ?? '').split(',')
  return { columns, rows: Math.max(1, Math.ceil(cells.length / columns)), cells }
}

interface TimelineProps {
  total: number
  position: number
  offsets: number[]
  trigger: number | null
  range: [number, number] | null
  onRangeChange: (range: [number, number] | null) => void
  onSeek: (seconds: number) => void
  timeAt: (seconds: number) => string
}

/** The scrubber: segment boundaries, the trigger moment, and an optional export range with draggable ends. */
function TimelineBar({ total, position, offsets, trigger, range, onRangeChange, onSeek, timeAt }: TimelineProps) {
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef<'seek' | 'start' | 'end' | null>(null)

  const toSeconds = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    return Math.min(total, Math.max(0, ((clientX - rect.left) / rect.width) * total))
  }
  const pct = (seconds: number) => `${total > 0 ? (seconds / total) * 100 : 0}%`

  function apply(kind: 'seek' | 'start' | 'end', seconds: number) {
    if (kind === 'seek') onSeek(seconds)
    else if (range) {
      // Keep at least a second between the two ends.
      if (kind === 'start') onRangeChange([Math.min(seconds, range[1] - 1), range[1]])
      else onRangeChange([range[0], Math.max(seconds, range[0] + 1)])
    }
  }

  function start(kind: 'seek' | 'start' | 'end', e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = kind
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    apply(kind, toSeconds(e.clientX))
  }

  function move(e: ReactPointerEvent) {
    if (dragging.current) apply(dragging.current, toSeconds(e.clientX))
  }

  function end() {
    dragging.current = null
  }

  return (
    <div
      className="group/timeline relative flex h-7 cursor-pointer touch-none items-center select-none"
      onPointerDown={(e) => start('seek', e)}
      onPointerMove={(e) => {
        move(e)
        setHover(toSeconds(e.clientX))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(position)}
      tabIndex={0}
    >
      <div ref={track} className="relative h-1.5 w-full rounded-full bg-line-strong transition-[height] group-hover/timeline:h-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: pct(position) }} />
        {offsets.slice(1).map((o) => (
          <span key={o} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink" style={{ left: pct(o) }} />
        ))}
        {range && (
          <div className="absolute -inset-y-1.5 rounded-sm border-y-2 border-blue bg-blue/30" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }}>
            <span
              onPointerDown={(e) => start('start', e)}
              onPointerMove={move}
              onPointerUp={end}
              className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize rounded-sm bg-blue"
              aria-label="Clip start"
            />
            <span
              onPointerDown={(e) => start('end', e)}
              onPointerMove={move}
              onPointerUp={end}
              className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize rounded-sm bg-blue"
              aria-label="Clip end"
            />
          </div>
        )}
        {trigger != null && (
          <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-accent" style={{ left: pct(trigger) }} title="Trigger" />
        )}
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg opacity-0 shadow transition-opacity group-hover/timeline:opacity-100"
          style={{ left: pct(position) }}
        />
      </div>
      {hover != null && (
        <div className="tabular pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap shadow" style={{ left: pct(hover) }}>
          {formatClock(hover)} · {timeAt(hover)}
        </div>
      )}
    </div>
  )
}
