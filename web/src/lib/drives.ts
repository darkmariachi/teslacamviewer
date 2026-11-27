import { useQuery } from '@tanstack/react-query'
import { api, carQuery, type EventSummary } from '../api'
import { parseLocal } from './format'

/** A car-logger drive an event belongs to, with where in it the event happened (0 at the start, 1 at the end). */
export interface EventDrive {
  to: string
  start: string
  end: string
  miles: number | null
  avgSpeedMph: number | null
  maxSpeedMph: number | null
  route: [number, number][]
  /** Where in the drive the event started; null for a recording that is the whole drive. */
  at: number | null
}

const DAYS = 90
// Clips start a little before the drive's first GPS fix and end a little after its last.
const SLACK_MS = 60_000

/**
 * Finds the drive each event was recorded during, from car-logger's drives, fetched once for the last 90 days and
 * shared by every row. Without car-logger nothing is fetched and no event has a drive.
 */
export function useEventDrives() {
  const car = useQuery({ ...carQuery, refetchInterval: 5 * 60_000 })
  const hasCar = car.data?.configured === true && car.data.readings > 0
  const drives = useQuery({ queryKey: ['car', 'drives', DAYS], queryFn: () => api.carDrives(DAYS), enabled: hasCar, retry: false, staleTime: 60_000 })

  return (event: EventSummary): EventDrive | null => {
    const start = parseLocal(event.startTime).getTime()
    const end = start + event.durationSec * 1000
    for (const d of drives.data ?? []) {
      const ds = new Date(d.start).getTime()
      const de = new Date(d.end).getTime()
      if (start > de + SLACK_MS || end < ds - SLACK_MS) continue
      // A drive recording covers the drive; anything shorter happened at a moment in it.
      const at = event.type === 'recent' ? null : Math.min(1, Math.max(0, (start - ds) / Math.max(1, de - ds)))
      return { to: `/car/drives/${d.id}`, start: d.start, end: d.end, miles: d.miles, avgSpeedMph: d.avgSpeedMph, maxSpeedMph: d.maxSpeedMph, route: d.route, at }
    }
    return null
  }
}
