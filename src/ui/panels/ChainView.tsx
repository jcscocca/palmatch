import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChainRequest, ChainResponse, ChainStep } from '../../engine/types.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'
import { PalTile } from '../PalTile.tsx'

const DEPTHS = [4, 5, 6, 7, 8]
/** Slots and the depth select change in bursts; only the last one is worth a search. */
const DEBOUNCE_MS = 150
const TIMEOUT_MS = 5000

type ChainState =
  | { status: 'loading' }
  | { status: 'done'; steps: ChainStep[] | null; depth: number; strict: boolean }
  | { status: 'error'; message: string }

/**
 * Step-by-step breeding paths, computed in `chains.worker.ts` so a deep search can't freeze the
 * page. Every reply carries the id of the request it answers: slots change faster than searches
 * finish, and an answer to a workbench the player has already moved on from is dropped rather
 * than rendered.
 */
export function ChainView() {
  const ds = useDataset()
  const slotA = useWorkbenchStore((s) => s.slotA)
  const slotB = useWorkbenchStore((s) => s.slotB)
  const target = useWorkbenchStore((s) => s.target)
  const depth = useWorkbenchStore((s) => s.chainDepth)
  const setChainDepth = useWorkbenchStore((s) => s.setChainDepth)
  const setSlot = useWorkbenchStore((s) => s.setSlot)

  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const askedRef = useRef<{ depth: number; strict: boolean }>({ depth, strict: false })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ChainState>({ status: 'loading' })

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL('../../engine/chains.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<ChainResponse>) => {
      const res = event.data
      if (res.requestId !== requestIdRef.current) return
      clearTimer()
      setState(
        res.ok
          ? { status: 'done', steps: res.steps, depth: askedRef.current.depth, strict: askedRef.current.strict }
          : { status: 'error', message: res.error },
      )
    }
    worker.onerror = (event: ErrorEvent) => {
      clearTimer()
      setState({ status: 'error', message: event.message === '' ? 'the chain worker failed to start' : event.message })
    }
    return () => {
      clearTimer()
      worker.terminate()
      workerRef.current = null
    }
  }, [clearTimer])

  useEffect(() => {
    if (slotA === null || target === null) return
    const starters = slotB === null ? [slotA] : [slotA, slotB]
    setState({ status: 'loading' })
    const debounce = setTimeout(() => {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      askedRef.current = { depth, strict: starters.length > 1 }
      const request: ChainRequest = { requestId, starters, target, maxDepth: depth }
      workerRef.current?.postMessage(request)
      timerRef.current = setTimeout(() => {
        if (requestIdRef.current !== requestId) return
        // Nothing is coming; invalidate the id so a late reply can't overwrite the error.
        requestIdRef.current = requestId + 1
        setState({ status: 'error', message: 'the chain search did not answer within 5 seconds' })
      }, TIMEOUT_MS)
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(debounce)
      clearTimer()
    }
  }, [attempt, clearTimer, depth, slotA, slotB, target])

  if (slotA === null || target === null) return <p className="panel-note">pick a starter and a target to plan a chain</p>

  const strictNow = slotB !== null
  const tile = (index: number) => <PalTile pal={ds.pals[index]} size="sm" onPromote={(slot) => setSlot(slot, index)} />

  return (
    <div className="chain-view">
      <div className="chain-head">
        <label className="label-caps" htmlFor="chain-depth">
          MAX BREEDS
        </label>
        <select
          id="chain-depth"
          className="depth-select"
          value={depth}
          onChange={(e) => setChainDepth(Number(e.target.value))}
        >
          {DEPTHS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span className="chain-mode">
          {strictNow ? 'strict — only the two pals you picked' : 'free partners — catch whatever a step needs'}
        </span>
      </div>

      {state.status === 'loading' && (
        <div className="chain-loading">
          <div className="dots" aria-label="searching for a chain">
            <span>▸</span>
            <span>▸</span>
            <span>▸</span>
          </div>
          <p className="label-caps">SEARCHING</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="chain-error">
          <p className="panel-note">{state.message}</p>
          <button type="button" className="retry-btn" onClick={() => setAttempt((n) => n + 1)}>
            RETRY
          </button>
        </div>
      )}

      {state.status === 'done' && state.steps !== null && state.steps.length === 0 && (
        <p className="panel-note">already have it — {ds.pals[target].name} is among your starters</p>
      )}

      {state.status === 'done' && state.steps !== null && state.steps.length > 0 && (
        <ol className="chain-steps">
          {state.steps.map((step, i) => (
            <li className="chain-step" key={step.child}>
              <span className="step-num">STEP {i + 1}</span>
              <div className="step-row">
                {tile(step.a)}
                <span className="cell-op" aria-hidden="true">
                  ×
                </span>
                {tile(step.b)}
                <span className="cell-op" aria-hidden="true">
                  →
                </span>
                {tile(step.child)}
              </div>
            </li>
          ))}
        </ol>
      )}

      {state.status === 'done' && state.steps === null && !state.strict && (
        <div className="chain-error">
          <p className="panel-note">no path within {state.depth} breeds — raise depth?</p>
          {state.depth < DEPTHS[DEPTHS.length - 1] && (
            <button
              type="button"
              className="retry-btn"
              aria-label={`raise depth to ${state.depth + 1}`}
              onClick={() => setChainDepth(state.depth + 1)}
            >
              +
            </button>
          )}
        </div>
      )}

      {state.status === 'done' && state.steps === null && state.strict && (
        <p className="panel-note">
          no path within {state.depth} breeds using only these pals — chains here use ONLY the pals you selected (+
          their children); try adding another starter or use a single starter for free-partner chains
        </p>
      )}
    </div>
  )
}
