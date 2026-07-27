import { useCallback, useEffect, useState } from 'react'
import { modeFor, useWorkbenchStore } from '../state/store.ts'
import type { Mode } from '../state/store.ts'
import { useDataset } from './dataset-context.ts'
import { SearchPalette } from './SearchPalette.tsx'
import { Slot } from './Slot.tsx'
import { MODE_TABS, TAB_LABELS, activeTabFor } from './tabs.ts'

const MODE_LABELS: Record<Mode, string> = {
  empty: 'NO PALS PICKED',
  'a-only': 'ONE PARENT',
  pair: 'PARENT PAIR',
  target: 'TARGET',
  chain: 'CHAIN TO TARGET',
}

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
  const tab = useWorkbenchStore((s) => s.tab)
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const setTab = useWorkbenchStore((s) => s.setTab)

  const [palette, setPalette] = useState<{ open: boolean; forSlot: 'a' | 'b' | 't' | null }>({
    open: false,
    forSlot: null,
  })
  const openPalette = useCallback((forSlot: 'a' | 'b' | 't' | null) => setPalette({ open: true, forSlot }), [])
  const closePalette = useCallback(() => setPalette({ open: false, forSlot: null }), [])

  const mode = modeFor({ slotA, slotB, target })
  const tabs = MODE_TABS[mode]
  const activeTab = activeTabFor(mode, tab)

  // A tab id can arrive from a shared link that doesn't belong to the current mode. `activeTabFor`
  // already falls back for rendering; writing the fallback back into the store keeps the URL from
  // advertising a tab the screen isn't showing.
  useEffect(() => {
    if (tab !== null && !tabs.includes(tab)) setTab(null)
  }, [setTab, tab, tabs])

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
  const panelId = `panel-${activeTab ?? 'none'}`

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

        <section className="results">
          {tabs.length > 0 && (
            <div className="tab-strip" role="tablist" aria-label="result tabs">
              {tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  id={`tab-${id}`}
                  role="tab"
                  className={`tab${id === activeTab ? ' tab-active' : ''}`}
                  aria-selected={id === activeTab}
                  aria-controls={panelId}
                  onClick={() => setTab(id)}
                >
                  {TAB_LABELS[id]}
                </button>
              ))}
            </div>
          )}
          <div
            className="panel"
            id={panelId}
            role="tabpanel"
            aria-labelledby={activeTab === null ? undefined : `tab-${activeTab}`}
            aria-label={activeTab === null ? MODE_LABELS[mode] : undefined}
          >
            <div className="label-caps">{MODE_LABELS[mode]}</div>
            <p className="panel-placeholder">
              {mode === 'empty' ? 'pick pals to begin' : `panels arrive in Task 7 — ${activeTab ?? 'no tab'}`}
            </p>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <p className="label-caps">
          palcalc {palcalcCommit.slice(0, 7)} · refreshed {refreshedAt.slice(0, 10)}
        </p>
        <p>
          Data &amp; sprites: palcalc (MIT) · Mutation model: community estimates via palpedia.net Discord research ·
          Unofficial fan tool — not affiliated with Pocketpair. Palworld © Pocketpair, Inc.
        </p>
      </footer>

      {/* Mounted only while open so each opening starts from a blank query and filters. */}
      {palette.open && <SearchPalette forSlot={palette.forSlot} onClose={closePalette} />}
    </div>
  )
}
