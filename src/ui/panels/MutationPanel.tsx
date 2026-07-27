import { useMemo } from 'react'
import { mutationPool } from '../../engine/mutation.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'
import { PalTile } from '../PalTile.tsx'
import { ComboTable } from './ComboTable.tsx'
import { mutationRowsFor } from './combo-rows.ts'

/** Rows past this are summarised instead of rendered — a common rank has thousands of pairs. */
const VIA_MUTATION_CAP = 100

function percent(x: number): string {
  return `${+(x * 100).toFixed(1)}%`
}

/** Pool weights run down to fractions of a percent; rounding those to `0%` would read as never. */
function weightLabel(weight: number): string {
  return weight < 0.01 ? '<1%' : `${Math.round(weight * 100)}%`
}

function Disclaimer() {
  const ds = useDataset()
  return (
    <p className="disclaimer">
      <span className="label-caps">COMMUNITY MODEL</span> — {ds.mutation.source}. Odds are player-measured estimates,
      not datamined values.
    </p>
  )
}

export interface MutationPanelProps {
  a: number
  b: number
}

/** The species a mutated egg from this pairing can hatch, and how often an egg mutates at all. */
export function MutationPanel({ a, b }: MutationPanelProps) {
  const ds = useDataset()
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const pool = useMemo(() => mutationPool(ds, a, b), [ds, a, b])
  const { chances } = ds.mutation

  return (
    <div className="mutation-panel">
      <Disclaimer />

      <p className="count-line">{pool.length} possible mutations</p>
      <ul className="mut-pool">
        {pool.map((outcome) => (
          <li className="mut-row" key={outcome.child}>
            <PalTile pal={ds.pals[outcome.child]} size="sm" onPromote={(slot) => setSlot(slot, outcome.child)} />
            <span className="mut-weight">{weightLabel(outcome.weight)}</span>
          </li>
        ))}
      </ul>

      <table className="chance-table">
        <caption className="label-caps">CHANCE AN EGG IS MUTATED</caption>
        <thead>
          <tr>
            <th scope="col">FEED</th>
            <th scope="col">CHANCE</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>no cake</td>
            <td>{percent(chances.base)}</td>
          </tr>
          <tr>
            <td>Vegetable Cake</td>
            <td>{percent(chances.vegetableCake)}</td>
          </tr>
          <tr>
            <td>Extravagant Vegetable Cake</td>
            <td>{percent(chances.extravagantCake)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export interface ViaMutationProps {
  target: number
}

/** Every pair whose mutation roll can land on the target — the reverse of the pool above. */
export function ViaMutation({ target }: ViaMutationProps) {
  const ds = useDataset()
  const rows = useMemo(() => mutationRowsFor(ds, target), [ds, target])

  return (
    <div className="mutation-panel">
      <Disclaimer />
      {rows.length === 0 ? (
        <p className="panel-note">no pairing can mutate into {ds.pals[target].name}</p>
      ) : (
        <ComboTable rows={rows} cap={VIA_MUTATION_CAP} />
      )}
    </div>
  )
}
