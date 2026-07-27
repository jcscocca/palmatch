import type { CombosFile, Dataset, MutationConfig, PalsFile, PassiveRecord } from './types.ts'

/**
 * `src/` is typechecked without `@types/node`, and a literal `node:` specifier would make the
 * browser build externalise a builtin it never reaches. So the disk loader resolves `fs` through
 * an indirect specifier plus a local shim of the one call it makes.
 */
interface NodeFsPromises {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  readFile(path: string): Promise<Uint8Array>
}

const NODE_FS_PROMISES = 'node:fs/promises'

async function nodeFs(): Promise<NodeFsPromises> {
  return (await import(/* @vite-ignore */ NODE_FS_PROMISES)) as unknown as NodeFsPromises
}

function trimSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/** A truncated artifact gives an odd byteLength, which would otherwise be a bare RangeError. */
function toMatrix(buffer: ArrayBuffer, source: string): Uint16Array {
  if (buffer.byteLength % 2 !== 0) {
    throw new Error(`failed to read ${source}: ${buffer.byteLength} bytes is not a whole number of Uint16 cells`)
  }
  return new Uint16Array(buffer)
}

function assemble(
  palsFile: PalsFile,
  matrix: Uint16Array,
  combos: CombosFile,
  passives: PassiveRecord[],
  mutation: MutationConfig,
): Dataset {
  const { pals, version } = palsFile
  if (matrix.length !== pals.length * pals.length) {
    throw new Error(`matrix holds ${matrix.length} cells, expected ${pals.length * pals.length} for ${pals.length} pals`)
  }
  return {
    pals,
    byId: new Map(pals.map((p, i) => [p.id, i])),
    matrix,
    combos,
    passives,
    mutation,
    version,
  }
}

async function fetchData(fetchFn: typeof fetch, base: string, file: string): Promise<Response> {
  const url = `${base}/data/${file}`
  let res: Response
  try {
    res = await fetchFn(url)
  } catch (cause) {
    throw new Error(`failed to fetch ${url}`, { cause })
  }
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`)
  return res
}

async function fetchJson<T>(fetchFn: typeof fetch, base: string, file: string): Promise<T> {
  const res = await fetchData(fetchFn, base, file)
  try {
    return (await res.json()) as T
  } catch (cause) {
    throw new Error(`failed to parse ${base}/data/${file} as JSON`, { cause })
  }
}

async function fetchMatrix(fetchFn: typeof fetch, base: string): Promise<Uint16Array> {
  const res = await fetchData(fetchFn, base, 'matrix.bin')
  return toMatrix(await res.arrayBuffer(), `${base}/data/matrix.bin`)
}

/**
 * Browser loader. Errors carry the failing URL so the shell can show a retry screen with a reason.
 * `fetchFn` exists so tests can drive the failure paths without a network.
 */
export async function loadDataset(baseUrl = '', fetchFn: typeof fetch = fetch): Promise<Dataset> {
  const base = trimSlash(baseUrl)
  const [palsFile, matrix, combos, passives, mutation] = await Promise.all([
    fetchJson<PalsFile>(fetchFn, base, 'pals.json'),
    fetchMatrix(fetchFn, base),
    fetchJson<CombosFile>(fetchFn, base, 'combos.json'),
    fetchJson<PassiveRecord[]>(fetchFn, base, 'passives.json'),
    fetchJson<MutationConfig>(fetchFn, base, 'mutation.json'),
  ])
  return assemble(palsFile, matrix, combos, passives, mutation)
}

/** Node loader for tests and scripts; `dir` is the directory holding the five artifacts. */
export async function loadDatasetFromDisk(dir: string): Promise<Dataset> {
  const fs = await nodeFs()
  const base = trimSlash(dir)

  const readJson = async <T>(file: string): Promise<T> => {
    const path = `${base}/${file}`
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch (cause) {
      throw new Error(`failed to read ${path}`, { cause })
    }
    try {
      return JSON.parse(text) as T
    } catch (cause) {
      throw new Error(`failed to parse ${path} as JSON`, { cause })
    }
  }

  const matrixPath = `${base}/matrix.bin`
  const [palsFile, bytes, combos, passives, mutation] = await Promise.all([
    readJson<PalsFile>('pals.json'),
    fs.readFile(matrixPath).catch((cause: unknown) => {
      throw new Error(`failed to read ${matrixPath}`, { cause })
    }),
    readJson<CombosFile>('combos.json'),
    readJson<PassiveRecord[]>('passives.json'),
    readJson<MutationConfig>('mutation.json'),
  ])
  // Node hands back a view that may sit at an odd offset in a pooled buffer, so copy before reinterpreting.
  return assemble(palsFile, toMatrix(new Uint8Array(bytes).buffer, matrixPath), combos, passives, mutation)
}
