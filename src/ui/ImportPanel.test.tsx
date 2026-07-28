import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import type { Dataset } from '../engine/types.ts'
import { levelGvas, plz1 } from '../save/fixtures/builder.ts'
import { MAX_SAVE_BYTES } from '../save/parse.ts'
import type { ImportResult, OwnedPal, ParseErrorCode, SaveImportRequest, SaveImportResponse } from '../save/types.ts'
import { encodeOwnedShare, shareJson } from '../state/owned-share.ts'
import { useOwnedStore } from '../state/owned.ts'
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

function importResult(owned: OwnedPal[], warnings: string[] = [], playerRows = 0): ImportResult {
  return {
    owned,
    unknownSpecies: [],
    unknownPals: 0,
    oddTypes: [],
    playerRows,
    unreadableRows: 0,
    palCount: owned.length,
    warnings,
  }
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

function show(props: { shareBlob?: string | null; dropReady?: boolean } = {}): { onClose: () => void } {
  const onClose = vi.fn()
  render(
    <DatasetContext value={ds}>
      <ImportPanel onClose={onClose} shareBlob={props.shareBlob ?? null} dropReady={props.dropReady ?? false} />
    </DatasetContext>,
  )
  return { onClose }
}

/**
 * The zone is a plain div with nothing an accessibility query can hold onto, so it carries a
 * `data-testid`. Reaching it through the words inside it, as this used to, made every test that
 * only wanted "is the drop zone showing?" break the day the copy changed.
 */
function dropZone(): HTMLElement {
  return screen.getByTestId('drop-zone')
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

  it('names every control it offers, and puts the real file input inside its own label', () => {
    // Same shell as SearchPalette: a named dialog, a named close button, and no control whose only
    // identity is a glyph. The file input is `.visually-hidden`, so nesting it inside the BROWSE…
    // label is what gives a keyboard user something that lights up when they tab to it.
    show()
    expect(screen.getByLabelText('my pals').tagName).toBe('DIALOG')
    expect(screen.getByLabelText('close my pals')).toBeTruthy()

    const input = screen.getByLabelText('choose a save file')
    expect(input.closest('label')?.textContent).toContain('BROWSE…')
    expect(input.classList.contains('visually-hidden')).toBe(true)
  })

  it('restores focus to whatever opened it', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    show()
    cleanup()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('announces a failure as an alert and a share confirmation as a status', async () => {
    show()
    drop(saveFile())
    const worker = await posted()
    worker.reply({ ok: false, requestId: worker.posted[0].requestId, code: 'not-a-save', detail: 'too short' })
    expect(screen.getByRole('alert').textContent).toContain('IMPORT FAILED')

    cleanup()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show()
    fireEvent.click(screen.getByText('SHARE'))
    // A status rather than an alert: the copy worked, it just needs saying — politely.
    expect(screen.getByRole('status').textContent).toBe('copy the link from the box')
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

  it('retires the worker once it has answered, rather than holding its wasm heap open', async () => {
    show()
    drop(saveFile())
    const worker = await posted()

    worker.reply({ ok: true, requestId: worker.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })

    // The protocol is one answer per request, and a finished worker still owns tens of MB of wasm
    // linear memory for as long as the player sits on the summary.
    expect(worker.terminated).toBe(true)
    expect(screen.getByText(/1 species · 1 pal/)).toBeTruthy()
  })

  it('terminates its worker after a failure too', async () => {
    show()
    drop(saveFile())
    const worker = await posted()

    worker.reply({ ok: false, requestId: worker.posted[0].requestId, code: 'skip-drift', detail: 'lost at offset 9' })
    expect(worker.terminated).toBe(true)
  })

  it('kills the first parse when a second file is dropped on top of it', async () => {
    show()
    drop(saveFile('one.sav'))
    const first = await posted()

    // A second file dropped on the dialog while the first is still parsing — the drop handler is
    // live in every panel state, which is what makes this reachable at all.
    fireEvent.drop(screen.getByLabelText('my pals'), { dataTransfer: { files: [saveFile('two.sav')] } })

    await waitFor(() => expect(workers).toHaveLength(2))
    expect(first.terminated).toBe(true)
    expect(workers[1].terminated).toBe(false)

    // And the abandoned parse's answer is not rendered when it arrives late.
    first.reply({ ok: true, requestId: first.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })
    expect(useOwnedStore.getState().importedAt).toBeNull()
  })

  it('discards a save parse that lands after a shared list was applied over it', async () => {
    const list: OwnedBySpecies = { 4: { count: 3, individuals: [] } }
    show()
    drop(saveFile())
    const worker = await posted()

    // A `.palmatch.json` dropped while the save is still parsing. Without the abort, the save's
    // result would arrive seconds later and silently replace the list the player just chose.
    fireEvent.drop(screen.getByLabelText('my pals'), {
      dataTransfer: { files: [new File([shareJson(list)], 'my-pals.palmatch.json')] },
    })
    await waitFor(() => expect(useOwnedStore.getState().bySpecies[4].count).toBe(3))
    expect(worker.terminated).toBe(true)

    worker.reply({ ok: true, requestId: worker.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })
    expect(useOwnedStore.getState().bySpecies).toEqual(list)
  })

  it('gives up on a worker that never answers, and takes it down with it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      show()
      drop(saveFile())
      const worker = await posted()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })

      expect(screen.getByText(/did not finish within 60 seconds/)).toBeTruthy()
      expect(screen.getByText('Level.sav was still parsing after 60 seconds')).toBeTruthy()
      // A worker that missed its deadline is still chewing on the old question; leaving it alive
      // would make the retry queue behind it.
      expect(worker.terminated).toBe(true)
      expect(useOwnedStore.getState().importedAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not time out a parse that answered in time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      show()
      drop(saveFile())
      const worker = await posted()
      worker.reply({ ok: true, requestId: worker.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(screen.queryByText(/did not finish within 60 seconds/)).toBeNull()
      expect(screen.getByText(/1 species · 1 pal/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens straight on the drop zone when a file was dragged onto the page', () => {
    useOwnedStore.getState().loadShared([[2, 3]], 'mine')
    show({ dropReady: true })

    // Without this the panel would open on the summary and the file in the player's hand would
    // have nowhere obvious to land.
    expect(dropZone()).toBeTruthy()
    expect(screen.queryByText(/1 species · 3 pals/)).toBeNull()
  })

  it('says how many players share the world the list came from', async () => {
    show()
    drop(saveFile())
    const worker = await posted()
    worker.reply({
      ok: true,
      requestId: worker.posted[0].requestId,
      result: importResult([ownedPal(idx('Lamball'))], [], 3),
    })

    expect(screen.getByText('1 species · 1 pal · guild of 3 players · from Level.sav')).toBeTruthy()
  })

  it('totals the species it can actually render, not everything in the store', async () => {
    // A list from a newer build: 500 pals of a species this paldex has never heard of. Counting
    // them in the headline would advertise a total the grid underneath cannot account for.
    useOwnedStore.getState().loadShared(
      [
        [2, 3],
        [ds.pals.length + 40, 500],
      ],
      'a newer build',
    )
    show()

    expect(screen.getByText('1 species · 3 pals · from a newer build')).toBeTruthy()
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

      // Awaited, not immediate: the codec that decodes the blob is a lazy chunk (see `loadCodec`).
      await screen.findByText('Load shared list — 2 species? Replaces your current list.')
      expect(useOwnedStore.getState().importedAt).toBeNull()

      fireEvent.click(screen.getByText('LOAD'))
      expect(useOwnedStore.getState().bySpecies).toEqual({
        2: { count: 5, individuals: [] },
        6: { count: 1, individuals: [] },
      })
      expect(screen.getByText(/2 species · 6 pals/)).toBeTruthy()
    })

    it('leaves the current list alone when the confirm is cancelled', async () => {
      useOwnedStore.getState().loadShared([[1, 1]], 'mine')
      const { onClose } = show({ shareBlob: encodeOwnedShare(shared) })

      fireEvent.click(await screen.findByText('CANCEL'))
      expect(onClose).toHaveBeenCalled()
      expect(useOwnedStore.getState().bySpecies).toEqual({ 1: { count: 1, individuals: [] } })
    })

    it('says so when the link is damaged, instead of importing half of it', async () => {
      show({ shareBlob: 'this-is-not-a-blob' })
      await screen.findByText(/shared list is damaged/)
      expect(useOwnedStore.getState().importedAt).toBeNull()
    })

    it('leaves out species this build has never heard of, and says how many', async () => {
      const stale: OwnedBySpecies = { 2: { count: 1, individuals: [] }, 5000: { count: 1, individuals: [] } }
      show({ shareBlob: encodeOwnedShare(stale) })

      await screen.findByText(/1 more species in that link are unknown/)
      fireEvent.click(screen.getByText('LOAD'))
      expect(useOwnedStore.getState().bySpecies).toEqual({ 2: { count: 1, individuals: [] } })
      expect(screen.getByText('1 species · 1 pal · from shared list')).toBeTruthy()
      // The count the confirm step already made was carried through rather than re-derived.
      expect(screen.getByText(/1 species in that list are unknown to this version and were left out/)).toBeTruthy()
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

  it('asks which world when a SaveGames folder holds several, biggest first', async () => {
    // The real shape: `SaveGames/<steam-id>/<world-id>/Level.sav`, two levels below what the player
    // picks. Guessing at one of them would quietly import the wrong world.
    const world = (name: string, size: number) => ({
      kind: 'directory' as const,
      name,
      values: async function* () {
        const file = saveFile()
        Object.defineProperty(file, 'size', { value: size })
        yield { kind: 'file' as const, name: 'Level.sav', getFile: () => Promise.resolve(file) }
      },
    })
    const steamId = {
      kind: 'directory' as const,
      name: '76561198000000000',
      values: async function* () {
        yield world('small-world', 2 * 1024 * 1024)
        yield world('big-world', 300 * 1024 * 1024)
      },
    }
    vi.stubGlobal('showDirectoryPicker', () =>
      Promise.resolve({
        kind: 'directory' as const,
        name: 'SaveGames',
        values: async function* () {
          yield steamId
        },
      }),
    )
    show()

    fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
    await screen.findByText('2 saves in that folder — which world?')

    const paths = screen.getAllByText(/world\/Level\.sav$/).map((el) => el.textContent)
    // Biggest first, and the path is the full breadcrumb from what they picked, so two worlds with
    // the same folder name are still tellable apart.
    expect(paths).toEqual([
      '76561198000000000/big-world/Level.sav',
      '76561198000000000/small-world/Level.sav',
    ])
    expect(screen.getByText('300 MB')).toBeTruthy()

    fireEvent.click(screen.getByText('76561198000000000/big-world/Level.sav'))
    expect((await posted()).posted[0].buffer.byteLength).toBe(saveBytes().byteLength)
  })

  it('stops walking rather than searching a whole home directory', async () => {
    // A player who picks `~` by mistake must get a quick "nothing here", not a full-disk crawl.
    // `Level.sav` is planted three levels down, past MAX_WALK_DEPTH, so it is never reached.
    let visited = 0
    const branch = (depth: number): { kind: 'directory'; name: string; values: () => AsyncGenerator<never> } => ({
      kind: 'directory',
      name: `dir-${depth}`,
      values: async function* () {
        visited++
        for (let i = 0; i < 8; i++) yield branch(depth + 1) as never
      },
    })
    vi.stubGlobal('showDirectoryPicker', () => Promise.resolve(branch(0)))
    show()

    fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
    await waitFor(() => expect(screen.getByText(/no Level\.sav in that folder/)).toBeTruthy())
    // MAX_WALK_DEPTH = 2 and MAX_DIRECTORIES = 64: 1 + 8 + 64 would be the unbounded shape, and the
    // directory budget is what actually stops it.
    expect(visited).toBeLessThanOrEqual(64)
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
