import { useMemo } from 'react'
import { breed } from '../../engine/breed.ts'
import type { BreedResult, Dataset } from '../../engine/types.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'
import { PalTile } from '../PalTile.tsx'

export interface ChildCardProps {
  a: number
  b: number
}

function nameOf(ds: Dataset, id: string): string {
  const index = ds.byId.get(id)
  return index === undefined ? id : ds.pals[index].name
}

/** `♀ Katress × ♂ Wixen` in the orientation the dataset stores, so the genders can't be flipped. */
function lockLine(ds: Dataset, result: BreedResult): string | null {
  const lock = result.lock
  if (lock === undefined) return null
  const glyph = (g: 'F' | 'M'): string => (g === 'F' ? '♀' : '♂')
  return `${glyph(lock.aGender)} ${nameOf(ds, lock.aId)} × ${glyph(lock.bGender)} ${nameOf(ds, lock.bId)} →`
}

/**
 * What the two parents make. Usually one card; the one gender-locked pair in the game makes a
 * different child depending on which parent is female, so it renders both — each labelled with the
 * genders that produce it.
 */
export function ChildCard({ a, b }: ChildCardProps) {
  const ds = useDataset()
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const results = useMemo(() => breed(ds, a, b), [ds, a, b])

  return (
    <div className="child-cards">
      {results.map((result) => {
        const pal = ds.pals[result.child]
        const line = lockLine(ds, result)
        return (
          <div className="result-card" key={`${result.child}-${result.condition}`}>
            {line !== null && <p className="lock-line">{line}</p>}
            <PalTile pal={pal} size="lg" onPromote={(slot) => setSlot(slot, result.child)} />
            <p className="cond-line">
              {result.condition === 'unique' ? (
                <span className="badge-pill badge-accent">UNIQUE COMBO</span>
              ) : result.condition === 'same-species' ? (
                'same species'
              ) : line !== null ? (
                'gender-locked combo'
              ) : (
                'standard combo'
              )}
            </p>
            <p className="gender-odds">
              <span className="label-caps">HATCHES MALE</span> ♂ {Math.round(pal.maleProb * 100)}%
            </p>
          </div>
        )
      })}
    </div>
  )
}
