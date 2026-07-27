import { useEffect, useMemo } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { modeFor, useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'
import { MODE_TABS, TAB_LABELS, activeTabFor } from '../tabs.ts'
import { ChainView } from './ChainView.tsx'
import { ChildCard } from './ChildCard.tsx'
import { ComboTable } from './ComboTable.tsx'
import { MutationPanel, ViaMutation } from './MutationPanel.tsx'
import { OddsPanel } from './OddsPanel.tsx'
import { comboRowsFor, parentRowsFor } from './combo-rows.ts'

/** Fixed: every tab's `aria-controls` points at the one panel element, which never changes id. */
const PANEL_ID = 'result-panel'
/** A handful of pals have >1000 parent pairs; the filter is how you get at the rest. */
const COMBO_CAP = 300

/**
 * The result area: the per-mode tab strip plus whichever panel it selects. Arrow keys move between
 * tabs (roving tabindex — only the selected tab is in the tab order), and selection follows focus,
 * which is the pattern for tab sets whose panels are cheap to render.
 */
export function ResultTabs() {
  const ds = useDataset()
  const slotA = useWorkbenchStore((s) => s.slotA)
  const slotB = useWorkbenchStore((s) => s.slotB)
  const target = useWorkbenchStore((s) => s.target)
  const tab = useWorkbenchStore((s) => s.tab)
  const setTab = useWorkbenchStore((s) => s.setTab)

  const mode = modeFor({ slotA, slotB, target })
  const tabs = MODE_TABS[mode]
  const activeTab = activeTabFor(mode, tab)

  // A tab id can arrive from a shared link that doesn't belong to the current mode. `activeTabFor`
  // already falls back for rendering; writing the fallback back into the store keeps the URL from
  // advertising a tab the screen isn't showing.
  useEffect(() => {
    if (tab !== null && !tabs.includes(tab)) setTab(null)
  }, [setTab, tab, tabs])

  // Needed for the tab label as well as the panel, so it is computed for the whole mode rather
  // than only while its tab is open. The A-combos rows are not, so they wait for their tab.
  const parentRows = useMemo(
    () => (mode === 'target' && target !== null ? parentRowsFor(ds, target) : []),
    [ds, mode, target],
  )
  const aRows = useMemo(
    () => (activeTab === 'all-a-combos' && slotA !== null ? comboRowsFor(ds, slotA) : []),
    [activeTab, ds, slotA],
  )

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = activeTab === null ? -1 : tabs.indexOf(activeTab)
    if (current < 0) return
    const next =
      e.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (current - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1
    if (next < 0) return
    e.preventDefault()
    setTab(tabs[next])
    document.getElementById(`tab-${tabs[next]}`)?.focus()
  }

  // Each tab belongs to a mode, and every mode fills the slots its tabs read — the `null` guards
  // below are there for the type checker, not for a state the workbench can actually be in. The
  // two `ComboTable`s are keyed so switching tabs mounts a fresh one: without that, React reuses
  // the instance and the filter typed into one tab silently narrows the other.
  const pair = slotA !== null && slotB !== null ? { a: slotA, b: slotB } : null
  const body = ((): ReactNode => {
    switch (activeTab) {
      case null:
        return <p className="panel-note">pick pals to begin — fill PARENT A, PARENT B, or TARGET above, or press / to search</p>
      case 'child':
        return pair === null ? null : <ChildCard a={pair.a} b={pair.b} />
      case 'mutations':
        return pair === null ? null : <MutationPanel a={pair.a} b={pair.b} />
      case 'passive-odds':
        return pair === null ? null : <OddsPanel a={pair.a} b={pair.b} />
      case 'all-a-combos':
        return slotA === null ? null : <ComboTable key={activeTab} rows={aRows} cap={COMBO_CAP} />
      case 'parent-combos':
        return <ComboTable key={activeTab} rows={parentRows} cap={COMBO_CAP} />
      case 'via-mutation':
        return target === null ? null : <ViaMutation target={target} />
      case 'chains':
        return <ChainView />
      default: {
        // Every `TabId` is handled above; adding one without a panel stops compiling here.
        const unreachable: never = activeTab
        return unreachable
      }
    }
  })()

  return (
    <section className="results">
      {tabs.length > 0 && (
        <div className="tab-strip" role="tablist" aria-label="result tabs" onKeyDown={onTabKeyDown}>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              id={`tab-${id}`}
              role="tab"
              className={`tab${id === activeTab ? ' tab-active' : ''}`}
              aria-selected={id === activeTab}
              aria-controls={PANEL_ID}
              tabIndex={id === activeTab ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {id === 'parent-combos' ? `${TAB_LABELS[id]} (${parentRows.length})` : TAB_LABELS[id]}
            </button>
          ))}
        </div>
      )}
      <div
        className="panel"
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={activeTab === null ? undefined : `tab-${activeTab}`}
        aria-label={activeTab === null ? 'results' : undefined}
      >
        {body}
      </div>
    </section>
  )
}
