import { parseSave } from './parse.ts'
import { ParseError, type SaveImportRequest, type SaveImportResponse } from './types.ts'

/**
 * Save parsing off the main thread: a 400 MB decompress plus a full property walk would otherwise
 * freeze the tab for seconds. Same protocol as `chains.worker.ts` — the request id comes back on the
 * answer so a stale reply is discardable — with two differences: the ArrayBuffer is transferred
 * rather than copied, and failures carry a `ParseErrorCode` instead of a message, because the panel
 * switches on the code exhaustively to choose its copy.
 *
 * Contract with the panel: every failure has a code from `ParseErrorCode`. Anything the parser
 * didn't anticipate lands on `internal` rather than being dressed up as a diagnosis of the file.
 *
 * Verified here against a stubbed scope, as jsdom can't instantiate a real module worker; the
 * real-browser run (Safari included, where wasm in a module worker is the risk) happens at F6.
 */

/** `lib.dom` types `self` as a window, whose `postMessage` takes a target origin. This is the worker's. */
interface WorkerScope {
  /** `data` is optional because a worker's inbox is not ours alone — see `run`. */
  onmessage: ((event: MessageEvent<SaveImportRequest | undefined>) => void) | null
  postMessage(message: SaveImportResponse): void
}

const ctx = self as unknown as WorkerScope

/**
 * The id is read *before* the try, and defensively: a message that isn't a request at all — an
 * empty `postMessage`, a probe from an extension — would otherwise throw while building the failure
 * response, leaving `run` rejecting with nothing sent and the panel waiting out its full timeout.
 * `-1` matches no in-flight id, so the panel discards it, which is the right fate for a reply to a
 * question nobody asked.
 */
async function run(req: SaveImportRequest | undefined): Promise<void> {
  const requestId = req?.requestId ?? -1
  try {
    if (req === undefined) throw new TypeError('the import worker was sent a message with no request in it')
    const result = await parseSave(req.buffer, new Map(req.byIdLower))
    ctx.postMessage({ ok: true, requestId, result })
  } catch (cause) {
    const response: SaveImportResponse =
      cause instanceof ParseError
        ? { ok: false, requestId, code: cause.code, detail: cause.message }
        : {
            ok: false,
            requestId,
            code: 'internal',
            detail: cause instanceof Error ? cause.message : String(cause),
          }
    ctx.postMessage(response)
  }
}

ctx.onmessage = (event) => {
  void run(event.data)
}
