import { useCallback, useEffect, useState } from 'react'
import { loadDataset } from './engine/dataset.ts'
import type { Dataset } from './engine/types.ts'
import { useWorkbenchStore } from './state/store.ts'
import { bindUrl } from './state/url.ts'
import { DatasetContext } from './ui/dataset-context.ts'
import { Toasts } from './ui/Toasts.tsx'
import { useUrlWarningToasts } from './ui/useUrlWarningToasts.ts'
import { Workbench } from './ui/Workbench.tsx'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; ds: Dataset }

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // A `#/own/<blob>` link, held here only until the import panel has shown its confirm step.
  const [shareBlob, setShareBlob] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loadDataset(import.meta.env.BASE_URL).then(
      (ds) => {
        if (!cancelled) setState({ status: 'ready', ds })
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  const { toasts, onWarnings, dismiss } = useUrlWarningToasts()
  const clearShare = useCallback(() => setShareBlob(null), [])

  // Bound once the dataset exists — the URL codec needs `pals`/`byId` to resolve ids. An unknown
  // pal id in the hash (a stale/hand-typed link) surfaces here as a dismissible toast rather than
  // silently dropping the slot.
  const ds = state.status === 'ready' ? state.ds : null
  useEffect(() => {
    if (ds === null) return
    return bindUrl(useWorkbenchStore, ds.pals, ds.byId, onWarnings, setShareBlob)
  }, [ds, onWarnings])

  if (state.status === 'loading') {
    return (
      <div className="screen">
        <div className="dots" aria-label="loading pal data">
          <span>▸</span>
          <span>▸</span>
          <span>▸</span>
        </div>
        <p className="label-caps">LOADING PAL DATA</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="screen">
        <p className="label-caps">DATASET FAILED TO LOAD</p>
        <p className="screen-message">{state.message}</p>
        <button type="button" className="retry-btn" onClick={() => setAttempt((n) => n + 1)}>
          RETRY
        </button>
      </div>
    )
  }

  return (
    <DatasetContext value={state.ds}>
      <Workbench shareBlob={shareBlob} onShareHandled={clearShare} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </DatasetContext>
  )
}

export default App
