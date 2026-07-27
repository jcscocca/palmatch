import { useCallback, useEffect, useState } from 'react'
import { useWorkbenchStore } from '../state/store.ts'
import { useDataset } from './dataset-context.ts'
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

export function Workbench() {
  const ds = useDataset()
  const slotA = useWorkbenchStore((s) => s.slotA)
  const slotB = useWorkbenchStore((s) => s.slotB)
  const target = useWorkbenchStore((s) => s.target)
  const setSlot = useWorkbenchStore((s) => s.setSlot)

  const [palette, setPalette] = useState<{ open: boolean; forSlot: 'a' | 'b' | 't' | null }>({
    open: false,
    forSlot: null,
  })
  const openPalette = useCallback((forSlot: 'a' | 'b' | 't' | null) => setPalette({ open: true, forSlot }), [])
  const closePalette = useCallback(() => setPalette({ open: false, forSlot: null }), [])

  const paletteOpen = palette.open
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (paletteOpen) closePalette()
        return
      }
      // While the palette is up it owns the keyboard — no reopening, no shortcut handling behind it.
      if (paletteOpen || isTyping(e.target)) return
      const shortcut = e.key === '/' || ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))
      if (!shortcut) return
      e.preventDefault()
      openPalette(slotA === null ? 'a' : slotB === null ? 'b' : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePalette, openPalette, paletteOpen, slotA, slotB])

  const { palcalcCommit, gameVersion, refreshedAt } = ds.version

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
    </div>
  )
}
