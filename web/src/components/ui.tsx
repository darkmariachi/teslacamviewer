import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { cx } from '../lib/format'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-fg text-ink hover:bg-white disabled:bg-line-strong disabled:text-faint',
  secondary: 'bg-raised text-fg border border-line hover:bg-hover hover:border-line-strong disabled:text-faint',
  ghost: 'text-dim hover:text-fg hover:bg-hover disabled:text-faint',
  danger: 'bg-accent text-white hover:bg-accent-hover disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  busy?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-colors select-none',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        BUTTON[variant],
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-fg text-ink' : 'text-dim hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-card border border-line bg-panel', className)}>{children}</div>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'blue'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-white/10 text-fg',
    accent: 'bg-accent text-white',
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
    blue: 'bg-blue/20 text-[#8fb0ff]',
  }
  return (
    <span className={cx('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-dim', className ?? 'size-5')} />
}

export function ProgressBar({ value, tone = 'fg' }: { value: number; tone?: 'fg' | 'accent' | 'ok' }) {
  const color = tone === 'accent' ? 'bg-accent' : tone === 'ok' ? 'bg-ok' : 'bg-fg'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className={cx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-raised text-dim">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="max-w-sm text-sm text-dim">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A centered dialog on desktop, a bottom sheet on phones. */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(
          'rise flex max-h-[90dvh] w-full flex-col rounded-t-2xl border border-line bg-panel shadow-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<unknown> | void
  onClose: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Something went wrong')
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-dim">{message}</div>
      {error && <p className="mt-3 text-sm text-accent-hover">{error}</p>}
    </Modal>
  )
}

/** A small menu anchored to its trigger; closes on outside click or Escape. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          className={cx(
            'rise absolute z-40 mt-2 min-w-52 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-2xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-hover disabled:opacity-40',
        danger ? 'text-accent-hover' : 'text-fg',
      )}
    >
      <span className="flex size-4 items-center justify-center text-dim">{icon}</span>
      {children}
    </button>
  )
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg placeholder:text-faint transition-colors hover:border-line-strong focus:border-fg focus:outline-none'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-blue' : 'bg-line-strong')}
    >
      <span className={cx('absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

/** Tesla-style segmented control. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-fg text-ink' : 'text-dim hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
