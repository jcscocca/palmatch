import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import type { Dataset } from '../engine/types.ts'
import { levelGvas, plz1 } from '../save/fixtures/builder.ts'
import { MAX_SAVE_BYTES } from '../save/parse.ts'
import type { ImportResult, OwnedPal, ParseErrorCode, SaveImportRequest, SaveImportResponse } from '../save/types.ts'
import { encodeOwnedShare, shareJson, useOwnedStore } from '../state/owned.ts'
import type { OwnedBySpecies } from '../state/owned.ts'
import { DatasetContext } from './dataset-context.ts'
import { ImportPanel, MAX_FILE_BYTES } from './ImportPanel.tsx'

let ds: Dataset
let workers: FakeWorker[]

/**
 * The real module worker can't run in jsdom (and wouldn't be the thing under test here anyway):
 * the parser has its own suite against these same fixtures, and the browser-side wiring is verified
 * live at F6. What this stands in for is the *contract* — a transferred buffer, a request id, and a
 * response that is either a result or a `ParseErrorCode`.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<SaveImportResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: SaveImportRequest[] = []
  transfers: Array<Transferable[] | undefined> = []
  terminated = false

  constructor() {
    workers.push(this)
  }

  postMessage(request: SaveImportRequest, transfer?: Transferable[]): void {
    this.posted.push(request)
    this.transfers.push(transfer)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(response: SaveImportResponse): void {
    act(() => {
      this.onmessage?.({ data: response } as MessageEvent<SaveImportResponse>)
    })
  }

  fail(message: string): void {
    act(() => {
      this.onerror?.({ message } as ErrorEvent)
    })
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

/** Real `Level.sav` bytes, so the ingest path (size check, sniff, transfer) sees a real save. */
function saveBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(plz1(levelGvas({ pals: [{ characterId: 'SheepBall' }, { characterId: 'FoxMage' }] })))
}

/** Dataset index by display name, as in the other panel suites — ids are palcalc InternalNames. */
function idx(name: string): number {
  const i = ds.pals.findIndex((p) => p.name === name)
  expect(i).toBeGreaterThanOrEqual(0)
  return i
}

function saveFile(name = 'Level.sav'): File {
  return new File([saveBytes()], name)
}

function ownedPal(speciesIndex: number): OwnedPal {
  return { speciesIndex, gender: 'F', passives: ['Swift'], talents: null }
}

function importResult(owned: OwnedPal[], warnings: string[] = []): ImportResult {
  return { owned, unknownSpecies: [], nonPalRows: 1, palCount: owned.length, warnings }
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

beforeEach(() => {
  workers = []
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('Worker', FakeWorker)
  useOwnedStore.getState().clearOwned()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function show(props: { shareBlob?: string | null } = {}): { onClose: () => void } {
  const onClose = vi.fn()
  render(
    <DatasetContext value={ds}>
      <ImportPanel onClose={onClose} shareBlob={props.shareBlob ?? null} />
    </DatasetContext>,
  )
  return { onClose }
}

/** The zone itself is a plain div; the file name inside it is the one exact-text handle on it. */
function dropZone(): HTMLElement {
  const zone = screen.getByText('Level.sav').closest('.drop-zone')
  expect(zone).not.toBeNull()
  return zone as HTMLElement
}

function drop(file: File): void {
  fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } })
}

/** The worker the panel built for the file just dropped, once the async read has handed it over. */
async function posted(): Promise<FakeWorker> {
  await waitFor(() => expect(workers).toHaveLength(1))
  const worker = workers[0]
  await waitFor(() => expect(worker.posted).toHaveLength(1))
  return worker
}

describe('ImportPanel', () => {
  it('agrees with the parser about the size cap it enforces on its behalf', () => {
    expect(MAX_FILE_BYTES).toBe(MAX_SAVE_BYTES)
  })

  it('sends a dropped save to the worker and renders the counts it comes back with', async () => {
    const bytes = saveBytes()
    show()
    drop(new File([bytes], 'Level.sav'))

    expect(screen.getByLabelText('reading your save')).toBeTruthy()

    const worker = await posted()
    const request = worker.posted[0]
    expect(request.buffer.byteLength).toBe(bytes.byteLength)
    // The buffer is handed over rather than copied, and species resolution rides along as plain
    // pairs because the worker never loads the paldex itself.
    expect(worker.transfers[0]).toEqual([request.buffer])
    expect(new Map(request.byIdLower).get('sheepball')).toBe(ds.byId.get('SheepBall'))

    const lamball = idx('Lamball')
    const foxparks = idx('Foxparks')
    worker.reply({
      ok: true,
      requestId: request.requestId,
      result: importResult([ownedPal(lamball), ownedPal(lamball), ownedPal(foxparks)], ['left out 1 pal palmatch does not know']),
    })

    expect(screen.getByText(/2 species · 3 pals/)).toBeTruthy()
    expect(screen.getByText('left out 1 pal palmatch does not know')).toBeTruthy()
    expect(screen.getByLabelText('2 owned')).toBeTruthy()
    expect(screen.getAllByText(ds.pals[lamball].name).length).toBeGreaterThan(0)
    expect(useOwnedStore.getState().bySpecies[lamball].count).toBe(2)
    expect(useOwnedStore.getState().sourceLabel).toBe('Level.sav')
  })

  it('takes a file dropped anywhere in the dialog, so a near-miss cannot navigate the tab away', async () => {
    show()
    // The dashed zone is a target, not a boundary: without this the browser's own drop handler
    // opens the .sav as a document and the app is gone.
    fireEvent.drop(screen.getByLabelText('my pals'), { dataTransfer: { files: [saveFile()] } })

    const worker = await posted()
    expect(worker.posted).toHaveLength(1)
  })

  it('drops a reply to a request the panel has moved on from', async () => {
    show()
    drop(saveFile())
    const worker = await posted()

    worker.reply({ ok: true, requestId: worker.posted[0].requestId + 1, result: importResult([ownedPal(0)]) })
    expect(screen.getByLabelText('reading your save')).toBeTruthy()
    expect(useOwnedStore.getState().importedAt).toBeNull()
  })

  it.each<[ParseErrorCode, RegExp, boolean]>([
    ['xbox-save', /Xbox\/Game Pass save/, false],
    ['not-a-save', /doesn't look like a Palworld save/, false],
    ['wrong-file', /you want Level\.sav, the big one/, false],
    ['too-large', /bigger than the 500 MB/, false],
    ['truncated', /corrupt or was cut short/, true],
    ['skip-drift', /lost its place reading that save/, true],
    ['unknown-magic', /does not recognise this save format/, true],
    ['internal', /something went wrong reading that file/, true],
  ])('explains a %s failure in plain language', async (code, message, reportable) => {
    show()
    drop(saveFile('LevelMeta.sav'))
    const worker = await posted()

    worker.reply({ ok: false, requestId: worker.posted[0].requestId, code, detail: 'offset 1234: something specific' })

    expect(screen.getByText(message)).toBeTruthy()
    // The parser's own detail is always shown: it is the half a bug report needs.
    expect(screen.getByText('offset 1234: something specific')).toBeTruthy()
    expect(screen.queryByText('report it')).toEqual(reportable ? expect.anything() : null)
    expect(useOwnedStore.getState().importedAt).toBeNull()
  })

  it('names the file the player actually picked when it is the wrong one', async () => {
    show()
    drop(saveFile('LevelMeta.sav'))
    const worker = await posted()
    worker.reply({ ok: false, requestId: worker.posted[0].requestId, code: 'wrong-file', detail: 'no worldSaveData' })

    expect(screen.getByText(/that's LevelMeta\.sav — you want Level\.sav/)).toBeTruthy()
  })

  it('reports a worker that fails to start, without claiming anything about the file', async () => {
    show()
    drop(saveFile())
    const worker = await posted()
    worker.fail('')

    expect(screen.getByText(/something went wrong reading that file/)).toBeTruthy()
    expect(screen.getByText('the import worker failed to start')).toBeTruthy()
  })

  it('rejects an oversized file on its size alone, without reading a byte or starting a worker', async () => {
    const file = saveFile()
    Object.defineProperty(file, 'size', { value: 600 * 1024 * 1024 })
    const read = vi.spyOn(file, 'arrayBuffer')

    show()
    drop(file)

    expect(screen.getByText(/bigger than the 500 MB/)).toBeTruthy()
    expect(screen.getByText(/Level\.sav is 600 MB, past the 500 MB limit/)).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
    expect(workers).toHaveLength(0)
  })

  it('offers another go after a failure, back at the drop zone', async () => {
    show()
    drop(saveFile())
    const worker = await posted()
    worker.reply({ ok: false, requestId: worker.posted[0].requestId, code: 'not-a-save', detail: 'too short' })

    fireEvent.click(screen.getByText('TRY ANOTHER FILE'))
    expect(dropZone()).toBeTruthy()
  })

  it('terminates its worker when the panel closes mid-parse', async () => {
    show()
    drop(saveFile())
    const worker = await posted()

    cleanup()
    expect(worker.terminated).toBe(true)
  })

  it('imports a .palmatch.json list without going near the worker', async () => {
    const list: OwnedBySpecies = { 4: { count: 3, individuals: [] }, 9: { count: 1, individuals: [] } }
    show()
    drop(new File([shareJson(list)], 'my-pals.palmatch.json'))

    await waitFor(() => expect(useOwnedStore.getState().bySpecies[4].count).toBe(3))
    expect(workers).toHaveLength(0)
    expect(screen.getByText(/2 species · 4 pals/)).toBeTruthy()
  })

  it('calls a damaged .palmatch.json what it is, rather than blaming the save parser', async () => {
    show()
    drop(new File(['{"v":1,"species":"nope"}'], 'my-pals.palmatch.json'))

    await waitFor(() => expect(screen.getByText(/shared list is damaged/)).toBeTruthy())
    expect(workers).toHaveLength(0)
  })

  describe('shared links', () => {
    const shared: OwnedBySpecies = { 2: { count: 5, individuals: [] }, 6: { count: 1, individuals: [] } }

    it('asks before replacing the current list, then loads it', async () => {
      show({ shareBlob: encodeOwnedShare(shared) })

      expect(screen.getByText('Load shared list — 2 species? Replaces your current list.')).toBeTruthy()
      expect(useOwnedStore.getState().importedAt).toBeNull()

      fireEvent.click(screen.getByText('LOAD'))
      expect(useOwnedStore.getState().bySpecies).toEqual({
        2: { count: 5, individuals: [] },
        6: { count: 1, individuals: [] },
      })
      expect(screen.getByText(/2 species · 6 pals/)).toBeTruthy()
    })

    it('leaves the current list alone when the confirm is cancelled', () => {
      useOwnedStore.getState().loadShared([[1, 1]], 'mine')
      const { onClose } = show({ shareBlob: encodeOwnedShare(shared) })

      fireEvent.click(screen.getByText('CANCEL'))
      expect(onClose).toHaveBeenCalled()
      expect(useOwnedStore.getState().bySpecies).toEqual({ 1: { count: 1, individuals: [] } })
    })

    it('says so when the link is damaged, instead of importing half of it', () => {
      show({ shareBlob: 'this-is-not-a-blob' })
      expect(screen.getByText(/shared list is damaged/)).toBeTruthy()
      expect(useOwnedStore.getState().importedAt).toBeNull()
    })

    it('leaves out species this build has never heard of, and says how many', () => {
      const stale: OwnedBySpecies = { 2: { count: 1, individuals: [] }, 5000: { count: 1, individuals: [] } }
      show({ shareBlob: encodeOwnedShare(stale) })

      expect(screen.getByText(/1 more species in that link are unknown/)).toBeTruthy()
      fireEvent.click(screen.getByText('LOAD'))
      expect(useOwnedStore.getState().bySpecies).toEqual({ 2: { count: 1, individuals: [] } })
      expect(screen.getByText('1 species · 1 pal · from shared list')).toBeTruthy()
    })
  })

  it('copies a share link to the clipboard and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show()

    fireEvent.click(screen.getByText('SHARE'))
    await waitFor(() => expect(screen.getByText(/link copied/)).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#/own/'))
    expect(writeText.mock.calls[0][0]).toBe(
      `${window.location.origin}${window.location.pathname}#/own/${encodeOwnedShare({ 2: { count: 3, individuals: [] } })}`,
    )
  })

  it('downloads the same payload as a .palmatch.json file', async () => {
    const created: Blob[] = []
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return 'blob:fake'
      },
      revokeObjectURL: () => undefined,
    })
    const clicks: string[] = []
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.download)
      })

    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show()
    fireEvent.click(screen.getByText('DOWNLOAD'))

    expect(click).toHaveBeenCalled()
    expect(clicks).toEqual(['my-pals.palmatch.json'])
    expect(await created[0].text()).toBe(shareJson({ 2: { count: 3, individuals: [] } }))
    expect(screen.getByText(/saved my-pals\.palmatch\.json/)).toBeTruthy()
  })

  it('falls back to a prompt when the clipboard is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show()

    fireEvent.click(screen.getByText('SHARE'))
    expect(prompt).toHaveBeenCalledWith('copy this link', expect.stringContaining('#/own/'))
    expect(screen.getByText('copy the link from the box')).toBeTruthy()
  })

  it('CLEAR empties the list and lands back on the drop zone', () => {
    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show()

    fireEvent.click(screen.getByText('CLEAR'))
    expect(useOwnedStore.getState().bySpecies).toEqual({})
    expect(dropZone()).toBeTruthy()
  })

  it('IMPORT AGAIN shows the drop zone over an existing list, and BACK returns to it', () => {
    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show()

    fireEvent.click(screen.getByText('IMPORT AGAIN'))
    expect(dropZone()).toBeTruthy()
    fireEvent.click(screen.getByText('BACK'))
    expect(screen.getByText(/1 species · 3 pals/)).toBeTruthy()
  })

  it('hides the directory picker on a browser that has none, and uses it where it exists', async () => {
    show()
    expect(screen.queryByText('FIND MY SAVE FOLDER')).toBeNull()
    cleanup()

    const file = saveFile()
    const world = {
      kind: 'directory' as const,
      name: 'world-1',
      values: async function* () {
        yield { kind: 'file' as const, name: 'Level.sav', getFile: () => Promise.resolve(file) }
        yield { kind: 'file' as const, name: 'LevelMeta.sav', getFile: () => Promise.resolve(saveFile('LevelMeta.sav')) }
      },
    }
    const saveGames = {
      kind: 'directory' as const,
      name: 'SaveGames',
      values: async function* () {
        yield world
      },
    }
    vi.stubGlobal('showDirectoryPicker', () => Promise.resolve(saveGames))

    show()
    fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
    const worker = await posted()
    expect(worker.posted[0].buffer.byteLength).toBe(saveBytes().byteLength)
  })

  it('says so when the chosen folder holds no save at all', async () => {
    vi.stubGlobal('showDirectoryPicker', () =>
      Promise.resolve({
        kind: 'directory' as const,
        name: 'Documents',
        values: async function* () {
          yield { kind: 'file' as const, name: 'notes.txt', getFile: () => Promise.resolve(new File([''], 'notes.txt')) }
        },
      }),
    )
    show()

    fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
    await waitFor(() => expect(screen.getByText(/no Level\.sav in that folder/)).toBeTruthy())
  })
})
