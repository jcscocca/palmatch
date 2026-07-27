import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const RAW = 'https://raw.githubusercontent.com/tylercamp/palcalc'
const TREES = 'https://api.github.com/repos/tylercamp/palcalc/git/trees'
const PAL_SPRITE_DIR = 'PalCalc.UI/Resources/Pals/'
const ELEMENT_DIR = 'PalCalc.UI/Resources/Elements/'
const CONCURRENCY = 8

export interface PalcalcPaths {
  dbPath: string
  breedingPath: string
  spriteDir: string
  elementDir: string
}

async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.size > 0
  } catch {
    return false
  }
}

async function fetchBuffer(url: string, headers?: Record<string, string>): Promise<Buffer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (attempt === 1) throw new Error(`fetch failed: ${url}`, { cause: err })
      await new Promise((r) => setTimeout(r, 750))
    }
  }
  throw new Error('unreachable')
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/** Writes via a temp file so an interrupted run never leaves a truncated cache entry behind. */
async function downloadIfMissing(url: string, dest: string): Promise<boolean> {
  if (await exists(dest)) return false
  const tmp = `${dest}.tmp`
  await writeFile(tmp, await fetchBuffer(url))
  await rename(tmp, dest)
  return true
}

interface TreeEntry {
  path: string
  type: string
}

async function loadTree(commit: string, cacheDir: string): Promise<TreeEntry[]> {
  const cached = join(cacheDir, 'tree.json')
  if (await exists(cached)) {
    return JSON.parse(await readFile(cached, 'utf8')) as TreeEntry[]
  }
  const raw = await fetchBuffer(`${TREES}/${commit}?recursive=1`, {
    accept: 'application/vnd.github+json',
    'user-agent': 'palmatch-data-pipeline',
  })
  const parsed = JSON.parse(raw.toString('utf8')) as { tree?: TreeEntry[]; truncated?: boolean; message?: string }
  if (!parsed.tree) throw new Error(`GitHub trees API returned no tree: ${parsed.message ?? 'unknown'}`)
  if (parsed.truncated) throw new Error('GitHub trees API response was truncated')
  const trimmed = parsed.tree
    .filter((e) => e.type === 'blob' && (e.path.startsWith(PAL_SPRITE_DIR) || e.path.startsWith(ELEMENT_DIR)))
    .map((e) => ({ path: e.path, type: e.type }))
  await writeFile(`${cached}.tmp`, JSON.stringify(trimmed))
  await rename(`${cached}.tmp`, cached)
  return trimmed
}

export async function fetchPalcalc(commit: string, cacheDir: string): Promise<PalcalcPaths> {
  const spriteDir = join(cacheDir, 'sprites')
  const elementDir = join(cacheDir, 'elements')
  await mkdir(spriteDir, { recursive: true })
  await mkdir(elementDir, { recursive: true })

  const dbPath = join(cacheDir, 'db.json')
  const breedingPath = join(cacheDir, 'breeding.json')
  for (const [name, dest] of [
    ['PalCalc.Model/db.json', dbPath],
    ['PalCalc.Model/breeding.json', breedingPath],
  ] as const) {
    if (await downloadIfMissing(`${RAW}/${commit}/${name}`, dest)) {
      console.log(`  fetched ${name}`)
    }
  }

  const tree = await loadTree(commit, cacheDir)
  const candidates = tree
    .filter((e) => e.path.endsWith('.png'))
    .map((e) => ({
      path: e.path,
      file: e.path.slice(e.path.lastIndexOf('/') + 1),
      dir: e.path.startsWith(PAL_SPRITE_DIR) ? spriteDir : elementDir,
    }))
  // Same size>0 test as db/breeding, so a truncated image is re-fetched rather than trusted.
  const present = await Promise.all(candidates.map((e) => exists(join(e.dir, e.file))))
  const wanted = candidates.filter((_, i) => !present[i])

  if (wanted.length > 0) {
    console.log(`  fetching ${wanted.length} image(s) from palcalc...`)
    await pool(wanted, CONCURRENCY, async (e) => {
      await downloadIfMissing(`${RAW}/${commit}/${encodeURI(e.path)}`, join(e.dir, e.file))
    })
  }

  return { dbPath, breedingPath, spriteDir, elementDir }
}
