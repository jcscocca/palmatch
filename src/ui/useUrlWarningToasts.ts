import { useCallback, useRef, useState } from 'react'

export interface ToastEntry {
  id: number
  warnings: string[]
}

export interface UrlWarningToasts {
  toasts: ToastEntry[]
  /** Wired straight into `bindUrl`'s 4th argument; empty batches (a clean parse) are dropped. */
  onWarnings: (warnings: string[]) => void
  dismiss: (id: number) => void
}

/** Owns the toast queue App.tsx renders via `<Toasts>` (Toasts.tsx) — split out so a hook and a
 * component don't share one file (keeps Fast Refresh happy and each half independently testable). */
export function useUrlWarningToasts(): UrlWarningToasts {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const nextId = useRef(0)

  const onWarnings = useCallback((warnings: string[]) => {
    if (warnings.length === 0) return
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, warnings }])
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, onWarnings, dismiss }
}
