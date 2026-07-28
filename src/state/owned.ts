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

/**
 * The key is a namespace, not the schema version — renaming it would strand every list already in
 * a browser. The schema version lives in the envelope's `v`, which is what `validateStored` reads.
 */
export const OWNED_STORAGE_KEY = 'palmatch.owned.v1'

/**
 * Envelope version written by this build. v1 is still read forever: it predates the gender tallies,
 * so its species migrate in with `genders: null` — "this list never said" — rather than with zeroes
 * a UI would print as a fact.
 */
export const STORAGE_VERSION = 2

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

/** Confirmed male/female pals of one species. Never negative, never summing past its `count`. */
export interface OwnedGenders {
  males: number
  females: number
}

export interface OwnedSpecies {
  count: number
  /**
   * The male/female split, or `null` for "this list never said" — a v1 list from before the tallies
   * existed, or a share link that carried none.
   *
   * Counted over every pal in the import, never over `individuals`: that sample is capped at
   * `MAX_STORED_INDIVIDUALS` and sorted by passive count, so a player with six Lamballs whose only
   * female sorted out of the sample would be told they own none — and sent off to plan a pairing
   * that cannot happen. A tally derived from the sample would be wrong exactly where it matters.
   *
   * Pals whose save row carried no gender at all are in neither half, so `males + females <= count`
   * rather than `=`. That gap is why `onlyGender` refuses to call a species single-gender unless
   * every pal in it is accounted for.
   */
  genders: OwnedGenders | null
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

/**
 * `[speciesIndex, count]`, or `[speciesIndex, count, males, females]` where the sharer knew the
 * split. Individuals are deliberately absent — see `encodeOwnedShare`.
 */
export type SharedSpecies = [number, number] | [number, number, number, number]

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
  genders: OwnedGenders | null
}

/**
 * `'M'`/`'F'` when this species is one gender all the way through — the case a breeding plan has to
 * know about, because such a species cannot be paired with itself at any count.
 *
 * Deliberately silent unless every pal is accounted for: a species with an ungendered row could be
 * hiding the very partner this flag would claim does not exist. Silent below two pals as well —
 * "you own one Lamball" already says it can't breed with itself, and marking every single-pal
 * species would leave the flag on most of a real palbox and worth nothing to scan for.
 */
export function onlyGender(count: number, genders: OwnedGenders | null): GenderCode | null {
  if (genders === null || count < 2 || genders.males + genders.females !== count) return null
  if (genders.females === 0) return 'M'
  if (genders.males === 0) return 'F'
  return null
}

/**
 * The list's overall split, or `null` when even one rendered species doesn't know its own. Summing
 * over just the species that have tallies would print a headline total nothing in the grid below it
 * adds up to, which is the same lie in a different place.
 */
export function genderTotals(rows: OwnedRow[]): OwnedGenders | null {
  let males = 0
  let females = 0
  for (const row of rows) {
    if (row.genders === null) return null
    males += row.genders.males
    females += row.genders.females
  }
  return rows.length === 0 ? null : { males, females }
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
    .map((index) => ({
      index,
      pal: pals[index],
      count: bySpecies[index].count,
      genders: bySpecies[index].genders,
    }))
    .sort((a, b) => b.count - a.count || a.pal.name.localeCompare(b.pal.name))
}

/** The running tally per species, before the individuals are sorted and capped. */
interface SpeciesTally {
  count: number
  males: number
  females: number
  individuals: OwnedIndividual[]
}

/**
 * Folds the parser's flat pal list into the stored shape. Sorting by passive count before the
 * cap is what makes the kept examples the useful ones; `Array.sort` is stable, so pals with equal
 * passive counts stay in save order.
 *
 * The genders are tallied in the first loop, over every pal — the cap in the second loop can then
 * throw away individuals without ever touching a number the UI prints.
 */
function foldOwned(result: ImportResult): OwnedBySpecies {
  const tallies: Record<number, SpeciesTally> = {}
  for (const pal of result.owned) {
    const tally = (tallies[pal.speciesIndex] ??= { count: 0, males: 0, females: 0, individuals: [] })
    tally.count++
    if (pal.gender === 'M') tally.males++
    else if (pal.gender === 'F') tally.females++
    tally.individuals.push({ gender: pal.gender, passives: pal.passives, talents: pal.talents })
  }

  const bySpecies: OwnedBySpecies = {}
  for (const [key, tally] of Object.entries(tallies)) {
    tally.individuals.sort((a, b) => b.passives.length - a.passives.length)
    if (tally.individuals.length > MAX_STORED_INDIVIDUALS) tally.individuals.length = MAX_STORED_INDIVIDUALS
    bySpecies[Number(key)] = {
      count: tally.count,
      genders: { males: tally.males, females: tally.females },
      individuals: tally.individuals,
    }
  }
  return bySpecies
}

/**
 * A shared list carries counts (and, from a build that had them, the split) but never individuals.
 * A link made before genders existed arrives as `null`, which the summary renders as "unknown"
 * rather than as a species with no males and no females.
 */
function fromShared(species: SharedSpecies[]): OwnedBySpecies {
  const bySpecies: OwnedBySpecies = {}
  for (const entry of species) {
    bySpecies[entry[0]] = {
      count: entry[1],
      genders: entry.length === 4 ? { males: entry[2], females: entry[3] } : null,
      individuals: [],
    }
  }
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

/** A tally is a whole number of pals: not fractional, not negative, not past what can be added up. */
function isTally(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * One stored `genders` block, or `'invalid'` when it is present in a shape this build won't print.
 * `null` is a legitimate stored value — "this list never said" — so it can't double as the failure.
 *
 * The `males + females <= count` check is the load-bearing one: a blob claiming three males of a
 * species it also says there are two of would render a split the count beside it contradicts.
 */
function toGenders(value: unknown, count: number): OwnedGenders | null | 'invalid' {
  if (value === null) return null
  // Catches the missing field too: `typeof undefined` is `'undefined'`, so an absent `genders` on a
  // v2 entry lands here rather than quietly becoming "unknown".
  if (typeof value !== 'object') return 'invalid'
  const g = value as Record<string, unknown>
  if (!isTally(g.males) || !isTally(g.females)) return 'invalid'
  if (g.males + g.females > count) return 'invalid'
  return { males: g.males, females: g.females }
}

/**
 * Validates a hydrated envelope field by field rather than trusting `JSON.parse`. The stored blob
 * is user-editable and survives across app versions, so "it parsed as JSON" says nothing about
 * whether `bySpecies` still holds what this build expects — and a bad shape here would surface as
 * an undefined-index crash inside a panel, far from its cause.
 *
 * Two envelope versions are accepted, and a malformed one of either is rejected identically. v1 is
 * the shape shipped before the gender tallies: its species come in with `genders: null`, keeping
 * every count and stored individual, and any `genders` a v1 envelope happens to carry is ignored
 * outright — this build didn't write it, so it isn't a number this build will vouch for.
 */
function validateStored(parsed: unknown): OwnedData | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.v !== 1 && envelope.v !== STORAGE_VERSION) return null
  const hasGenders = envelope.v === STORAGE_VERSION
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
    // `isSafeInteger`, not `isInteger`, and matched by the share codec's `validatePayload`:
    // `Number.isInteger(1e21)` is true, so a plain integer test admits counts no arithmetic
    // downstream can add up. A count of 1.5, 1e21 or Infinity pals is a hand-edited blob either way.
    if (typeof entry.count !== 'number' || !Number.isSafeInteger(entry.count) || entry.count <= 0) return null
    // A v2 entry must say something about genders, even if that something is `null`; a v2 blob
    // missing the field is not one this build wrote, and guessing at it is what this whole design
    // exists to avoid.
    const genders = hasGenders ? toGenders(entry.genders, entry.count) : null
    if (genders === 'invalid') return null
    if (!Array.isArray(entry.individuals)) return null
    const individuals: OwnedIndividual[] = []
    for (const raw of entry.individuals.slice(0, MAX_STORED_INDIVIDUALS)) {
      const individual = toIndividual(raw)
      if (individual === null) return null
      individuals.push(individual)
    }
    bySpecies[index] = { count: entry.count, genders, individuals }
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
  // A v1 blob is migrated into memory on every load and only rewritten as v2 when something
  // actually changes the store. Nothing is gained by rewriting it eagerly, and leaving it alone
  // means a player who opens an older build in another tab still finds their list where it was.
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
  writeStorage(
    JSON.stringify({ v: STORAGE_VERSION, data: { bySpecies, importedAt, sourceLabel, warnings, playerRows } }),
  )
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
