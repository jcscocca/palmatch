import { useCallback, useEffect, useState } from 'react'
import type { Dataset } from '../engine/types.ts'
import { modeFor, useWorkbenchStore } from '../state/store.ts'
import type { Mode } from '../state/store.ts'
import { SearchPalette } from './SearchPalette.tsx'
import { Slot } from './Slot.tsx'

export interface WorkbenchProps {
  ds: Dataset
}

/** Tab ids per mode. Ids match `/^[a-z-]+$/` — they are written into the URL fragment verbatim. */
const MODE_TABS: Record<Mode, string[]> = {
  empty: [],
  'a-only': ['all-a-combos'],
  pair: ['child', 'mutations', 'passive-odds', 'all-a-combos'],
  target: ['parent-combos', 'via-mutation'],
  chain: ['chains'],
}

const TAB_LABELS: Record<string, string> = {
  child: 'CHILD',
  mutations: 'MUTATIONS',
  'passive-odds': 'PASSIVE ODDS',
  'all-a-combos': 'ALL A-COMBOS',
  'parent-combos': 'PARENT COMBOS',
  'via-mutation': 'VIA MUTATION',
  chains: 'CHAINS',
}

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

export function Workbench({ ds }: WorkbenchProps) {
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

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closePalette()
        return
      }
      if (isTyping(e.target)) return
      const shortcut = e.key === '/' || ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))
      if (!shortcut) return
      e.preventDefault()
      openPalette(slotA === null ? 'a' : slotB === null ? 'b' : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePalette, openPalette, slotA, slotB])

  const mode = modeFor({ slotA, slotB, target })
  const tabs = MODE_TABS[mode]
  const activeTab = tab !== null && tabs.includes(tab) ? tab : (tabs[0] ?? null)
  const { palcalcCommit, gameVersion, refreshedAt } = ds.version

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="logo">
          <span className="logo-glyph">▸</span> PALMATCH
        </h1>
        <div className="header-right">
          <span className="label-caps header-version">DATA {gameVersion}</span>
          <button type="button" className="search-btn" onClick={() => openPalette(null)}>
            SEARCH PALS <kbd>/</kbd>
          </button>
        </div>
      </header>

      <section className="slot-row" aria-label="breeding slots">
        <Slot label="PARENT A" palIndex={slotA} onOpen={() => openPalette('a')} onClear={() => setSlot('a', null)} />
        <div className="slot-sep" aria-hidden="true">
          ×
        </div>
        <Slot label="PARENT B" palIndex={slotB} onOpen={() => openPalette('b')} onClear={() => setSlot('b', null)} />
        <div className="slot-sep" aria-hidden="true">
          →
        </div>
        <Slot label="TARGET" palIndex={target} onOpen={() => openPalette('t')} onClear={() => setSlot('t', null)} accent />
      </section>

      <section className="results" aria-label="results">
        {tabs.length > 0 && (
          <nav className="tab-strip" aria-label="result tabs">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                className={`tab${id === activeTab ? ' tab-active' : ''}`}
                aria-pressed={id === activeTab}
                onClick={() => setTab(id)}
              >
                {TAB_LABELS[id]}
              </button>
            ))}
          </nav>
        )}
        <div className="panel">
          <div className="label-caps">{MODE_LABELS[mode]}</div>
          <p className="panel-placeholder">
            {mode === 'empty' ? 'pick pals to begin' : `panels arrive in Task 7 — ${activeTab ?? 'no tab'}`}
          </p>
        </div>
      </section>

      <footer className="app-footer">
        <p className="footer-version">
          palcalc {palcalcCommit.slice(0, 7)} · refreshed {refreshedAt.slice(0, 10)}
        </p>
        <p>
          Data &amp; sprites: palcalc (MIT) · Mutation model: community estimates via palpedia.net Discord research ·
          Unofficial fan tool — not affiliated with Pocketpair. Palworld © Pocketpair, Inc.
        </p>
      </footer>

      {/* Mounted only while open so each opening starts from a blank query and filters. */}
      {palette.open && <SearchPalette open={palette.open} forSlot={palette.forSlot} onClose={closePalette} />}
    </div>
  )
}
