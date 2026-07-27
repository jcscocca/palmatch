import { describe, expect, it, vi } from 'vitest'
import { cnk0, junkFile, levelGvas, plm1, plz1, plz2, truncateTo } from './fixtures/builder.ts'
import type { OozDecompress } from './ooz.ts'
import { ParseError } from './types.ts'
import { decompressSave, MAX_DECOMPRESSED_BYTES, sniffWrapper } from './wrapper.ts'

/** Rewrites one of the header's two u32 lengths, to fake the corruption a real file would show. */
function patchU32(buffer: ArrayBuffer, offset: number, value: number): ArrayBuffer {
  const copy = buffer.slice(0)
  new DataView(copy).setUint32(offset, value, true)
  return copy
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ParseError) return error.code
    throw error
  }
  throw new Error('expected a ParseError, got a successful parse')
}

const gvas = levelGvas({ pals: [{}] })

describe('sniffWrapper', () => {
  it('reads the four header fields off a PlZ1 save', () => {
    const header = sniffWrapper(new Uint8Array(plz1(gvas)))
    expect(header.magic).toBe('PlZ')
    expect(header.saveType).toBe(0x31)
    expect(header.uncompressedLen).toBe(gvas.length)
    expect(header.dataOffset).toBe(12)
  })

  it('rejects a file too short to hold a header', () => {
    expect(() => sniffWrapper(new Uint8Array(23))).toThrow(/at least 24/)
    try {
      sniffWrapper(new Uint8Array(23))
    } catch (error) {
      expect((error as ParseError).code).toBe('not-a-save')
    }
  })

  it('names the Xbox container instead of trying to unwrap it', () => {
    try {
      sniffWrapper(new Uint8Array(cnk0(plz1(gvas))))
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ParseError).code).toBe('xbox-save')
      expect((error as ParseError).message).toMatch(/CNK0/)
    }
  })

  it('rejects an unknown magic, quoting what it saw', () => {
    try {
      sniffWrapper(new Uint8Array(junkFile()))
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ParseError).code).toBe('unknown-magic')
      expect((error as ParseError).message).toMatch(/XYZ/)
    }
  })

  it('refuses a header claiming more decompressed data than we would ever hold', () => {
    const huge = patchU32(plz1(gvas), 0, MAX_DECOMPRESSED_BYTES + 1)
    try {
      sniffWrapper(new Uint8Array(huge))
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ParseError).code).toBe('too-large')
    }
  })
})

describe('decompressSave', () => {
  it('single-inflates a PlZ1 save back to the exact GVAS bytes', async () => {
    await expect(decompressSave(plz1(gvas))).resolves.toEqual(gvas)
  })

  it('double-inflates a PlZ2 save', async () => {
    await expect(decompressSave(plz2(gvas))).resolves.toEqual(gvas)
  })

  it('catches a PlZ2 whose intermediate length disagrees with the header', async () => {
    const bad = patchU32(plz2(gvas), 4, 999)
    expect(await codeOf(decompressSave(bad))).toBe('truncated')
    await expect(decompressSave(bad)).rejects.toThrow(/after the first inflate/)
  })

  it('catches a final length that disagrees with the header', async () => {
    const bad = patchU32(plz1(gvas), 0, gvas.length + 1)
    expect(await codeOf(decompressSave(bad))).toBe('truncated')
    await expect(decompressSave(bad)).rejects.toThrow(/decompressed to/)
  })

  it('reports a half-written file as truncated rather than as junk', async () => {
    const cut = truncateTo(plz1(gvas), 40)
    expect(await codeOf(decompressSave(cut))).toBe('truncated')
  })

  it('hands a PlM1 payload to the Oodle decompressor with the raw size from the header', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    const decompress = vi.fn<OozDecompress>(() => gvas)

    await expect(decompressSave(plm1(gvas, payload), () => Promise.resolve(decompress))).resolves.toEqual(gvas)

    expect(decompress).toHaveBeenCalledTimes(1)
    const [data, rawSize] = decompress.mock.calls[0]
    expect([...data]).toEqual([...payload])
    expect(rawSize).toBe(gvas.length)
  })

  it('never loads the Oodle decompressor for a zlib save', async () => {
    const load = vi.fn(() => Promise.reject(new Error('should not be reached')))
    await expect(decompressSave(plz1(gvas), load)).resolves.toEqual(gvas)
    expect(load).not.toHaveBeenCalled()
  })

  it('blames itself, not the file, when ooz-wasm will not load', async () => {
    const failed = decompressSave(plm1(gvas), () => Promise.reject(new Error('dynamic import failed')))
    expect(await codeOf(failed)).toBe('internal')
  })

  it('blames the file when Oodle refuses to decode it', async () => {
    const failed = decompressSave(plm1(gvas), () =>
      Promise.resolve(() => {
        throw new Error('Failed to decode')
      }),
    )
    expect(await codeOf(failed)).toBe('truncated')
  })

  it('stops a stream that expands far past its declared length, instead of exhausting the worker', async () => {
    // 64 MB of zeros deflate to a few KB. A one-shot inflate would allocate all of it — and a real
    // bomb, at ~1000:1 on a 500 MB file, would take the tab down before any length check ran.
    const bomb = plz1(new Uint8Array(64 * 1024 * 1024))
    const capped = patchU32(bomb, 0, 4096)

    const started = performance.now()
    expect(await codeOf(decompressSave(capped))).toBe('truncated')
    expect(performance.now() - started).toBeLessThan(1000)
    await expect(decompressSave(capped)).rejects.toThrow(/expands past/)
  })

  it('rejects a PlM1 whose payload runs off the end of the file', async () => {
    const short = patchU32(plm1(gvas), 4, 4096)
    expect(await codeOf(decompressSave(short, () => Promise.resolve(() => gvas)))).toBe('truncated')
  })
})
