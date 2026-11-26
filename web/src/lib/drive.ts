import type { DriveData, DriveDataSegment } from '../api'

/** The car's driving data at one moment of an event. */
export interface DriveMoment {
  speed: number
  gear: number
  pedal: number
  steer: number
  brake: boolean
  left: boolean
  right: boolean
  autopilot: number
  heading: number
  accel: number
  lateral: number
  lat: number | null
  lon: number | null
}

/** Index of the last reading at or before t, or -1. */
function before(t: number[], at: number) {
  let lo = 0
  let hi = t.length - 1
  if (hi < 0 || at < t[0]) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (t[mid] <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Looks up the driving data for a segment and a time into it. Speed is blended between readings so the number
 * doesn't step; everything else is the latest reading. Gaps of more than a second count as no data.
 */
export function momentAt(data: DriveData | undefined, segmentIndex: number, local: number): DriveMoment | null {
  const seg: DriveDataSegment | undefined = data?.segments.find((s) => s.index === segmentIndex)
  if (!seg) return null
  const i = before(seg.t, local)
  if (i < 0 || local - seg.t[i] > 1) return null
  const j = Math.min(i + 1, seg.t.length - 1)
  const span = seg.t[j] - seg.t[i]
  const f = span > 0 && span < 1 ? Math.min(1, (local - seg.t[i]) / span) : 0
  const lerp = (a: number[]) => a[i] + (a[j] - a[i]) * f
  return {
    speed: lerp(seg.speed),
    gear: seg.gear[i],
    pedal: seg.pedal[i],
    steer: lerp(seg.steer),
    brake: seg.brake[i] === 1,
    left: (seg.blinker[i] & 1) !== 0,
    right: (seg.blinker[i] & 2) !== 0,
    autopilot: seg.autopilot[i],
    heading: seg.heading[i],
    accel: lerp(seg.accel),
    lateral: lerp(seg.lateral),
    lat: seg.lat[i],
    lon: seg.lon[i],
  }
}

/** Every GPS fix in the event, in order, as [lon, lat] for a route line. */
export function routeOf(data: DriveData | undefined): [number, number][] {
  const out: [number, number][] = []
  for (const seg of [...(data?.segments ?? [])].sort((a, b) => a.index - b.index)) {
    for (let k = 0; k < seg.t.length; k++) {
      const lat = seg.lat[k]
      const lon = seg.lon[k]
      if (lat == null || lon == null) continue
      const last = out[out.length - 1]
      if (!last || last[0] !== lon || last[1] !== lat) out.push([lon, lat])
    }
  }
  return out
}

export const GEARS = ['P', 'D', 'R', 'N'] as const

export const AUTOPILOT: Record<number, string> = { 1: 'Self-driving', 2: 'Autosteer', 3: 'Cruise control' }

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

export const toSpeed = (mps: number, unit: 'mph' | 'kmh') => mps * (unit === 'mph' ? 2.23694 : 3.6)

/** Acceleration in g, the unit people know from car magazines. */
export const toG = (mps2: number) => mps2 / 9.80665
