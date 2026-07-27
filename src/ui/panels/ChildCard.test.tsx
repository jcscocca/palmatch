import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { breed } from '../../engine/breed.ts'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import type { Dataset } from '../../engine/types.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { DatasetContext } from '../dataset-context.ts'
import { ChildCard } from './ChildCard.tsx'

let ds: Dataset

function idx(name: string): number {
  const i = ds.pals.findIndex((p) => p.name === name)
  expect(i).toBeGreaterThanOrEqual(0)
  return i
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

beforeEach(() => {
  useWorkbenchStore.getState().clearAll()
})

afterEach(cleanup)

function show(a: number, b: number) {
  render(
    <DatasetContext value={ds}>
      <ChildCard a={a} b={b} />
    </DatasetContext>,
  )
}

describe('ChildCard', () => {
  it('renders the child of an ordinary pair with its condition and male chance', () => {
    const a = idx('Foxparks')
    const b = idx('Bristla')
    const [result] = breed(ds, a, b)
    const child = ds.pals[result.child]

    show(a, b)

    expect(screen.getByText(child.name)).toBeTruthy()
    expect(screen.getByText('standard combo')).toBeTruthy()
    expect(screen.getByText(`♂ ${Math.round(child.maleProb * 100)}%`)).toBeTruthy()
  })

  it('renders both gender rows for the gender-locked pair', () => {
    const a = idx('Katress')
    const b = idx('Wixen')
    const results = breed(ds, a, b)
    expect(results).toHaveLength(2)

    show(a, b)

    expect(screen.getByText('♀ Katress × ♂ Wixen →')).toBeTruthy()
    expect(screen.getByText('♂ Katress × ♀ Wixen →')).toBeTruthy()
    for (const result of results) expect(screen.getByText(ds.pals[result.child].name)).toBeTruthy()
    expect(screen.getAllByText('gender-locked combo')).toHaveLength(2)
  })

  it('badges a unique combo', () => {
    const a = idx('Relaxaurus')
    const b = idx('Sparkit')
    show(a, b)
    expect(screen.getByText('UNIQUE COMBO')).toBeTruthy()
    expect(screen.getByText('Relaxaurus Lux')).toBeTruthy()
  })

  it('promotes the child into a slot', () => {
    const a = idx('Foxparks')
    const b = idx('Bristla')
    const [result] = breed(ds, a, b)

    show(a, b)
    const card = screen.getByText(ds.pals[result.child].name).closest('.result-card')
    expect(card).not.toBeNull()
    fireEvent.click(within(card as HTMLElement).getByLabelText(`set as Target (${ds.pals[result.child].name})`))

    expect(useWorkbenchStore.getState().target).toBe(result.child)
  })
})
