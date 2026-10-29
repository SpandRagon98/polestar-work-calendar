import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { Button, Dialog, cx } from './primitives'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const nextId = useRef(1)

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3500)
  }, [])

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
            className="anim-rise pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-white"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 size={17} className="mt-px shrink-0 text-emerald-300" />
            ) : t.kind === 'error' ? (
              <AlertTriangle size={17} className="mt-px shrink-0 text-apricot" />
            ) : (
              <Info size={17} className="mt-px shrink-0 text-peach" />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              aria-label="Dismiss"
              className="text-white/60 hover:text-white"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
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
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button
              variant={pending?.danger ? 'danger' : 'primary'}
              className={cx(pending?.danger && 'bg-st-pending! text-white! border-transparent!')}
              onClick={() => close(true)}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
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
