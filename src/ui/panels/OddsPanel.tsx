import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { breed } from '../../engine/breed.ts'
import {
  PASSIVE_ROLE_LABELS,
  passiveTier,
  suggestedPassives,
  type PassiveRole,
  type PassiveTier,
} from '../../engine/passive-guidance.ts'
import { attemptEstimate, exactPassiveOdds, passiveOdds } from '../../engine/passives.ts'
import type { BreedResult, GenderCode, PassiveRecord } from '../../engine/types.ts'
import { percent } from '../../lib/format.ts'
import { useOwnedStore, type OwnedIndividual } from '../../state/owned.ts'
import { MAX_PARENT_PASSIVES, useWorkbenchStore } from '../../state/store.ts'
import { useDataset } from '../dataset-context.ts'

/** Enough to pick from without turning the panel into a scrolling list of 114 passives. */
const OPTION_LIMIT = 6

function genderGlyph(gender: GenderCode | null): string {
  return gender === 'F' ? '♀' : gender === 'M' ? '♂' : '?'
}

interface PassivePickerProps {
  side: 'a' | 'b'
  palName: string
  picked: string[]
  gender: GenderCode | null
  individuals: OwnedIndividual[]
  ownedCount: number
  options: PassiveRecord[]
  nameOf: (id: string) => string
  tierOf: (id: string) => PassiveTier
  onChange: (ids: string[]) => void
  onGenderChange: (gender: GenderCode | null) => void
}

function PassivePicker({
  side,
  palName,
  picked,
  gender,
  individuals,
  ownedCount,
  options,
  nameOf,
  tierOf,
  onChange,
  onGenderChange,
}: PassivePickerProps) {
  const [query, setQuery] = useState('')
  const [copyIndex, setCopyIndex] = useState<number | null>(null)
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

      {individuals.length > 0 && (
        <label className="copy-select-label">
          <span className="label-caps">OWNED COPY</span>
          <select
            className="copy-select"
            aria-label={`use owned copy for parent ${side.toUpperCase()}`}
            value={copyIndex === null ? 'manual' : String(copyIndex)}
            onChange={(event) => {
              if (event.target.value === 'manual') {
                setCopyIndex(null)
                return
              }
              const individual = individuals[Number(event.target.value)]
              if (individual === undefined) return
              setCopyIndex(Number(event.target.value))
              onGenderChange(individual.gender)
              onChange(individual.passives)
            }}
          >
            <option value="manual">Manual entry</option>
            {individuals.map((individual, index) => (
              <option key={index} value={index}>
                {genderGlyph(individual.gender)} ·{' '}
                {individual.passives.length === 0
                  ? 'clean — no passives'
                  : individual.passives.map(nameOf).join(' + ')}
              </option>
            ))}
          </select>
        </label>
      )}

      {ownedCount > individuals.length && (
        <p className="portfolio-note">
          showing {individuals.length} representative copies of {ownedCount} — clean and high-rank breeding stock
          is kept first
        </p>
      )}

      <label className="gender-select-label">
        <span className="label-caps">SEX</span>
        <select
          className="gender-select"
          aria-label={`sex for parent ${side.toUpperCase()}`}
          value={gender ?? ''}
          onChange={(event) => {
            setCopyIndex(null)
            onGenderChange((event.target.value || null) as GenderCode | null)
          }}
        >
          <option value="">Unknown</option>
          <option value="F">♀ Female</option>
          <option value="M">♂ Male</option>
        </select>
      </label>

      <ul className="chip-list">
        {picked.map((id) => {
          const tier = tierOf(id)
          return (
            <li key={id} className="passive-chip">
              <span>{nameOf(id)}</span>
              <span className={`passive-tier passive-tier-${tier.tone}`}>{tier.label}</span>
              <button
                type="button"
                className="chip-x"
                aria-label={`remove ${nameOf(id)} from parent ${side.toUpperCase()}`}
                onClick={() => {
                  setCopyIndex(null)
                  onChange(picked.filter((x) => x !== id))
                }}
              >
                ×
              </button>
            </li>
          )
        })}
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
            <button
              key={p.id}
              type="button"
              className="option-btn"
              onClick={() => {
                setCopyIndex(null)
                setQuery('')
                onChange([...picked, p.id])
              }}
            >
              + {p.name} · R{p.rank}
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

interface StrategyStep {
  title: string
  body: string
  chance: number
}

function attemptCopy(chance: number): string {
  const attempts = attemptEstimate(chance)
  return attempts === null
    ? 'not reachable under the direct-inheritance model'
    : `about ${attempts.average} eggs on average · 90% chance by ${attempts.p90}`
}

function resultMatchesGenders(
  result: BreedResult,
  aId: string,
  bId: string,
  aGender: GenderCode | null,
  bGender: GenderCode | null,
): boolean {
  if (result.lock === undefined || aGender === null || bGender === null) return true
  const aActual = result.lock.aId === aId ? aGender : bGender
  const bActual = result.lock.bId === bId ? bGender : aGender
  return aActual === result.lock.aGender && bActual === result.lock.bGender
}

/**
 * Passive planning stays deliberately separate from species-chain planning. It appraises the two
 * exact copies, gives honest direct odds, and explains the cleanup/merge gates a player should use;
 * it does not pretend an unspecified clean partner is a deterministic route to a target species.
 */
export function OddsPanel({ a, b }: OddsPanelProps) {
  const ds = useDataset()
  const parentPassives = useWorkbenchStore((s) => s.parentPassives)
  const parentGenders = useWorkbenchStore((s) => s.parentGenders)
  const desired = useWorkbenchStore((s) => s.desiredPassives)
  const setParentPassives = useWorkbenchStore((s) => s.setParentPassives)
  const setParentGender = useWorkbenchStore((s) => s.setParentGender)
  const setDesiredPassives = useWorkbenchStore((s) => s.setDesiredPassives)
  const bySpecies = useOwnedStore((s) => s.bySpecies)
  const [role, setRole] = useState<PassiveRole>('unsure')

  const options = useMemo(
    () =>
      ds.passives
        .filter((p) => p.randomAllowed || p.standard)
        .slice()
        .sort((x, y) => x.name.localeCompare(y.name)),
    [ds.passives],
  )
  const passiveById = useMemo(() => new Map(ds.passives.map((p) => [p.id, p])), [ds.passives])
  const nameOf = useCallback((id: string): string => passiveById.get(id)?.name ?? id, [passiveById])
  const tierOf = useCallback((id: string): PassiveTier => passiveTier(passiveById.get(id)?.rank ?? 0), [passiveById])

  const union = useMemo(
    () => [...new Set([...parentPassives.a, ...parentPassives.b])],
    [parentPassives.a, parentPassives.b],
  )

  useLayoutEffect(() => {
    const pruned = desired.filter((id) => union.includes(id))
    if (pruned.length !== desired.length) setDesiredPassives(pruned)
  }, [desired, setDesiredPassives, union])

  const availableRecords = union.flatMap((id) => {
    const passive = passiveById.get(id)
    return passive === undefined ? [] : [passive]
  })
  const suggestions = suggestedPassives(availableRecords, role).slice(0, MAX_PARENT_PASSIVES)
  const inclusiveOdds = passiveOdds(union.length, desired.length)
  const exactOdds = exactPassiveOdds(union.length, desired.length)
  const sameKnownSex = parentGenders.a !== null && parentGenders.a === parentGenders.b

  const directResults = useMemo(
    () =>
      breed(ds, a, b).filter((result) =>
        resultMatchesGenders(
          result,
          ds.pals[a].id,
          ds.pals[b].id,
          parentGenders.a,
          parentGenders.b,
        ),
      ),
    [a, b, ds, parentGenders.a, parentGenders.b],
  )
  const childNames = directResults.map((result) => ds.pals[result.child].name)
  const forced = [
    ...new Set(directResults.flatMap((result) => ds.pals[result.child].guaranteed).filter((id) => !desired.includes(id))),
  ]

  const strategy = useMemo((): { summary: string; steps: StrategyStep[] } | null => {
    if (desired.length === 0) return null
    const wanted = new Set(desired)
    const unwantedFor = (passives: string[]): string[] => passives.filter((id) => !wanted.has(id))
    const hasAll = (passives: string[]): boolean => desired.every((id) => passives.includes(id))
    const candidates = [
      { side: 'A', passives: parentPassives.a },
      { side: 'B', passives: parentPassives.b },
    ].filter((candidate) => hasAll(candidate.passives))

    if (candidates.length > 0) {
      candidates.sort(
        (x, y) =>
          unwantedFor(x.passives).length - unwantedFor(y.passives).length || x.passives.length - y.passives.length,
      )
      const donor = candidates[0]
      const unwanted = unwantedFor(donor.passives)
      const redundant = candidates.length > 1 ? ` Parent ${donor.side} is the cleaner of the two complete donors.` : ''
      if (unwanted.length === 0) {
        return {
          summary: `Parent ${donor.side} already carries exactly the selected set.${redundant}`,
          steps: [],
        }
      }
      return {
        summary: `Use Parent ${donor.side} as the donor.${redundant}`,
        steps: [
          {
            title: `CLEAN PARENT ${donor.side}`,
            body: `Pair it with a clean opposite-sex partner. Keep a child with ${desired.map(nameOf).join(' + ')} only; remove ${unwanted.map(nameOf).join(' + ')}.`,
            chance: exactPassiveOdds(donor.passives.length, desired.length),
          },
        ],
      }
    }

    const aLine = desired.filter((id) => parentPassives.a.includes(id))
    const bLine = desired.filter((id) => !aLine.includes(id) && parentPassives.b.includes(id))
    const lines = [
      { side: 'A', source: parentPassives.a, keep: aLine },
      { side: 'B', source: parentPassives.b, keep: bLine },
    ].filter((line) => line.keep.length > 0)
    const steps: StrategyStep[] = []
    for (const line of lines) {
      const unwanted = line.source.filter((id) => !line.keep.includes(id))
      if (unwanted.length === 0) continue
      steps.push({
        title: `CLEAN PARENT ${line.side}'S LINE`,
        body: `Use a clean opposite-sex partner and keep ${line.keep.map(nameOf).join(' + ')} only; remove ${unwanted.map(nameOf).join(' + ')}.`,
        chance: exactPassiveOdds(line.source.length, line.keep.length),
      })
    }
    steps.push({
      title: 'MERGE THE CLEAN CARRIERS',
      body: `Breed the two cleaned lines together and keep ${desired.map(nameOf).join(' + ')} with no extras. Use opposite-sex carriers.`,
      chance: exactPassiveOdds(desired.length, desired.length),
    })
    return {
      summary: 'The selected passives are split across the parents, so preserve each clean line before merging them.',
      steps,
    }
  }, [desired, nameOf, parentPassives.a, parentPassives.b])

  return (
    <div className="odds-panel">
      <div className="picker-row">
        <PassivePicker
          key={`a-${a}`}
          side="a"
          palName={ds.pals[a].name}
          picked={parentPassives.a}
          gender={parentGenders.a}
          individuals={bySpecies[a]?.individuals ?? []}
          ownedCount={bySpecies[a]?.count ?? 0}
          options={options}
          nameOf={nameOf}
          tierOf={tierOf}
          onChange={(ids) => setParentPassives('a', ids)}
          onGenderChange={(gender) => setParentGender('a', gender)}
        />
        <PassivePicker
          key={`b-${b}`}
          side="b"
          palName={ds.pals[b].name}
          picked={parentPassives.b}
          gender={parentGenders.b}
          individuals={bySpecies[b]?.individuals ?? []}
          ownedCount={bySpecies[b]?.count ?? 0}
          options={options}
          nameOf={nameOf}
          tierOf={tierOf}
          onChange={(ids) => setParentPassives('b', ids)}
          onGenderChange={(gender) => setParentGender('b', gender)}
        />
      </div>

      <section className="guidance-card" aria-labelledby="build-guidance-title">
        <div className="guidance-head">
          <div>
            <div className="label-caps" id="build-guidance-title">
              BEGINNER GUIDANCE
            </div>
            <p>Community-curated suggestions, not a universal tier list. Your Pal&apos;s job decides what is useful.</p>
          </div>
          <label className="role-select-label">
            <span className="label-caps">BUILD FOR</span>
            <select
              className="role-select"
              aria-label="choose passive build role"
              value={role}
              onChange={(event) => setRole(event.target.value as PassiveRole)}
            >
              {(Object.keys(PASSIVE_ROLE_LABELS) as PassiveRole[]).map((id) => (
                <option key={id} value={id}>
                  {PASSIVE_ROLE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {union.length === 0 ? (
          <p className="panel-note">load an owned copy or declare passives to get suggestions</p>
        ) : suggestions.length === 0 ? (
          <p className="panel-note">
            {role === 'unsure'
              ? 'none of these passives is Rainbow-ranked — choose a role for more specific guidance'
              : `none of these passives is a broad ${PASSIVE_ROLE_LABELS[role].toLowerCase()} recommendation`}
          </p>
        ) : (
          <div className="suggestion-row">
            <span>
              Suggested from these parents: <strong>{suggestions.map((p) => p.name).join(' + ')}</strong>
            </span>
            <button type="button" className="option-btn" onClick={() => setDesiredPassives(suggestions.map((p) => p.id))}>
              KEEP SUGGESTED
            </button>
          </div>
        )}
      </section>

      <div className="desired-picker">
        <div className="label-caps">KEEP IN THE LINE</div>
        {union.length === 0 ? (
          <p className="panel-note">declare each parent&apos;s passives above — the pool is what a child can inherit</p>
        ) : (
          <div className="option-row">
            {union.map((id) => {
              const tier = tierOf(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`chip-text passive-choice passive-tier-${tier.tone}${desired.includes(id) ? ' chip-on' : ''}`}
                  aria-pressed={desired.includes(id)}
                  disabled={!desired.includes(id) && desired.length >= MAX_PARENT_PASSIVES}
                  onClick={() =>
                    setDesiredPassives(desired.includes(id) ? desired.filter((x) => x !== id) : [...desired, id])
                  }
                >
                  {nameOf(id)} · {tier.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="result-card odds-card">
        {union.length === 0 || desired.length === 0 ? (
          <p className="panel-note">
            {union.length === 0 ? 'no passives declared yet' : 'pick which pooled passives you want to keep'}
          </p>
        ) : (
          <>
            <div className="odds-big">{percent(inclusiveOdds)}</div>
            <p className="cond-line">
              inherits all {desired.length} selected passives; extra inherited passives allowed
            </p>
            <div className="clean-odds">
              <span className="label-caps">EXACT CLEAN SET</span>
              <strong>{percent(exactOdds)}</strong>
              <span>{attemptCopy(exactOdds)}</span>
            </div>
          </>
        )}
        <p className="odds-caveat">
          Direct-inheritance model only; random-fill passives, cake modifiers and required offspring sex are not
          included. Egg counts are estimates, not guarantees.
        </p>
        <p className="odds-caveat">
          IVs inherit independently per stat: 30% father · 30% mother · 40% random roll.
        </p>
      </div>

      {strategy !== null && (
        <section className="breed-plan" aria-labelledby="breed-plan-title">
          <div className="breed-plan-head">
            <div>
              <div className="label-caps" id="breed-plan-title">
                BREEDING APPROACH
              </div>
              <p>{strategy.summary}</p>
            </div>
            <div className="direct-result">
              <span className="label-caps">DIRECT PAIR</span>
              {sameKnownSex ? (
                <strong>same sex — cannot breed directly</strong>
              ) : childNames.length === 0 ? (
                <strong>selected sexes do not match this gender-locked combo</strong>
              ) : (
                <strong>→ {childNames.join(' or ')}</strong>
              )}
            </div>
          </div>

          {!sameKnownSex && childNames.length > 0 && (
            <div className="direct-option">
              <strong>Try them directly:</strong> exact selected set {percent(exactOdds)} per egg · {attemptCopy(exactOdds)}
            </div>
          )}

          {forced.length > 0 && (
            <p className="plan-warning">
              Child species can force {forced.map(nameOf).join(' + ')}; the clean-set estimate above does not include
              forced passives.
            </p>
          )}

          {strategy.steps.length === 0 ? (
            <p className="plan-ready">This is already a clean donor. Preserve its opposite-sex counterpart when you hatch one.</p>
          ) : (
            <ol className="plan-steps">
              {strategy.steps.map((step, index) => (
                <li key={`${step.title}-${index}`} className="plan-step">
                  <span className="step-num">STEP {index + 1}</span>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                  <span className="plan-estimate">
                    passive roll {percent(step.chance)} · {attemptCopy(step.chance)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="plan-caveat">
            This is a passive-cleanup strategy, not a target-species route. Pick clean partners whose child does not
            force an unwanted passive; actual egg counts vary widely.
          </p>
        </section>
      )}
    </div>
  )
}
