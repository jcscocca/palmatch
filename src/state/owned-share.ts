import { deflate } from 'pako'
import { boundedInflate } from '../lib/bounded-inflate.ts'
import { ownedSpeciesIndices } from './owned.ts'
import type { OwnedBySpecies, SharedSpecies } from './owned.ts'

/**
 * The owned-list share codec: `#/own/<blob>` links and the `.palmatch.json` file, which carry the
 * same payload by different routes.
 *
 * Kept out of `owned.ts` so the store — which every panel imports — doesn't drag pako's
 * deflate+inflate (~42 KB) into the entry chunk for a feature only the import dialog uses. The
 * dependency runs one way: this module knows about the store's shapes, the store knows nothing
 * about this one. `ImportPanel` loads it with a dynamic `import()`, which is what actually keeps it
 * out of the entry.
 */

/**
 * Version tag inside both the share blob and the `.palmatch.json` file.
 *
 * Deliberately still 1 now that links can carry genders. The build that shipped before them refuses
 * any payload whose `v` isn't 1 and any `species` entry that isn't exactly two elements — so the
 * split rides in a *separate*, optional `g` field, aligned to `species`, and that build ignores it
 * and reads the counts as it always did. Bumping `v`, or widening the pairs, would have made every
 * new link a hard failure for anyone who hadn't reloaded the app.
 */
export const SHARE_VERSION = 1

/**
 * A blob longer than this is not a palmatch share link — 150 species deflate to a few hundred
 * characters. Bounding it before `inflate` means a hand-crafted link can't be a decompression bomb.
 */
const MAX_SHARE_BLOB = 16384

/**
 * Ceiling on what a share blob may inflate *to*. The base64url cap above bounds the input, but a
 * few KB of deflate can expand to tens of MB, and this decode runs on the main thread the instant a
 * link is opened. A species list is a few KB of JSON, so a megabyte is already absurdly generous
 * and anything past it is a bomb rather than a list.
 */
const MAX_SHARE_BYTES = 1024 * 1024

/** The decoded payload, with `species` and `g` already merged into one entry per species. */
export interface OwnedSharePayload {
  v: number
  species: SharedSpecies[]
}

/** `[males, females]`, or `null` for a species whose split the sharer did not know. */
type SharedGenders = [number, number] | null

/**
 * What actually goes over the wire, in the two fields an older build can read past. `g` is absent
 * whenever there is nothing to say, so a list with no genders serialises to the exact bytes it did
 * before this feature — every link already in a Discord scrollback still decodes to itself.
 */
interface ShareWire {
  v: number
  species: Array<[number, number]>
  g?: SharedGenders[]
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // `String.fromCharCode(...bytes)` blows the argument limit on a large array, so chunk it.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(blob: string): Uint8Array | null {
  if (blob === '' || blob.length > MAX_SHARE_BLOB || !/^[A-Za-z0-9_-]+$/.test(blob)) return null
  const base64 = blob.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * The share payload: species indices, counts, and the male/female split where the list has one,
 * ascending by index so the blob is deterministic.
 */
export function shareSpecies(bySpecies: OwnedBySpecies): SharedSpecies[] {
  return ownedSpeciesIndices(bySpecies).map((index): SharedSpecies => {
    const { count, genders } = bySpecies[index]
    return genders === null ? [index, count] : [index, count, genders.males, genders.females]
  })
}

export function shareJson(bySpecies: OwnedBySpecies): string {
  const species = shareSpecies(bySpecies)
  const g = species.map((entry): SharedGenders => (entry.length === 4 ? [entry[2], entry[3]] : null))
  const wire: ShareWire = { v: SHARE_VERSION, species: species.map((entry) => [entry[0], entry[1]]) }
  // Only when at least one species has something to say: an all-unknown `g` would be a column of
  // nulls that costs bytes, changes every existing link's blob, and tells the recipient nothing.
  if (g.some((entry) => entry !== null)) wire.g = g
  return JSON.stringify(wire)
}

/**
 * `deflate(JSON) -> base64url`. Individuals are left out on purpose: passives and IVs would multiply
 * the blob by ~20x for information a *recipient* can't act on (they can't breed with your pals),
 * and a link long enough to be broken by a chat client is worse than no link.
 */
export function encodeOwnedShare(bySpecies: OwnedBySpecies): string {
  return toBase64Url(deflate(shareJson(bySpecies)))
}

/**
 * The full link. `pathname` is kept so this works on a Pages subpath deploy, and the query string is
 * dropped — nothing in palmatch reads one, and carrying it would leak whatever tracking parameter
 * the sharer happened to arrive with into a link they hand to a friend.
 */
export function ownedShareLink(bySpecies: OwnedBySpecies, location: Location = window.location): string {
  return `${location.origin}${location.pathname}#/own/${encodeOwnedShare(bySpecies)}`
}

/**
 * `isSafeInteger` rather than `isInteger`, matched by the store's `validateStored`:
 * `Number.isInteger(1e21)` is true, and no species index or pal count past 2^53 is a number
 * anything downstream can do arithmetic with.
 */
function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function validatePayload(parsed: unknown): OwnedSharePayload | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  if (p.v !== SHARE_VERSION || !Array.isArray(p.species)) return null
  // Absent in every link made before genders existed, and in every list with none to carry. When
  // present it must line up with `species` exactly — a `g` of the wrong length is a payload whose
  // splits cannot be attributed to species with any confidence, and guessing would misreport them.
  const g: unknown = p.g
  if (g !== undefined && (!Array.isArray(g) || g.length !== p.species.length)) return null
  const splits = g as unknown[] | undefined

  const species: SharedSpecies[] = []
  for (let i = 0; i < p.species.length; i++) {
    const pair: unknown = p.species[i]
    if (!Array.isArray(pair) || pair.length !== 2) return null
    const [index, count] = pair as unknown[]
    if (!isWholeNumber(index) || index < 0) return null
    if (!isWholeNumber(count) || count <= 0) return null

    const split: unknown = splits?.[i]
    if (split === undefined || split === null) {
      species.push([index, count])
      continue
    }
    if (!Array.isArray(split) || split.length !== 2) return null
    const [males, females] = split as unknown[]
    if (!isWholeNumber(males) || males < 0 || !isWholeNumber(females) || females < 0) return null
    // Ungendered pals are in neither half, so the split may fall short of the count — but a split
    // that outruns it describes a species that cannot exist, and would print a tally contradicting
    // the `×N` beside it.
    if (males + females > count) return null
    species.push([index, count, males, females])
  }
  return { v: SHARE_VERSION, species }
}

/**
 * A hand-typed, truncated, re-encoded or deliberately-bombed blob decodes to `null` rather than
 * throwing. Both bounds matter: the base64url length cap refuses the input, `boundedInflate` refuses
 * the output, and the UTF-8 decode is non-fatal so a blob of noise ends at `JSON.parse` instead.
 */
export function decodeOwnedShare(blob: string): OwnedSharePayload | null {
  const bytes = fromBase64Url(blob)
  if (bytes === null) return null
  let text: string
  try {
    text = new TextDecoder().decode(boundedInflate(bytes, MAX_SHARE_BYTES))
  } catch {
    return null
  }
  return parseOwnedShareJson(text)
}

/** The `.palmatch.json` half of the same contract: identical payload, no deflate, no base64. */
export function parseOwnedShareJson(text: string): OwnedSharePayload | null {
  try {
    return validatePayload(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * A shared list is written against the sharer's dataset. Indices past the end of *this* build's
 * paldex would index `undefined` in every panel downstream, so they are dropped here, at the
 * boundary, and counted so the panel can say so out loud.
 */
export function sanitizeShare(species: SharedSpecies[], palCount: number): { species: SharedSpecies[]; dropped: number } {
  // Deduped as well as bounds-checked: the store keys by species, so a crafted link repeating one
  // index 40k times would otherwise have the confirm step promise 40000 species and then store 1.
  // Last entry for an index wins, matching what `fromShared` would have done anyway.
  const byIndex = new Map<number, SharedSpecies>()
  for (const entry of species) {
    if (entry[0] < palCount) byIndex.set(entry[0], entry)
  }
  const kept = [...byIndex.values()]
  return { species: kept, dropped: species.length - kept.length }
}
