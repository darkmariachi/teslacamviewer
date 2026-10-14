// MapLibre is large, so it is loaded only when a map is actually shown.
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

let loading: Promise<typeof import('maplibre-gl')> | undefined

export function loadMapLibre() {
  loading ??= Promise.all([
    import('maplibre-gl'),
    // The library runs its tile work in a web worker that ships as a separate module; let Vite bundle it.
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]).then(([module, worker]) => {
    module.setWorkerUrl(worker.default)
    return module
  })
  return loading
}
