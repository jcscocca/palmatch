import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { buildLowerLookup } from '../lib/lower-lookup.ts'
import type { ParseErrorCode, SaveImportRequest, SaveImportResponse } from '../save/types.ts'
import { useOwnedStore } from '../state/owned.ts'
import type { SharedSpecies } from '../state/owned.ts'
import { useDataset } from './dataset-context.ts'
import { OwnedSummary } from './OwnedSummary.tsx'

/**
 * The share codec, loaded on demand. `owned-share.ts` pulls in pako's deflate+inflate (~42 KB raw,
 * ~13 KB gzipped) for a feature only this dialog offers, and a static import from here would put it
 * in the entry chunk — this component is mounted conditionally but imported eagerly by `Workbench`.
 * A dynamic `import()` is what actually splits it out.
 *
 * Module-scoped rather than per-instance, and warmed the moment the panel mounts, so that by the
 * time SHARE or DOWNLOAD is clicked the module is already resolved and the clipboard write stays
 * inside the user's gesture — Safari refuses one issued after an `await`.
 */
type ShareCodec = typeof import('../state/owned-share.ts')

let codecModule: ShareCodec | null = null
let codecPromise: Promise<ShareCodec> | null = null

function loadCodec(): Promise<ShareCodec> {
  codecPromise ??= import('../state/owned-share.ts').then(
    (module) => {
      codecModule = module
      return module
    },
    (cause: unknown) => {
      // Cleared so a chunk load that failed on a flaky network is retried rather than remembered.
      codecPromise = null
      throw cause
    },
  )
  return codecPromise
}

/**
 * Mirrors `MAX_SAVE_BYTES` in `src/save/parse.ts`. Duplicated rather than imported so the panel
 * doesn't drag the whole parser (and its pako inflate) into the entry chunk for one number — the
 * parser is meant to load only when a file is actually dropped. `ImportPanel.test.tsx` imports both
 * and asserts they agree, so the copy can't drift.
 */
export const MAX_FILE_BYTES = 500 * 1024 * 1024

/** A parse is seconds of work on a few hundred MB, so this is a "the worker died" backstop, not a UX timer. */
const TIMEOUT_MS = 60_000

/** Anything bigger than this is not a `.palmatch.json`, so it is never decoded as text. */
const SHARE_FILE_MAX_BYTES = 1024 * 1024

const REPORT_URL = 'https://github.com/jcscocca/palmatch/issues'

/** Doubled extension on purpose: the `.json` keeps it openable, the `.palmatch` says whose it is. */
const DOWNLOAD_NAME = 'my-pals.palmatch.json'

/**
 * The panel's failure vocabulary: every `ParseErrorCode` the worker can send, plus the three things
 * that go wrong before or beside the parser. Switched exhaustively in `errorCopy` with a
 * never-bound default, so a new parser code can't ship without copy to explain it.
 */
type PanelErrorCode = ParseErrorCode | 'timeout' | 'bad-share' | 'no-save-found'

interface SaveCandidate {
  path: string
  file: File
}

type PanelState =
  | { status: 'idle' }
  /** The drop zone, shown over an existing list because the player asked to IMPORT AGAIN. */
  | { status: 'picking' }
  | { status: 'parsing'; label: string; bytes: number }
  | { status: 'choose'; candidates: SaveCandidate[] }
  | { status: 'error'; code: PanelErrorCode; detail: string; label: string }
  | { status: 'confirm'; species: SharedSpecies[]; dropped: number }

function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024 / 1024))
}

/** A real `Level.sav` is hundreds of MB, but a shared `.palmatch.json` is a few hundred bytes. */
function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${megabytes(bytes)} MB`
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Plain-language copy per failure, and whether it is worth a bug report. The rule: anything the
 * player can act on says what to do and doesn't ask for a report; anything that means palmatch is
 * wrong about the save format says so and asks for one. `label` is the file they picked, which is
 * what makes the wrong-file line concrete ("that's LevelMeta.sav — you want Level.sav").
 */
function errorCopy(code: PanelErrorCode, label: string): { line: string; report: boolean } {
  const named = label === '' ? 'that file' : label
  switch (code) {
    case 'xbox-save':
      return {
        line: 'this is an Xbox/Game Pass save — palmatch can only read Steam/PC saves',
        report: false,
      }
    case 'not-a-save':
      return { line: `that doesn't look like a Palworld save — ${named} isn't one`, report: false }
    case 'wrong-file':
      return { line: `that's ${named} — you want Level.sav, the big one in your world folder`, report: false }
    case 'too-large':
      return {
        line: `${named} is bigger than the 500 MB palmatch can hold — deleting unused bases and pals in-game shrinks Level.sav`,
        report: false,
      }
    case 'truncated':
      return {
        line: 'that save is corrupt or was cut short — try a fresh copy, taken while the game is closed',
        report: true,
      }
    case 'skip-drift':
      return {
        line: "palmatch lost its place reading that save — its format isn't what this version expects",
        report: true,
      }
    case 'unknown-magic':
      return { line: 'palmatch does not recognise this save format — the game may have updated it', report: true }
    case 'internal':
      return { line: 'something went wrong reading that file', report: true }
    case 'timeout':
      return { line: 'that import did not finish within 60 seconds — try again, or with a smaller world', report: true }
    case 'bad-share':
      return { line: 'that shared list is damaged or too old to read — ask for a fresh one', report: false }
    case 'no-save-found':
      return { line: 'no Level.sav in that folder — pick the SaveGames folder, or a world folder inside it', report: false }
    default: {
      const never: never = code
      return { line: `unrecognised failure ${String(never)}`, report: true }
    }
  }
}

/**
 * The File System Access API, typed locally: `lib.dom` in this TypeScript carries neither
 * `showDirectoryPicker` nor the async `values()` iterator, and the app is not going to widen its
 * `lib` for one Chromium-only convenience.
 */
interface FsFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

interface FsDirectoryHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterableIterator<FsFileHandle | FsDirectoryHandle>
}

function directoryPicker(): (() => Promise<FsDirectoryHandle>) | null {
  const fn = (globalThis as { showDirectoryPicker?: () => Promise<FsDirectoryHandle> }).showDirectoryPicker
  // Bound back to the global: a `Window` method pulled off its object is called with the wrong
  // receiver, and browsers answer that with "Illegal invocation".
  return typeof fn === 'function' ? () => fn.call(globalThis) : null
}

/**
 * `SaveGames/<steam-id>/<world-id>/Level.sav`, so two levels below whatever the player picked — and
 * they may equally have picked the world folder itself, hence the search rather than a fixed path.
 * Bounded on every axis: a player who picks their home directory by mistake gets a quick "nothing
 * here", not a full-disk walk.
 */
const MAX_WALK_DEPTH = 2
const MAX_CANDIDATES = 12
const MAX_DIRECTORIES = 64

async function walkForSaves(
  dir: FsDirectoryHandle,
  path: string,
  depth: number,
  out: SaveCandidate[],
  budget: { dirs: number },
): Promise<void> {
  if (out.length >= MAX_CANDIDATES || budget.dirs <= 0) return
  budget.dirs--
  const subdirs: Array<{ handle: FsDirectoryHandle; path: string }> = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      if (entry.name.toLowerCase() === 'level.sav' && out.length < MAX_CANDIDATES) {
        out.push({ path: `${path}${entry.name}`, file: await entry.getFile() })
      }
    } else if (depth < MAX_WALK_DEPTH) {
      subdirs.push({ handle: entry, path: `${path}${entry.name}/` })
    }
  }
  for (const sub of subdirs) await walkForSaves(sub.handle, sub.path, depth + 1, out, budget)
}

export interface ImportPanelProps {
  /**
   * A `#/own/<blob>` link's payload, if the panel was opened by one. Decoded into a confirm step
   * rather than applied: an owned list arrives from someone else, and silently replacing the
   * player's own list would be a rude thing for a link to do.
   */
  shareBlob?: string | null
  /**
   * Opened by a file dragged onto the page: start on the drop zone rather than on the summary, so
   * the thing already in the player's hand has somewhere to land.
   */
  dropReady?: boolean
  onClose: () => void
}

/**
 * The MY PALS dialog: drop a `Level.sav`, watch it parse in a worker, keep the result. Same native
 * `<dialog>`/`showModal` shell as `SearchPalette` (focus trap, top layer, backdrop dismissal for
 * free), and the same worker discipline as `ChainView` — a fresh worker per attempt, replies matched
 * against an in-flight request id, terminated on unmount.
 *
 * The worker is built in the ingest handler rather than in an effect: unlike the chain search,
 * nothing here should be running while the panel merely sits open, and the parse chunk (with its
 * wasm) should not load for a player who opened the dialog to read the path hints.
 */
export function ImportPanel({ shareBlob = null, dropReady = false, onClose }: ImportPanelProps) {
  const ds = useDataset()
  const bySpecies = useOwnedStore((s) => s.bySpecies)
  const warnings = useOwnedStore((s) => s.warnings)
  const sourceLabel = useOwnedStore((s) => s.sourceLabel)
  const playerRows = useOwnedStore((s) => s.playerRows)
  const setOwned = useOwnedStore((s) => s.setOwned)
  const clearOwned = useOwnedStore((s) => s.clearOwned)
  const loadShared = useOwnedStore((s) => s.loadShared)

  const [state, setState] = useState<PanelState>(dropReady ? { status: 'picking' } : { status: 'idle' })
  const [note, setNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const downTargetRef = useRef<EventTarget | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<{ id: number; expired: boolean }>({ id: 0, expired: true })
  const closedRef = useRef(false)
  /**
   * Bumped by every `ingest`. The worker protocol has its own request id, but that only starts once
   * a buffer exists — the window *before* it, while `file.arrayBuffer()` is resolving, is unguarded
   * by anything else, and reading a 400 MB save takes long enough for a second drop to finish
   * entirely inside it. Whichever ingest is newest owns the panel; older continuations return.
   */
  const ingestRef = useRef(0)

  // The worker resolves species itself but never loads the paldex — it gets the lookup as plain
  // entry pairs, built here from the dataset the app already has.
  const byIdLower = useMemo<Array<[string, number]>>(() => [...buildLowerLookup(ds.byId)], [ds.byId])

  // Warmed on open, not on click: see `loadCodec`. A failure is not surfaced here — the paths that
  // need the codec each report their own, and a player who never shares never notices.
  useEffect(() => {
    loadCodec().catch(() => undefined)
  }, [])

  // Dialog shell, per SearchPalette: open modally where the DOM supports it, restore focus to
  // whatever opened the panel on the way out.
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement
    if (openerRef.current === null && previous instanceof HTMLElement && dialog?.contains(previous) !== true) {
      openerRef.current = previous
    }
    if (dialog !== null) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      const opener = openerRef.current
      if (opener !== null && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    dialog.addEventListener('close', onClose)
    return () => dialog.removeEventListener('close', onClose)
  }, [onClose])

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  /**
   * Drop whatever is in flight on the floor: expire the request id so a reply in transit is
   * discarded, stop the timeout, and kill the worker so a parse of 400 MB isn't left chewing (and
   * holding its decompressed copy, plus the wasm heap if it got that far) on a question nobody is
   * waiting for.
   *
   * This closes the *worker* half of the clobber race only — everything downstream of a posted
   * request. The half before it, where a file is still being read off disk and no worker exists to
   * abort, is closed by `ingestRef`; the two are needed together.
   */
  const abortInFlight = useCallback((): void => {
    inFlightRef.current = { ...inFlightRef.current, expired: true }
    clearTimer()
    workerRef.current?.terminate()
    workerRef.current = null
  }, [clearTimer])

  // Whatever is in flight when the panel closes is abandoned: a parse the player walked away from
  // must not resurface, and a worker chewing on 400 MB must not outlive the dialog.
  useEffect(() => {
    closedRef.current = false
    return () => {
      closedRef.current = true
      clearTimeout(timerRef.current ?? undefined)
      timerRef.current = null
      inFlightRef.current = { ...inFlightRef.current, expired: true }
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  /** Installs an already-sanitized shared list. `dropped` is only ever reported, never re-derived. */
  const applyShare = useCallback(
    (species: SharedSpecies[], dropped: number, label: string): void => {
      abortInFlight()
      // Claim the panel the same way `ingest` does: a save whose `arrayBuffer()` is still in flight
      // has no worker for `abortInFlight` to kill, so only a generation bump stops its continuation
      // from parsing over the list the player just chose here.
      ingestRef.current++
      if (species.length === 0) {
        setState({ status: 'error', code: 'bad-share', detail: 'none of its species exist in this paldex', label })
        return
      }
      loadShared(species, label)
      setNote(dropped === 0 ? null : `${dropped} species in that list are unknown to this version and were left out`)
      setState({ status: 'idle' })
    },
    [abortInFlight, loadShared],
  )

  const parseInWorker = useCallback(
    (label: string, buffer: ArrayBuffer): void => {
      abortInFlight()
      const id = inFlightRef.current.id + 1
      inFlightRef.current = { id, expired: false }

      let worker: Worker
      try {
        worker = new Worker(new URL('../save/save-import.worker.ts', import.meta.url), { type: 'module' })
      } catch (cause) {
        // A Content-Security-Policy without `worker-src`, or a browser without module workers, makes
        // the constructor itself throw — `onerror` never fires, so without this the panel sits on
        // READING forever with no way out but a reload.
        inFlightRef.current = { ...inFlightRef.current, expired: true }
        setState({ status: 'error', code: 'internal', detail: `the import worker could not be started: ${messageOf(cause)}`, label })
        return
      }
      workerRef.current = worker
      // The protocol is terminal — one answer per request — so the worker is retired the moment it
      // gives one. Otherwise it sits idle holding its wasm linear memory (tens of MB, never returned
      // to the OS) for as long as the player reads the summary.
      const settle = (): void => {
        inFlightRef.current = { ...inFlightRef.current, expired: true }
        clearTimer()
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
      worker.onmessage = (event: MessageEvent<SaveImportResponse>) => {
        const data = event.data
        if (inFlightRef.current.expired || data.requestId !== inFlightRef.current.id) return
        settle()
        if (data.ok) {
          setOwned(data.result, label)
          setState({ status: 'idle' })
        } else {
          setState({ status: 'error', code: data.code, detail: data.detail, label })
        }
      }
      worker.onerror = (event: ErrorEvent) => {
        // Matched on the id exactly as `onmessage` is: an error queued by a worker that was already
        // terminated would otherwise expire whatever request replaced it, and leave *that* worker
        // running with nothing left holding a reference to terminate it.
        if (inFlightRef.current.expired || inFlightRef.current.id !== id) return
        settle()
        const detail = event.message === '' ? 'the import worker failed to start' : event.message
        setState({ status: 'error', code: 'internal', detail, label })
      }

      const request: SaveImportRequest = { requestId: id, buffer, byIdLower }
      worker.postMessage(request, [buffer])
      timerRef.current = setTimeout(() => {
        if (inFlightRef.current.id !== id || inFlightRef.current.expired) return
        settle()
        setState({ status: 'error', code: 'timeout', detail: `${label} was still parsing after 60 seconds`, label })
      }, TIMEOUT_MS)
    },
    [abortInFlight, byIdLower, clearTimer, setOwned],
  )

  const ingest = useCallback(
    (file: File): void => {
      setNote(null)
      // Before the async read, not after it: from here on the panel is committed to this file, and
      // an earlier parse still running must not be allowed to land on top of whatever it produces.
      abortInFlight()
      const generation = ++ingestRef.current
      // Checked against the *file's* size, before a byte is read: the point of the cap is not to
      // read half a gigabyte into the tab only to reject it.
      if (file.size > MAX_FILE_BYTES) {
        setState({
          status: 'error',
          code: 'too-large',
          detail: `${file.name} is ${megabytes(file.size)} MB, past the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`,
          label: file.name,
        })
        return
      }
      setState({ status: 'parsing', label: file.name, bytes: file.size })
      // The codec await is normally already settled (it was warmed on mount) — it is here because
      // telling a `.palmatch.json` from a `.sav` needs the payload validator.
      Promise.all([file.arrayBuffer(), loadCodec()]).then(
        ([buffer, codec]) => {
          // Reading a few hundred MB outlives an impatient close, and outlives a second drop. The
          // first guard stops a worker being started after the unmount cleanup ran (nothing would
          // be left to terminate it); the second stops a slow save's read finishing *after* a small
          // shared list was dropped on top of it and quietly parsing over the list the player chose.
          if (closedRef.current || ingestRef.current !== generation) return
          const share = sniffShareFile(file, buffer, codec.parseOwnedShareJson)
          if (share === 'invalid') {
            setState({
              status: 'error',
              code: 'bad-share',
              detail: `${file.name} is not a palmatch owned list`,
              label: file.name,
            })
            return
          }
          if (share !== null) {
            const { species, dropped } = codec.sanitizeShare(share, ds.pals.length)
            applyShare(species, dropped, file.name)
            return
          }
          parseInWorker(file.name, buffer)
        },
        (cause: unknown) => {
          if (closedRef.current || ingestRef.current !== generation) return
          setState({ status: 'error', code: 'internal', detail: messageOf(cause), label: file.name })
        },
      )
    },
    [abortInFlight, applyShare, ds.pals.length, parseInWorker],
  )

  // A share link opens the panel straight into its confirm step (or an error, if the blob is junk).
  useEffect(() => {
    if (shareBlob === null || shareBlob === undefined) return
    let cancelled = false
    loadCodec().then(
      (codec) => {
        if (cancelled) return
        const payload = codec.decodeOwnedShare(shareBlob)
        if (payload === null) {
          setState({ status: 'error', code: 'bad-share', detail: 'the link did not decode', label: '' })
          return
        }
        const { species, dropped } = codec.sanitizeShare(payload.species, ds.pals.length)
        if (species.length === 0) {
          setState({ status: 'error', code: 'bad-share', detail: 'none of its species exist in this paldex', label: '' })
          return
        }
        setState({ status: 'confirm', species, dropped })
      },
      (cause: unknown) => {
        if (!cancelled) setState({ status: 'error', code: 'internal', detail: messageOf(cause), label: '' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [ds.pals.length, shareBlob])

  const pickDirectory = useCallback((): void => {
    const picker = directoryPicker()
    if (picker === null) return
    picker().then(
      async (dir) => {
        const found: SaveCandidate[] = []
        try {
          await walkForSaves(dir, '', 0, found, { dirs: MAX_DIRECTORIES })
        } catch (cause) {
          // The guard belongs on the failure path too: a permission error raised after the player
          // closed the dialog would otherwise re-render an unmounted panel's error state.
          if (closedRef.current) return
          setState({ status: 'error', code: 'internal', detail: messageOf(cause), label: dir.name })
          return
        }
        if (closedRef.current) return
        if (found.length === 0) {
          setState({
            status: 'error',
            code: 'no-save-found',
            detail: `nothing named Level.sav under ${dir.name}`,
            label: dir.name,
          })
        } else if (found.length === 1) {
          ingest(found[0].file)
        } else {
          // Several worlds under one SaveGames folder: which is "the" save is the player's call,
          // and guessing at the biggest one would quietly import the wrong world.
          setState({ status: 'choose', candidates: found.sort((a, b) => b.file.size - a.file.size) })
        }
      },
      // A cancelled picker throws `AbortError`. Nothing went wrong; the panel just stays put.
      () => undefined,
    )
  }, [ingest])

  const onShare = useCallback((): void => {
    const codec = codecModule
    // Only reachable by clicking within milliseconds of the panel opening; awaiting here instead
    // would cost the clipboard its user gesture, which is a worse failure than asking again.
    if (codec === null) {
      loadCodec().then(
        () => setNote('one moment — press SHARE again'),
        () => setNote('could not build a link — reload the page and try again'),
      )
      return
    }
    const link = codec.ownedShareLink(bySpecies)
    const clipboard = navigator.clipboard as Clipboard | undefined
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      window.prompt('copy this link', link)
      setNote('copy the link from the box')
      return
    }
    clipboard.writeText(link).then(
      () => setNote('link copied — it carries species, counts and genders, not individual pals'),
      () => {
        window.prompt('copy this link', link)
        setNote('copy the link from the box')
      },
    )
  }, [bySpecies])

  const onDownload = useCallback((): void => {
    const codec = codecModule
    if (codec === null) {
      loadCodec().then(
        () => setNote('one moment — press DOWNLOAD again'),
        () => setNote('could not build the file — reload the page and try again'),
      )
      return
    }
    const createUrl = URL.createObjectURL as ((blob: Blob) => string) | undefined
    if (typeof createUrl !== 'function') {
      setNote('this browser cannot download the list — use SHARE instead')
      return
    }
    const blob = new Blob([codec.shareJson(bySpecies)], { type: 'application/json' })
    const href = createUrl(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = DOWNLOAD_NAME
    // In the document for the click and out again straight after: a detached anchor is ignored by
    // some browsers, and the object URL is released a tick later so the download has started first.
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(href), 0)
    setNote(`saved ${DOWNLOAD_NAME} — drop it back here on any machine`)
  }, [bySpecies])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    onClose()
  }

  const hasList = Object.keys(bySpecies).length > 0
  const showDropZone = state.status === 'picking' || (state.status === 'idle' && !hasList)

  return (
    <dialog
      ref={dialogRef}
      className="palette-dialog"
      aria-label="my pals"
      onKeyDown={onKeyDown}
      // Drops are handled for the whole dialog, not just the dashed zone: a file dropped a few
      // pixels wide of it would otherwise hit the browser's own handler, which navigates the tab to
      // the raw save and takes the app with it.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer?.files?.[0]
        if (file !== undefined) ingest(file)
      }}
      onMouseDown={(e) => {
        downTargetRef.current = e.target
      }}
      onClick={(e) => {
        const fromBackdrop = downTargetRef.current === dialogRef.current
        downTargetRef.current = null
        if (fromBackdrop && e.target === dialogRef.current) onClose()
      }}
    >
      {/* `palette` carries the modal box's whole look; `import-panel` only widens it. */}
      <div className="palette import-panel">
        <div className="palette-head">
          <span className="label-caps">MY PALS</span>
          <button type="button" className="toast-close" aria-label="close my pals" onClick={onClose}>
            ×
          </button>
        </div>

        {showDropZone && (
          <DropZone
            dragging={dragging}
            hasList={hasList}
            onDragging={setDragging}
            onFile={ingest}
            onDirectory={directoryPicker() === null ? null : pickDirectory}
            onBack={() => setState({ status: 'idle' })}
          />
        )}

        {state.status === 'parsing' && (
          <div className="import-parsing">
            <div className="dots" aria-label="reading your save">
              <span>▸</span>
              <span>▸</span>
              <span>▸</span>
            </div>
            <p className="label-caps">{`READING ${sizeLabel(state.bytes)} — ${state.label}`}</p>
            <p className="panel-note">a big world takes a few seconds; the page stays usable meanwhile</p>
          </div>
        )}

        {state.status === 'choose' && (
          <div className="import-choose">
            <p className="count-line">{state.candidates.length} saves in that folder — which world?</p>
            <ul className="save-list">
              {state.candidates.map((candidate) => (
                <li key={candidate.path}>
                  <button type="button" className="save-btn" onClick={() => ingest(candidate.file)}>
                    <span className="save-path">{candidate.path}</span>
                    <span className="label-caps">{sizeLabel(candidate.file.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.status === 'error' && (
          <ErrorView
            code={state.code}
            detail={state.detail}
            label={state.label}
            onRetry={() => setState({ status: 'picking' })}
          />
        )}

        {state.status === 'confirm' && (
          <div className="import-confirm">
            <p className="import-message">
              Load shared list — {state.species.length} species? Replaces your current list.
            </p>
            {state.dropped > 0 && (
              <p className="panel-note">
                {state.dropped} more species in that link are unknown to this version and will be left out
              </p>
            )}
            <div className="import-actions">
              <button
                type="button"
                className="retry-btn"
                onClick={() => applyShare(state.species, state.dropped, 'shared list')}
              >
                LOAD
              </button>
              <button type="button" className="file-btn" onClick={onClose}>
                CANCEL
              </button>
            </div>
          </div>
        )}

        {state.status === 'idle' && hasList && (
          <OwnedSummary
            pals={ds.pals}
            bySpecies={bySpecies}
            warnings={warnings}
            sourceLabel={sourceLabel}
            playerRows={playerRows}
            note={note}
            onImportAgain={() => {
              setNote(null)
              setState({ status: 'picking' })
            }}
            onClear={() => {
              setNote(null)
              clearOwned()
            }}
            onShare={onShare}
            onDownload={onDownload}
          />
        )}
      </div>
    </dialog>
  )
}

/**
 * Tells a `.palmatch.json` from a `.sav` without a second read: `null` means "binary, hand it to the
 * parser", `'invalid'` means "meant to be a list and isn't". The name check comes first so a
 * corrupted list gets the list error instead of a baffling save error; the byte check catches a
 * renamed one. A `.sav` that happens to start with `{` still falls through to the parser, because
 * it won't parse as a payload.
 *
 * `parseJson` is passed in rather than imported: it lives in the lazily-loaded share codec.
 */
function sniffShareFile(
  file: File,
  buffer: ArrayBuffer,
  parseJson: (text: string) => { species: SharedSpecies[] } | null,
): SharedSpecies[] | 'invalid' | null {
  const named = file.name.toLowerCase().endsWith('.json')
  if (buffer.byteLength === 0) return named ? 'invalid' : null
  if (!named && (buffer.byteLength > SHARE_FILE_MAX_BYTES || new Uint8Array(buffer, 0, 1)[0] !== 0x7b)) return null
  if (named && buffer.byteLength > SHARE_FILE_MAX_BYTES) return 'invalid'
  const payload = parseJson(new TextDecoder().decode(buffer))
  if (payload !== null) return payload.species
  return named ? 'invalid' : null
}

interface DropZoneProps {
  dragging: boolean
  hasList: boolean
  onDragging: (dragging: boolean) => void
  onFile: (file: File) => void
  /** `null` on a browser without the directory picker — Firefox and Safari, as of writing. */
  onDirectory: (() => void) | null
  onBack: () => void
}

/**
 * Dragging over a child of the zone fires `dragleave` on the zone itself, so a naive handler drops
 * the highlight the instant the cursor crosses the text inside it and the border strobes. Only a
 * `relatedTarget` outside the zone (or none at all — leaving the window) is a real exit.
 */
function leftZone(e: DragEvent<HTMLElement>): boolean {
  const to = e.relatedTarget
  return !(to instanceof Node) || !e.currentTarget.contains(to)
}

function DropZone({ dragging, hasList, onDragging, onFile, onDirectory, onBack }: DropZoneProps) {
  return (
    <div className="import-empty">
      <div
        className={`drop-zone${dragging ? ' drop-zone-over' : ''}`}
        data-testid="drop-zone"
        onDragOver={(e) => {
          e.preventDefault()
          onDragging(true)
        }}
        onDragLeave={(e) => {
          if (leftZone(e)) onDragging(false)
        }}
        // Only the highlight: the file itself is picked up by the dialog's drop handler, which this
        // bubbles to, so a drop lands exactly once wherever in the panel it happens.
        onDrop={() => onDragging(false)}
      >
        <p className="drop-line">
          drop <strong>Level.sav</strong> here
        </p>
        <p className="panel-note">nothing is uploaded — your save is read here, in this browser</p>
      </div>

      <div className="import-actions">
        {/*
          The input lives inside its label rather than beside it: `.visually-hidden` keeps a focused
          input off-screen, so a keyboard user tabbing to BROWSE… had no visible focus anywhere.
          Nested, the label is the focus container and `:focus-within` can light it up.
        */}
        <label className="file-btn">
          BROWSE…
          <input
            className="visually-hidden"
            type="file"
            aria-label="choose a save file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so re-picking the same file after a failure fires `change` again.
              e.target.value = ''
              if (file !== undefined) onFile(file)
            }}
          />
        </label>
        {onDirectory !== null && (
          <button type="button" className="file-btn" onClick={onDirectory}>
            FIND MY SAVE FOLDER
          </button>
        )}
        {hasList && (
          <button type="button" className="file-btn" onClick={onBack}>
            BACK
          </button>
        )}
      </div>

      <details className="path-hints">
        <summary className="label-caps">WHERE IS MY SAVE?</summary>
        <ul>
          <li>
            <span className="label-caps">WINDOWS</span>{' '}
            <code>%LOCALAPPDATA%\Pal\Saved\SaveGames\&lt;steam-id&gt;\&lt;world-id&gt;\Level.sav</code>
          </li>
          <li>
            <span className="label-caps">SERVER</span> <code>Pal/Saved/SaveGames/0/&lt;world-id&gt;/Level.sav</code>
          </li>
          <li>
            <span className="label-caps">STEAM DECK / LINUX</span>{' '}
            <code>
              ~/.steam/steam/steamapps/compatdata/1623730/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames/
            </code>
          </li>
          <li>a shared list works too — drop the <code>.palmatch.json</code> a friend sent you</li>
        </ul>
      </details>
    </div>
  )
}

interface ErrorViewProps {
  code: PanelErrorCode
  detail: string
  label: string
  onRetry: () => void
}

function ErrorView({ code, detail, label, onRetry }: ErrorViewProps): ReactNode {
  const { line, report } = errorCopy(code, label)
  return (
    <div className="import-error" role="alert">
      <p className="label-caps">IMPORT FAILED</p>
      <p className="import-message">{line}</p>
      <p className="panel-note">{detail}</p>
      {report && (
        <p className="panel-note">
          if this keeps happening,{' '}
          <a href={REPORT_URL} target="_blank" rel="noreferrer">
            report it
          </a>{' '}
          with the line above — it names what palmatch tripped over.
        </p>
      )}
      <div className="import-actions">
        <button type="button" className="retry-btn" onClick={onRetry}>
          TRY ANOTHER FILE
        </button>
      </div>
    </div>
  )
}
