import { Inflate } from 'pako'

/**
 * One zlib pass that refuses to expand past a byte budget.
 *
 * The bound is the whole point: a zlib stream can expand ~1000x, so a one-shot `inflate()` lets a
 * corrupt or hostile input allocate tens of GB and kill the thread it runs on before any
 * caller-side length check can fire. Both callers need exactly this and for the same reason — the
 * save wrapper inflates a file the user picked, the share codec inflates a blob out of a link
 * someone else wrote — so the streaming-limit core lives here once rather than twice.
 *
 * The check lives *inside* pako's output callback, which is the only place that sees each block as
 * it is produced; checking between `push()` calls would let a whole slice of input expand first.
 * pako hands out `chunkSize` blocks (64 KiB by default) and has no try/catch around the callback,
 * so throwing here stops the decode with at most one block of overshoot past the limit.
 */

/**
 * Why a bounded inflate stopped. `corrupt` is pako's own verdict on the stream (`message` carries
 * its text); `overflow` is ours, and `produced` is how far it got before we cut it off.
 */
export type InflateFailure = 'corrupt' | 'overflow'

export class BoundedInflateError extends Error {
  readonly reason: InflateFailure
  readonly produced: number

  constructor(reason: InflateFailure, produced: number, message: string) {
    super(message)
    this.name = 'BoundedInflateError'
    this.reason = reason
    this.produced = produced
  }
}

/** Inflates `data`, throwing `BoundedInflateError` rather than producing more than `limit` bytes. */
export function boundedInflate(data: Uint8Array, limit: number): Uint8Array {
  const inflator = new Inflate()
  const chunks: Uint8Array[] = []
  let total = 0
  inflator.onData = (chunk) => {
    total += chunk.length
    if (total > limit) {
      throw new BoundedInflateError('overflow', total, `the stream expands past ${limit} bytes (stopped after ${total})`)
    }
    chunks.push(chunk)
  }

  inflator.push(data, true)
  if (inflator.err !== 0) throw new BoundedInflateError('corrupt', total, inflator.msg)

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
