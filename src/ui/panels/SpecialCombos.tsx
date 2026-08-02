import { useMemo, useState } from 'react'
import { useDataset } from '../dataset-context.ts'
import { ComboTable } from './ComboTable.tsx'
import { specialRowsFor } from './combo-rows.ts'
import type { SpecialComboSort } from './combo-rows.ts'

const SORT_DESCRIPTIONS: Record<SpecialComboSort, string> = {
  'breeding-rank': 'Lowest offspring breeding rank first.',
  'rank-jump': 'Largest rank improvement over the stronger parent first.',
}

/**
 * Useful starting points for a blank workbench. These are data-driven rather than hand-picked, so
 * a data refresh automatically replaces them when the game's breeding ranks or special recipes
 * change.
 */
export function SpecialCombos() {
  const ds = useDataset()
  const [sort, setSort] = useState<SpecialComboSort>('breeding-rank')
  const rows = useMemo(() => specialRowsFor(ds, sort), [ds, sort])

  return (
    <section className="special-combos" aria-labelledby="special-combos-title">
      <div className="special-combos-head">
        <div className="special-combos-title">
          <h2 id="special-combos-title">SPECIAL COMBINATIONS</h2>
          <span className="label-caps">{rows.length} RECIPES</span>
        </div>
        <div className="special-combos-controls">
          <p>{SORT_DESCRIPTIONS[sort]}</p>
          <label className="combo-sort">
            <span className="label-caps">SORT</span>
            <select
              className="combo-sort-select"
              aria-label="sort special combinations"
              value={sort}
              onChange={(e) => setSort(e.target.value as SpecialComboSort)}
            >
              <option value="breeding-rank">BREEDING RANK</option>
              <option value="rank-jump">BIGGEST RANK JUMP</option>
            </select>
          </label>
        </div>
      </div>
      <ComboTable rows={rows} showFilters={false} />
    </section>
  )
}
