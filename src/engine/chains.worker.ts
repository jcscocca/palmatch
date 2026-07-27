import { findChains } from './chains.ts'
import { loadDataset } from './dataset.ts'
import type { ChainRequest, ChainResponse, Dataset } from './types.ts'

/** `lib.dom` types `self` as a window, whose `postMessage` takes a target origin. This is the worker's. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ChainRequest>) => void) | null
  postMessage(message: ChainResponse): void
}

const ctx = self as unknown as WorkerScope

/** The dataset outlives one request; a failed load is dropped so the next request retries it. */
let dataset: Promise<Dataset> | undefined

async function run(req: ChainRequest): Promise<void> {
  try {
    dataset ??= loadDataset(req.baseUrl)
    const ds = await dataset
    const steps = findChains(ds, req.starters, req.target, req.maxDepth)
    ctx.postMessage({ ok: true, requestId: req.requestId, steps })
  } catch (cause) {
    dataset = undefined
    const error = cause instanceof Error ? cause.message : String(cause)
    ctx.postMessage({ ok: false, requestId: req.requestId, error })
  }
}

ctx.onmessage = (event) => {
  void run(event.data)
}
