import { useEffect } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, FolderHeart, Map as MapIcon, Settings2, Video } from 'lucide-react'
import { api, UNAUTHORIZED_EVENT } from './api'
import { cx } from './lib/format'
import { Spinner } from './components/ui'
import LoginPage from './pages/LoginPage'
import EventsPage from './pages/EventsPage'
import EventPage from './pages/EventPage'
import MapPage from './pages/MapPage'
import CollectionsPage from './pages/CollectionsPage'
import CollectionPage from './pages/CollectionPage'
import InsightsPage from './pages/InsightsPage'
import AdminPage from './pages/AdminPage'

const NAV = [
  { to: '/', label: 'Events', icon: Video, end: true },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/collections', label: 'Collections', icon: FolderHeart },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/admin', label: 'Admin', icon: Settings2 },
]

export default function App() {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['auth'], queryFn: api.authStatus, staleTime: Infinity })

  // Any API call that comes back 401 means the session ended; show the login screen again.
  useEffect(() => {
    const onUnauthorized = () => queryClient.invalidateQueries({ queryKey: ['auth'] })
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [queryClient])

  if (status.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-7" />
      </div>
    )
  }
  if (status.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold">Can't reach the server</p>
        <p className="text-sm text-dim">Check that TeslaCam is running, then reload.</p>
      </div>
    )
  }
  if (status.data.setupRequired || !status.data.authenticated) {
    return <LoginPage setup={status.data.setupRequired} />
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/collections/:id" element={<CollectionPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
        <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="32" cy="32" r="9" fill="var(--color-accent)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[0.22em]">TESLACAM</span>
    </div>
  )
}

/** Sidebar on desktop, bottom tab bar on phones. */
function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  // The map fills the screen; everything else gets normal page padding.
  const flush = location.pathname === '/map'

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-panel/60 px-3 py-6 lg:flex">
        <NavLink to="/" className="px-3">
          <Logo />
        </NavLink>
        <nav className="mt-9 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive || (to === '/' && location.pathname.startsWith('/events')) ? 'bg-hover text-fg' : 'text-dim hover:bg-raised hover:text-fg',
                )
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-ink/85 px-4 backdrop-blur lg:hidden">
        <NavLink to="/">
          <Logo />
        </NavLink>
      </header>

      <main className={cx(flush ? '' : 'mx-auto max-w-[1500px] px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8', 'pb-24 lg:pb-10')}>{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                isActive || (to === '/' && location.pathname.startsWith('/events')) ? 'text-fg' : 'text-faint',
              )
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
