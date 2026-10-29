import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/** Keeps a rendering bug from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-ivory p-6">
        <div className="card max-w-md p-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-st-pending/10 text-st-pending">
            <AlertTriangle size={20} />
          </div>
          <h1 className="font-display text-lg font-bold">Something went wrong</h1>
          <p className="mt-1 text-sm text-ash">Your data is safe — nothing unsaved was lost on the server. Reload to continue.</p>
          <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-left font-mono text-[11px] break-words text-stone">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-4 h-10 rounded-xl bg-maroon px-4 text-sm font-medium text-white hover:bg-maroon-600"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
