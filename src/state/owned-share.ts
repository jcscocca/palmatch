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

/** Version tag inside both the share blob and the `.palmatch.json` file. */
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

export interface OwnedSharePayload {
  v: number
  species: SharedSpecies[]
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

/** The share payload: species indices and counts, ascending by index so the blob is deterministic. */
export function shareSpecies(bySpecies: OwnedBySpecies): SharedSpecies[] {
  return ownedSpeciesIndices(bySpecies).map((index) => [index, bySpecies[index].count])
}

export function shareJson(bySpecies: OwnedBySpecies): string {
  const payload: OwnedSharePayload = { v: SHARE_VERSION, species: shareSpecies(bySpecies) }
  return JSON.stringify(payload)
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

function validatePayload(parsed: unknown): OwnedSharePayload | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  if (p.v !== SHARE_VERSION || !Array.isArray(p.species)) return null
  const species: SharedSpecies[] = []
  for (const pair of p.species) {
    if (!Array.isArray(pair) || pair.length !== 2) return null
    const [index, count] = pair as unknown[]
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null
    species.push([index, count])
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
  const kept = species.filter(([index]) => index < palCount)
  return { species: kept, dropped: species.length - kept.length }
}
