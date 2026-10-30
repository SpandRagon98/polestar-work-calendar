import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { avatarColor, initials } from '../../lib/status'
import { motionLevel } from '../../lib/motion'

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
        'inline-flex shrink-0 items-center font-medium select-none',
        'transition-[color,background-color,border-color,box-shadow,scale,opacity] duration-150 ease-out',
        'active:scale-[0.97] active:duration-75 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
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

const prefersReducedMotion = () => motionLevel() === 'off'

/**
 * Keep something mounted while it animates out. `closing` is true during the
 * exit; `mounted` turns false once it has finished.
 */
export function usePresence(open: boolean, ms = 150): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    if (prefersReducedMotion()) {
      setMounted(false)
      return
    }
    setClosing(true)
    const id = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, ms)
    return () => window.clearTimeout(id)
  }, [open, ms])
  return { mounted: open || mounted, closing: !open && closing }
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
  const { mounted, closing } = usePresence(open)
  if (!mounted) return null
  return (
    <div
      ref={ref}
      className={cx(
        'absolute top-full z-40 mt-2 rounded-2xl border border-line bg-ivory',
        align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
        closing ? 'anim-pop-out pointer-events-none' : 'anim-pop',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-pop)' }}
    >
      {children}
    </div>
  )
}

/**
 * Close after a short exit animation (skipped when the user prefers reduced motion).
 * Returns [closing, close]: render exit classes while `closing` is true.
 */
export function useAnimatedClose(onClose: () => void, ms = 170): [boolean, () => void] {
  const [closing, setClosing] = useState(false)
  const latest = useRef(onClose)
  latest.current = onClose
  const started = useRef(false)
  const close = useCallback(() => {
    if (started.current) return
    if (prefersReducedMotion()) {
      latest.current()
      return
    }
    started.current = true
    setClosing(true)
    window.setTimeout(() => {
      started.current = false
      setClosing(false)
      latest.current()
    }, ms)
  }, [ms])
  return [closing, close]
}

/**
 * Modal dialog. Centered on larger screens, a bottom sheet on phones.
 * `footer` may be a function that receives an animated `close` for Cancel buttons.
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
  footer?: ReactNode | ((close: () => void) => ReactNode)
  width?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [closing, close] = useAnimatedClose(onClose)
  const closeRef = useRef(close)
  closeRef.current = close
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
      <div className={cx('absolute inset-0 bg-ink/30', closing ? 'anim-fade-out' : 'anim-fade')} onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-ivory sm:rounded-3xl',
          closing ? 'anim-rise-out pointer-events-none' : 'anim-rise',
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
          <Button variant="ghost" size="icon" className="-mt-1 -mr-2" onClick={close} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/50 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {typeof footer === 'function' ? footer(close) : footer}
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
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const [animate, setAnimate] = useState(false)
  const optionKey = options.map((o) => o.value).join('|')

  // Measure the selected option; the pill glides there with transform only.
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!el) return setPill(null)
    setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, optionKey])

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const sel = el.querySelector<HTMLElement>('[aria-checked="true"]')
      if (sel) setPill({ x: sel.offsetLeft, w: sel.offsetWidth })
    })
    ro.observe(el)
    // Enable the glide only after the first placement, so it doesn't slide in on load.
    const id = window.setTimeout(() => setAnimate(true), 60)
    return () => {
      ro.disconnect()
      window.clearTimeout(id)
    }
  }, [])

  return (
    <div ref={box} role="radiogroup" aria-label={label} className="relative inline-flex rounded-xl border border-line bg-canvas p-0.5">
      {pill ? (
        <span
          aria-hidden
          className={cx(
            'absolute top-0.5 bottom-0.5 left-0 rounded-[10px] bg-white shadow-sm',
            animate && 'transition-[transform,width] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          )}
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative z-10 rounded-[10px] font-medium whitespace-nowrap transition-colors duration-150 select-none',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'text-ink' : 'text-ash hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Smoothly expand / collapse a section. Content stays mounted (so typed values
 * survive) and is made inert while closed.
 */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!inner.current) return
    if (open) inner.current.removeAttribute('inert')
    else inner.current.setAttribute('inert', '')
  }, [open])
  return (
    <div
      className={cx(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
      aria-hidden={!open}
    >
      <div ref={inner} className="-mx-1 min-h-0 overflow-hidden px-1">
        <div className={className}>{children}</div>
      </div>
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
