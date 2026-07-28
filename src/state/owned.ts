import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import type { GenderCode, PalRecord } from '../engine/types.ts'
import type { ImportResult, Talents } from '../save/types.ts'

/**
 * The pals the player actually owns, kept deliberately apart from the workbench store: the
 * workbench is a scratchpad that lives in the URL and resets when you clear it, this is a
 * possession list that survives reloads and is never part of a shared workbench link. Merging the
 * two would put a 200-species blob in the address bar and make CLEAR ambiguous.
 *
 * Store, persistence and selectors only. The share codec lives in `owned-share.ts` so that pako
 * stays out of the entry chunk — nothing here may import it.
 */

export const OWNED_STORAGE_KEY = 'palmatch.owned.v1'

/**
 * How many individuals of one species we keep. Counts stay exact; only the per-pal detail
 * (passives/IVs) is capped, because a guild's `Level.sav` can hold hundreds of one species and
 * localStorage is a few MB. The survivors are the ones with the most passives — those are the pals
 * a breeding plan is actually built around.
 */
export const MAX_STORED_INDIVIDUALS = 5

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
  /**
   * Player rows in the save this list came from. A guild world holds everyone's pals in one map, so
   * this is what lets the summary say whose palbox you are actually looking at. Always 0 for a
   * shared list, which carries no such thing.
   */
  playerRows: number
}

export interface OwnedActions {
  setOwned(result: ImportResult, label: string): void
  clearOwned(): void
  loadShared(species: SharedSpecies[], label?: string): void
}

export type OwnedState = OwnedData & OwnedActions

/** `[speciesIndex, count]`. Individuals are deliberately absent — see `encodeOwnedShare`. */
export type SharedSpecies = [number, number]

function emptyOwned(): OwnedData {
  return { bySpecies: {}, importedAt: null, sourceLabel: null, warnings: [], playerRows: 0 }
}

/** Sorted ascending, so callers get a stable order without re-sorting. */
export function ownedSpeciesIndices(bySpecies: OwnedBySpecies): number[] {
  return Object.keys(bySpecies)
    .map(Number)
    .sort((a, b) => a - b)
}

/**
 * "Owns something this build can actually use." A stored list outlives the paldex it was made
 * against — an old localStorage entry, a link from a newer build — so a species index past the end
 * of `pals` is one no panel could render. Shared by every consumer that gates a control on the
 * owned list (the chain toggle, the OWNED ONLY chip, the empty-state hint), which used to answer
 * this question three different ways and disagree at the edges.
 */
export function hasOwnedFor(bySpecies: OwnedBySpecies, palCount: number): boolean {
  return ownedSpeciesIndices(bySpecies).some((index) => index < palCount)
}

export interface OwnedRow {
  index: number
  pal: PalRecord
  count: number
}

/**
 * The species grid, filtered to what this dataset can render and ordered most-owned first — the
 * species a plan is likely to lean on are the ones at the top. Lives here rather than in
 * `OwnedSummary` so the total the summary prints is derived from the same rows it shows, and
 * a dropped-species list can't produce a headline count that disagrees with the grid under it.
 */
export function ownedRows(pals: PalRecord[], bySpecies: OwnedBySpecies): OwnedRow[] {
  return ownedSpeciesIndices(bySpecies)
    .filter((index) => pals[index] !== undefined)
    .map((index) => ({ index, pal: pals[index], count: bySpecies[index].count }))
    .sort((a, b) => b.count - a.count || a.pal.name.localeCompare(b.pal.name))
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

/**
 * IVs are the one stored field allowed to degrade rather than reject the whole list: `null` already
 * means "this save never said", so a `talents` that isn't three numbers becomes that instead of
 * costing the player their entire palbox.
 */
function toTalents(value: unknown): Talents | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>
  if (typeof t.hp !== 'number' || typeof t.shot !== 'number' || typeof t.defense !== 'number') return null
  return { hp: t.hp, shot: t.shot, defense: t.defense }
}

/** One stored individual, or `null` when the shape isn't one at all. */
function toIndividual(value: unknown): OwnedIndividual | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.gender !== null && v.gender !== 'M' && v.gender !== 'F') return null
  if (!Array.isArray(v.passives) || v.passives.some((p) => typeof p !== 'string')) return null
  return { gender: v.gender as GenderCode | null, passives: v.passives as string[], talents: toTalents(v.talents) }
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
    // Integer, matching the share codec: a count of 1.5 or 1e21 pals is a hand-edited blob.
    if (typeof entry.count !== 'number' || !Number.isInteger(entry.count) || entry.count <= 0) return null
    if (!Array.isArray(entry.individuals)) return null
    const individuals: OwnedIndividual[] = []
    for (const raw of entry.individuals.slice(0, MAX_STORED_INDIVIDUALS)) {
      const individual = toIndividual(raw)
      if (individual === null) return null
      individuals.push(individual)
    }
    bySpecies[index] = { count: entry.count, individuals }
  }

  if (d.importedAt !== null && typeof d.importedAt !== 'string') return null
  if (d.sourceLabel !== null && typeof d.sourceLabel !== 'string') return null
  if (!Array.isArray(d.warnings) || d.warnings.some((w) => typeof w !== 'string')) return null
  // Absent in a list stored before this field existed: no players named is 0, not a broken list.
  const playerRows = d.playerRows ?? 0
  if (typeof playerRows !== 'number' || !Number.isInteger(playerRows) || playerRows < 0) return null

  return {
    bySpecies,
    importedAt: d.importedAt as string | null,
    sourceLabel: d.sourceLabel as string | null,
    warnings: d.warnings as string[],
    playerRows,
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
  if (data.importedAt === null) {
    writeStorage(null)
    return
  }
  // Named field by field rather than serializing the state object whole: the subscriber is handed
  // the full store, actions included, and "JSON.stringify drops functions" is not a contract worth
  // resting persistence on — a future action that closes over data would be silently written out.
  const { bySpecies, importedAt, sourceLabel, warnings, playerRows } = data
  writeStorage(JSON.stringify({ v: 1, data: { bySpecies, importedAt, sourceLabel, warnings, playerRows } }))
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
        playerRows: result.playerRows,
      }),
    clearOwned: () => set(emptyOwned()),
    loadShared: (species, label = 'shared list') =>
      set({
        bySpecies: fromShared(species),
        importedAt: new Date().toISOString(),
        sourceLabel: label,
        warnings: [],
        playerRows: 0,
      }),
  }))
  // Persisting from a subscription rather than inside each action means a future action can't
  // forget to save; the writes are small (a few hundred species at most) and only happen on import.
  store.subscribe(persist)
  return store
}

export const useOwnedStore = createOwnedStore()
