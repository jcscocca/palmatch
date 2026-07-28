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
import type { OwnedBySpecies, SharedSpecies } from './owned.ts'

const SAMPLE: OwnedBySpecies = {
  3: { count: 2, genders: null, individuals: [{ gender: 'F', passives: ['Swift'], talents: null }] },
  11: { count: 1, genders: null, individuals: [] },
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

describe('share codec: genders', () => {
  const SPLIT: OwnedBySpecies = {
    3: { count: 2, genders: { males: 1, females: 1 }, individuals: [] },
    11: { count: 4, genders: { males: 4, females: 0 }, individuals: [] },
  }

  it('round-trips the split through both the link and the file', () => {
    const expected = {
      v: 1,
      species: [
        [3, 2, 1, 1],
        [11, 4, 4, 0],
      ],
    }
    expect(decodeOwnedShare(encodeOwnedShare(SPLIT))).toEqual(expected)
    expect(parseOwnedShareJson(shareJson(SPLIT))).toEqual(expected)
  })

  it('carries the split beside the pairs, never inside them', () => {
    // The shape is the whole backward-compatibility story: `v` stays 1 and every `species` entry
    // stays two elements long, because that is all the previous build will accept.
    const wire = JSON.parse(shareJson(SPLIT)) as { v: number; species: unknown[][]; g: unknown }
    expect(wire.v).toBe(1)
    expect(wire.species).toEqual([
      [3, 2],
      [11, 4],
    ])
    expect(wire.g).toEqual([
      [1, 1],
      [4, 0],
    ])
  })

  it('still loads in the build that shipped before genders existed', () => {
    // A faithful replica of that build's `validatePayload`: `v` must be 1, every entry must be a
    // two-element pair, and anything else in the object is ignored. If this ever stops passing, a
    // link made here has become a hard failure for anyone who has not reloaded the app.
    function oldBuildValidate(parsed: unknown): Array<[number, number]> | null {
      if (typeof parsed !== 'object' || parsed === null) return null
      const p = parsed as Record<string, unknown>
      if (p.v !== 1 || !Array.isArray(p.species)) return null
      const species: Array<[number, number]> = []
      for (const pair of p.species) {
        if (!Array.isArray(pair) || pair.length !== 2) return null
        const [index, count] = pair as unknown[]
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return null
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return null
        species.push([index, count])
      }
      return species
    }

    expect(oldBuildValidate(JSON.parse(shareJson(SPLIT)))).toEqual([
      [3, 2],
      [11, 4],
    ])
  })

  it('omits the gender field entirely when there is nothing to say', () => {
    // Byte-for-byte what this list produced before genders existed, so every link already pasted
    // into a Discord scrollback still decodes to exactly itself.
    const noSplit: OwnedBySpecies = { 3: { count: 2, genders: null, individuals: [] } }
    expect(shareJson(noSplit)).toBe('{"v":1,"species":[[3,2]]}')
    expect(decodeOwnedShare(encodeOwnedShare(noSplit))).toEqual({ v: 1, species: [[3, 2]] })
  })

  it('reads a link from before genders as unknown, not as a species with none', () => {
    // The other direction of compatibility: an old link, opened here. Two-element entries, and the
    // store turns those into `genders: null` — see `fromShared`.
    const decoded = parseOwnedShareJson('{"v":1,"species":[[3,2],[11,4]]}')
    expect(decoded?.species).toEqual([
      [3, 2],
      [11, 4],
    ])
    expect(decoded?.species.every((entry) => entry.length === 2)).toBe(true)
  })

  it('carries a mixed list, marking only the species whose split the sharer knew', () => {
    const mixed: OwnedBySpecies = {
      3: { count: 2, genders: { males: 2, females: 0 }, individuals: [] },
      11: { count: 4, genders: null, individuals: [] },
    }
    expect(JSON.parse(shareJson(mixed))).toEqual({ v: 1, species: [[3, 2], [11, 4]], g: [[2, 0], null] })
    expect(decodeOwnedShare(encodeOwnedShare(mixed))?.species).toEqual([[3, 2, 2, 0], [11, 4]])
  })

  it('keeps the payload deterministic with genders in it', () => {
    const reversed: OwnedBySpecies = { 11: SPLIT[11], 3: SPLIT[3] }
    expect(shareSpecies(reversed)).toEqual([
      [3, 2, 1, 1],
      [11, 4, 4, 0],
    ])
    expect(encodeOwnedShare(reversed)).toBe(encodeOwnedShare(SPLIT))
  })

  it('carries the split through sanitizeShare untouched', () => {
    expect(sanitizeShare([[1, 2, 1, 1], [900, 1, 1, 0]], 200)).toEqual({ species: [[1, 2, 1, 1]], dropped: 1 })
  })

  it.each([
    ['a gender column shorter than the species list', '{"v":1,"species":[[3,2],[11,4]],"g":[[1,1]]}'],
    ['a gender column that is not an array', '{"v":1,"species":[[3,2]],"g":7}'],
    ['a split that is not a pair', '{"v":1,"species":[[3,2]],"g":[[1]]}'],
    ['a fractional half', '{"v":1,"species":[[3,2]],"g":[[1.5,0]]}'],
    ['a negative half', '{"v":1,"species":[[3,2]],"g":[[-1,3]]}'],
    ['a half past the safe-integer range', '{"v":1,"species":[[3,2]],"g":[[1e21,0]]}'],
    // Short of the count is fine — ungendered pals — but past it describes nothing real.
    ['a split that outnumbers its count', '{"v":1,"species":[[3,2]],"g":[[2,1]]}'],
    ['a half that is not a number', '{"v":1,"species":[[3,2]],"g":[["1","1"]]}'],
  ])('refuses %s', (_label, json) => {
    expect(parseOwnedShareJson(json)).toBeNull()
    expect(decodeOwnedShare(blobOf(json))).toBeNull()
  })

  it('accepts a split that falls short of the count, since the save may not have gendered every pal', () => {
    expect(parseOwnedShareJson('{"v":1,"species":[[3,3]],"g":[[2,0]]}')).toEqual({ v: 1, species: [[3, 3, 2, 0]] })
  })
})

describe('sanitizeShare deduping', () => {
  it('collapses a crafted link that repeats one index, so the confirm cannot overpromise', () => {
    // The store keys by species: 40k repeats of index 3 are one species. Without deduping the
    // confirm step would offer "40000 species" and then install exactly one.
    const repeated: SharedSpecies[] = Array.from({ length: 40_000 }, () => [3, 1])
    const { species, dropped } = sanitizeShare(repeated, 299)
    expect(species).toEqual([[3, 1]])
    expect(dropped).toBe(39_999)
  })

  it('keeps distinct species and still drops out-of-range ones', () => {
    const { species, dropped } = sanitizeShare(
      [
        [1, 2],
        [5, 1],
        [999, 4],
      ],
      299,
    )
    expect(species).toEqual([
      [1, 2],
      [5, 1],
    ])
    expect(dropped).toBe(1)
  })
})
