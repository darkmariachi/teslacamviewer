import type { DriveMoment } from '../lib/drive'
import { AUTOPILOT, GEARS, compass, toG, toSpeed } from '../lib/drive'
import { cx } from '../lib/format'

/**
 * The car's own readings over the video: speed, gear, turn signals, pedals, steering, heading and g-force.
 * Always light-on-dark, whatever the app's theme, since it sits on footage.
 */
export function DriveHud({ moment, unit, compact }: { moment: DriveMoment; unit: 'mph' | 'kmh'; compact?: boolean }) {
  const speed = Math.round(toSpeed(moment.speed, unit))
  const g = toG(moment.accel)
  const side = toG(moment.lateral)
  const gear = GEARS[moment.gear] ?? '–'
  const ap = AUTOPILOT[moment.autopilot]

  return (
    <div
      className={cx(
        'pointer-events-none flex items-center rounded-2xl bg-black/55 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm',
        compact ? 'gap-2.5 px-2.5 py-1.5' : 'gap-4 px-4 py-2.5',
      )}
      aria-label={`${speed} ${unit === 'mph' ? 'mph' : 'km/h'}, gear ${gear}`}
    >
      <Signal on={moment.left} side="left" compact={compact} />

      <div className="flex flex-col items-center leading-none">
        <span className={cx('tabular font-semibold tracking-tight', compact ? 'text-xl' : 'text-[34px]')}>{speed}</span>
        <span className="mt-0.5 text-[10px] font-medium text-white/60">{unit === 'mph' ? 'mph' : 'km/h'}</span>
      </div>

      <div className={cx('flex font-semibold', compact ? 'gap-0.5 text-[11px]' : 'gap-1 text-[13px]')}>
        {(['P', 'R', 'N', 'D'] as const).map((g) => (
          <span key={g} className={g === gear ? 'text-white' : 'text-white/30'}>
            {g}
          </span>
        ))}
      </div>

      {!compact && (
        <>
          <Pedals pedal={moment.pedal} brake={moment.brake} />
          <Wheel angle={moment.steer} autopilot={moment.autopilot > 0} />
          <div className="flex flex-col items-center leading-tight">
            <span className="text-[13px] font-semibold">{compass(moment.heading)}</span>
            <span className="tabular text-[10px] text-white/60">{Math.round(((moment.heading % 360) + 360) % 360)}°</span>
          </div>
          <GBall forward={g} side={side} />
        </>
      )}

      <Signal on={moment.right} side="right" compact={compact} />

      {ap && !compact && <span className="rounded-md bg-[#3e6ae1] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">{ap}</span>}
    </div>
  )
}

function Signal({ on, side, compact }: { on: boolean; side: 'left' | 'right'; compact?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={cx(compact ? 'size-3.5' : 'size-5', on ? 'animate-[blink_0.7s_steps(1)_infinite] text-[#30d158]' : 'text-white/20')} aria-label={on ? `${side} signal on` : undefined}>
      <path d={side === 'left' ? 'M2 10 L10 3 V7 H18 V13 H10 V17 Z' : 'M18 10 L10 3 V7 H2 V13 H10 V17 Z'} fill="currentColor" />
    </svg>
  )
}

/** Accelerator travel as a green bar, and the brake as a red one that lights when pressed. */
function Pedals({ pedal, brake }: { pedal: number; brake: boolean }) {
  return (
    <div className="flex h-8 items-end gap-1" title={`Accelerator ${Math.round(pedal)}%${brake ? ', braking' : ''}`}>
      <div className="relative h-full w-1.5 overflow-hidden rounded-full bg-white/15">
        <div className="absolute inset-x-0 bottom-0 rounded-full bg-[#30d158]" style={{ height: `${Math.min(100, Math.max(0, pedal))}%` }} />
      </div>
      <div className={cx('h-full w-1.5 rounded-full', brake ? 'bg-[#ff3d43]' : 'bg-white/15')} />
    </div>
  )
}

/** A steering wheel turned as far as the car's wheel; blue while Autopilot steers. */
function Wheel({ angle, autopilot }: { angle: number; autopilot: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-7', autopilot ? 'text-[#7b9bff]' : 'text-white/85')} style={{ transform: `rotate(${Math.max(-540, Math.min(540, angle))}deg)` }} aria-label={`Steering ${Math.round(angle)}°`}>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M2.8 11 H9.8 M14.2 11 H21.2 M12 14.2 V21.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Which way the car is accelerating, as a dot in a ring of 0.5 g (up is forward), with the forward figure beside it. */
function GBall({ forward, side }: { forward: number; side: number }) {
  const r = 11
  const scale = r / 0.5
  let x = side * scale
  let y = -forward * scale
  const len = Math.hypot(x, y)
  if (len > r) {
    x = (x / len) * r
    y = (y / len) * r
  }
  return (
    <div className="flex items-center gap-1.5" title="Acceleration (g): forward and sideways">
      <svg viewBox="-13 -13 26 26" className="size-7">
        <circle r={r} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="1.2" />
        <path d={`M-${r} 0 H${r} M0 -${r} V${r}`} stroke="rgb(255 255 255 / 0.15)" strokeWidth="1" />
        <circle cx={x} cy={y} r="2.6" fill="white" />
      </svg>
      <span className="tabular w-9 text-[11px] text-white/80">
        {forward >= 0 ? '+' : '−'}
        {Math.abs(forward).toFixed(2)}g
      </span>
    </div>
  )
}
