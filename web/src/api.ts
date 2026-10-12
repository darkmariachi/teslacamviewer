// Typed client for the TeslaCam API. Authentication is a same-site cookie, so plain fetch is enough.

export type EventType = 'sentry' | 'saved' | 'recent'
export type JobKind = 'probe' | 'thumbnail' | 'preview' | 'transcode' | 'export'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface EventSummary {
  id: number
  type: EventType
  name: string
  startTime: string
  endTime: string
  durationSec: number
  triggerTime: string | null
  city: string | null
  lat: number | null
  lon: number | null
  reason: string | null
  reasonValue: number | null
  cameras: string[]
  segmentCount: number
  sizeBytes: number
  favorite: boolean
  hasNotes: boolean
  hasThumb: boolean
  hasPreview: boolean
  needsTranscode: boolean
  trashedAt: string | null
}

export interface ClipFile {
  id: number
  camera: string
  url: string
  codec: string | null
  width: number | null
  height: number | null
  durationSec: number | null
  sizeBytes: number
  playable: boolean
}

export interface Segment {
  id: number
  index: number
  startTime: string
  durationSec: number
  files: ClipFile[]
}

export interface Job {
  id: number
  eventId: number
  eventName: string | null
  eventStart: string | null
  kind: JobKind
  status: JobStatus
  userRequested: boolean
  progress: number
  error: string | null
  attempts: number
  args: string | null
  outputSizeBytes: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface EventDetail {
  summary: EventSummary
  notes: string | null
  triggerCamera: string | null
  triggerOffsetSec: number | null
  probed: boolean
  preview: { url: string; layout: string; durationSec: number; sizeBytes: number } | null
  segments: Segment[]
  collections: { id: number; name: string }[]
  jobs: Job[]
  exports: Job[]
  newerId: number | null
  olderId: number | null
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Facets {
  total: number
  favorites: number
  types: Partial<Record<EventType, number>>
  reasons: { value: string; count: number }[]
  cities: { value: string; count: number }[]
  firstDay: string | null
  lastDay: string | null
}

export interface MapPoint {
  id: number
  lat: number
  lon: number
  startTime: string
  type: EventType
  reason: string | null
  city: string | null
  hasThumb: boolean
  favorite: boolean
}

export interface Collection {
  id: number
  name: string
  description: string | null
  createdAt: string
  count: number
  covers: number[]
}

export interface Settings {
  previewPolicy: 'all' | 'recent' | 'ondemand'
  previewRecentDays: number
  transcodePolicy: 'auto' | 'ondemand'
  paused: boolean
  workHoursEnabled: boolean
  workHoursStart: number
  workHoursEnd: number
  scanIntervalMinutes: number
  trashRetentionDays: number
  ffmpegThreads: number
  encoder: 'auto' | 'software' | 'vaapi'
  previewCellHeight: number
  previewFps: number
  previewQuality: number
  webhookUrl: string | null
}

export interface Overview {
  pipeline: {
    paused: boolean
    backgroundAllowed: boolean
    workHours: { start: number; end: number } | null
    encoder: string
    hardwareAvailable: boolean | null
    ffmpegVersion: string | null
    etaSeconds: number | null
  }
  jobs: { kind: JobKind; queued: number; running: number; done: number; failed: number }[]
  running: Job[]
  scan: {
    running: boolean
    lastRun: string | null
    lastResult: { added: number; updated: number; removed: number; total: number; seconds: number } | null
    lastError: string | null
    intervalMinutes: number
  }
  library: {
    events: number
    probed: number
    thumbs: number
    previews: number
    needTranscode: number
    durationSec: number
    originalBytes: number
    previewBytes: number
  }
  storage: {
    cacheBytes: number
    exportBytes: number
    clips: { freeBytes: number; totalBytes: number } | null
    data: { freeBytes: number; totalBytes: number } | null
    clipsWritable: boolean
  }
  trash: { count: number; bytes: number; retentionDays: number }
}

export interface Stats {
  total: number
  durationSec: number
  sizeBytes: number
  byMonth: { month: string; sentry: number; saved: number; recent: number; sizeBytes: number }[]
  byDay: { day: string; count: number }[]
  byHour: { hour: number; count: number }[]
  byWeekday: { weekday: number; count: number }[]
  byReason: { reason: string; count: number }[]
  byCity: { city: string; count: number }[]
}

export interface EventFilters {
  type?: EventType
  favorite?: boolean
  collection?: number
  reason?: string
  city?: string
  from?: string
  to?: string
  q?: string
  sort?: 'newest' | 'oldest' | 'longest' | 'largest'
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fired when the session has expired so the app can return to the login screen. */
export const UNAUTHORIZED_EVENT = 'teslacam:unauthorized'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  const text = await res.text()
  const data = text ? safeParse(text) : undefined
  if (!res.ok) {
    const message = (data as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`
    throw new ApiError(res.status, message)
  }
  return data as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function query(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export const api = {
  authStatus: () => request<{ setupRequired: boolean; authenticated: boolean }>('GET', '/api/auth/status'),
  setup: (password: string) => request<void>('POST', '/api/auth/setup', { password }),
  login: (password: string) => request<void>('POST', '/api/auth/login', { password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/api/auth/password', { currentPassword, newPassword }),

  events: (filters: EventFilters, page: number, pageSize = 48) =>
    request<Page<EventSummary>>('GET', `/api/events${query({ ...filters, page, pageSize })}`),
  facets: () => request<Facets>('GET', '/api/events/facets'),
  mapPoints: (filters: EventFilters) => request<MapPoint[]>('GET', `/api/events/map${query(filters)}`),
  event: (id: number) => request<EventDetail>('GET', `/api/events/${id}`),
  patchEvent: (id: number, patch: { favorite?: boolean; notes?: string }) =>
    request<EventSummary>('PATCH', `/api/events/${id}`, patch),
  trashEvent: (id: number) => request<void>('DELETE', `/api/events/${id}`),
  restoreEvent: (id: number) => request<void>('POST', `/api/events/${id}/restore`),
  trashSegment: (id: number, segmentId: number) => request<void>('DELETE', `/api/events/${id}/segments/${segmentId}`),
  process: (id: number, kind: JobKind) => request<Job>('POST', `/api/events/${id}/process`, { kind }),
  exportClip: (id: number, camera: string, start: number, end: number) =>
    request<Job>('POST', `/api/events/${id}/export`, { camera, start, end }),
  bulk: (ids: number[], action: 'favorite' | 'unfavorite' | 'collect' | 'preview' | 'trash', collectionId?: number) =>
    request<void>('POST', '/api/events/bulk', { ids, action, collectionId }),

  collections: () => request<Collection[]>('GET', '/api/collections'),
  createCollection: (name: string, description?: string) =>
    request<{ id: number; name: string }>('POST', '/api/collections', { name, description }),
  updateCollection: (id: number, name: string, description?: string) =>
    request<void>('PUT', `/api/collections/${id}`, { name, description }),
  deleteCollection: (id: number) => request<void>('DELETE', `/api/collections/${id}`),
  addToCollection: (id: number, eventId: number) => request<void>('PUT', `/api/collections/${id}/events/${eventId}`),
  removeFromCollection: (id: number, eventId: number) =>
    request<void>('DELETE', `/api/collections/${id}/events/${eventId}`),

  overview: () => request<Overview>('GET', '/api/admin/overview'),
  jobs: (params: { status?: string; kind?: string; page?: number }) =>
    request<Page<Job>>('GET', `/api/admin/jobs${query(params)}`),
  retryJob: (id: number) => request<void>('POST', `/api/admin/jobs/${id}/retry`),
  cancelJob: (id: number) => request<void>('POST', `/api/admin/jobs/${id}/cancel`),
  retryFailed: () => request<{ changed: number }>('POST', '/api/admin/jobs/retry-failed'),
  clearFinished: () => request<{ removed: number }>('POST', '/api/admin/jobs/clear-finished'),
  pause: () => request<void>('POST', '/api/admin/pause'),
  resume: () => request<void>('POST', '/api/admin/resume'),
  scan: () => request<void>('POST', '/api/admin/scan'),
  backlog: (kind: JobKind) => request<{ queued: number }>('POST', '/api/admin/backlog', { kind }),
  cancelBacklog: (kind: JobKind) => request<{ removed: number }>('POST', '/api/admin/backlog/cancel', { kind }),
  settings: () => request<Settings>('GET', '/api/admin/settings'),
  saveSettings: (settings: Settings) => request<Settings>('PUT', '/api/admin/settings', settings),
  trash: () => request<EventSummary[]>('GET', '/api/admin/trash'),
  purge: (id: number) => request<void>('DELETE', `/api/admin/trash/${id}`),
  emptyTrash: () => request<{ purged: number }>('DELETE', '/api/admin/trash'),
  retentionPreview: (olderThanDays: number, types: EventType[]) =>
    request<{ count: number; bytes: number }>('POST', '/api/admin/retention/preview', { olderThanDays, types }),
  retentionApply: (olderThanDays: number, types: EventType[]) =>
    request<{ moved: number }>('POST', '/api/admin/retention/apply', { olderThanDays, types }),
  stats: () => request<Stats>('GET', '/api/stats'),
}

export const thumbUrl = (eventId: number) => `/api/media/thumb/${eventId}`
