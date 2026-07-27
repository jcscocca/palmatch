import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from './dataset.ts'
import type { ChainRequest, ChainResponse, Dataset } from './types.ts'

const loadDataset = vi.hoisted(() => vi.fn())

vi.mock('./dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dataset.ts')>()),
  loadDataset,
}))

interface FakeScope {
  onmessage: ((event: MessageEvent<ChainRequest>) => void) | null
  postMessage(message: ChainResponse): void
}

let ds: Dataset
let posted: ChainResponse[]
let scope: FakeScope

function idx(id: string): number {
  const i = ds.byId.get(id)
  if (i === undefined) throw new Error(`unknown pal: ${id}`)
  return i
}

/** Loads the worker against the stubbed scope and hands back its message port. */
async function boot(): Promise<(req: ChainRequest) => void> {
  await import('./chains.worker.ts')
  const handler = scope.onmessage
  if (handler === null) throw new Error('worker never registered a message handler')
  return (req) => handler({ data: req } as unknown as MessageEvent<ChainRequest>)
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

beforeEach(() => {
  posted = []
  scope = {
    onmessage: null,
    postMessage: (message) => {
      posted.push(message)
    },
  }
  loadDataset.mockReset()
  vi.resetModules()
  vi.stubGlobal('self', scope)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chains.worker', () => {
  it('answers a request with the chain and the id it was asked for', async () => {
    loadDataset.mockResolvedValue(ds)
    const send = await boot()

    send({ requestId: 7, starters: [idx('LazyDragon'), idx('ElecCat')], target: idx('LazyDragon_Electric') })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      ok: true,
      requestId: 7,
      steps: [
        {
          a: Math.min(idx('LazyDragon'), idx('ElecCat')),
          b: Math.max(idx('LazyDragon'), idx('ElecCat')),
          child: idx('LazyDragon_Electric'),
        },
      ],
    })
  })

  it('loads the dataset once across requests', async () => {
    loadDataset.mockResolvedValue(ds)
    const send = await boot()

    send({ requestId: 1, starters: [idx('SheepBall')], target: idx('LazyDragon_Electric') })
    send({ requestId: 2, starters: [idx('SheepBall')], target: idx('SheepBall'), maxDepth: 2 })

    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted.map((m) => m.requestId)).toEqual([1, 2])
    expect(posted[1]).toEqual({ ok: true, requestId: 2, steps: [] })
    expect(loadDataset).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable target as a null chain rather than an error', async () => {
    loadDataset.mockResolvedValue(ds)
    const send = await boot()

    send({ requestId: 3, starters: [idx('SheepBall')], target: idx('LazyDragon_Electric'), maxDepth: 0 })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({ ok: true, requestId: 3, steps: null })
  })

  it('reports a failed load, then retries it on the next request', async () => {
    loadDataset.mockRejectedValueOnce(new Error('failed to fetch /data/pals.json')).mockResolvedValue(ds)
    const send = await boot()

    send({ requestId: 1, starters: [idx('SheepBall')], target: idx('LazyDragon_Electric') })
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({ ok: false, requestId: 1, error: 'failed to fetch /data/pals.json' })

    send({ requestId: 2, starters: [idx('SheepBall')], target: idx('LazyDragon_Electric') })
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ ok: true, requestId: 2 })
    expect(loadDataset).toHaveBeenCalledTimes(2)
  })
})
