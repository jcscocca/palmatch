import { Inflate } from 'pako'
import { loadOoz, type OozDecompress } from './ooz.ts'
import { ParseError } from './types.ts'

/**
 * The outer `.sav` container (reference §1): a 12-byte header, then a compressed GVAS blob.
 *
 * ```
 * 0  u32 uncompressedLen   4  u32 compressedLen   8  ascii magic   11  u8 saveType
 * ```
 *
 * Dispatch is on the 3-byte magic first, then the digit — the two are not interchangeable
 * (`PlZ1` also carries saveType 0x31, which the upstream enum conflates). Getting this wrong is the
 * single most common port bug: before Oodle detection existed, every post-0.6 save was assumed zlib
 * and failed to import.
 */

const MIN_SAVE_BYTES = 24

/**
 * Ceiling on the *declared* decompressed length, checked before anything is allocated. Real worlds
 * top out in the low hundreds of MB decompressed; a header claiming more is either corrupt or a
 * save we could not walk without exhausting the tab anyway.
 */
export const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024

export interface SaveWrapper {
  /** Three ASCII bytes: `PlZ`, `PlM` or `CNK`. */
  magic: string
  saveType: number
  uncompressedLen: number
  compressedLen: number
  dataOffset: number
}

function ascii(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`
  return out
}

/**
 * Reads and validates the outer header. `CNK0` (Xbox / Game Pass) is rejected rather than unwrapped:
 * its real header repeats 12 bytes later (PST re-reads both lengths at 12/16; palcalc keeps the
 * outer ones and gets Oodle lengths wrong), and multi-part variants have no inner header at all.
 * Out of scope for a first pass, so it gets its own code instead of a confusing generic failure.
 */
export function sniffWrapper(bytes: Uint8Array): SaveWrapper {
  if (bytes.byteLength < MIN_SAVE_BYTES) {
    throw new ParseError('not-a-save', `the file is ${bytes.byteLength} bytes; a Palworld save is at least ${MIN_SAVE_BYTES}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const uncompressedLen = view.getUint32(0, true)
  const compressedLen = view.getUint32(4, true)
  const magic = ascii(bytes.subarray(8, 11))
  const saveType = bytes[11]

  if (magic === 'CNK') {
    throw new ParseError(
      'xbox-save',
      'this is an Xbox / Game Pass save (CNK0 container), which palmatch cannot read yet',
    )
  }
  if (magic !== 'PlZ' && magic !== 'PlM') {
    throw new ParseError(
      'unknown-magic',
      `unrecognised save magic "${magic}" (0x${saveType.toString(16)}) — this doesn't look like a Palworld .sav`,
    )
  }
  if (uncompressedLen > MAX_DECOMPRESSED_BYTES) {
    throw new ParseError(
      'too-large',
      `the save declares ${Math.round(uncompressedLen / 1024 / 1024)} MB of decompressed data, past the ${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MB limit`,
    )
  }
  return { magic, saveType, uncompressedLen, compressedLen, dataOffset: 12 }
}

/** How much compressed input to hand pako between output-size checks. */
const INFLATE_STEP = 1 << 20

/**
 * One zlib pass, refusing to expand past `limit` bytes.
 *
 * The bound matters: a zlib stream can expand ~1000x, so a one-shot `inflate()` would let a
 * corrupt or hostile file allocate tens of GB and kill the worker outright, before any of the
 * header's length checks could run. Feeding pako the input in slices lets us stop within one slice
 * of the limit and answer with a `ParseError` like every other bad file. `limit` is the length the
 * save's own header declares, so a well-formed file never comes close to it.
 */
function inflateOnce(data: Uint8Array, limit: number, pass: string): Uint8Array {
  const inflator = new Inflate()
  const chunks: Uint8Array[] = []
  let total = 0
  inflator.onData = (chunk) => {
    chunks.push(chunk)
    total += chunk.length
  }

  for (let at = 0; at < data.byteLength; at += INFLATE_STEP) {
    const end = Math.min(at + INFLATE_STEP, data.byteLength)
    inflator.push(data.subarray(at, end), end === data.byteLength)
    if (total > limit) {
      throw new ParseError(
        'truncated',
        `the ${pass} zlib stream expands past the ${limit} bytes the save's header declares — the file is corrupt`,
      )
    }
    if (inflator.ended) break
  }
  if (inflator.err !== 0) {
    throw new ParseError(
      'truncated',
      `the ${pass} zlib stream would not decompress (${inflator.msg}) — the file looks corrupt or incomplete`,
    )
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * `.sav` bytes in, GVAS bytes out.
 *
 * `loadOozFn` is injectable so tests can drive the `PlM1` path without compiling the wasm; in
 * production it is the lazy dynamic import, which is why this is async even for zlib saves.
 * Failure modes are deliberately split: a decompressor that won't *load* is our problem
 * (`internal`), whereas a stream that won't *decode* is a statement about the file (`truncated`).
 */
export async function decompressSave(
  buffer: ArrayBuffer,
  loadOozFn: () => Promise<OozDecompress> = loadOoz,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(buffer)
  const header = sniffWrapper(bytes)
  const { magic, saveType, uncompressedLen, compressedLen, dataOffset } = header

  let out: Uint8Array
  if (magic === 'PlM') {
    if (dataOffset + compressedLen > bytes.byteLength) {
      throw new ParseError(
        'truncated',
        `the save says its Oodle payload is ${compressedLen} bytes but only ${bytes.byteLength - dataOffset} follow the header`,
      )
    }
    let decompress: OozDecompress
    try {
      decompress = await loadOozFn()
    } catch (cause) {
      throw new ParseError(
        'internal',
        `the Oodle decompressor (ooz-wasm) failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    try {
      // `decompress` (not `decompressUnsafe`) copies out of the wasm heap — see ooz.ts.
      out = decompress(bytes.subarray(dataOffset, dataOffset + compressedLen), uncompressedLen)
    } catch (cause) {
      throw new ParseError(
        'truncated',
        `Oodle decompression failed (${cause instanceof Error ? cause.message : String(cause)}) — the file looks corrupt or incomplete`,
      )
    }
  } else {
    // For a double-deflate save `compressedLen` describes the *intermediate* blob, not the payload
    // on disk, so this length check only makes sense for the single-deflate form.
    if (saveType !== 0x32 && compressedLen > bytes.byteLength - dataOffset) {
      throw new ParseError(
        'truncated',
        `the save says its payload is ${compressedLen} bytes but only ${bytes.byteLength - dataOffset} follow the header`,
      )
    }
    // Only 0x32 is double-deflated; anything else is single, following palcalc's default rather
    // than PST's stricter rejection — a wrong guess here surfaces as a length mismatch below.
    const double = saveType === 0x32
    out = inflateOnce(bytes.subarray(dataOffset), double ? compressedLen : uncompressedLen, 'first')
    if (double) {
      // The strongest early corruption signal there is (`PST compressor/zlib.py:71-72`).
      if (out.byteLength !== compressedLen) {
        throw new ParseError(
          'truncated',
          `after the first inflate the save is ${out.byteLength} bytes, not the ${compressedLen} its header declares`,
        )
      }
      out = inflateOnce(out, uncompressedLen, 'second')
    }
  }

  if (out.byteLength !== uncompressedLen) {
    throw new ParseError(
      'truncated',
      `the save decompressed to ${out.byteLength} bytes, not the ${uncompressedLen} its header declares`,
    )
  }
  return out
}
