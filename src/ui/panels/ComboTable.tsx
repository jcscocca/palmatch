import { useMemo, useState } from 'react'
import type { ComboBadge, PalRecord } from '../../engine/types.ts'
import { TYPE_TO_ELEMENT } from '../../lib/elements.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'
import { PalTile } from '../PalTile.tsx'
import { TypeBadge } from '../TypeBadge.tsx'
import { rowKey } from './combo-rows.ts'
import type { ComboRow } from './combo-rows.ts'

const TYPES = Object.keys(TYPE_TO_ELEMENT)

const BADGE_TEXT: Record<ComboBadge, string> = {
  unique: 'UNIQUE',
  'same-species': 'SAME SPECIES',
  'gender-locked': '♀♂ LOCKED',
}

export interface ComboTableProps {
  rows: ComboRow[]
  /**
   * Rows past this many are replaced by a count note. Left off, everything renders — fine up to
   * a few hundred rows, which is what the combo tabs produce for most pals.
   */
  cap?: number
  /** Heading over the child column; rows carrying no child render no such column. */
  childLabel?: string
}

/** A parent passes the filters on its own; a row survives when either parent does. */
function matches(pal: PalRecord, query: string, types: string[]): boolean {
  if (query !== '' && !pal.name.toLowerCase().includes(query)) return false
  return types.length === 0 || pal.types.some((t) => types.includes(t))
}

/**
 * The shared parent-pair table behind PARENT COMBOS, ALL A-COMBOS and VIA MUTATION. Cells are
 * plain table cells rather than `role="button"` rows on purpose: a clickable row would flatten
 * everything inside it into one accessible name and hide `PalTile`'s promote buttons from screen
 * readers. Promotion is the only interaction here, so the row itself doesn't need to be one.
 */
export function ComboTable({ rows, cap, childLabel = 'CHILD' }: ComboTableProps) {
  const ds = useDataset()
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])

  const showChild = rows.some((r) => r.child !== undefined)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '' && typeFilter.length === 0) return rows
    return rows.filter((r) => matches(ds.pals[r.a], q, typeFilter) || matches(ds.pals[r.b], q, typeFilter))
  }, [ds.pals, query, rows, typeFilter])

  const shown = cap === undefined ? filtered : filtered.slice(0, cap)
  const hidden = filtered.length - shown.length

  const toggleType = (type: string): void => {
    setTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const cell = (index: number) => (
    <PalTile pal={ds.pals[index]} size="sm" onPromote={(slot) => setSlot(slot, index)} />
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
        <div className="chip-row">
          {TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`chip${typeFilter.includes(type) ? ' chip-on' : ''}`}
              aria-label={`filter ${type}`}
              aria-pressed={typeFilter.includes(type)}
              onClick={() => toggleType(type)}
            >
              <TypeBadge type={type} size="sm" />
            </button>
          ))}
        </div>
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
                {showChild && <th scope="col">{childLabel}</th>}
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

      {hidden > 0 && <p className="panel-note">…{hidden} more pairs not shown — narrow with the filter</p>}
    </div>
  )
}
