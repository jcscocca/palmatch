import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { fetchPalcalc } from './lib/fetch-palcalc.ts'
import { loadPalpedia, writePalpediaSnapshot } from './lib/palpedia-extract.ts'
import {
  buildCombos,
  buildGoldens,
  buildMatrix,
  buildMutation,
  buildPals,
  buildPassives,
  matrixToBuffer,
  type BreedingFile,
  type PalcalcDb,
} from './lib/transform.ts'
import { ValidationError, validate } from './lib/validate.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CACHE = join(ROOT, '.cache')
const DATA_SNAPSHOTS = join(ROOT, 'data')
const OUT_DATA = join(ROOT, 'public/data')
const OUT_SPRITES = join(ROOT, 'public/sprites')
const OUT_ELEMENTS = join(ROOT, 'public/elements')
const OUT_FIXTURES = join(ROOT, 'src/engine/fixtures')
const MANIFEST = join(ROOT, 'data-manifest.json')
const SPRITE_SIZE = 128
const SPRITE_QUALITY = 80

interface Manifest {
  palcalcCommit: string
  gameVersion: string
  refreshedAt: string
}

const rows = (list: unknown[], indent: string): string =>
  list.length === 0 ? '[]' : `[\n${list.map((r) => `${indent}${JSON.stringify(r)}`).join(',\n')}\n${indent.slice(2)}]`

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest
  console.log(`palmatch data refresh — palcalc@${manifest.palcalcCommit.slice(0, 8)}`)

  console.log('1/6 fetching palcalc data')
  const paths = await fetchPalcalc(manifest.palcalcCommit, CACHE)

  console.log('2/6 extracting palpedia bundle')
  await mkdir(DATA_SNAPSHOTS, { recursive: true })
  const palpedia = await loadPalpedia(DATA_SNAPSHOTS)
  console.log(
    `  source=${palpedia.source} types=${Object.keys(palpedia.types).length} uniques=${palpedia.uniques.length}`,
  )

  console.log('3/6 transforming')
  const db = JSON.parse(await readFile(paths.dbPath, 'utf8')) as PalcalcDb
  const breeding = JSON.parse(await readFile(paths.breedingPath, 'utf8')) as BreedingFile
  const pals = buildPals(db, palpedia.types)
  const { matrix, genderLocked, unsetCells } = buildMatrix(pals, breeding.Breeding)
  const { combos, dropped } = buildCombos(pals, matrix, palpedia.uniques, genderLocked)
  const passives = buildPassives(db)
  const mutation = buildMutation()
  const goldens = buildGoldens(pals, breeding.Breeding, combos, matrix)
  for (const d of dropped) {
    console.warn(`  WARN dropped unique combo referencing unknown pal: ${d.parentA}+${d.parentB}=${d.childId}`)
  }
  console.log(
    `  pals=${pals.length} breedingEntries=${breeding.Breeding.length} unsetCells=${unsetCells} ` +
      `unique=${combos.unique.length} genderLocked=${combos.genderLocked.length} ` +
      `sameSpeciesOnly=${combos.sameSpeciesOnly.length} passives=${passives.length}`,
  )

  console.log('4/6 validating')
  const spriteFiles = new Set(await readdir(paths.spriteDir))
  const elementFiles = new Set((await readdir(paths.elementDir)).filter((f) => f.endsWith('.png')))
  validate({ pals, matrix, combos, goldens, entries: breeding.Breeding, spriteFiles, elementFiles })
  console.log('  all gates passed')
  // Only overwrite the committed snapshot once this extraction has proven itself against every gate.
  if (palpedia.source === 'live') await writePalpediaSnapshot(DATA_SNAPSHOTS, palpedia)

  console.log('5/6 writing artifacts')
  await mkdir(OUT_DATA, { recursive: true })
  await mkdir(OUT_FIXTURES, { recursive: true })
  const refreshedAt = new Date().toISOString()
  const version = { palcalcCommit: manifest.palcalcCommit, gameVersion: manifest.gameVersion, refreshedAt }
  await writeFile(
    join(OUT_DATA, 'pals.json'),
    `{\n  "version": ${JSON.stringify(version)},\n  "pals": ${rows(pals, '    ')}\n}\n`,
  )
  await writeFile(join(OUT_DATA, 'matrix.bin'), matrixToBuffer(matrix))
  await writeFile(
    join(OUT_DATA, 'combos.json'),
    `{\n  "unique": ${rows(combos.unique, '    ')},\n  "genderLocked": ${rows(combos.genderLocked, '    ')},\n` +
      `  "sameSpeciesOnly": ${JSON.stringify(combos.sameSpeciesOnly)}\n}\n`,
  )
  await writeFile(join(OUT_DATA, 'passives.json'), `${rows(passives, '  ')}\n`)
  await writeFile(join(OUT_DATA, 'mutation.json'), `${JSON.stringify(mutation, null, 2)}\n`)
  await writeFile(
    join(OUT_FIXTURES, 'goldens.json'),
    `{\n  "pairs": ${rows(goldens.pairs, '    ')},\n  "uniques": ${rows(goldens.uniques, '    ')},\n` +
      `  "genderLocked": ${rows(goldens.genderLocked, '    ')},\n  "sameSpecies": ${rows(goldens.sameSpecies, '    ')}\n}\n`,
  )
  await writeFile(MANIFEST, `${JSON.stringify({ ...manifest, refreshedAt }, null, 2)}\n`)

  console.log('6/6 converting images')
  await mkdir(OUT_SPRITES, { recursive: true })
  await mkdir(OUT_ELEMENTS, { recursive: true })
  // Keyed off pals, not files: palcalc ships one sprite per display name and Gumoss
  // (PlantSlime / PlantSlime_Flower) is two pals sharing one.
  let converted = 0
  const failed: string[] = []
  for (const pal of pals) {
    try {
      await sharp(join(paths.spriteDir, `${pal.name}.png`))
        .resize(SPRITE_SIZE, SPRITE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: SPRITE_QUALITY })
        .toFile(join(OUT_SPRITES, `${pal.id}.webp`))
      converted++
    } catch (err) {
      failed.push(`${pal.id} (${pal.name}.png): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (converted !== pals.length)
    throw new Error(`converted ${converted} sprites for ${pals.length} pals:\n  - ${failed.join('\n  - ')}`)
  const elements = [...elementFiles].sort()
  for (const file of elements) {
    await copyFile(join(paths.elementDir, file), join(OUT_ELEMENTS, file))
  }
  console.log(`  sprites=${converted} elements=${elements.length}`)
  console.log(`done — refreshedAt ${refreshedAt}`)
}

main().catch((err: unknown) => {
  // Gate failures are the expected kind of failure and read better without a stack.
  // Anything else gets the full object: node prints the stack plus the `[cause]` chain.
  if (err instanceof ValidationError) console.error(err.message)
  else console.error(err)
  process.exit(1)
})
