import { useEffect, useMemo, useState } from 'react'
import { passiveOdds } from '../../engine/passives.ts'
import type { PassiveRecord } from '../../engine/types.ts'
import { MAX_PARENT_PASSIVES, useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'

/** Enough to pick from without turning the panel into a scrolling list of 114 passives. */
const OPTION_LIMIT = 6

function percent(p: number): string {
  return `${+(p * 100).toFixed(1)}%`
}

interface PassivePickerProps {
  side: 'a' | 'b'
  palName: string
  picked: string[]
  options: PassiveRecord[]
  nameOf: (id: string) => string
  onChange: (ids: string[]) => void
}

function PassivePicker({ side, palName, picked, options, nameOf, onChange }: PassivePickerProps) {
  const [query, setQuery] = useState('')
  const full = picked.length >= MAX_PARENT_PASSIVES
  const q = query.trim().toLowerCase()
  const matches = options
    .filter((p) => !picked.includes(p.id) && (q === '' || p.name.toLowerCase().includes(q)))
    .slice(0, OPTION_LIMIT)

  return (
    <div className="passive-picker">
      <div className="label-caps">
        PARENT {side.toUpperCase()} · {palName}
      </div>

      <ul className="chip-list">
        {picked.map((id) => (
          <li key={id} className="passive-chip">
            {nameOf(id)}
            <button
              type="button"
              className="chip-x"
              aria-label={`remove ${nameOf(id)} from parent ${side.toUpperCase()}`}
              onClick={() => onChange(picked.filter((x) => x !== id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <input
        className="filter-input"
        type="text"
        aria-label={`search passives for parent ${side.toUpperCase()}`}
        placeholder={full ? `${MAX_PARENT_PASSIVES} passives is the cap` : 'search passives…'}
        disabled={full}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!full && (
        <div className="option-row">
          {matches.map((p) => (
            <button key={p.id} type="button" className="option-btn" onClick={() => onChange([...picked, p.id])}>
              + {p.name}
            </button>
          ))}
          {matches.length === 0 && <span className="panel-note">no passive matches</span>}
        </div>
      )}
    </div>
  )
}

export interface OddsPanelProps {
  a: number
  b: number
}

/**
 * Odds the child inherits the passives you care about. The pool is the union of what both parents
 * carry — a passive on both parents is still one entry in the pool — and the desired set can only
 * ever be a subset of that pool, so entries drop out of it as soon as the parent carrying them
 * does.
 */
export function OddsPanel({ a, b }: OddsPanelProps) {
  const ds = useDataset()
  const parentPassives = useWorkbenchStore((s) => s.parentPassives)
  const desired = useWorkbenchStore((s) => s.desiredPassives)
  const setParentPassives = useWorkbenchStore((s) => s.setParentPassives)
  const setDesiredPassives = useWorkbenchStore((s) => s.setDesiredPassives)

  // Only passives a child can actually end up with by inheritance are worth offering.
  const options = useMemo(
    () =>
      ds.passives
        .filter((p) => p.randomAllowed || p.standard)
        .slice()
        .sort((x, y) => x.name.localeCompare(y.name)),
    [ds.passives],
  )
  const nameOf = useMemo(() => {
    const names = new Map(ds.passives.map((p) => [p.id, p.name]))
    return (id: string): string => names.get(id) ?? id
  }, [ds.passives])

  const union = useMemo(
    () => [...new Set([...parentPassives.a, ...parentPassives.b])],
    [parentPassives.a, parentPassives.b],
  )

  useEffect(() => {
    const pruned = desired.filter((id) => union.includes(id))
    if (pruned.length !== desired.length) setDesiredPassives(pruned)
  }, [desired, setDesiredPassives, union])

  const inPool = desired.filter((id) => union.includes(id))
  const odds = passiveOdds(union.length, inPool.length)

  return (
    <div className="odds-panel">
      <div className="picker-row">
        <PassivePicker
          side="a"
          palName={ds.pals[a].name}
          picked={parentPassives.a}
          options={options}
          nameOf={nameOf}
          onChange={(ids) => setParentPassives('a', ids)}
        />
        <PassivePicker
          side="b"
          palName={ds.pals[b].name}
          picked={parentPassives.b}
          options={options}
          nameOf={nameOf}
          onChange={(ids) => setParentPassives('b', ids)}
        />
      </div>

      <div className="desired-picker">
        <div className="label-caps">WANT IN THE CHILD</div>
        {union.length === 0 ? (
          <p className="panel-note">declare each parent&apos;s passives above — the pool is what a child can inherit</p>
        ) : (
          <div className="option-row">
            {union.map((id) => (
              <button
                key={id}
                type="button"
                className={`chip-text${inPool.includes(id) ? ' chip-on' : ''}`}
                aria-pressed={inPool.includes(id)}
                onClick={() =>
                  setDesiredPassives(inPool.includes(id) ? inPool.filter((x) => x !== id) : [...inPool, id])
                }
              >
                {nameOf(id)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="result-card odds-card">
        {union.length === 0 || inPool.length === 0 ? (
          <p className="panel-note">
            {union.length === 0 ? 'no passives declared yet' : 'pick which pooled passives you want'}
          </p>
        ) : (
          <>
            <div className="odds-big">{percent(odds)}</div>
            <p className="cond-line">
              P(child directly inherits all {inPool.length} of {union.length} pooled passives)
            </p>
          </>
        )}
        <p className="odds-caveat">
          Estimate: direct inheritance only; random-fill passives and cake modifiers not modeled.
        </p>
      </div>
    </div>
  )
}
