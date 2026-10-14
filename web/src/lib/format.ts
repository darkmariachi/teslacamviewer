import type { EventSummary, EventType } from '../api'

// Clip times are the car's local wall clock without a zone; `new Date` reads them as local, which is what we show.
export const parseLocal = (iso: string) => new Date(iso)

export function formatDay(iso: string): string {
  return parseLocal(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function formatDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTime(iso: string | Date, seconds = false): string {
  const d = typeof iso === 'string' ? parseLocal(iso) : iso
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined })
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`
}

export const dayKey = (iso: string) => iso.slice(0, 10)

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** 75 -> "1 min", 5400 -> "1 h 30 min" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds)
  if (s < 60) return `${s} sec`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  const days = seconds / 86400
  if (days < 60) return `${Math.round(days)} d ago`
  if (days < 730) return `${Math.round(days / 30.4)} months ago`
  return `${(days / 365.25).toFixed(1)} years ago`
}

const REASONS: Record<string, string> = {
  sentry_aware_object_detection: 'Object detected',
  sentry_aware_accel: 'Vehicle bumped',
  sentry_panic_accel: 'Impact detected',
  user_interaction_dashcam_icon_tapped: 'Saved from dashcam',
  user_interaction_dashcam_panel_save: 'Saved from dashcam',
  user_interaction_dashcam_launcher_action_tapped: 'Saved from dashcam',
  user_interaction_honk: 'Saved by honk',
  vehicle_auto_emergency_braking: 'Emergency braking',
  sentry_locked_handle_pulled: 'Door handle pulled',
}

/** Turns Tesla's reason codes into something readable, falling back to a tidied-up version of the code. */
export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (REASONS[reason]) return REASONS[reason]
  const match = Object.keys(REASONS).find((key) => reason.startsWith(key))
  if (match) return REASONS[match]
  const text = reason.replace(/^(sentry_aware_|user_interaction_|vehicle_|sentry_)/, '').replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const TYPE_LABEL: Record<EventType, string> = { sentry: 'Sentry', saved: 'Saved', recent: 'Drive' }

export function eventTitle(e: Pick<EventSummary, 'type' | 'reason'>): string {
  return reasonLabel(e.reason) ?? (e.type === 'sentry' ? 'Sentry event' : e.type === 'saved' ? 'Saved clip' : 'Recorded drive')
}

const CAMERAS: Record<string, string> = {
  front: 'Front',
  back: 'Rear',
  left_repeater: 'Left repeater',
  right_repeater: 'Right repeater',
  left_pillar: 'Left pillar',
  right_pillar: 'Right pillar',
  grid: 'All cameras',
}

const CAMERAS_SHORT: Record<string, string> = {
  front: 'Front',
  back: 'Rear',
  left_repeater: 'Left',
  right_repeater: 'Right',
  left_pillar: 'L pillar',
  right_pillar: 'R pillar',
}

export const cameraLabel = (camera: string) => CAMERAS[camera] ?? camera
export const cameraShort = (camera: string) => CAMERAS_SHORT[camera] ?? camera

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
