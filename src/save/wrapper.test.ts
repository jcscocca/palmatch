import { describe, expect, it, vi } from 'vitest'
import { build, cnk0, junkFile, levelGvas, plm1, plz1, plz2, truncateTo } from './fixtures/builder.ts'
import type { OozDecompress } from './ooz.ts'
import { codeOf, detailOf } from './test-utils.ts'
import { ParseError } from './types.ts'
import { decompressSave, MAX_DECOMPRESSED_BYTES, sniffWrapper } from './wrapper.ts'

/** Rewrites one of the header's two u32 lengths, to fake the corruption a real file would show. */
function patchU32(buffer: ArrayBuffer, offset: number, value: number): ArrayBuffer {
  const copy = buffer.slice(0)
  new DataView(copy).setUint32(offset, value, true)
  return copy
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

  it('bounds the intermediate length too, since a PlZ2 first pass is budgeted by it', () => {
    // The adversarial header: a tiny final size to look harmless, 4 GB of intermediate to inflate
    // into. Nothing may read this far — the rejection has to come out of the sniff itself.
    const evil = build((w) => {
      w.u32(4096).u32(0xffffffff)
      for (const ch of 'PlZ') w.u8(ch.charCodeAt(0))
      w.u8(0x32)
      w.zeros(64)
    })
    try {
      sniffWrapper(evil)
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ParseError).code).toBe('too-large')
      expect((error as ParseError).message).toMatch(/intermediate/)
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
    const limit = 4096
    const bomb = plz1(new Uint8Array(64 * 1024 * 1024))
    const capped = patchU32(bomb, 0, limit)

    const started = performance.now()
    const detail = await detailOf(decompressSave(capped))
    expect(performance.now() - started).toBeLessThan(1000)
    expect(await codeOf(decompressSave(capped))).toBe('truncated')

    // Load-bearing: how much it actually let through before giving up. pako emits output in
    // `chunkSize` blocks and the guard runs on each one, so the overshoot is bounded by a single
    // block (64 KiB by default) — not by the 64 MB the stream wanted to produce.
    const stopped = Number(/stopped after (\d+)/.exec(detail)?.[1])
    expect(stopped).toBeGreaterThan(limit)
    expect(stopped).toBeLessThanOrEqual(limit + 64 * 1024)
  })

  it('rejects a PlM1 whose payload runs off the end of the file', async () => {
    const short = patchU32(plm1(gvas), 4, 4096)
    expect(await codeOf(decompressSave(short, () => Promise.resolve(() => gvas)))).toBe('truncated')
  })
})
