import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MapPinOff, Star, X } from 'lucide-react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { api, thumbUrl, type EventType, type MapPoint } from '../api'
import { MAP_STYLE, loadMapLibre } from '../lib/map'
import { cx, eventTitle, formatDateTime } from '../lib/format'
import { Segmented, Spinner } from '../components/ui'

const TYPE_COLOR: Record<EventType, string> = { sentry: '#e82127', saved: '#f5f5f7', recent: '#3e6ae1' }

/** Every located event on one map. Nearby events cluster; a cluster that can't split further opens as a list. */
export default function MapPage() {
  const [params] = useSearchParams()
  const focusId = Number(params.get('focus')) || null
  const [type, setType] = useState<'all' | EventType>('all')
  const [favorite, setFavorite] = useState(false)
  const [picked, setPicked] = useState<MapPoint[] | null>(null)
  const [ready, setReady] = useState(false)

  const node = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const fitted = useRef(false)

  const points = useQuery({
    queryKey: ['map', type, favorite],
    queryFn: () => api.mapPoints({ type: type === 'all' ? undefined : type, favorite: favorite || undefined }),
  })
  const byId = useMemo(() => new Map((points.data ?? []).map((p) => [p.id, p])), [points.data])
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  useEffect(() => {
    let cancelled = false
    loadMapLibre().then((maplibre) => {
      if (cancelled || !node.current) return
      const m = new maplibre.Map({ container: node.current, style: MAP_STYLE, center: [-98, 38], zoom: 3, attributionControl: { compact: true } })
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right')
      map.current = m
      m.on('load', () => {
        m.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 46, clusterMaxZoom: 17 })
        m.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#e82127',
            'circle-opacity': 0.88,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 50, 27, 200, 34],
            'circle-stroke-width': 6,
            'circle-stroke-color': 'rgba(232,33,39,0.22)',
          },
        })
        m.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'events',
          filter: ['has', 'point_count'],
          layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
          paint: { 'text-color': '#ffffff' },
        })
        m.addLayer({
          id: 'points',
          type: 'circle',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['match', ['get', 'type'], 'sentry', TYPE_COLOR.sentry, 'saved', TYPE_COLOR.saved, TYPE_COLOR.recent],
            'circle-radius': 7,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#0a0a0b',
          },
        })

        m.on('click', 'clusters', async (e) => {
          const feature = e.features?.[0]
          if (!feature) return
          const source = m.getSource('events') as GeoJSONSource
          const clusterId = feature.properties.cluster_id as number
          const center = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates
          const zoom = await source.getClusterExpansionZoom(clusterId)
          // Events recorded at the same spot (home, work) never separate; list them instead.
          if (zoom > 17 || m.getZoom() >= 16.5) {
            const leaves = await source.getClusterLeaves(clusterId, 500, 0)
            const list = leaves.map((l) => byIdRef.current.get(l.properties!.id as number)).filter((p): p is MapPoint => !!p)
            setPicked(list.sort((a, b) => b.startTime.localeCompare(a.startTime)))
          } else {
            m.easeTo({ center, zoom: zoom + 0.5 })
          }
        })
        m.on('click', 'points', (e) => {
          const point = byIdRef.current.get(e.features?.[0]?.properties.id as number)
          if (point) setPicked([point])
        })
        for (const layer of ['clusters', 'points']) {
          m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
          m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''))
        }
        setReady(true)
      })
    })
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!ready || !m || !points.data) return
    const source = m.getSource('events') as GeoJSONSource
    source.setData({
      type: 'FeatureCollection',
      features: points.data.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, type: p.type },
      })),
    })
    if (fitted.current || points.data.length === 0) return
    fitted.current = true
    const focus = focusId ? byId.get(focusId) : undefined
    if (focus) {
      m.jumpTo({ center: [focus.lon, focus.lat], zoom: 15 })
      setPicked([focus])
      return
    }
    const lons = points.data.map((p) => p.lon)
    const lats = points.data.map((p) => p.lat)
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 70, maxZoom: 14, duration: 0 })
  }, [ready, points.data, byId, focusId])

  return (
    <div className="relative h-[calc(100dvh-7rem-env(safe-area-inset-bottom)-var(--tb))] lg:h-[calc(100dvh-var(--tb))]">
      {/* Sized explicitly: MapLibre sets position: relative on its container, which would collapse an inset-0 box. */}
      <div ref={node} className="size-full bg-ink" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <div className="pointer-events-auto rounded-xl bg-ink/80 backdrop-blur">
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'All' },
              { value: 'sentry', label: 'Sentry' },
              { value: 'saved', label: 'Saved' },
            ]}
          />
        </div>
        <button
          onClick={() => setFavorite((v) => !v)}
          aria-pressed={favorite}
          className={cx(
            'pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium backdrop-blur transition-colors',
            favorite ? 'border-warn/50 bg-warn/20 text-warn' : 'border-line bg-ink/80 text-dim hover:text-fg',
          )}
        >
          <Star className="size-4" fill={favorite ? 'currentColor' : 'none'} /> Favorites
        </button>
        <span className="tabular pointer-events-auto ml-auto rounded-lg bg-ink/80 px-3 py-2 text-[13px] text-dim backdrop-blur">
          {points.isPending ? <Spinner className="size-4" /> : `${points.data?.length.toLocaleString() ?? 0} located events`}
        </span>
      </div>

      {points.isSuccess && points.data.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/70 text-center">
          <MapPinOff className="size-8 text-faint" />
          <p className="font-semibold">No located events</p>
          <p className="max-w-xs text-sm text-dim">Events show up here when the car recorded a location with them.</p>
        </div>
      )}

      {picked && (
        <div className="rise absolute inset-x-3 bottom-3 z-10 max-h-[55%] overflow-hidden rounded-2xl border border-line bg-panel/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:top-20 sm:right-4 sm:bottom-auto sm:max-h-[calc(100%-7rem)] sm:w-80">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">
              {picked.length === 1 ? (picked[0].city ?? 'Event') : `${picked.length} events here`}
            </p>
            <button onClick={() => setPicked(null)} aria-label="Close" className="text-dim hover:text-fg">
              <X className="size-4.5" />
            </button>
          </div>
          <ul className="max-h-[calc(55dvh-3.5rem)] divide-y divide-line overflow-y-auto sm:max-h-[calc(100dvh-12rem)]">
            {picked.map((p) => (
              <li key={p.id}>
                <Link to={`/events/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                  <div className="aspect-4/3 w-20 shrink-0 overflow-hidden rounded-lg bg-raised">
                    {p.hasThumb && <img src={thumbUrl(p.id)} alt="" loading="lazy" className="size-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[p.type] }} />
                      {eventTitle(p)}
                      {p.favorite && <Star className="size-3 shrink-0 text-warn" fill="currentColor" />}
                    </p>
                    <p className="tabular mt-0.5 truncate text-[13px] text-dim">{formatDateTime(p.startTime)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
