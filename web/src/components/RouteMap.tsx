import { useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import { MAP_STYLE, loadMapLibre } from '../lib/map'

type Route = [number, number][]

/** A drive's route as a line on the map, with a dot where it started and a ring where it ended; either can be clicked. */
export function RouteMap({ route, marker, className }: { route: Route; marker?: [number, number] | null; className?: string }) {
  const node = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<Marker[]>([])
  const cursor = useRef<Marker | null>(null)
  const [ready, setReady] = useState(false)

  // Where the car was at the moment hovered in a chart.
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    if (!marker) {
      cursor.current?.remove()
      cursor.current = null
      return
    }
    if (cursor.current) {
      cursor.current.setLngLat(marker)
      return
    }
    loadMapLibre().then((maplibre) => {
      const dot = Object.assign(document.createElement('div'), { className: 'size-3.5 rounded-full border-2 border-ink bg-fg shadow-[0_0_0_5px_rgb(245_245_247/0.25)]' })
      cursor.current = new maplibre.Marker({ element: dot }).setLngLat(marker).addTo(m)
    })
  }, [ready, marker])

  useEffect(() => {
    let cancelled = false
    loadMapLibre().then((maplibre) => {
      if (cancelled || !node.current) return
      const m = new maplibre.Map({ container: node.current, style: MAP_STYLE, center: [-98, 38], zoom: 3, attributionControl: { compact: true } })
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right')
      m.on('load', () => {
        node.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
        m.addSource('route', { type: 'geojson', data: line([]) })
        // A wide dark casing under the line keeps it readable over busy streets.
        m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0a0a0b', 'line-width': 8, 'line-opacity': 0.7 } })
        m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3e6ae1', 'line-width': 4 } })
        setReady(true)
      })
      map.current = m
    })
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource('route') as GeoJSONSource).setData(line(route))
    markers.current.forEach((mk) => mk.remove())
    markers.current = []
    if (route.length === 0) return
    loadMapLibre().then((maplibre) => {
      const dot = (className: string) => Object.assign(document.createElement('div'), { className: `${className} cursor-pointer` })
      // Clicking either end opens a small card that can hand the spot over to Google Maps, e.g. for directions.
      const end = (className: string, at: [number, number], title: string) =>
        new maplibre.Marker({ element: dot(className) })
          .setLngLat(at)
          .setPopup(new maplibre.Popup({ offset: 12, closeButton: false, maxWidth: '240px' }).setDOMContent(endCard(title, at)))
          .addTo(m)
      markers.current = [
        end('size-3.5 rounded-full border-2 border-white bg-blue', route[0], 'Start of the drive'),
        end('size-4 rounded-full border-[3px] border-white bg-ink', route[route.length - 1], 'End of the drive'),
      ]
      const lons = route.map((p) => p[0])
      const lats = route.map((p) => p[1])
      m.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 15, duration: 600 },
      )
    })
  }, [ready, route])

  return <div ref={node} className={className} />
}

/** The popup for a drive's start or end: what it is, and a link that opens the spot in Google Maps. */
function endCard(title: string, [lon, lat]: [number, number]) {
  const card = Object.assign(document.createElement('div'), { className: 'px-3.5 py-3 text-sm' })
  card.append(
    Object.assign(document.createElement('p'), { className: 'font-semibold text-fg', textContent: title }),
    Object.assign(document.createElement('a'), {
      href: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`,
      target: '_blank',
      rel: 'noreferrer',
      className: 'mt-1 inline-block text-[13px] text-accent-hover hover:underline',
      textContent: 'Open in Google Maps ↗',
    }),
  )
  return card
}

function line(route: Route) {
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route } }
}
