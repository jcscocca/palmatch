import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ORIGIN = 'https://www.palpedia.net'
const BREEDING_PAGE = `${ORIGIN}/breeding`
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Palpedia ids that are not real breedable pals. */
const NON_PAL_PREFIXES = ['raid_', 'predator_', 'summon_']
/** Boss entries mirror their base pal's typing; used only as a fallback for pals palpedia lists boss-only. */
const BOSS_PREFIX = 'boss_'

export interface RawUnique {
  parentA: string
  parentB: string
  childId: string
}

export interface PalpediaSnapshot {
  types: Record<string, string[]>
  uniques: RawUnique[]
}

/**
 * palpedia type slug -> palcalc element icon name.
 * palcalc ships the neutral icon as `Normal.png`, so `normal` maps to `Normal`.
 */
export const TYPE_TO_ELEMENT: Record<string, string> = {
  normal: 'Normal',
  fire: 'Fire',
  water: 'Water',
  grass: 'Leaf',
  electric: 'Electricity',
  ice: 'Ice',
  ground: 'Earth',
  dark: 'Dark',
  dragon: 'Dragon',
}

async function get(url: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.text()
    } catch (err) {
      if (attempt === 1) throw new Error(`palpedia fetch failed: ${url} — ${String(err)}`)
      await new Promise((r) => setTimeout(r, 750))
    }
  }
  throw new Error('unreachable')
}

/**
 * Chunk filenames are content-hashed, so they are always resolved from the live page:
 * the flight payload lists the route's chunks, and the webpack runtime maps every
 * lazily-loaded chunk id to its hashed filename.
 */
function chunkPathsFromHtml(html: string): string[] {
  return [...new Set([...html.matchAll(/static\/chunks\/[A-Za-z0-9._/-]+\.js/g)].map((m) => m[0]))]
}

function chunkPathsFromWebpackRuntime(source: string): string[] {
  const start = source.indexOf('.u=function')
  if (start < 0) return []
  const body = source.slice(start, start + 4000)
  const out = new Set<string>()
  for (const m of body.matchAll(/"(static\/chunks\/[A-Za-z0-9._-]+\.js)"/g)) out.add(m[1]!)

  // `7699===e?"8e1d74a4":e` style filename overrides, then the `{id:"hash"}` table.
  const overrides = new Map<string, string>()
  for (const m of body.matchAll(/(\d+)===e\?"([A-Za-z0-9]+)":/g)) overrides.set(m[1]!, m[2]!)
  const mapStart = body.indexOf('({')
  const mapEnd = body.indexOf('})', mapStart)
  if (mapStart >= 0 && mapEnd > mapStart) {
    for (const m of body.slice(mapStart, mapEnd).matchAll(/(\d+):"([0-9a-f]+)"/g)) {
      out.add(`static/chunks/${overrides.get(m[1]!) ?? m[1]!}-${m[2]!}.js`)
    }
  }
  return [...out]
}

function parsePalTypes(source: string): Record<string, string[]> {
  const direct: Record<string, string[]> = {}
  const bossFallback: Record<string, string[]> = {}
  const re = /\{"id":"([a-z0-9_]+)","fileIndex"[\s\S]{0,400}?"type":\[([^\]]*)\]/g
  for (const m of source.matchAll(re)) {
    const id = m[1]!
    let types: string[]
    try {
      types = JSON.parse(`[${m[2]!}]`) as string[]
    } catch {
      continue
    }
    if (types.length === 0) continue
    if (id.startsWith(BOSS_PREFIX)) {
      const base = id.slice(BOSS_PREFIX.length)
      if (!(base in bossFallback)) bossFallback[base] = types
      continue
    }
    if (NON_PAL_PREFIXES.some((p) => id.startsWith(p))) continue
    if (!(id in direct)) direct[id] = types
  }
  // Some pals (e.g. plantslime_flower / Gumoss Flower) only appear boss-prefixed on palpedia.
  for (const [id, types] of Object.entries(bossFallback)) {
    if (!(id in direct)) direct[id] = types
  }
  return direct
}

function parseUniques(source: string): RawUnique[] {
  const m = source.match(/JSON\.parse\('(\[\{[^']*?childId[^']*?\])'\)/)
  if (!m) return []
  const raw = JSON.parse(m[1]!) as Array<RawUnique & { parentGenderA?: string; parentGenderB?: string }>
  return raw
    // The one gender-locked pair is taken from palcalc's breeding.json instead, which is authoritative.
    .filter((u) => !u.parentGenderA && !u.parentGenderB)
    .map((u) => ({ parentA: u.parentA, parentB: u.parentB, childId: u.childId }))
}

export async function extractPalpediaLive(): Promise<PalpediaSnapshot> {
  const html = await get(BREEDING_PAGE)
  const paths = chunkPathsFromHtml(html)
  if (paths.length === 0) throw new Error('no /_next/static/chunks/*.js references found on palpedia /breeding')

  let types: Record<string, string[]> = {}
  let uniques: RawUnique[] = []
  const scan = async (list: string[]): Promise<void> => {
    for (const path of list) {
      if (Object.keys(types).length > 0 && uniques.length > 0) return
      const source = await get(`${ORIGIN}/_next/${path}`)
      if (Object.keys(types).length === 0 && source.includes('combiRank')) {
        types = parsePalTypes(source)
      }
      if (uniques.length === 0 && source.includes('childId')) {
        uniques = parseUniques(source)
      }
    }
  }

  // Route chunks first (they hold the data); the webpack chunk table is the fallback sweep.
  await scan(paths)
  if (Object.keys(types).length === 0 || uniques.length === 0) {
    const runtime = paths.find((p) => p.includes('/webpack-'))
    if (runtime) {
      const extra = chunkPathsFromWebpackRuntime(await get(`${ORIGIN}/_next/${runtime}`)).filter(
        (p) => !paths.includes(p),
      )
      await scan(extra)
    }
  }

  if (Object.keys(types).length === 0) throw new Error('palpedia: no pal-type data found in any chunk')
  if (uniques.length === 0) throw new Error('palpedia: no unique-combo data found in any chunk')
  return { types, uniques }
}

export interface PalpediaLoad extends PalpediaSnapshot {
  source: 'live' | 'snapshot'
}

export async function loadPalpedia(dataDir: string): Promise<PalpediaLoad> {
  const typesPath = join(dataDir, 'palpedia-types.json')
  const uniquesPath = join(dataDir, 'palpedia-uniques.json')
  try {
    const live = await extractPalpediaLive()
    return { ...live, source: 'live' }
  } catch (err) {
    let snapshot: PalpediaSnapshot
    try {
      snapshot = {
        types: JSON.parse(await readFile(typesPath, 'utf8')) as Record<string, string[]>,
        uniques: JSON.parse(await readFile(uniquesPath, 'utf8')) as RawUnique[],
      }
    } catch {
      throw new Error(`palpedia extraction failed and no snapshot to fall back on: ${String(err)}`)
    }
    console.warn(`  WARN palpedia extraction failed (${String(err)}) — reusing committed snapshots`)
    return { ...snapshot, source: 'snapshot' }
  }
}

export async function writePalpediaSnapshot(dataDir: string, snapshot: PalpediaSnapshot): Promise<void> {
  const types = Object.fromEntries(Object.entries(snapshot.types).sort(([a], [b]) => (a < b ? -1 : 1)))
  await writeFile(join(dataDir, 'palpedia-types.json'), `${JSON.stringify(types, null, 2)}\n`)
  await writeFile(join(dataDir, 'palpedia-uniques.json'), `${JSON.stringify(snapshot.uniques, null, 2)}\n`)
}
