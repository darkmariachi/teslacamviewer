import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { CheckSquare, FolderPlus, LayoutGrid, Search, SlidersHorizontal, Star, Trash2, VideoOff, X } from 'lucide-react'
import { api, type EventFilters, type EventSummary, type EventType, type Page } from '../api'
import { cx, dayKey, formatDay, reasonLabel } from '../lib/format'
import { Button, ConfirmDialog, EmptyState, Segmented, inputClass } from './ui'
import { EventCard } from './EventCard'
import { CollectionPicker } from './CollectionPicker'

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'longest', label: 'Longest' },
  { value: 'largest', label: 'Largest' },
] as const

/** Filters live in the URL so the browser's back button returns to the same view. */
export function useEventFilters(fixed: EventFilters = {}): [EventFilters, (patch: Partial<EventFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams()
  const filters: EventFilters = {
    type: (params.get('type') as EventType | null) ?? undefined,
    favorite: params.get('favorite') === '1' || undefined,
    reason: params.get('reason') ?? undefined,
    city: params.get('city') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    q: params.get('q') ?? undefined,
    sort: (params.get('sort') as EventFilters['sort'] | null) ?? undefined,
    ...fixed,
  }
  const update = (patch: Partial<EventFilters>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === false) next.delete(key)
      else next.set(key, value === true ? '1' : String(value))
    }
    setParams(next, { replace: true })
  }
  const clear = () => setParams(new URLSearchParams(), { replace: true })
  return [filters, update, clear]
}

interface Props {
  fixed?: EventFilters
  empty?: ReactNode
  /** Extra bulk action shown while selecting, e.g. "Remove from collection". */
  extraBulk?: (ids: number[], done: () => void) => ReactNode
}

export function EventBrowser({ fixed, empty, extraBulk }: Props) {
  const queryClient = useQueryClient()
  const [filters, update, clear] = useEventFilters(fixed)
  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState(filters.q ?? '')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<'collect' | 'trash' | null>(null)

  const facets = useQuery({ queryKey: ['facets'], queryFn: api.facets })
  const list = useInfiniteQuery({
    queryKey: ['events', filters],
    queryFn: ({ pageParam }) => api.events(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  })

  // Typing searches after a short pause.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((filters.q ?? '') !== search.trim()) update({ q: search.trim() || undefined })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage()
      },
      { rootMargin: '600px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [list])

  const events = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total ?? 0
  const groups = useMemo(() => {
    // Day headers only make sense when the list is in date order.
    if (filters.sort === 'longest' || filters.sort === 'largest') return [{ key: 'all', title: null, items: events }]
    const map = new Map<string, EventSummary[]>()
    for (const e of events) {
      const key = dayKey(e.startTime)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()].map(([key, items]) => ({ key, title: formatDay(items[0].startTime), items }))
  }, [events, filters.sort])

  const activeFilterCount = [filters.reason, filters.city, filters.from, filters.to, filters.sort && filters.sort !== 'newest'].filter(Boolean).length
  const anyFilter = activeFilterCount > 0 || !!filters.type || !!filters.favorite || !!filters.q

  function patchCached(ids: number[], patch: Partial<EventSummary>) {
    queryClient.setQueriesData<InfiniteData<Page<EventSummary>>>({ queryKey: ['events'] }, (data) =>
      data && {
        ...data,
        pages: data.pages.map((p) => ({ ...p, items: p.items.map((e) => (ids.includes(e.id) ? { ...e, ...patch } : e)) })),
      },
    )
  }

  async function toggleFavorite(event: EventSummary) {
    patchCached([event.id], { favorite: !event.favorite })
    try {
      await api.patchEvent(event.id, { favorite: !event.favorite })
      queryClient.invalidateQueries({ queryKey: ['facets'] })
    } catch {
      patchCached([event.id], { favorite: event.favorite })
    }
  }

  function stopSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }

  const ids = [...selected]
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['facets'] })
    queryClient.invalidateQueries({ queryKey: ['collections'] })
  }

  const typeOptions = [
    { value: 'all', label: 'All' },
    { value: 'sentry', label: 'Sentry' },
    { value: 'saved', label: 'Saved' },
    ...(facets.data?.types.recent ? [{ value: 'recent', label: 'Drives' }] : []),
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={filters.type ?? 'all'} options={typeOptions} onChange={(v) => update({ type: v === 'all' ? undefined : (v as EventType) })} />
        <button
          onClick={() => update({ favorite: !filters.favorite })}
          aria-pressed={!!filters.favorite}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            filters.favorite ? 'border-warn/50 bg-warn/15 text-warn' : 'border-line bg-panel text-dim hover:text-fg',
          )}
        >
          <Star className="size-4" fill={filters.favorite ? 'currentColor' : 'none'} />
          <span className="max-sm:hidden">Favorites</span>
        </button>
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search city, reason, notes"
            className={inputClass + ' h-9 pl-9'}
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            showFilters || activeFilterCount ? 'border-line-strong bg-hover text-fg' : 'border-line bg-panel text-dim hover:text-fg',
          )}
        >
          <SlidersHorizontal className="size-4" />
          <span className="max-sm:hidden">Filters</span>
          {activeFilterCount > 0 && <span className="flex size-4.5 items-center justify-center rounded-full bg-fg text-[10px] font-bold text-ink">{activeFilterCount}</span>}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="tabular text-[13px] text-faint">{list.isSuccess ? `${total.toLocaleString()} ${total === 1 ? 'event' : 'events'}` : ''}</span>
          <Button size="sm" variant={selecting ? 'primary' : 'secondary'} icon={<CheckSquare className="size-4" />} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            {selecting ? 'Done' : 'Select'}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="rise mt-3 grid grid-cols-2 gap-3 rounded-card border border-line bg-panel p-4 md:grid-cols-5">
          <FilterSelect label="Reason" value={filters.reason ?? ''} onChange={(v) => update({ reason: v || undefined })}>
            <option value="">Any reason</option>
            {facets.data?.reasons.map((r) => (
              <option key={r.value} value={r.value}>
                {reasonLabel(r.value)} ({r.count})
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="City" value={filters.city ?? ''} onChange={(v) => update({ city: v || undefined })}>
            <option value="">Anywhere</option>
            {facets.data?.cities.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value} ({c.count})
              </option>
            ))}
          </FilterSelect>
          <label className="block">
            <span className="label mb-1.5 block">From</span>
            <input type="date" value={filters.from ?? ''} max={filters.to} onChange={(e) => update({ from: e.target.value || undefined })} className={inputClass} />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">To</span>
            <input type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => update({ to: e.target.value || undefined })} className={inputClass} />
          </label>
          <FilterSelect label="Sort" value={filters.sort ?? 'newest'} onChange={(v) => update({ sort: v as EventFilters['sort'] })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </FilterSelect>
        </div>
      )}

      {anyFilter && (
        <button
          onClick={() => {
            setSearch('')
            clear()
          }}
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-dim hover:text-fg"
        >
          <X className="size-3.5" /> Clear filters
        </button>
      )}

      <div className="mt-5">
        {list.isPending && <GridSkeleton />}
        {list.isError && <EmptyState icon={<VideoOff className="size-6" />} title="Couldn't load events">{(list.error as Error).message}</EmptyState>}
        {list.isSuccess && events.length === 0 && (
          anyFilter ? (
            <EmptyState icon={<Search className="size-6" />} title="No events match">Try removing a filter or widening the date range.</EmptyState>
          ) : (
            empty ?? (
              <EmptyState icon={<VideoOff className="size-6" />} title="No clips yet">
                Once your clip folder has Sentry or Saved events they will show up here. You can start a scan from the Admin page.
              </EmptyState>
            )
          )
        )}
        {groups.map((group) => (
          <section key={group.key} className="mb-8">
            {group.title && (
              <h2 className="sticky top-14 z-20 -mx-1 mb-3 bg-ink/90 px-1 py-2 text-[13px] font-semibold text-dim backdrop-blur lg:top-0">
                {group.title}
                <span className="ml-2 font-normal text-faint">{group.items.length}</span>
              </h2>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {group.items.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  selecting={selecting}
                  selected={selected.has(event.id)}
                  onToggleSelect={() =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (next.has(event.id)) next.delete(event.id)
                      else next.add(event.id)
                      return next
                    })
                  }
                  onToggleFavorite={() => toggleFavorite(event)}
                />
              ))}
            </div>
          </section>
        ))}
        <div ref={sentinel} />
        {list.isFetchingNextPage && <GridSkeleton count={6} />}
      </div>

      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 pb-3 lg:bottom-0 lg:pl-60">
          <div className="rise flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-line-strong bg-raised/95 px-4 py-3 shadow-2xl backdrop-blur">
            <span className="tabular mr-auto text-sm font-medium">{selected.size} selected</span>
            <button
              className="text-[13px] text-dim hover:text-fg"
              onClick={() => setSelected(selected.size === events.length ? new Set() : new Set(events.map((e) => e.id)))}
            >
              {selected.size === events.length && events.length > 0 ? 'Clear' : 'Select all loaded'}
            </button>
            <Button size="sm" disabled={!ids.length} icon={<Star className="size-4" />} onClick={async () => { await api.bulk(ids, 'favorite'); patchCached(ids, { favorite: true }); refresh(); stopSelecting() }}>
              Favorite
            </Button>
            <Button size="sm" disabled={!ids.length} icon={<FolderPlus className="size-4" />} onClick={() => setDialog('collect')}>
              Collect
            </Button>
            <Button size="sm" disabled={!ids.length} icon={<LayoutGrid className="size-4" />} onClick={async () => { await api.bulk(ids, 'preview'); stopSelecting() }}>
              Merge
            </Button>
            {extraBulk?.(ids, () => { refresh(); stopSelecting() })}
            <Button size="sm" variant="danger" disabled={!ids.length} icon={<Trash2 className="size-4" />} onClick={() => setDialog('trash')}>
              Delete
            </Button>
          </div>
        </div>
      )}

      {dialog === 'collect' && (
        <CollectionPicker
          onPick={(collectionId) => api.bulk(ids, 'collect', collectionId)}
          onClose={() => {
            setDialog(null)
            refresh()
            stopSelecting()
          }}
        />
      )}
      {dialog === 'trash' && (
        <ConfirmDialog
          title={`Delete ${ids.length} ${ids.length === 1 ? 'event' : 'events'}?`}
          message="The clips move to the trash and can be restored from the Admin page until the trash is emptied."
          confirmLabel="Move to trash"
          danger
          onConfirm={async () => {
            await api.bulk(ids, 'trash')
            refresh()
            stopSelecting()
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {children}
      </select>
    </label>
  )
}

function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton aspect-4/3 rounded-xl" />
          <div className="skeleton mt-3 h-3.5 w-2/3 rounded" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  )
}
