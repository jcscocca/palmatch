import { useMemo, useState } from 'react'
import type { ComboBadge, Dataset, PalRecord } from '../../engine/types.ts'
import { hasOwnedFor, ownedSpeciesIndices, useOwnedStore } from '../../state/owned.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'
import { PalTile } from '../PalTile.tsx'
import { TypeChips } from '../TypeChips.tsx'
import { rowKey } from './combo-rows.ts'
import type { ComboRow } from './combo-rows.ts'

const BADGE_TEXT: Record<ComboBadge, string> = {
  unique: 'UNIQUE',
  'same-species': 'SAME SPECIES',
  'gender-locked': '♀♂ LOCKED',
}

export interface ComboTableProps {
  rows: ComboRow[]
  /**
   * Initial row count and "show more" step. Left off, everything renders.
   */
  cap?: number
}

/** One pal against both filters; the row survives when any *visible* cell of it does. */
function matches(pal: PalRecord, query: string, types: string[]): boolean {
  if (query !== '' && !pal.name.toLowerCase().includes(query)) return false
  return types.length === 0 || pal.types.some((t) => types.includes(t))
}

/**
 * Filtering follows what the table is showing: either parent can satisfy it, and so can the child
 * wherever the child column is rendered — searching "lifmunk" in ALL A-COMBOS is as likely to mean
 * "what makes one" as "what does it make", and hiding the row that answers the first would be a
 * lie about the pair.
 */
function rowMatches(ds: Dataset, row: ComboRow, showChild: boolean, query: string, types: string[]): boolean {
  if (matches(ds.pals[row.a], query, types) || matches(ds.pals[row.b], query, types)) return true
  return showChild && row.child !== undefined && matches(ds.pals[row.child], query, types)
}

/**
 * The shared parent-pair table behind PARENT COMBOS, ALL A-COMBOS and VIA MUTATION. Cells are
 * plain table cells rather than `role="button"` rows on purpose: a clickable row would flatten
 * everything inside it into one accessible name and hide `PalTile`'s promote buttons from screen
 * readers. Promotion is the only interaction here, so the row itself doesn't need to be one.
 */
export function ComboTable({ rows, cap }: ComboTableProps) {
  const ds = useDataset()
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const bySpecies = useOwnedStore((s) => s.bySpecies)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [ownedPref, setOwnedPref] = useState(false)
  const [shownLimit, setShownLimit] = useState(cap ?? Number.POSITIVE_INFINITY)

  // Read once per table rather than per tile: even one 50-row batch can carry 150 tiles, and each
  // subscribing to the store for one boolean would be 150 subscriptions for 150 set lookups.
  const owned = useMemo(() => new Set(ownedSpeciesIndices(bySpecies)), [bySpecies])
  const hasOwned = hasOwnedFor(bySpecies, ds.pals.length)
  // Clearing the list mid-session takes the chip away with it; without this the table would keep
  // filtering against an empty set and show nothing, with no control left to explain why.
  const ownedOnly = ownedPref && hasOwned

  const showChild = rows.some((r) => r.child !== undefined)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '' && typeFilter.length === 0 && !ownedOnly) return rows
    // Both filters must hold: OWNED ONLY asks about the pair, the name/type filter asks about any
    // visible cell, and a row has to answer both. The child is deliberately not part of the owned
    // test — the point of the chip is "pairs I can breed right now", which the child never is.
    return rows.filter(
      (r) => (!ownedOnly || (owned.has(r.a) && owned.has(r.b))) && rowMatches(ds, r, showChild, q, typeFilter),
    )
  }, [ds, owned, ownedOnly, query, rows, showChild, typeFilter])

  const shown = filtered.slice(0, shownLimit)
  const hidden = filtered.length - shown.length
  const nextCount = cap === undefined ? 0 : Math.min(cap, hidden)

  const toggleType = (type: string): void => {
    setTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const cell = (index: number) => (
    <PalTile pal={ds.pals[index]} size="sm" owned={owned.has(index)} onPromote={(slot) => setSlot(slot, index)} />
  )

  return (
    <div className="combo-panel">
      <div className="filter-bar">
        <input
          className="filter-input"
          type="text"
          aria-label="filter combos by pal name"
          placeholder="filter by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <TypeChips selected={typeFilter} onToggle={toggleType} />
        {hasOwned && (
          <button
            type="button"
            className={`chip-text${ownedOnly ? ' chip-on' : ''}`}
            aria-pressed={ownedOnly}
            title="only pairs where you own both parents"
            onClick={() => setOwnedPref((on) => !on)}
          >
            OWNED ONLY
          </button>
        )}
      </div>

      <p className="count-line">
        {filtered.length} combos{filtered.length === rows.length ? '' : ` of ${rows.length}`}
      </p>

      {shown.length === 0 ? (
        <p className="panel-note">no combos match this filter</p>
      ) : (
        <div className="table-scroll">
          <table className="combo-table">
            <thead>
              <tr>
                <th scope="col">PARENT</th>
                <th scope="col">PARENT</th>
                {showChild && <th scope="col">CHILD</th>}
                <th scope="col">NOTES</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={rowKey(row)}>
                  <td className="cell-pal">
                    <div className="cell-inner">{cell(row.a)}</div>
                  </td>
                  <td className="cell-pal">
                    <div className="cell-inner">
                      <span className="cell-op" aria-hidden="true">
                        ×
                      </span>
                      {cell(row.b)}
                    </div>
                  </td>
                  {showChild && (
                    <td className="cell-pal">
                      <div className="cell-inner">
                        <span className="cell-op" aria-hidden="true">
                          →
                        </span>
                        {row.child === undefined ? null : cell(row.child)}
                      </div>
                    </td>
                  )}
                  <td className="cell-badges">
                    {row.badges.map((badge) => (
                      <span
                        key={badge}
                        className={`badge-pill${badge === 'unique' ? ' badge-accent' : ''}`}
                        title={badge === 'gender-locked' ? (row.lockHint ?? 'each parent must be a set gender') : badge}
                      >
                        {BADGE_TEXT[badge]}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hidden > 0 && cap !== undefined && (
        <div className="combo-tail">
          <p className="panel-note">…{hidden} more pairs not shown</p>
          <button
            type="button"
            className="file-btn"
            onClick={() => setShownLimit((current) => current + cap)}
          >
            SHOW {nextCount} MORE
          </button>
        </div>
      )}
    </div>
  )
}
