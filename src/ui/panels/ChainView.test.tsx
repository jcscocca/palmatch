import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import type { ChainRequest, ChainResponse, ChainStep, Dataset } from '../../engine/types.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { DatasetContext } from '../dataset-context.ts'
import { ChainView } from './ChainView.tsx'

let ds: Dataset
let workers: FakeWorker[]

/** Stands in for the module worker: records what was posted, replies on demand. */
class FakeWorker {
  onmessage: ((event: MessageEvent<ChainResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: ChainRequest[] = []
  terminated = false

  constructor() {
    workers.push(this)
  }

  postMessage(request: ChainRequest): void {
    this.posted.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(response: ChainResponse): void {
    act(() => {
      this.onmessage?.({ data: response } as MessageEvent<ChainResponse>)
    })
  }
}

function idx(name: string): number {
  const i = ds.pals.findIndex((p) => p.name === name)
  expect(i).toBeGreaterThanOrEqual(0)
  return i
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

beforeEach(() => {
  workers = []
  useWorkbenchStore.getState().clearAll()
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function show() {
  render(
    <DatasetContext value={ds}>
      <ChainView />
    </DatasetContext>,
  )
}

/** The single worker the panel owns, once the debounced request has actually gone out. */
async function pending(): Promise<FakeWorker> {
  const worker = workers[0]
  await waitFor(() => expect(worker.posted.length).toBeGreaterThan(0))
  return worker
}

describe('ChainView', () => {
  it('shows the search running, then the steps it comes back with', async () => {
    const lamball = idx('Lamball')
    const relaxaurus = idx('Relaxaurus')
    const target = idx('Relaxaurus Lux')
    useWorkbenchStore.getState().setSlot('a', lamball)
    useWorkbenchStore.getState().setSlot('t', target)

    show()
    expect(screen.getByLabelText('searching for a chain')).toBeTruthy()

    const worker = await pending()
    const request = worker.posted[0]
    expect(request.starters).toEqual([lamball])
    expect(request.maxDepth).toBe(useWorkbenchStore.getState().chainDepth)

    const steps: ChainStep[] = [
      { a: lamball, b: relaxaurus, child: idx('Sparkit') },
      { a: idx('Sparkit'), b: relaxaurus, child: target },
    ]
    worker.reply({ ok: true, requestId: request.requestId, steps })

    expect(screen.getByText('STEP 1')).toBeTruthy()
    expect(screen.getByText('STEP 2')).toBeTruthy()
    expect(screen.queryByLabelText('searching for a chain')).toBeNull()
    expect(screen.getAllByText('Relaxaurus Lux').length).toBeGreaterThan(0)
  })

  it('ignores a reply carrying a stale request id', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Grizzbolt'))
    show()

    const worker = await pending()
    const request = worker.posted[0]
    worker.reply({ ok: true, requestId: request.requestId + 99, steps: [] })
    expect(screen.getByLabelText('searching for a chain')).toBeTruthy()

    worker.reply({ ok: true, requestId: request.requestId, steps: [] })
    expect(screen.getByText('already have it — Grizzbolt is among your starters')).toBeTruthy()
  })

  it('explains the strict semantics when two starters find no path', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('b', idx('Melpaca'))
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()

    const worker = await pending()
    expect(worker.posted[0].starters).toHaveLength(2)
    worker.reply({ ok: true, requestId: worker.posted[0].requestId, steps: null })

    expect(screen.getByText(/chains here use ONLY the pals you selected/)).toBeTruthy()
    expect(screen.queryByText(/raise depth/)).toBeNull()
  })

  it('offers a depth bump when a single starter finds no path', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()

    const worker = await pending()
    const depth = useWorkbenchStore.getState().chainDepth
    worker.reply({ ok: true, requestId: worker.posted[0].requestId, steps: null })
    expect(screen.getByText(`no path within ${depth} breeds — raise depth?`)).toBeTruthy()

    fireEvent.click(screen.getByLabelText(`raise depth to ${depth + 1}`))
    expect(useWorkbenchStore.getState().chainDepth).toBe(depth + 1)
    await waitFor(() => expect(worker.posted).toHaveLength(2))
    expect(worker.posted[1].maxDepth).toBe(depth + 1)
  })

  it('surfaces a worker error with a retry', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Grizzbolt'))
    show()

    const worker = await pending()
    worker.reply({ ok: false, requestId: worker.posted[0].requestId, error: 'failed to fetch /data/pals.json' })
    expect(screen.getByText('failed to fetch /data/pals.json')).toBeTruthy()

    fireEvent.click(screen.getByText('RETRY'))
    await waitFor(() => expect(worker.posted).toHaveLength(2))
  })

  it('terminates its worker on unmount', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Grizzbolt'))
    show()
    const worker = await pending()

    cleanup()
    expect(worker.terminated).toBe(true)
  })
})
