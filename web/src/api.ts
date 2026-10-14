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
  /** The car's own short clip of the trigger is available for a hover preview. */
  hasEventClip: boolean
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
  /** What trimming to the trigger would remove; null when there is nothing to trim. */
  trim: { segments: number; bytes: number; beforeSec: number; afterSec: number } | null
  /** When the home rule moves this event to the trash; null when it doesn't apply. */
  homeCleanupAt: string | null
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
  trimBeforeSec: number
  trimAfterSec: number
  homeLat: number | null
  homeLon: number | null
  homeRadiusM: number
  homeCleanupEnabled: boolean
  homeCleanupDays: number
  ffmpegThreads: number
  encoder: 'auto' | 'software' | 'vaapi' | 'qsv' | 'nvenc' | 'amf' | 'videotoolbox'
  previewCellHeight: number
  previewFps: number
  previewQuality: number
  webhookUrl: string | null
  archiverUrl: string | null
  /** Clips arrive through teslausb: shows the Car tab and polls the device. */
  teslausbEnabled: boolean
}

export interface ArchiverStatus {
  cpuTempC: number | null
  throttled: number | null
  wifiSsid: string | null
  wifiStrength: number | null
  wifiIp: string | null
  etherIp: string | null
  uptimeSec: number | null
  drivesActive: boolean | null
  totalBytes: number | null
  freeBytes: number | null
  snapshots: number | null
  newestSnapshotUtc: string | null
  fanRpm: number | null
  supplyVolts: number | null
}

export interface ArchiverSync {
  id: number
  startedAt: string
  finishedAt: string | null
  filesPlanned: number | null
  eventsPlanned: number | null
  filesArchived: number | null
}

/** The teslausb device in the car, as seen from the home network. */
export interface Archiver {
  enabled: boolean
  configured: boolean
  url: string | null
  hookPath: string
  online: boolean
  lastSeen: string | null
  onlineSince: string | null
  status: ArchiverStatus | null
  error: string | null
  uploading: ArchiverSync | null
  syncs: ArchiverSync[]
  sessions: { id: number; startedAt: string; lastSeenAt: string; open: boolean }[]
  newestClip: string | null
  lastIndexed: string | null
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

export interface AuthStatus {
  setupRequired: boolean
  authenticated: boolean
  /** Running inside the desktop app: no password, and the library folder is on this computer. */
  desktop: boolean
  libraryFolder: string | null
  /** False when the clip folder is missing: an unplugged drive, an unmounted share, a deleted folder. */
  libraryAvailable: boolean
}

export interface ImportCheck {
  missing: { path: string; size: number }[]
  missingBytes: number
  alreadyThere: number
  ignored: number
}

export interface ImportStatus {
  running: boolean
  source: string | null
  totalFiles: number
  totalBytes: number
  doneFiles: number
  doneBytes: number
  alreadyThere: number
  failed: number
  deleted: number
  deleteAfter: boolean
  canceled: boolean
  error: string | null
  startedUtc: string | null
  finishedUtc: string | null
}

export interface ImportDrive {
  path: string
  name: string
  totalBytes: number
  /** Files on the drive the library doesn't have yet. */
  newFiles: number
  newBytes: number
  /** Clips the car encrypted, which can't be imported. */
  encrypted: number
}

/** What is in a folder someone is about to use as their library. */
export interface FolderInfo {
  exists: boolean
  clipRoot: string | null
  events: number
  encrypted: number
  /** On a drive that comes and goes, such as the car's USB drive. */
  removable: boolean
  isLibrary: boolean
}

export interface WindowState {
  maximized: boolean
  focused: boolean
  fullScreen: boolean
}

/** What the desktop app adds to the page through its preload script. Absent in a normal browser. */
export interface DesktopBridge {
  version: string
  platform: string
  pickFolder: (title: string) => Promise<string | null>
  /** Switches the library to this folder; the app restarts its server and reloads. */
  setLibraryFolder: (path: string) => Promise<boolean>
  useDefaultLibraryFolder: () => Promise<boolean>
  defaultLibraryFolder: () => Promise<string>
  isFirstRun: () => Promise<boolean>
  finishFirstRun: () => Promise<void>
  showFolder: (path: string) => Promise<void>
  checkForUpdates: () => Promise<string>
  showAppMenu: (x: number, y: number) => Promise<void>
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    state: () => Promise<WindowState>
    onState: (callback: (state: WindowState) => void) => () => void
  }
}

declare global {
  interface Window {
    teslacamDesktop?: DesktopBridge
  }
}

export const desktopBridge = () => window.teslacamDesktop

/** Shared by every component that needs to know whether this is the desktop app. */
export const authQuery = { queryKey: ['auth'], queryFn: () => api.authStatus(), staleTime: Infinity } as const

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
  authStatus: () => request<AuthStatus>('GET', '/api/auth/status'),
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
  trimEvent: (id: number) => request<void>('POST', `/api/events/${id}/trim`),
  /** Cuts the event's own clips down to start–end; returns roughly how many bytes left the event. */
  keepRange: (id: number, start: number, end: number) =>
    request<{ bytes: number }>('POST', `/api/events/${id}/keep`, { start, end }),
  process: (id: number, kind: JobKind) => request<Job>('POST', `/api/events/${id}/process`, { kind }),
  exportClip: (id: number, camera: string, start: number, end: number) =>
    request<Job>('POST', `/api/events/${id}/export`, { camera, start, end }),
  bulk: (ids: number[], action: 'favorite' | 'unfavorite' | 'collect' | 'preview' | 'trim' | 'trash', collectionId?: number) =>
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
  homeCleanupPreview: (settings: Settings) =>
    request<{ covered: number; coveredBytes: number; due: number; dueBytes: number }>('POST', '/api/admin/home-cleanup/preview', settings),
  trash: () => request<EventSummary[]>('GET', '/api/admin/trash'),
  purge: (id: number) => request<void>('DELETE', `/api/admin/trash/${id}`),
  emptyTrash: () => request<{ purged: number }>('DELETE', '/api/admin/trash'),
  retentionPreview: (olderThanDays: number, types: EventType[]) =>
    request<{ count: number; bytes: number }>('POST', '/api/admin/retention/preview', { olderThanDays, types }),
  retentionApply: (olderThanDays: number, types: EventType[]) =>
    request<{ moved: number }>('POST', '/api/admin/retention/apply', { olderThanDays, types }),
  stats: () => request<Stats>('GET', '/api/stats'),

  importCheck: (files: { path: string; size: number }[]) => request<ImportCheck>('POST', '/api/import/check', { files }),
  importFinish: () => request<void>('POST', '/api/import/finish'),
  importStatus: () => request<ImportStatus>('GET', '/api/import/status'),
  importCancel: () => request<void>('POST', '/api/import/cancel'),
  importDrives: () => request<ImportDrive[]>('GET', '/api/import/drives'),
  importPlan: (folder: string) =>
    request<{ files: number; bytes: number; alreadyThere: number; encrypted: number }>('POST', '/api/import/plan', { folder, deleteAfter: false }),
  importInspect: (folder: string) => request<FolderInfo>('POST', '/api/import/inspect', { folder }),
  importFolder: (folder: string, deleteAfter: boolean) => request<void>('POST', '/api/import/folder', { folder, deleteAfter }),

  archiver: () => request<Archiver>('GET', '/api/archiver'),
  archiverSync: () => request<void>('POST', '/api/archiver/sync'),
  archiverPoll: () => request<void>('POST', '/api/archiver/poll'),
}

export const thumbUrl = (eventId: number) => `/api/media/thumb/${eventId}`
export const eventClipUrl = (eventId: number) => `/api/media/eventclip/${eventId}`

/**
 * Sends one file to the library. XMLHttpRequest rather than fetch, because only it reports upload
 * progress. Resolves when the server has stored the file.
 */
export function uploadClip(file: File, path: string, onProgress: (sentBytes: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const params = new URLSearchParams({ path, size: String(file.size), modified: String(file.lastModified) })
    xhr.open('PUT', `/api/import/file?${params}`)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      const message = (safeParse(xhr.responseText) as { error?: string } | undefined)?.error ?? `Upload failed (${xhr.status})`
      reject(new ApiError(xhr.status, message))
    }
    xhr.onerror = () => reject(new ApiError(0, 'The connection to the server was lost'))
    xhr.onabort = () => reject(new DOMException('Canceled', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}
