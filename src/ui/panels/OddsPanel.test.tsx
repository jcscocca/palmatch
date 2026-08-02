import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import { passiveOdds } from '../../engine/passives.ts'
import type { Dataset, PassiveRecord } from '../../engine/types.ts'
import { useOwnedStore } from '../../state/owned.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { DatasetContext } from '../dataset-context.ts'
import { OddsPanel } from './OddsPanel.tsx'

let ds: Dataset
let pool: PassiveRecord[]

function idx(name: string): number {
  const i = ds.pals.findIndex((p) => p.name === name)
  expect(i).toBeGreaterThanOrEqual(0)
  return i
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
  // The same set the panel offers, in the same order, so the fixtures match what renders.
  pool = ds.passives
    .filter((p) => p.randomAllowed || p.standard)
    .slice()
    .sort((x, y) => x.name.localeCompare(y.name))
  expect(pool.length).toBeGreaterThan(8)
})

beforeEach(() => {
  useWorkbenchStore.getState().clearAll()
  useOwnedStore.getState().clearOwned()
})

afterEach(cleanup)

function show() {
  render(
    <DatasetContext value={ds}>
      <OddsPanel a={idx('Foxparks')} b={idx('Bristla')} />
    </DatasetContext>,
  )
}

/** Two passives per parent, none shared — a pool of exactly four. */
function fourPool(): PassiveRecord[] {
  const picks = pool.slice(0, 4)
  useWorkbenchStore.getState().setParentPassives('a', [picks[0].id, picks[1].id])
  useWorkbenchStore.getState().setParentPassives('b', [picks[2].id, picks[3].id])
  return picks
}

describe('OddsPanel', () => {
  it('hints instead of quoting odds while the pool is empty', () => {
    show()
    expect(screen.getByText('no passives declared yet')).toBeTruthy()
    expect(document.querySelector('.odds-big')).toBeNull()
  })

  it('one wanted passive out of a four-passive pool is a coin flip', () => {
    const picks = fourPool()
    show()

    expect(screen.getByText('pick which pooled passives you want to keep')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(picks[0].name), pressed: false }))

    expect(passiveOdds(4, 1)).toBe(0.5)
    expect(document.querySelector('.odds-big')?.textContent).toBe('50%')
    expect(screen.getByText('inherits all 1 selected passives; extra inherited passives allowed')).toBeTruthy()
    expect(useWorkbenchStore.getState().desiredPassives).toEqual([picks[0].id])
  })

  it('drops a desired passive when the parent carrying it loses it', () => {
    const picks = fourPool()
    useWorkbenchStore.getState().setDesiredPassives([picks[0].id, picks[2].id])
    show()

    fireEvent.click(screen.getByLabelText(`remove ${picks[0].name} from parent A`))

    expect(useWorkbenchStore.getState().parentPassives.a).toEqual([picks[1].id])
    expect(useWorkbenchStore.getState().desiredPassives).toEqual([picks[2].id])
    expect(screen.getByText('inherits all 1 selected passives; extra inherited passives allowed')).toBeTruthy()
  })

  it('adds passives from the search box and stops at four per parent', () => {
    show()
    const search = screen.getByLabelText('search passives for parent A')
    // Both parents offer the same passives, so the options are read out of parent A's picker.
    const pickerA = search.closest('.passive-picker') as HTMLElement
    fireEvent.change(search, { target: { value: pool[0].name.slice(0, 4).toLowerCase() } })
    fireEvent.click(within(pickerA).getByRole('button', { name: new RegExp(`\\+ ${pool[0].name}`) }))
    expect(useWorkbenchStore.getState().parentPassives.a).toEqual([pool[0].id])

    act(() => {
      useWorkbenchStore.getState().setParentPassives(
        'a',
        pool.slice(0, 4).map((p) => p.id),
      )
    })
    expect((screen.getByLabelText('search passives for parent A') as HTMLInputElement).disabled).toBe(true)
    expect(within(pickerA).queryByText(`+ ${pool[4].name}`)).toBeNull()
  })

  it('keeps the caveat visible whatever the state', () => {
    show()
    expect(screen.getByText(/direct-inheritance model only; random-fill passives/i)).toBeTruthy()
  })

  it('loads a representative owned copy with its sex and passives', () => {
    const lucky = ds.passives.find((p) => p.name === 'Lucky')!
    const coward = ds.passives.find((p) => p.name === 'Coward')!
    const foxparks = idx('Foxparks')
    useOwnedStore.setState({
      bySpecies: {
        [foxparks]: {
          count: 9,
          genders: { females: 4, males: 5 },
          individuals: [{ gender: 'F', passives: [lucky.id, coward.id], talents: null }],
        },
      },
    })
    show()

    fireEvent.change(screen.getByLabelText('use owned copy for parent A'), { target: { value: '0' } })

    expect(useWorkbenchStore.getState().parentPassives.a).toEqual([lucky.id, coward.id])
    expect(useWorkbenchStore.getState().parentGenders.a).toBe('F')
    expect(screen.getByText(/showing 1 representative copies of 9/)).toBeTruthy()
    expect(screen.getByText('RAINBOW · RANK 4')).toBeTruthy()
  })

  it('turns curated role suggestions into an editable keep set', () => {
    const lucky = ds.passives.find((p) => p.name === 'Lucky')!
    const artisan = ds.passives.find((p) => p.name === 'Artisan')!
    useWorkbenchStore.getState().setParentPassives('a', [lucky.id, artisan.id])
    show()

    fireEvent.change(screen.getByLabelText('choose passive build role'), { target: { value: 'worker' } })
    expect(screen.getByText(/Suggested from these parents:/).textContent).toContain('Artisan + Lucky')
    fireEvent.click(screen.getByRole('button', { name: 'KEEP SUGGESTED' }))

    expect(useWorkbenchStore.getState().desiredPassives).toEqual([artisan.id, lucky.id])
  })

  it('frames split-passive cleanup as probabilistic gates', () => {
    const lucky = ds.passives.find((p) => p.name === 'Lucky')!
    const swift = ds.passives.find((p) => p.name === 'Swift')!
    const coward = ds.passives.find((p) => p.name === 'Coward')!
    const glutton = ds.passives.find((p) => p.name === 'Glutton')!
    useWorkbenchStore.getState().setParentPassives('a', [lucky.id, coward.id])
    useWorkbenchStore.getState().setParentPassives('b', [swift.id, glutton.id])
    useWorkbenchStore.getState().setDesiredPassives([lucky.id, swift.id])
    show()

    expect(screen.getByText(/selected passives are split across the parents/)).toBeTruthy()
    expect(screen.getAllByText(/STEP [123]/)).toHaveLength(3)
    expect(screen.getAllByText(/90% chance by/).length).toBeGreaterThan(0)
    expect(screen.getByText(/not a target-species route/)).toBeTruthy()
  })
})
