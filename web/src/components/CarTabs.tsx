import { NavLink } from 'react-router-dom'
import { cx } from '../lib/format'

const TABS = [
  { to: '/car', label: 'Now', end: true },
  { to: '/car/drives', label: 'Drives', end: false },
]

/** Switches between the car as it is now and its history, at the top of every Car page. */
export function CarTabs() {
  return (
    <nav className="flex gap-1 rounded-lg border border-line bg-panel p-1" aria-label="Car">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cx('rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors', isActive ? 'bg-raised text-fg' : 'text-dim hover:text-fg')
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
