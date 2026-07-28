import { deflate } from 'pako'
import { describe, expect, it } from 'vitest'
import {
  decodeOwnedShare,
  encodeOwnedShare,
  ownedShareLink,
  parseOwnedShareJson,
  sanitizeShare,
  shareJson,
  shareSpecies,
} from './owned-share.ts'
import type { OwnedBySpecies } from './owned.ts'

const SAMPLE: OwnedBySpecies = {
  3: { count: 2, individuals: [{ gender: 'F', passives: ['Swift'], talents: null }] },
  11: { count: 1, individuals: [] },
}

/** Hand-built blobs for the failure table: a real deflate stream around bytes we choose. */
function blobOf(payload: string | Uint8Array): string {
  const bytes = deflate(payload)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('share codec', () => {
  it('round-trips species and counts, and leaves individuals out of the payload', () => {
    const blob = encodeOwnedShare(SAMPLE)
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/)

    const decoded = decodeOwnedShare(blob)
    expect(decoded).toEqual({ v: 1, species: [[3, 2], [11, 1]] })
    expect(JSON.stringify(decoded)).not.toContain('Swift')
  })

  it('builds a link on the current origin and path, with no query string carried over', () => {
    const location = { origin: 'https://example.test', pathname: '/palmatch/' } as Location
    expect(ownedShareLink(SAMPLE, location)).toBe(`https://example.test/palmatch/#/own/${encodeOwnedShare(SAMPLE)}`)
  })

  it.each([
    ['an empty blob', ''],
    ['characters outside base64url', 'not a blob!'],
    ['base64url that is not deflate', 'aGVsbG8gd29ybGQ'],
    ['a deflate stream of the wrong payload', blobOf('{"v":1,"species":[["3",2]]}')],
    ['a payload from another version', blobOf('{"v":9,"species":[[3,2]]}')],
    ['a negative species index', blobOf('{"v":1,"species":[[-1,2]]}')],
    ['a zero count', blobOf('{"v":1,"species":[[3,0]]}')],
    // `Number.isInteger` says yes to both of these; `isSafeInteger` is what refuses them, and the
    // store's `validateStored` refuses them the same way.
    ['a count past the safe-integer range', blobOf('{"v":1,"species":[[3,1e21]]}')],
    ['a species index past the safe-integer range', blobOf('{"v":1,"species":[[1e21,3]]}')],
    ['bytes that are not UTF-8 text', blobOf(new Uint8Array([0xff, 0xfe, 0xff, 0xfe]))],
  ])('decodes %s to null instead of throwing', (_label, blob) => {
    expect(() => decodeOwnedShare(blob)).not.toThrow()
    expect(decodeOwnedShare(blob)).toBeNull()
  })

  it('decodes a tampered blob to null', () => {
    const blob = encodeOwnedShare(SAMPLE)
    const flipped = `${blob.slice(0, 4)}${blob[4] === 'A' ? 'B' : 'A'}${blob.slice(5)}`
    expect(decodeOwnedShare(flipped)).toBeNull()
  })

  it('refuses a blob far larger than any real owned list, before inflating it', () => {
    expect(decodeOwnedShare('A'.repeat(20000))).toBeNull()
  })

  it('decodes a deflate stream that was cut short to null', () => {
    // Half a link — a chat client that wrapped the URL, a hand-typed paste. pako reports an error
    // on the incomplete stream rather than handing back the bytes it managed.
    const bytes = deflate(shareJson(SAMPLE))
    let binary = ''
    for (const byte of bytes.subarray(0, Math.floor(bytes.length / 2))) binary += String.fromCharCode(byte)
    const truncated = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeOwnedShare(truncated)).toBeNull()
  })

  it('refuses a small blob that inflates into a large one', () => {
    // A zip bomb in a link: 4 MB of zeroes deflate to ~4 KB, well inside the blob-length cap, and a
    // one-shot inflate on the main thread would allocate the lot before anything could object.
    const bomb = blobOf(new Uint8Array(4 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(16384)
    expect(decodeOwnedShare(bomb)).toBeNull()
  })

  it('shares the same payload with the .palmatch.json file', () => {
    expect(parseOwnedShareJson(shareJson(SAMPLE))).toEqual(decodeOwnedShare(encodeOwnedShare(SAMPLE)))
    expect(parseOwnedShareJson('{')).toBeNull()
    expect(parseOwnedShareJson('[]')).toBeNull()
  })

  it('sorts the payload by species index, so the same list always yields the same link', () => {
    const reversed: OwnedBySpecies = { 11: SAMPLE[11], 3: SAMPLE[3] }
    expect(shareSpecies(reversed)).toEqual([
      [3, 2],
      [11, 1],
    ])
    expect(encodeOwnedShare(reversed)).toBe(encodeOwnedShare(SAMPLE))
  })

  it('drops species the receiving build does not have, and says how many', () => {
    expect(sanitizeShare([[1, 2], [900, 1]], 200)).toEqual({ species: [[1, 2]], dropped: 1 })
  })
})
