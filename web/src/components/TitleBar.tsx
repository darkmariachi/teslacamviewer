import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Copy, Menu as MenuIcon, Minus, Square, X } from 'lucide-react'
import { desktopBridge, type WindowState } from '../api'
import { cx } from '../lib/format'

// Parts of the bar that move the window, and parts (the buttons) that don't.
const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

/**
 * The desktop app's title bar, in place of the system one. Its window buttons are a traffic light: amber to
 * minimize, green to maximize, red to close. The lamps dim while the window is in the background. On macOS the
 * system's own buttons sit at the left instead.
 */
export function TitleBar() {
  const bridge = desktopBridge()
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true, fullScreen: false })

  useEffect(() => {
    if (!bridge) return
    bridge.window.state().then(setState)
    return bridge.window.onState(setState)
  }, [bridge])

  if (!bridge || state.fullScreen) return null
  const mac = bridge.platform === 'darwin'

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex h-[var(--tb)] items-center gap-2 border-b border-line bg-ink/95 pr-2 backdrop-blur select-none"
      style={drag}
      onDoubleClick={(e) => {
        // Windows maximizes on a double click by itself; Linux window managers don't always.
        if (bridge.platform === 'linux' && e.target === e.currentTarget) bridge.window.toggleMaximize()
      }}
    >
      <div className={cx('flex items-center gap-2', mac ? 'pl-20' : 'pl-2')}>
        {!mac && (
          <button
            aria-label="App menu"
            title="Menu"
            style={noDrag}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              bridge.showAppMenu(r.left, r.bottom + 4)
            }}
            className="flex size-7 items-center justify-center rounded-md text-dim transition-colors hover:bg-raised hover:text-fg"
          >
            <MenuIcon className="size-4" />
          </button>
        )}
        <span className={cx('text-[12px] font-medium tracking-[0.18em] transition-colors', state.focused ? 'text-dim' : 'text-faint')}>TESLACAM VIEWER</span>
      </div>
      <div className="flex-1 self-stretch" />
      {!mac && <TrafficLight state={state} />}
    </div>
  )
}

function TrafficLight({ state }: { state: WindowState }) {
  const bridge = desktopBridge()!
  return (
    <div
      style={noDrag}
      className="group/light flex items-center gap-[7px] rounded-full border border-white/10 bg-linear-to-b from-[#1d1d21] to-[#0b0b0d] px-[9px] py-[5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.7)]"
    >
      <Lamp color="#f5a524" lit={state.focused} label="Minimize" onClick={() => bridge.window.minimize()}>
        <Minus className="size-[9px]" strokeWidth={3.5} />
      </Lamp>
      <Lamp color="#30c45a" lit={state.focused} label={state.maximized ? 'Restore' : 'Maximize'} onClick={() => bridge.window.toggleMaximize()}>
        {state.maximized ? <Copy className="size-[8px]" strokeWidth={3.5} /> : <Square className="size-[8px]" strokeWidth={3.5} />}
      </Lamp>
      <Lamp color="#e82127" lit={state.focused} label="Close" onClick={() => bridge.window.close()}>
        <X className="size-[9px]" strokeWidth={3.5} />
      </Lamp>
    </div>
  )
}

/**
 * One lamp: a glass lens with a hood shading its top, lit when the window is active. Hovering the light shows what
 * each lamp does, and the one under the pointer glows.
 */
function Lamp({ color, lit, label, onClick, children }: { color: string; lit: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="group/lamp relative flex size-[15px] items-center justify-center rounded-full text-black/75 transition-[box-shadow,filter] duration-150 hover:brightness-110"
      style={{
        background: lit
          ? `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7) 0, ${color} 42%, color-mix(in srgb, ${color} 55%, black) 100%)`
          : `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.12) 0, color-mix(in srgb, ${color} 22%, #18181b) 50%, #0c0c0e 100%)`,
        boxShadow: lit
          ? `inset 0 2px 2px rgba(0,0,0,0.45), 0 0 6px color-mix(in srgb, ${color} 55%, transparent)`
          : 'inset 0 2px 2px rgba(0,0,0,0.6)',
        ...({ '--glow': color } as CSSProperties),
      }}
    >
      <span className="pointer-events-none absolute inset-0 rounded-full opacity-0 shadow-[0_0_12px_var(--glow)] transition-opacity group-hover/lamp:opacity-100" />
      <span className="relative opacity-0 transition-opacity group-hover/light:opacity-100">{children}</span>
    </button>
  )
}
