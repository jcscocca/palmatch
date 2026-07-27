import { useEffect } from 'react'
import type { ToastEntry } from './useUrlWarningToasts.ts'

const AUTO_DISMISS_MS = 6000

interface ToastProps {
  toast: ToastEntry
  onDismiss: (id: number) => void
}

function Toast({ toast, onDismiss }: ToastProps) {
  const { id, warnings } = toast
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  return (
    <div className="toast" role="status">
      <ul className="toast-list">
        {warnings.map((warning, i) => (
          <li key={i}>{warning}</li>
        ))}
      </ul>
      <button type="button" className="toast-close" aria-label="dismiss warning" onClick={() => onDismiss(id)}>
        ×
      </button>
    </div>
  )
}

export interface ToastsProps {
  toasts: ToastEntry[]
  onDismiss: (id: number) => void
}

/**
 * URL-warning toasts (an unknown pal id dropped from a shared/hand-typed link): stacked top-right,
 * one card per `bindUrl` `onWarnings` call that actually carried a warning. Each auto-dismisses
 * after 6s or on its own × button.
 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
