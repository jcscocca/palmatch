import { deflate, inflate } from 'pako'
import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import type { GenderCode } from '../engine/types.ts'
import type { ImportResult, Talents } from '../save/types.ts'

/**
 * The pals the player actually owns, kept deliberately apart from the workbench store: the
 * workbench is a scratchpad that lives in the URL and resets when you clear it, this is a
 * possession list that survives reloads and is never part of a shared workbench link. Merging the
 * two would put a 200-species blob in the address bar and make CLEAR ambiguous.
 */

export const OWNED_STORAGE_KEY = 'palmatch.owned.v1'

/**
 * How many individuals of one species we keep. Counts stay exact; only the per-pal detail
 * (passives/IVs) is capped, because a guild's `Level.sav` can hold hundreds of one species and
 * localStorage is a few MB. The survivors are the ones with the most passives — those are the pals
 * a breeding plan is actually built around.
 */
export const MAX_STORED_INDIVIDUALS = 5

/** Version tag inside both the share blob and the `.palmatch.json` file. */
export const SHARE_VERSION = 1

/**
 * A blob longer than this is not a palmatch share link — 150 species deflate to a few hundred
 * characters. Bounding it before `inflate` means a hand-crafted link can't be a decompression bomb.
 */
const MAX_SHARE_BLOB = 16384

export interface OwnedIndividual {
  gender: GenderCode | null
  passives: string[]
  talents: Talents | null
}

export interface OwnedSpecies {
  count: number
  individuals: OwnedIndividual[]
}

/** Keyed by dataset index. JSON turns the keys into strings, so every read goes through `Number`. */
export type OwnedBySpecies = Record<number, OwnedSpecies>

export interface OwnedData {
  bySpecies: OwnedBySpecies
  /** ISO timestamp of the last successful import; `null` means "no list at all". */
  importedAt: string | null
  /** Where the list came from — a file name, or the label of a shared link. */
  sourceLabel: string | null
  /** Parser warnings from the import that produced this list, shown in the summary. */
  warnings: string[]
}

export interface OwnedActions {
  setOwned(result: ImportResult, label: string): void
  clearOwned(): void
  loadShared(species: SharedSpecies[], label?: string): void
}

export type OwnedState = OwnedData & OwnedActions

/** `[speciesIndex, count]`. Individuals are deliberately absent — see `encodeOwnedShare`. */
export type SharedSpecies = [number, number]

export interface OwnedSharePayload {
  v: number
  species: SharedSpecies[]
}

function emptyOwned(): OwnedData {
  return { bySpecies: {}, importedAt: null, sourceLabel: null, warnings: [] }
}

/** Sorted ascending, so callers get a stable order without re-sorting. */
export function ownedSpeciesIndices(bySpecies: OwnedBySpecies): number[] {
  return Object.keys(bySpecies)
    .map(Number)
    .sort((a, b) => a - b)
}

/** Total pals, not species — the "M pals" half of the summary line. */
export function ownedCount(bySpecies: OwnedBySpecies): number {
  let total = 0
  for (const entry of Object.values(bySpecies)) total += entry.count
  return total
}

/**
 * Folds the parser's flat pal list into the stored shape. Sorting by passive count before the
 * cap is what makes the kept examples the useful ones; `Array.sort` is stable, so pals with equal
 * passive counts stay in save order.
 */
function foldOwned(result: ImportResult): OwnedBySpecies {
  const bySpecies: OwnedBySpecies = {}
  for (const pal of result.owned) {
    const entry = (bySpecies[pal.speciesIndex] ??= { count: 0, individuals: [] })
    entry.count++
    entry.individuals.push({ gender: pal.gender, passives: pal.passives, talents: pal.talents })
  }
  for (const entry of Object.values(bySpecies)) {
    entry.individuals.sort((a, b) => b.passives.length - a.passives.length)
    if (entry.individuals.length > MAX_STORED_INDIVIDUALS) entry.individuals.length = MAX_STORED_INDIVIDUALS
  }
  return bySpecies
}

/** A shared list carries counts only, so every species arrives with an empty individuals list. */
function fromShared(species: SharedSpecies[]): OwnedBySpecies {
  const bySpecies: OwnedBySpecies = {}
  for (const [index, count] of species) bySpecies[index] = { count, individuals: [] }
  return bySpecies
}

// ---- localStorage ----

/**
 * Every storage call is wrapped: Safari in private mode throws on `setItem`, and a browser with
 * storage disabled entirely throws on the property access itself. An owned list that can't be
 * persisted is still perfectly usable for the session, so none of this is worth an error path.
 */
function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(OWNED_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function writeStorage(text: string | null): void {
  try {
    const storage = globalThis.localStorage
    if (storage === undefined || storage === null) return
    if (text === null) storage.removeItem(OWNED_STORAGE_KEY)
    else storage.setItem(OWNED_STORAGE_KEY, text)
  } catch {
    /* private mode, quota, storage disabled — the session's list still works */
  }
}

function isIndividual(value: unknown): value is OwnedIndividual {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.gender !== null && v.gender !== 'M' && v.gender !== 'F') return false
  if (!Array.isArray(v.passives) || v.passives.some((p) => typeof p !== 'string')) return false
  if (v.talents !== null && typeof v.talents !== 'object') return false
  return true
}

/**
 * Validates a hydrated envelope field by field rather than trusting `JSON.parse`. The stored blob
 * is user-editable and survives across app versions, so "it parsed as JSON" says nothing about
 * whether `bySpecies` still holds what this build expects — and a bad shape here would surface as
 * an undefined-index crash inside a panel, far from its cause.
 */
function validateStored(parsed: unknown): OwnedData | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.v !== 1) return null
  const data = envelope.data
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>

  if (typeof d.bySpecies !== 'object' || d.bySpecies === null) return null
  const bySpecies: OwnedBySpecies = {}
  for (const [key, value] of Object.entries(d.bySpecies as Record<string, unknown>)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0) return null
    if (typeof value !== 'object' || value === null) return null
    const entry = value as Record<string, unknown>
    if (typeof entry.count !== 'number' || !Number.isFinite(entry.count) || entry.count <= 0) return null
    if (!Array.isArray(entry.individuals) || !entry.individuals.every(isIndividual)) return null
    bySpecies[index] = {
      count: entry.count,
      individuals: (entry.individuals as OwnedIndividual[]).slice(0, MAX_STORED_INDIVIDUALS),
    }
  }

  if (d.importedAt !== null && typeof d.importedAt !== 'string') return null
  if (d.sourceLabel !== null && typeof d.sourceLabel !== 'string') return null
  if (!Array.isArray(d.warnings) || d.warnings.some((w) => typeof w !== 'string')) return null

  return {
    bySpecies,
    importedAt: d.importedAt as string | null,
    sourceLabel: d.sourceLabel as string | null,
    warnings: d.warnings as string[],
  }
}

function hydrate(): OwnedData {
  const raw = readStorage()
  if (raw === null) return emptyOwned()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn(`palmatch: ignoring ${OWNED_STORAGE_KEY} — not valid JSON`)
    return emptyOwned()
  }
  const data = validateStored(parsed)
  if (data === null) {
    console.warn(`palmatch: ignoring ${OWNED_STORAGE_KEY} — not a list this version understands`)
    return emptyOwned()
  }
  return data
}

function persist(data: OwnedData): void {
  // An empty list removes the key rather than storing an empty envelope: CLEAR should leave no
  // trace, and the next load then takes the cheap "nothing stored" path.
  if (data.importedAt === null) writeStorage(null)
  else writeStorage(JSON.stringify({ v: 1, data }))
}

// ---- share codec ----

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

/** A hand-typed, truncated or re-encoded blob decodes to `null` rather than throwing. */
export function decodeOwnedShare(blob: string): OwnedSharePayload | null {
  const bytes = fromBase64Url(blob)
  if (bytes === null) return null
  let text: string
  try {
    // `toText` is pako 3's spelling of "decode the result as UTF-8" (2.x called it `to: 'string'`).
    text = inflate(bytes, { toText: true })
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

// ---- store ----

/** A fresh store instance, hydrated from localStorage. Tests use this; the app uses the singleton. */
export function createOwnedStore(): UseBoundStore<StoreApi<OwnedState>> {
  const store = create<OwnedState>((set) => ({
    ...hydrate(),
    setOwned: (result, label) =>
      set({
        bySpecies: foldOwned(result),
        importedAt: new Date().toISOString(),
        sourceLabel: label,
        warnings: result.warnings,
      }),
    clearOwned: () => set(emptyOwned()),
    loadShared: (species, label = 'shared list') =>
      set({
        bySpecies: fromShared(species),
        importedAt: new Date().toISOString(),
        sourceLabel: label,
        warnings: [],
      }),
  }))
  // Persisting from a subscription rather than inside each action means a future action can't
  // forget to save; the writes are small (a few hundred species at most) and only happen on import.
  store.subscribe(persist)
  return store
}

export const useOwnedStore = createOwnedStore()
