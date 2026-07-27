import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import { passiveOdds } from '../../engine/passives.ts'
import type { Dataset, PassiveRecord } from '../../engine/types.ts'
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

    expect(screen.getByText('pick which pooled passives you want')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: picks[0].name, pressed: false }))

    expect(passiveOdds(4, 1)).toBe(0.5)
    expect(document.querySelector('.odds-big')?.textContent).toBe('50%')
    expect(screen.getByText('P(child directly inherits all 1 of 4 pooled passives)')).toBeTruthy()
    expect(useWorkbenchStore.getState().desiredPassives).toEqual([picks[0].id])
  })

  it('drops a desired passive when the parent carrying it loses it', () => {
    const picks = fourPool()
    useWorkbenchStore.getState().setDesiredPassives([picks[0].id, picks[2].id])
    show()

    fireEvent.click(screen.getByLabelText(`remove ${picks[0].name} from parent A`))

    expect(useWorkbenchStore.getState().parentPassives.a).toEqual([picks[1].id])
    expect(useWorkbenchStore.getState().desiredPassives).toEqual([picks[2].id])
    expect(screen.getByText('P(child directly inherits all 1 of 3 pooled passives)')).toBeTruthy()
  })

  it('adds passives from the search box and stops at four per parent', () => {
    show()
    const search = screen.getByLabelText('search passives for parent A')
    // Both parents offer the same passives, so the options are read out of parent A's picker.
    const pickerA = search.closest('.passive-picker') as HTMLElement
    fireEvent.change(search, { target: { value: pool[0].name.slice(0, 4).toLowerCase() } })
    fireEvent.click(within(pickerA).getByText(`+ ${pool[0].name}`))
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
    expect(screen.getByText(/direct inheritance only; random-fill passives and cake modifiers not modeled/)).toBeTruthy()
  })
})
