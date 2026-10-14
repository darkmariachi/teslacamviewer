import { useEffect, useRef } from 'react'
import { MAP_STYLE, loadMapLibre } from '../lib/map'

/** A small, non-interactive map with a single pin. */
export function MiniMap({ lat, lon, className }: { lat: number; lon: number; className?: string }) {
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let map: import('maplibre-gl').Map | undefined
    let cancelled = false
    loadMapLibre().then((maplibre) => {
      if (cancelled || !node.current) return
      map = new maplibre.Map({
        container: node.current,
        style: MAP_STYLE,
        center: [lon, lat],
        zoom: 13.5,
        interactive: false,
        attributionControl: { compact: true },
      })
      // The attribution starts expanded and would cover most of a map this small; keep it one tap away.
      map.on('load', () => node.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))
      const pin = document.createElement('div')
      pin.className = 'size-4 rounded-full border-2 border-white bg-accent shadow-[0_0_0_6px_rgb(232_33_39/0.25)]'
      new maplibre.Marker({ element: pin }).setLngLat([lon, lat]).addTo(map)
    })
    return () => {
      cancelled = true
      map?.remove()
    }
  }, [lat, lon])

  return <div ref={node} className={className} />
}
