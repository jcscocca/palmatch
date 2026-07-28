import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import type { Dataset } from '../engine/types.ts'
import { levelGvas, plz1 } from '../save/fixtures/builder.ts'
import { MAX_SAVE_BYTES } from '../save/parse.ts'
import type {
  ImportResult,
  ImportSource,
  OwnedPal,
  ParseErrorCode,
  SaveImportRequest,
  SaveImportResponse,
} from '../save/types.ts'
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

function importResult(
  owned: OwnedPal[],
  warnings: string[] = [],
  playerRows = 0,
  sources: ImportSource[] = [{ label: 'Level.sav', kind: 'level', palCount: owned.length }],
): ImportResult {
  return {
    owned,
    sources,
    unknownSpecies: [],
    unknownPals: 0,
    oddTypes: [],
    playerRows,
    unreadableRows: 0,
    vacantSlots: 0,
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

/** Variadic because `Level.sav` and the `_dps.sav` files beside it are meant to be dragged together. */
function drop(...files: File[]): void {
  fireEvent.drop(dropZone(), { dataTransfer: { files } })
}

/**
 * `fireEvent.dragLeave(node, { relatedTarget })` silently drops `relatedTarget` under jsdom, and
 * that field is the whole of what the flicker fix reads — a test written that way exercises the
 * "left the window" branch no matter which element it names. A hand-built `MouseEvent` carries it.
 */
function dragLeave(zone: HTMLElement, relatedTarget: EventTarget | null): void {
  fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, relatedTarget }))
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

  it('discards a save whose read finishes after a shared list was dropped on top of it', async () => {
    // The window before any worker exists: reading a 400 MB save takes seconds, and a small shared
    // list dropped into that window resolves first. Without a generation guard the save's
    // continuation still runs, starts a worker, and parses over the list the player just chose.
    const list: OwnedBySpecies = { 4: { count: 3, genders: null, individuals: [] } }
    const slow = saveFile('big.sav')
    let releaseRead: (buffer: ArrayBuffer) => void = () => undefined
    vi.spyOn(slow, 'arrayBuffer').mockReturnValue(
      new Promise<ArrayBuffer>((resolve) => {
        releaseRead = resolve
      }),
    )

    show()
    drop(slow)
    fireEvent.drop(screen.getByLabelText('my pals'), {
      dataTransfer: { files: [new File([shareJson(list)], 'my-pals.palmatch.json')] },
    })
    await waitFor(() => expect(useOwnedStore.getState().bySpecies[4].count).toBe(3))

    // Now the big save's read finally lands. It must go nowhere.
    releaseRead(saveBytes().buffer as ArrayBuffer)
    await waitFor(() => expect(screen.getByText(/1 species · 3 pals/)).toBeTruthy())
    expect(workers).toHaveLength(0)
    expect(useOwnedStore.getState().bySpecies).toEqual(list)
    expect(useOwnedStore.getState().sourceLabel).toBe('my-pals.palmatch.json')
  })

  it('drops a read that lands after the panel closed, rather than starting an orphan worker', async () => {
    const slow = saveFile('big.sav')
    let releaseRead: (buffer: ArrayBuffer) => void = () => undefined
    vi.spyOn(slow, 'arrayBuffer').mockReturnValue(
      new Promise<ArrayBuffer>((resolve) => {
        releaseRead = resolve
      }),
    )

    show()
    drop(slow)
    cleanup()

    releaseRead(saveBytes().buffer as ArrayBuffer)
    await Promise.resolve()
    // A worker started here would have nothing left to terminate it — the unmount cleanup has run.
    await waitFor(() => expect(workers).toHaveLength(0))
    expect(useOwnedStore.getState().importedAt).toBeNull()
  })

  it('says so when the worker cannot be constructed at all', async () => {
    // A CSP without `worker-src`, or a browser with no module workers: the constructor throws (a
    // SecurityError in a real browser, which `messageOf` reads the same way) and `onerror` never
    // fires, so without a catch the panel sits on READING until a reload.
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked by Content-Security-Policy')
        }
      },
    )
    show()
    drop(saveFile())

    await waitFor(() => expect(screen.getByText(/something went wrong reading that file/)).toBeTruthy())
    expect(screen.getByText(/the import worker could not be started: blocked by Content-Security-Policy/)).toBeTruthy()
    expect(screen.queryByLabelText('reading your save')).toBeNull()
  })

  it('ignores an error queued by a worker that was already replaced', async () => {
    show()
    drop(saveFile('one.sav'))
    const first = await posted()

    fireEvent.drop(screen.getByLabelText('my pals'), { dataTransfer: { files: [saveFile('two.sav')] } })
    await waitFor(() => expect(workers).toHaveLength(2))
    const second = workers[1]

    // The terminated worker's error arrives late. Matched on id, it is dropped; unmatched, it would
    // expire the second request and leave that worker running with nobody holding it.
    first.fail('boom')
    expect(screen.queryByText(/something went wrong reading that file/)).toBeNull()
    expect(second.terminated).toBe(false)

    await waitFor(() => expect(second.posted).toHaveLength(1))
    second.reply({ ok: true, requestId: second.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })
    expect(screen.getByText(/1 species · 1 pal/)).toBeTruthy()
    expect(second.terminated).toBe(true)
  })

  it('keeps the drop highlight while the cursor moves over the zone’s own children', () => {
    show()
    const zone = dropZone()
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('drop-zone-over')

    // Entering a child fires dragleave on the zone itself; treating that as an exit makes the
    // border strobe as the cursor crosses the text inside it.
    dragLeave(zone, zone.querySelector('.drop-line'))
    expect(dropZone().className).toContain('drop-zone-over')

    // Leaving for something outside the zone is a real exit.
    dragLeave(zone, document.body)
    expect(dropZone().className).not.toContain('drop-zone-over')
  })

  it('drops the highlight when the drag leaves the window entirely', () => {
    show()
    const zone = dropZone()
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('drop-zone-over')

    // No relatedTarget at all — the cursor left the document.
    dragLeave(zone, null)
    expect(dropZone().className).not.toContain('drop-zone-over')
  })

  it('discards a save parse that lands after a shared list was applied over it', async () => {
    const list: OwnedBySpecies = { 4: { count: 3, genders: null, individuals: [] } }
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

  // The `♀1` is the split of the one pal `ownedPal` builds; the guild clause is what varies here.
  it.each([
    [3, '1 species · 1 pal · ♀1 · guild of 3 players · from Level.sav'],
    // A solo world has exactly one player row; "guild of 1" on every single-player save is noise.
    [1, '1 species · 1 pal · ♀1 · from Level.sav'],
    [0, '1 species · 1 pal · ♀1 · from Level.sav'],
  ])('names a guild of %i players in the headline', async (playerRows, line) => {
    show()
    drop(saveFile())
    const worker = await posted()
    worker.reply({
      ok: true,
      requestId: worker.posted[0].requestId,
      result: importResult([ownedPal(idx('Lamball'))], [], playerRows),
    })

    expect(screen.getByText(line)).toBeTruthy()
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
    const list: OwnedBySpecies = { 4: { count: 3, genders: null, individuals: [] }, 9: { count: 1, genders: null, individuals: [] } }
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
    const shared: OwnedBySpecies = { 2: { count: 5, genders: null, individuals: [] }, 6: { count: 1, genders: null, individuals: [] } }

    it('asks before replacing the current list, then loads it', async () => {
      show({ shareBlob: encodeOwnedShare(shared) })

      // Awaited, not immediate: the codec that decodes the blob is a lazy chunk (see `loadCodec`).
      await screen.findByText('Load shared list — 2 species? Replaces your current list.')
      expect(useOwnedStore.getState().importedAt).toBeNull()

      fireEvent.click(screen.getByText('LOAD'))
      expect(useOwnedStore.getState().bySpecies).toEqual({
        2: { count: 5, genders: null, individuals: [] },
        6: { count: 1, genders: null, individuals: [] },
      })
      expect(screen.getByText(/2 species · 6 pals/)).toBeTruthy()
    })

    it('leaves the current list alone when the confirm is cancelled', async () => {
      useOwnedStore.getState().loadShared([[1, 1]], 'mine')
      const { onClose } = show({ shareBlob: encodeOwnedShare(shared) })

      fireEvent.click(await screen.findByText('CANCEL'))
      expect(onClose).toHaveBeenCalled()
      expect(useOwnedStore.getState().bySpecies).toEqual({ 1: { count: 1, genders: null, individuals: [] } })
    })

    it('discards a save whose read finishes after LOAD chose a shared list', async () => {
      // Same window as the drop-a-list-mid-read case, reached through the confirm step instead: a
      // save dropped while the codec chunk is still resolving has no worker yet, so only a
      // generation bump stops its continuation from parsing over the list LOAD just installed.
      const slow = saveFile('big.sav')
      let releaseRead: (buffer: ArrayBuffer) => void = () => undefined
      vi.spyOn(slow, 'arrayBuffer').mockReturnValue(
        new Promise<ArrayBuffer>((resolve) => {
          releaseRead = resolve
        }),
      )

      show({ shareBlob: encodeOwnedShare(shared) })
      drop(slow)
      await screen.findByText('LOAD')
      fireEvent.click(screen.getByText('LOAD'))

      releaseRead(saveBytes().buffer as ArrayBuffer)
      await waitFor(() => expect(screen.getByText(/2 species · 6 pals/)).toBeTruthy())
      expect(workers).toHaveLength(0)
      expect(useOwnedStore.getState().sourceLabel).toBe('shared list')
    })

    it('LOAD installs exactly what the confirm step offered, without going near the parser', async () => {
      useOwnedStore.getState().loadShared([[1, 1]], 'mine')
      show({ shareBlob: encodeOwnedShare(shared) })
      await screen.findByText('LOAD')

      fireEvent.click(screen.getByText('LOAD'))

      // The species the confirm step showed, under the shared-list label, with no worker involved —
      // a link is a list, not a save, and nothing about it should touch the save parser.
      expect(useOwnedStore.getState().bySpecies).toEqual({
        2: { count: 5, genders: null, individuals: [] },
        6: { count: 1, genders: null, individuals: [] },
      })
      expect(useOwnedStore.getState().sourceLabel).toBe('shared list')
      expect(useOwnedStore.getState().playerRows).toBe(0)
      expect(workers).toHaveLength(0)
      expect(screen.getByText('2 species · 6 pals · from shared list')).toBeTruthy()
    })

    it('says so when the link is damaged, instead of importing half of it', async () => {
      show({ shareBlob: 'this-is-not-a-blob' })
      await screen.findByText(/shared list is damaged/)
      expect(useOwnedStore.getState().importedAt).toBeNull()
    })

    it('leaves out species this build has never heard of, and says how many', async () => {
      const stale: OwnedBySpecies = { 2: { count: 1, genders: null, individuals: [] }, 5000: { count: 1, genders: null, individuals: [] } }
      show({ shareBlob: encodeOwnedShare(stale) })

      await screen.findByText(/1 more species in that link are unknown/)
      fireEvent.click(screen.getByText('LOAD'))
      expect(useOwnedStore.getState().bySpecies).toEqual({ 2: { count: 1, genders: null, individuals: [] } })
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
      `${window.location.origin}${window.location.pathname}#/own/${encodeOwnedShare({ 2: { count: 3, genders: null, individuals: [] } })}`,
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
    expect(await created[0].text()).toBe(shareJson({ 2: { count: 3, genders: null, individuals: [] } }))
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

  /** A picked folder whose iteration fails — a revoked permission, a disconnected drive. */
  function failingPicker(): { release: (reason: Error) => void } {
    const control: { release: (reason: Error) => void } = { release: () => undefined }
    vi.stubGlobal('showDirectoryPicker', () =>
      Promise.resolve({
        kind: 'directory' as const,
        name: 'SaveGames',
        values: () => ({
          [Symbol.asyncIterator]() {
            return this
          },
          next: () =>
            new Promise<never>((_resolve, reject) => {
              control.release = reject
            }),
        }),
      }),
    )
    return control
  }

  it('blames itself, not the file, when the folder walk fails', async () => {
    const walk = failingPicker()
    show()
    fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
    await waitFor(() => expect(typeof walk.release).toBe('function'))

    walk.release(new Error('permission denied'))

    // Nothing was read, so nothing can be said about a file — this is our failure, not the save's.
    await waitFor(() => expect(screen.getByText(/something went wrong reading that file/)).toBeTruthy())
    expect(screen.getByText('permission denied')).toBeTruthy()
  })

  it('stays quiet when that failure lands after the panel has closed', async () => {
    const walk = failingPicker()
    show()
    fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
    await waitFor(() => expect(typeof walk.release).toBe('function'))
    cleanup()

    // Deliberately weak, and worth saying why: React 19 turns a `setState` on an unmounted
    // component into a silent no-op, so the `closedRef` guard on this path cannot be caught failing
    // from the outside. What this does pin is that the rejection is handled at all — an unguarded
    // `throw` out of the handler would surface here as an unhandled rejection — and that a closed
    // panel is never brought back. The guard itself is defence-in-depth, matching `ingest`'s.
    walk.release(new Error('permission denied'))
    await Promise.resolve()
    expect(screen.queryByLabelText('my pals')).toBeNull()
    expect(screen.queryByText(/something went wrong/)).toBeNull()
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

  describe('pal storage files', () => {
    function storageFile(name: string): File {
      return new File([saveBytes()], name)
    }

    /** A world folder, optionally with a `Players/` beside its save. */
    function worldDir(players: Array<{ kind: 'file'; name: string; getFile: () => Promise<File> }> | null) {
      return {
        kind: 'directory' as const,
        name: 'world-1',
        values: async function* () {
          yield { kind: 'file' as const, name: 'Level.sav', getFile: () => Promise.resolve(saveFile()) }
          if (players !== null) {
            yield {
              kind: 'directory' as const,
              name: 'Players',
              values: async function* () {
                for (const entry of players) yield entry
              },
            }
          }
        },
      }
    }

    function fileEntry(name: string) {
      return { kind: 'file' as const, name, getFile: () => Promise.resolve(storageFile(name)) }
    }

    it('sends every storage file dropped beside the save, transferring all of their buffers', async () => {
      show()
      drop(saveFile(), storageFile('0001_dps.sav'), storageFile('GlobalPalStorage.sav'))

      const worker = await posted()
      const request = worker.posted[0]
      expect(request.storage?.map((s) => s.label)).toEqual(['0001_dps.sav', 'GlobalPalStorage.sav'])
      // Handed over rather than copied, same as the save itself — a Dimensional Pal Storage is not
      // worth a structured clone.
      expect(worker.transfers[0]).toEqual([request.buffer, ...(request.storage ?? []).map((s) => s.buffer)])
    })

    it('ignores files in the selection that are neither the save nor a pal store', async () => {
      show()
      drop(storageFile('WorldOption.sav'), saveFile(), storageFile('0001_dps.sav'))

      const request = (await posted()).posted[0]
      expect(request.storage?.map((s) => s.label)).toEqual(['0001_dps.sav'])
    })

    it('collects the _dps.sav files beside a save and the Global Palbox above it', async () => {
      // The real tree: `SaveGames/<user-id>/GlobalPalStorage.sav` is a *sibling* of the world
      // folders, so only a walk that started at or above the user-id folder can reach it.
      vi.stubGlobal('showDirectoryPicker', () =>
        Promise.resolve({
          kind: 'directory' as const,
          name: 'SaveGames',
          values: async function* () {
            yield {
              kind: 'directory' as const,
              name: '76561198000000000',
              values: async function* () {
                yield fileEntry('GlobalPalStorage.sav')
                yield worldDir([fileEntry('0001_dps.sav'), fileEntry('0002_dps.sav')])
              },
            }
          },
        }),
      )
      show()

      fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
      const request = (await posted()).posted[0]
      expect(request.storage?.map((s) => s.label)).toEqual(['0001_dps.sav', '0002_dps.sav', 'GlobalPalStorage.sav'])
    })

    it('leaves the other saves in Players/ alone — they are profiles, not pals', async () => {
      // The field case: a two-player co-op world whose `Players/` holds two profile saves and no
      // `_dps.sav` at all, because nobody has built the storage.
      vi.stubGlobal('showDirectoryPicker', () =>
        Promise.resolve(worldDir([fileEntry('0001.sav'), fileEntry('0002.sav')])),
      )
      show()

      fireEvent.click(screen.getByText('FIND MY SAVE FOLDER'))
      const worker = await posted()
      expect(worker.posted[0].storage).toEqual([])

      worker.reply({ ok: true, requestId: worker.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })

      // Nothing to say: the folder was walked and it holds no pal storage, which is what most saves
      // look like. A complete import must read as complete.
      expect(screen.getByText(/from Level\.sav$/)).toBeTruthy()
      expect(screen.queryByText(/Dimensional Pal Storage/)).toBeNull()
      expect(screen.queryByText(/storage file/)).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('says it read Level.sav only when a single file was handed to it', async () => {
      show()
      drop(saveFile())
      const worker = await posted()
      worker.reply({ ok: true, requestId: worker.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })

      // Said only because nobody looked — and phrased as what was read, not as a claim that pals are
      // missing. Most players have no Dimensional Pal Storage at all.
      expect(screen.getByText(/read Level\.sav only — if you use Dimensional Pal Storage/)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('points that note at whichever route the browser actually has', async () => {
      // Firefox and Safari have no `showDirectoryPicker`, so "pick your save folder" would name a
      // button that isn't on their screen — the advice has to be advice they can take.
      show()
      drop(saveFile())
      const first = await posted()
      first.reply({ ok: true, requestId: first.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })
      expect(screen.getByText(/select Level\.sav and the _dps\.sav files beside it together/)).toBeTruthy()
      cleanup()

      workers = []
      // The store outlives `cleanup`, and a panel opened over an existing list starts on the summary
      // rather than the drop zone.
      useOwnedStore.getState().clearOwned()
      vi.stubGlobal('showDirectoryPicker', () => Promise.resolve(worldDir(null)))
      show()
      drop(saveFile())
      const second = await posted()
      second.reply({ ok: true, requestId: second.posted[0].requestId, result: importResult([ownedPal(idx('Lamball'))]) })
      expect(screen.getByText(/pick your save folder instead/)).toBeTruthy()
    })

    it('names a storage file whose bytes never arrived, rather than losing it silently', async () => {
      // Same visible loss as a file the parser choked on — a file the player can see, holding pals
      // that aren't in the count. Treating the two differently purely by where they failed would
      // leave the summary claiming fewer storage files with no explanation of the missing one.
      const unreadable = new File([saveBytes()], '0002_dps.sav')
      Object.defineProperty(unreadable, 'arrayBuffer', {
        value: () => Promise.reject(new Error('permission denied')),
      })

      show()
      drop(saveFile(), storageFile('0001_dps.sav'), unreadable)

      const worker = await posted()
      // Only the file that read is sent on; the worker is never handed a hole to trip over.
      expect(worker.posted[0].storage?.map((s) => s.label)).toEqual(['0001_dps.sav'])

      worker.reply({
        ok: true,
        requestId: worker.posted[0].requestId,
        result: importResult([ownedPal(idx('Lamball'))], [], 0, [
          { label: 'Level.sav', kind: 'level', palCount: 1 },
          { label: '0001_dps.sav', kind: 'storage', palCount: 0 },
        ]),
      })

      expect(screen.getByText(/couldn't read 0002_dps\.sav, so any pals kept in it are not counted: permission denied/)).toBeTruthy()
      expect(screen.getByText(/from Level\.sav · 1 storage file$/)).toBeTruthy()
    })

    it('names the storage files it actually read in the summary line', async () => {
      show()
      drop(saveFile(), storageFile('0001_dps.sav'), storageFile('0002_dps.sav'))
      const worker = await posted()
      worker.reply({
        ok: true,
        requestId: worker.posted[0].requestId,
        result: importResult([ownedPal(idx('Lamball'))], [], 0, [
          { label: 'Level.sav', kind: 'level', palCount: 1 },
          { label: '0001_dps.sav', kind: 'storage', palCount: 0 },
          { label: '0002_dps.sav', kind: 'storage', palCount: 0 },
        ]),
      })

      expect(screen.getByText(/from Level\.sav · 2 storage files$/)).toBeTruthy()
      expect(screen.queryByText(/read Level\.sav only/)).toBeNull()
    })

    it('counts only the storage files the parser could read, not the ones it was sent', async () => {
      show()
      drop(saveFile(), storageFile('0001_dps.sav'), storageFile('0002_dps.sav'))
      const worker = await posted()
      worker.reply({
        ok: true,
        requestId: worker.posted[0].requestId,
        result: importResult([ownedPal(idx('Lamball'))], ["couldn't read 0002_dps.sav, so any pals kept in it are not counted: junk"], 0, [
          { label: 'Level.sav', kind: 'level', palCount: 1 },
          { label: '0001_dps.sav', kind: 'storage', palCount: 0 },
        ]),
      })

      expect(screen.getByText(/from Level\.sav · 1 storage file$/)).toBeTruthy()
      expect(screen.getByText(/couldn't read 0002_dps\.sav/)).toBeTruthy()
    })
  })

  describe('genders in the summary', () => {
    it('shows each species’ split and totals it in the headline', () => {
      useOwnedStore.getState().loadShared([[idx('Lamball'), 3, 2, 1]], 'mine')
      show()

      expect(screen.getByText('1 species · 3 pals · ♂2 ♀1 · from mine')).toBeTruthy()
      expect(screen.getByLabelText('2 males, 1 female').textContent).toBe('♂2 ♀1')
      // Mixed, so nothing to warn about — and nothing to nudge about either.
      expect(screen.queryByText(/ONLY/)).toBeNull()
      expect(screen.queryByText('re-import your save to see genders')).toBeNull()
    })

    it('flags a species you own only one gender of, and leaves a mixed one unflagged', () => {
      useOwnedStore.getState().loadShared(
        [
          [idx('Lamball'), 4, 4, 0],
          [idx('Cattiva'), 3, 1, 2],
          [idx('Chikipi'), 2, 0, 2],
        ],
        'mine',
      )
      show()

      expect(screen.getByLabelText('males only — cannot be bred with itself').textContent).toBe('♂ ONLY')
      expect(screen.getByLabelText('females only — cannot be bred with itself').textContent).toBe('♀ ONLY')
      // Exactly the two single-gender species, not the mixed one.
      expect(screen.getAllByText(/ONLY/)).toHaveLength(2)
      expect(screen.getByLabelText('1 male, 2 females')).toBeTruthy()
      // The flagged rows drop the redundant split: ×4 and ♂ ONLY already say "four males".
      expect(screen.queryByLabelText('4 males')).toBeNull()
    })

    it('never prints a zero half, since an ungendered pal could be the missing partner', () => {
      // Three pals, two known male, one the save never gendered. `♀0` here would read as "no
      // females" when the truth is "one pal we cannot speak for" — so only the confirmed half shows,
      // and the ONLY marker stays away.
      useOwnedStore.getState().loadShared([[idx('Lamball'), 3, 2, 0]], 'mine')
      show()

      expect(screen.getByLabelText('2 males').textContent).toBe('♂2')
      expect(screen.queryByText(/♀/)).toBeNull()
      expect(screen.queryByText(/ONLY/)).toBeNull()
    })

    it('shows no gender number at all for a list that never carried one, and says how to fix it', () => {
      // A v1 list migrated out of localStorage, or a link from before genders existed.
      useOwnedStore.getState().loadShared([[idx('Lamball'), 3]], 'mine')
      show()

      expect(screen.getByText('re-import your save to see genders')).toBeTruthy()
      // Not one glyph anywhere: no split, no ONLY marker, and no total in the headline.
      expect(screen.queryByText(/[♂♀]/)).toBeNull()
      expect(screen.getByText('1 species · 3 pals · from mine')).toBeTruthy()
    })

    it('tells a share recipient to ask the sharer, since they have no save of their own', () => {
      // `loadShared` defaults the label to 'shared list'. Telling that person to "re-import your
      // save" points at a file they never had — only the sharer can refresh a pre-gender list.
      useOwnedStore.getState().loadShared([[idx('Lamball'), 3]])
      show()

      expect(screen.getByText(/ask whoever sent it to re-import and re-share/)).toBeTruthy()
      expect(screen.queryByText('re-import your save to see genders')).toBeNull()
    })

    it('withholds the headline total when even one species is unknown, but still shows the rest', () => {
      useOwnedStore.getState().loadShared(
        [
          [idx('Lamball'), 3, 2, 1],
          [idx('Cattiva'), 2],
        ],
        'mine',
      )
      show()

      expect(screen.getByText('2 species · 5 pals · from mine')).toBeTruthy()
      expect(screen.getByText('re-import your save to see genders')).toBeTruthy()
      // The species that does know its split still says so — the nudge is about the gaps, not a
      // reason to hide what the list can vouch for.
      expect(screen.getByLabelText('2 males, 1 female')).toBeTruthy()
    })
  })
})
