import type { CarNow } from '../api'
import { formatPressure } from '../lib/format'

/** What the drawing needs to show; every field is optional because readings arrive one kind at a time. */
export interface CarGraphicState {
  tires: CarNow['tires']
  open: string[]
  locked: boolean | null
  sentryArmed: boolean
  charging: string | null
  portOpen: boolean
}

// Tire positions in the drawing (front at the top) and where each label sits.
const WHEELS = [
  { key: 'frontLeft', name: 'front left', cx: 116, cy: 142, label: 54 },
  { key: 'frontRight', name: 'front right', cx: 284, cy: 142, label: 346 },
  { key: 'rearLeft', name: 'rear left', cx: 116, cy: 384, label: 54 },
  { key: 'rearRight', name: 'rear right', cx: 284, cy: 384, label: 346 },
] as const

// Doors swing out from their front edge. Left is the driver's side, as in left-hand-drive cars.
const DOORS = [
  { name: 'driver door', hinge: [121, 186], tip: [74, 240] },
  { name: 'rear left door', hinge: [121, 258], tip: [74, 312] },
  { name: 'passenger door', hinge: [279, 186], tip: [326, 240] },
  { name: 'rear right door', hinge: [279, 258], tip: [326, 312] },
] as const

const BODY =
  'M200 66 C232 66 252 74 262 90 C275 102 281 122 281 152 L282 382 C282 420 274 440 256 449 C236 458 218 460 200 460 C182 460 164 458 144 449 C126 440 118 420 118 382 L119 152 C119 122 125 102 138 90 C148 74 168 66 200 66 Z'

/**
 * A top-down drawing of the car, front at the top, with the tire pressures at each wheel and anything open
 * drawn open. It is a generic car, not any maker's artwork.
 */
export default function CarGraphic({ state }: { state: CarGraphicState }) {
  const { tires, open } = state
  const isOpen = (name: string) => open.includes(name)
  const warn = 'var(--color-warn)'
  const plugged = state.charging != null && state.charging !== 'Disconnected'
  const charging = state.charging === 'Charging' || state.charging === 'Starting'

  return (
    <svg viewBox="0 0 400 520" className="mx-auto h-auto w-full max-w-[460px]" role="img" aria-label={describe(state)}>
      <defs>
        <linearGradient id="car-body" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#24242a" />
          <stop offset="0.5" stopColor="#4b4b54" />
          <stop offset="1" stopColor="#24242a" />
        </linearGradient>
        <linearGradient id="car-glass" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1b2230" />
          <stop offset="0.5" stopColor="#0c0f15" />
          <stop offset="1" stopColor="#141a24" />
        </linearGradient>
        <radialGradient id="car-floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#3e6ae1" stopOpacity="0.18" />
          <stop offset="1" stopColor="#3e6ae1" stopOpacity="0" />
        </radialGradient>
        <filter id="car-shadow" x="-30%" y="-10%" width="160%" height="120%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="car-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Floor light and shadow */}
      <ellipse cx="200" cy="264" rx="175" ry="250" fill="url(#car-floor)" />
      <path d={BODY} transform="translate(0 8)" fill="#000" opacity="0.6" filter="url(#car-shadow)" />

      {/* Wheels, partly hidden under the body */}
      {WHEELS.map((w) => {
        const low = tires?.warnings.includes(w.name)
        return (
          <rect key={w.key} x={w.cx - 9} y={w.cy - 27} width="18" height="54" rx="7" fill="#111114" stroke={low ? warn : '#3a3a41'} strokeWidth={low ? 2.5 : 1.5} />
        )
      })}

      {/* Mirrors */}
      <ellipse cx="111" cy="182" rx="10" ry="6" fill="#2c2c33" stroke="#4a4a52" />
      <ellipse cx="289" cy="182" rx="10" ry="6" fill="#2c2c33" stroke="#4a4a52" />

      {/* Body */}
      <path d={BODY} fill="url(#car-body)" stroke="#5c5c66" strokeWidth="1.5" />

      {/* Frunk and trunk, lit when open */}
      <path
        d="M138 92 C150 76 170 70 200 70 C230 70 250 76 262 92 C272 104 277 124 278 150 Q200 136 122 150 C123 124 128 104 138 92 Z"
        fill={isOpen('frunk') ? warn : 'transparent'}
        fillOpacity={isOpen('frunk') ? 0.28 : 0}
        stroke={isOpen('frunk') ? warn : '#5c5c66'}
        strokeWidth={isOpen('frunk') ? 2 : 1}
      />
      <path
        d="M120 400 Q200 414 280 400 C279 424 272 440 256 447 C236 456 218 457 200 457 C182 457 164 456 144 447 C128 440 121 424 120 400 Z"
        fill={isOpen('trunk') ? warn : 'transparent'}
        fillOpacity={isOpen('trunk') ? 0.28 : 0}
        stroke={isOpen('trunk') ? warn : '#5c5c66'}
        strokeWidth={isOpen('trunk') ? 2 : 1}
      />

      {/* Glass: windshield, roof and rear window */}
      <path d="M140 170 Q200 152 260 170 L251 220 Q200 212 149 220 Z" fill="url(#car-glass)" stroke="#2f3644" />
      <rect x="149" y="224" width="102" height="118" rx="20" fill="url(#car-glass)" stroke="#2f3644" />
      <path d="M150 346 Q200 354 250 346 L257 384 Q200 396 143 384 Z" fill="url(#car-glass)" stroke="#2f3644" />
      {/* A soft reflection across the roof glass */}
      <path d="M160 236 Q200 228 240 236" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="6" strokeLinecap="round" />

      {/* Door seams */}
      {[186, 258, 330].map((y) => (
        <g key={y} stroke="#1c1c21" strokeWidth="1.5">
          <line x1="119" x2="141" y1={y} y2={y} />
          <line x1="259" x2="281" y1={y} y2={y} />
        </g>
      ))}

      {/* Open windows: a bright edge along that window */}
      {[
        ['driver window', 143, 190, 143, 254],
        ['rear left window', 143, 262, 143, 326],
        ['passenger window', 257, 190, 257, 254],
        ['rear right window', 257, 262, 257, 326],
      ].map(([name, x1, y1, x2, y2]) =>
        isOpen(name as string) ? <line key={name} x1={x1} y1={y1} x2={x2} y2={y2} stroke={warn} strokeWidth="4" strokeLinecap="round" /> : null,
      )}

      {/* Open doors swing out from the body */}
      {DOORS.map((d) =>
        isOpen(d.name) ? (
          <g key={d.name}>
            <line x1={d.hinge[0]} y1={d.hinge[1]} x2={d.tip[0]} y2={d.tip[1]} stroke={warn} strokeWidth="9" strokeLinecap="round" opacity="0.35" />
            <line x1={d.hinge[0]} y1={d.hinge[1]} x2={d.tip[0]} y2={d.tip[1]} stroke={warn} strokeWidth="3" strokeLinecap="round" />
          </g>
        ) : null,
      )}

      {/* Headlights and taillights */}
      <path d="M142 96 Q156 84 176 80" fill="none" stroke="#e8eefc" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      <path d="M258 96 Q244 84 224 80" fill="none" stroke="#e8eefc" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      <path d="M134 438 Q200 458 266 438" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M134 438 Q200 458 266 438" fill="none" stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round" opacity="0.4" filter="url(#car-glow)" />

      {/* Sentry: a red eye by the mirror when armed */}
      {state.sentryArmed && (
        <g>
          <circle cx="200" cy="184" r="9" fill="var(--color-accent)" opacity="0.5" filter="url(#car-glow)" />
          <circle cx="200" cy="184" r="4" fill="var(--color-accent)" />
        </g>
      )}

      {/* Lock in the middle of the roof */}
      {state.locked != null && <Lock x={200} y={283} locked={state.locked} />}

      {/* Charge port, rear left */}
      {(plugged || state.portOpen) && (
        <g>
          <circle cx="121" cy="352" r="8" fill={charging ? 'var(--color-ok)' : 'var(--color-blue)'} opacity="0.45" filter="url(#car-glow)" />
          <circle cx="121" cy="352" r="4" fill={charging ? 'var(--color-ok)' : 'var(--color-blue)'} />
        </g>
      )}

      {/* Tire pressures, with a short leader line to each wheel */}
      {WHEELS.map((w) => {
        const bar = tires?.[w.key]
        const low = tires?.warnings.includes(w.name)
        const left = w.label < 200
        return (
          <g key={`label-${w.key}`}>
            <line x1={left ? 84 : 316} x2={left ? 104 : 296} y1={w.cy} y2={w.cy} stroke={low ? warn : '#3a3a41'} strokeWidth="1.5" />
            <text x={w.label} y={w.cy + 2} textAnchor="middle" fontSize="19" fontWeight="600" fill={low ? warn : 'var(--color-fg)'} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {bar != null ? formatPressure(bar) : '–'}
            </text>
            <text x={w.label} y={w.cy + 20} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={low ? warn : 'var(--color-faint)'}>
              {low ? 'LOW' : w.name.toUpperCase()}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Lock({ x, y, locked }: { x: number; y: number; locked: boolean }) {
  const color = locked ? 'var(--color-fg)' : 'var(--color-warn)'
  return (
    <g transform={`translate(${x - 11} ${y - 14})`} opacity="0.92">
      <path d={locked ? 'M5 12 V8 a6 6 0 0 1 12 0 V12' : 'M5 12 V8 a6 6 0 0 1 11.5 -2.2'} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <rect x="1" y="12" width="20" height="15" rx="3.5" fill={color} />
    </g>
  )
}

function describe(s: CarGraphicState): string {
  const parts = [s.locked == null ? null : s.locked ? 'Locked' : 'Unlocked', s.sentryArmed ? 'Sentry armed' : null]
  if (s.open.length) parts.push(`open: ${s.open.join(', ')}`)
  if (s.tires?.warnings.length) parts.push(`low tires: ${s.tires.warnings.join(', ')}`)
  return `The car from above. ${parts.filter(Boolean).join('. ')}.`
}
