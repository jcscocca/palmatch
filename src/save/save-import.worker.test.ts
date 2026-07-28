import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import { buildLowerLookup } from '../lib/lower-lookup.ts'
import { cnk0, junkFile, levelGvas, plz1, storageGvas, type PalSpec } from './fixtures/builder.ts'
import type { SaveImportRequest, SaveImportResponse } from './types.ts'

interface FakeScope {
  onmessage: ((event: MessageEvent<SaveImportRequest | undefined>) => void) | null
  postMessage(message: SaveImportResponse): void
}

let byIdLower: Array<[string, number]>
let posted: SaveImportResponse[]
let scope: FakeScope

/** Loads the worker against the stubbed scope and hands back its message port. */
async function boot(): Promise<(req: SaveImportRequest | undefined) => void> {
  await import('./save-import.worker.ts')
  const handler = scope.onmessage
  if (handler === null) throw new Error('worker never registered a message handler')
  return (req) => handler({ data: req } as MessageEvent<SaveImportRequest | undefined>)
}

function save(pals: PalSpec[]): ArrayBuffer {
  return plz1(levelGvas({ pals }))
}

function storage(label: string, pals: Array<PalSpec | null>): { label: string; buffer: ArrayBuffer } {
  return { label, buffer: plz1(storageGvas({ pals })) }
}

beforeAll(async () => {
  const ds = await loadDatasetFromDisk('public/data')
  byIdLower = [...buildLowerLookup(ds.byId)]
})

beforeEach(() => {
  posted = []
  scope = {
    onmessage: null,
    postMessage: (message) => {
      posted.push(message)
    },
  }
  vi.resetModules()
  vi.stubGlobal('self', scope)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('save-import.worker', () => {
  it('answers a save with the pals in it and the id it was asked for', async () => {
    const send = await boot()

    send({
      requestId: 7,
      buffer: save([{ characterId: 'SheepBall', gender: 'Female', talents: { hp: 90 } }, { isPlayer: true, characterId: null }]),
      byIdLower,
    })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const response = posted[0]
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error(response.detail)
    expect(response.requestId).toBe(7)
    expect(response.result.playerRows).toBe(1)
    expect(response.result.owned).toEqual([
      { speciesIndex: expect.any(Number), gender: 'F', passives: [], talents: { hp: 90, shot: 0, defense: 0 } },
    ])
  })

  it('merges a Level.sav and the storage files sent with it into one answer', async () => {
    const send = await boot()

    send({
      requestId: 4,
      buffer: save([{ characterId: 'SheepBall' }, { isPlayer: true, characterId: null }]),
      storage: [
        storage('0001_dps.sav', [{ characterId: 'CatMage' }, null]),
        storage('GlobalPalStorage.sav', [{ characterId: 'LazyDragon' }]),
      ],
      byIdLower,
    })

    // One request, one answer: the extra files do not each get their own reply for the panel to
    // stitch together.
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const response = posted[0]
    if (!response.ok) throw new Error(response.detail)
    expect(response.requestId).toBe(4)
    expect(response.result.palCount).toBe(3)
    expect(response.result.playerRows).toBe(1)
    expect(response.result.vacantSlots).toBe(1)
    expect(response.result.sources.map((s) => `${s.kind}:${s.label}`)).toEqual([
      'level:Level.sav',
      'storage:0001_dps.sav',
      'storage:GlobalPalStorage.sav',
    ])
  })

  it('keeps the import alive when a storage file is the broken one', async () => {
    const send = await boot()

    send({ requestId: 5, buffer: save([{ characterId: 'SheepBall' }]), storage: [{ label: 'bad_dps.sav', buffer: junkFile() }], byIdLower })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const response = posted[0]
    // Not a failure: a `_dps.sav` that won't parse is common and costs one file, not the import.
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error(response.detail)
    expect(response.result.owned).toHaveLength(1)
    expect(response.result.sources).toHaveLength(1)
    expect(response.result.warnings[0]).toContain('bad_dps.sav')
  })

  it('rebuilds the species lookup from the plain pairs it was sent', async () => {
    const send = await boot()

    send({ requestId: 1, buffer: save([{ characterId: 'SheepBall' }]), byIdLower: [['sheepball', 42]] })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const response = posted[0]
    if (!response.ok) throw new Error(response.detail)
    expect(response.result.owned[0].speciesIndex).toBe(42)
  })

  it('answers each request with its own id', async () => {
    const send = await boot()

    send({ requestId: 1, buffer: save([{ characterId: 'SheepBall' }]), byIdLower })
    send({ requestId: 2, buffer: save([{ characterId: 'CatMage' }, { characterId: 'LazyDragon' }]), byIdLower })

    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted.map((m) => m.requestId)).toEqual([1, 2])
    expect(posted.every((m) => m.ok)).toBe(true)
  })

  it.each([
    ['an Xbox save', () => cnk0(plz1(levelGvas())), 'xbox-save'],
    ['a file that is not a save', () => junkFile(), 'unknown-magic'],
    ['a save that is not Level.sav', () => plz1(levelGvas({ omitWorldSaveData: true })), 'wrong-file'],
    ['a corrupted save', () => plz1(levelGvas({ padBytes: 128, corruptPadSize: 8 })), 'skip-drift'],
  ])('passes the code for %s through to the panel', async (_label, make, code) => {
    const send = await boot()

    send({ requestId: 3, buffer: make(), byIdLower })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const response = posted[0]
    expect(response).toMatchObject({ ok: false, requestId: 3, code })
    if (response.ok) throw new Error('expected a failure')
    expect(response.detail.length).toBeGreaterThan(0)
  })

  it('answers a message with no request in it, rather than rejecting into the void', async () => {
    const send = await boot()

    // Anything can `postMessage` at a worker — an empty call, a probe from an extension. Reading
    // the id inside the try would throw while building the failure response, leaving the promise
    // rejected with nothing sent and the panel waiting out its full 60-second timeout.
    send(undefined)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    // `-1` matches no in-flight request, so the panel discards it — which is the right fate for an
    // answer to a question nobody asked.
    expect(posted[0]).toMatchObject({ ok: false, requestId: -1, code: 'internal' })
  })

  it('reports an unforeseen throw as internal rather than as a verdict on the file', async () => {
    const send = await boot()

    // A malformed message: rebuilding the lookup throws a TypeError before the parser is reached.
    // Whatever the cause, the panel has to get an answer — a silent rejection would hang it.
    send({ requestId: 9, buffer: save([{}]), byIdLower: 5 as unknown as Array<[string, number]> })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const response = posted[0]
    expect(response).toMatchObject({ ok: false, requestId: 9, code: 'internal' })
    if (response.ok) throw new Error('expected a failure')
    expect(response.detail.length).toBeGreaterThan(0)
  })
})
