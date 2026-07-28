import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import type { ChainRequest, ChainResponse, ChainStep, Dataset } from '../../engine/types.ts'
import { useOwnedStore } from '../../state/owned.ts'
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
  useOwnedStore.getState().clearOwned()
  vi.stubGlobal('Worker', FakeWorker)
})

/** Counts don't reach the chain search — species do — so one of each is all a fixture needs. */
function own(...names: string[]): number[] {
  const indices = names.map(idx)
  act(() => {
    useOwnedStore.getState().loadShared(indices.map((index) => [index, 1]))
  })
  return [...indices].sort((a, b) => a - b)
}

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

  it('ignores the answer to the question the previous slots asked', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Grizzbolt'))
    show()

    const worker = await pending()
    const stale = worker.posted[0].requestId

    // The target changes and the old answer lands inside the debounce window — the screen is
    // already showing the new target, so rendering it would attribute a Grizzbolt chain to
    // Relaxaurus Lux.
    act(() => {
      useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    })
    worker.reply({ ok: true, requestId: stale, steps: [] })
    expect(screen.getByLabelText('searching for a chain')).toBeTruthy()
    expect(screen.queryByText(/already have it/)).toBeNull()

    await waitFor(() => expect(worker.posted).toHaveLength(2))
    expect(worker.posted[1].requestId).toBeGreaterThan(stale)
    worker.reply({ ok: true, requestId: worker.posted[1].requestId, steps: [] })
    expect(screen.getByText('already have it — Relaxaurus Lux is among your starters')).toBeTruthy()
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

  it('retries on a fresh worker, since the failed one may never answer again', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Grizzbolt'))
    show()

    const worker = await pending()
    worker.reply({ ok: false, requestId: worker.posted[0].requestId, error: 'failed to fetch /data/pals.json' })
    expect(screen.getByText('failed to fetch /data/pals.json')).toBeTruthy()

    fireEvent.click(screen.getByText('RETRY'))
    await waitFor(() => expect(workers).toHaveLength(2))
    expect(worker.terminated).toBe(true)
    await waitFor(() => expect(workers[1].posted).toHaveLength(1))
    expect(worker.posted).toHaveLength(1)
  })

  it('offers no MY PALS toggle to a player who has imported nothing', async () => {
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Grizzbolt'))
    show()

    expect(screen.queryByText('USE MY PALS')).toBeNull()
    expect(screen.getByText('free partners — catch whatever a step needs')).toBeTruthy()
    expect((await pending()).posted[0].starters).toEqual([idx('Lamball')])
  })

  it('starts from the owned list when no parent slot is filled', async () => {
    const owned = own('Lamball', 'Chikipi')
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()

    // This is the target-mode CHAINS tab: there is no starter slot to read, so the palbox is the
    // only thing that makes the search answerable — hence on by default.
    expect(screen.getByText('USE MY PALS').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('2 owned species as starters')).toBeTruthy()
    expect((await pending()).posted[0].starters).toEqual(owned)
  })

  it('merges the owned list into the picked starters, deduped, once switched on', async () => {
    const owned = own('Lamball', 'Chikipi')
    const melpaca = idx('Melpaca')
    useWorkbenchStore.getState().setSlot('a', melpaca)
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()

    // A hand-picked parent means "chain from this one", so the toggle starts off.
    const toggle = screen.getByText('USE MY PALS')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    const worker = await pending()
    expect(worker.posted[0].starters).toEqual([melpaca])

    fireEvent.click(toggle)
    await waitFor(() => expect(worker.posted).toHaveLength(2))
    expect(worker.posted[1].starters).toEqual([...owned, melpaca])

    // The pal already in a slot is a starter once, not twice.
    act(() => {
      useWorkbenchStore.getState().setSlot('a', owned[0])
    })
    await waitFor(() => expect(worker.posted).toHaveLength(3))
    expect(worker.posted[2].starters).toEqual(owned)
  })

  it('says so rather than searching when the owned starters are switched back off', async () => {
    own('Lamball', 'Chikipi')
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()
    const worker = await pending()

    fireEvent.click(screen.getByText('USE MY PALS'))
    expect(screen.getByText('nothing to chain from — turn USE MY PALS back on, or pick a parent')).toBeTruthy()
    expect(screen.queryByLabelText('searching for a chain')).toBeNull()

    // Nothing new is asked, and the answer to the question that was in flight is dropped.
    worker.reply({ ok: true, requestId: worker.posted[0].requestId, steps: [] })
    expect(screen.queryByText(/already have it/)).toBeNull()
    expect(worker.posted).toHaveLength(1)
  })

  it('ticks the steps built from pals the player already owns', async () => {
    const sparkit = idx('Sparkit')
    own('Sparkit')
    useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()

    const worker = await pending()
    const steps: ChainStep[] = [
      { a: idx('Lamball'), b: idx('Relaxaurus'), child: sparkit },
      { a: sparkit, b: idx('Relaxaurus'), child: idx('Relaxaurus Lux') },
    ]
    worker.reply({ ok: true, requestId: worker.posted[0].requestId, steps })

    // Sparkit twice: bred in step 1, paired again in step 2. Nothing else is owned.
    expect(screen.getAllByLabelText('owned')).toHaveLength(2)
    for (const tick of screen.getAllByLabelText('owned')) {
      expect(tick.closest('.pal-tile')?.querySelector('.pal-name')?.textContent).toBe('Sparkit')
    }
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
