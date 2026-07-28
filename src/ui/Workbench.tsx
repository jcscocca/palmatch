import { useCallback, useEffect, useMemo, useState } from 'react'
import { ownedRows, useOwnedStore } from '../state/owned.ts'
import { useWorkbenchStore } from '../state/store.ts'
import { useDataset } from './dataset-context.ts'
import { ImportPanel } from './ImportPanel.tsx'
import { ResultTabs } from './panels/ResultTabs.tsx'
import { SearchPalette } from './SearchPalette.tsx'
import { Slot } from './Slot.tsx'

/** A keystroke shortcut must not steal characters from whatever the player is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

export interface WorkbenchProps {
  /**
   * The blob from a `#/own/<blob>` link, handed down by `App` from `bindUrl`. Non-null opens the
   * import panel on its confirm step; `onShareHandled` fires when that panel closes, so the same
   * link can't re-open it on the next render.
   */
  shareBlob?: string | null
  onShareHandled?: () => void
}

export function Workbench({ shareBlob = null, onShareHandled }: WorkbenchProps) {
  const ds = useDataset()
  const slotA = useWorkbenchStore((s) => s.slotA)
  const slotB = useWorkbenchStore((s) => s.slotB)
  const target = useWorkbenchStore((s) => s.target)
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const bySpecies = useOwnedStore((s) => s.bySpecies)

  const [palette, setPalette] = useState<{ open: boolean; forSlot: 'a' | 'b' | 't' | null }>({
    open: false,
    forSlot: null,
  })
  const openPalette = useCallback((forSlot: 'a' | 'b' | 't' | null) => setPalette({ open: true, forSlot }), [])
  const closePalette = useCallback(() => setPalette({ open: false, forSlot: null }), [])

  const [importOpen, setImportOpen] = useState(false)
  /** Set only when a dragged file opened the panel, so it starts on the drop zone. */
  const [importDropReady, setImportDropReady] = useState(false)
  useEffect(() => {
    if (shareBlob !== null) setImportOpen(true)
  }, [shareBlob])
  const closeImport = useCallback(() => {
    setImportOpen(false)
    setImportDropReady(false)
    onShareHandled?.()
  }, [onShareHandled])

  const paletteOpen = palette.open

  /**
   * A file dropped anywhere but on an element that wants it is handled by the browser, which
   * navigates the tab to the file — a 400 MB `Level.sav` rendered as a document, and the workbench
   * gone with it. Both handlers exist to say "no" to that; the dragover one also takes the hint and
   * opens MY PALS on its drop zone, so the drag ends somewhere useful. The dialog fills the
   * viewport, so once it is up the drop lands on it.
   */
  useEffect(() => {
    const carriesFile = (e: globalThis.DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true
    const onDragOver = (e: globalThis.DragEvent): void => {
      if (!carriesFile(e)) return
      e.preventDefault()
      // A dialog already up owns the screen: the import panel needs no help, and yanking the search
      // palette away mid-drag would be a worse surprise than the drag doing nothing.
      if (!paletteOpen && !importOpen) {
        setImportDropReady(true)
        setImportOpen(true)
      }
    }
    const onDrop = (e: globalThis.DragEvent): void => {
      if (carriesFile(e)) e.preventDefault()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [importOpen, paletteOpen])

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (paletteOpen) closePalette()
        if (importOpen) closeImport()
        return
      }
      // While a modal is up it owns the keyboard — no reopening, no shortcut handling behind it.
      if (paletteOpen || importOpen || isTyping(e.target)) return
      const shortcut = e.key === '/' || ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))
      if (!shortcut) return
      e.preventDefault()
      openPalette(slotA === null ? 'a' : slotB === null ? 'b' : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeImport, closePalette, importOpen, openPalette, paletteOpen, slotA, slotB])

  const { palcalcCommit, gameVersion, refreshedAt } = ds.version
  // Counted over the rows this dataset can render, not over the raw store — the same
  // dataset-filtered question `hasOwnedFor` answers for the panels, and `> 0` here is exactly that
  // predicate. A list made against a newer paldex would otherwise badge `MY PALS · 2` while every
  // panel behind it computed `hasOwned === false` and hid its owned controls.
  const ownedSpecies = useMemo(() => ownedRows(ds.pals, bySpecies).length, [bySpecies, ds.pals])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="logo">
          <span className="logo-glyph" aria-hidden="true">
            ▸
          </span>{' '}
          PALMATCH
        </h1>
        <div className="header-right">
          <span className="label-caps">DATA {gameVersion}</span>
          <button
            type="button"
            className={`search-btn${ownedSpecies > 0 ? ' search-btn-on' : ''}`}
            onClick={() => {
              setImportDropReady(false)
              setImportOpen(true)
            }}
          >
            MY PALS{ownedSpecies > 0 ? ` · ${ownedSpecies}` : ''}
          </button>
          <button type="button" className="search-btn" onClick={() => openPalette(null)}>
            SEARCH PALS <kbd>/</kbd>
          </button>
        </div>
      </header>

      <main>
        <section className="slot-row" aria-label="breeding slots">
          <Slot label="PARENT A" palIndex={slotA} onOpen={() => openPalette('a')} onClear={() => setSlot('a', null)} />
          <div className="slot-sep" aria-hidden="true">
            ×
          </div>
          <Slot label="PARENT B" palIndex={slotB} onOpen={() => openPalette('b')} onClear={() => setSlot('b', null)} />
          <div className="slot-sep" aria-hidden="true">
            →
          </div>
          <Slot
            label="TARGET"
            palIndex={target}
            onOpen={() => openPalette('t')}
            onClear={() => setSlot('t', null)}
            accent
          />
        </section>

        <ResultTabs />
      </main>

      <footer className="app-footer">
        <p className="label-caps">
          palcalc {palcalcCommit.slice(0, 7)} · refreshed {refreshedAt.slice(0, 10)} ·{' '}
          <a
            href="https://github.com/jcscocca/palmatch/blob/main/ATTRIBUTION.md"
            target="_blank"
            rel="noreferrer"
          >
            GPL-3.0
          </a>
        </p>
        <p>
          Data &amp; sprites: palcalc (MIT) · Mutation model: community research by the palpedia.net Discord (Dinosaur,
          Kernist, DirectingRage, Despair, et al.) · Unofficial fan tool, not affiliated with Pocketpair. Palworld and
          all game assets © Pocketpair, Inc.
        </p>
      </footer>

      {/* Mounted only while open so each opening starts from a blank query and filters. */}
      {palette.open && <SearchPalette forSlot={palette.forSlot} onClose={closePalette} />}
      {importOpen && <ImportPanel shareBlob={shareBlob} dropReady={importDropReady} onClose={closeImport} />}
    </div>
  )
}
