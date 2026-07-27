import { useEffect, useState } from 'react'
import { loadDataset } from './engine/dataset.ts'
import type { Dataset } from './engine/types.ts'
import { useWorkbenchStore } from './state/store.ts'
import { bindUrl } from './state/url.ts'
import { DatasetContext } from './ui/dataset-context.ts'
import { Workbench } from './ui/Workbench.tsx'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; ds: Dataset }

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

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

  // Bound once the dataset exists — the URL codec needs `pals`/`byId` to resolve ids. Task 8 adds
  // the `onWarnings` toast argument.
  const ds = state.status === 'ready' ? state.ds : null
  useEffect(() => {
    if (ds === null) return
    return bindUrl(useWorkbenchStore, ds.pals, ds.byId)
  }, [ds])

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
      <Workbench ds={state.ds} />
    </DatasetContext>
  )
}

export default App
