import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, Info, X } from 'lucide-react'
import { Button, Dialog, cx } from './primitives'

type ToastKind = 'success' | 'error' | 'info' | 'notify'
export interface ToastAction {
  label: string
  onClick: () => void
}
interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
  leaving?: boolean
}

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const nextId = useRef(1)

  /** Animate a toast out, then remove it. */
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 170)
  }, [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success', action?: ToastAction) => {
      const id = nextId.current++
      setToasts((t) => [...t.slice(-3), { id, kind, message, action }])
      const ms = kind === 'error' ? 6500 : kind === 'notify' || action ? 15000 : 3500
      setTimeout(() => dismiss(id), ms)
    },
    [dismiss],
  )

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  )

  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-6 sm:left-auto sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white',
              t.leaving ? 'anim-rise-out' : 'anim-rise',
            )}
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 size={17} className="mt-px shrink-0 text-emerald-300" />
            ) : t.kind === 'error' ? (
              <AlertTriangle size={17} className="mt-px shrink-0 text-apricot" />
            ) : t.kind === 'notify' ? (
              <BellRing size={17} className="mt-px shrink-0 text-apricot" />
            ) : (
              <Info size={17} className="mt-px shrink-0 text-peach" />
            )}
            <span className="flex-1">
              {t.message}
              {t.action ? (
                <button
                  type="button"
                  className="mt-2 block rounded-lg bg-white/12 px-2.5 py-1 text-xs font-semibold text-white transition-[background-color,scale] duration-150 hover:bg-white/20 active:scale-[0.97]"
                  onClick={() => {
                    t.action!.onClick()
                    dismiss(t.id)
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </span>
            <button
              aria-label="Dismiss"
              className="text-white/60 transition-colors hover:text-white"
              onClick={() => dismiss(t.id)}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      <Dialog
        open={!!pending}
        onClose={() => close(false)}
        title={pending?.title ?? ''}
        width="max-w-md"
        footer={(dismiss) => (
          <>
            <Button onClick={dismiss}>Cancel</Button>
            <Button
              variant={pending?.danger ? 'danger' : 'primary'}
              className={cx(pending?.danger && 'bg-st-pending! text-white! border-transparent!')}
              onClick={() => close(true)}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        )}
      >
        <div className="text-sm text-ash">{pending?.message}</div>
      </Dialog>
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider')
  return ctx
}
