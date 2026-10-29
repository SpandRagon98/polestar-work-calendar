import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { avatarColor, initials } from '../../lib/status'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type Size = 'sm' | 'md' | 'icon'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-maroon text-white hover:bg-maroon-600 shadow-sm disabled:bg-maroon/50',
  secondary: 'bg-white text-ink border border-line-strong hover:border-stone hover:bg-canvas',
  ghost: 'text-ash hover:bg-canvas hover:text-ink',
  danger: 'bg-white text-st-pending border border-st-pending/30 hover:bg-st-pending/5',
  soft: 'bg-peach-50 text-maroon hover:bg-peach-100',
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-xl justify-center',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  )
}

export function Avatar({ id, name, size = 24, ring }: { id: string; name: string; size?: number; ring?: boolean }) {
  return (
    <span
      title={name}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', ring && 'ring-2 ring-white')}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4), background: avatarColor(id) }}
    >
      {initials(name)}
    </span>
  )
}

export function Logo({ compact, className }: { compact?: boolean; className?: string }) {
  const base = import.meta.env.BASE_URL
  return compact ? (
    <img src={`${base}polestar-mark.png`} alt="Polestar Analytics" className={cx('h-7 w-7 object-contain', className)} />
  ) : (
    <img src={`${base}polestar-logo.png`} alt="Polestar Analytics" className={cx('h-8 w-auto object-contain', className)} />
  )
}

/** Close on Escape and on clicks outside `ref`. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [ref, open, onClose])
}

export function Popover({
  open,
  onClose,
  children,
  align = 'right',
  className,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, onClose)
  if (!open) return null
  return (
    <div
      ref={ref}
      className={cx(
        'anim-pop absolute top-full z-40 mt-2 rounded-2xl border border-line bg-ivory',
        align === 'right' ? 'right-0' : 'left-0',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-pop)' }}
    >
      {children}
    </div>
  )
}

/**
 * Modal dialog. Centered on larger screens, a bottom sheet on phones.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      // Respect a field React already focused (autoFocus); otherwise focus the first field.
      if (panel.current?.contains(document.activeElement)) return
      const target =
        panel.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea') ??
        panel.current?.querySelector<HTMLElement>('button')
      target?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="anim-fade absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'anim-rise relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-ivory sm:rounded-3xl',
          width,
        )}
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4 sm:pt-6">
          <div className="min-w-0 pt-0.5">
            <h2 className="font-display text-lg leading-tight font-bold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm leading-relaxed text-ash">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" className="-mt-1 -mr-2" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/50 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[10px] font-medium transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ash hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-peach-50 text-maroon">{icon}</div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children ? <div className="mt-1 max-w-xs text-xs text-ash">{children}</div> : null}
    </div>
  )
}
