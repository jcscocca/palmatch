import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import { mutationPool, reverseMutation } from '../../engine/mutation.ts'
import type { Dataset } from '../../engine/types.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { DatasetContext } from '../dataset-context.ts'
import { MutationPanel, ViaMutation } from './MutationPanel.tsx'

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

function wrap(node: ReactNode) {
  render(<DatasetContext value={ds}>{node}</DatasetContext>)
}

describe('MutationPanel', () => {
  it('lists the pool with a weight per outcome', () => {
    const a = idx('Foxparks')
    const b = idx('Bristla')
    const pool = mutationPool(ds, a, b)
    wrap(<MutationPanel a={a} b={b} />)

    expect(screen.getByText(`${pool.length} possible mutations`)).toBeTruthy()
    expect(document.querySelectorAll('.mut-row')).toHaveLength(pool.length)
    const top = pool[0]
    const topRow = screen.getByText(ds.pals[top.child].name).closest('.mut-row')
    expect(topRow?.querySelector('.mut-weight')?.textContent).toBe(`${Math.round(top.weight * 100)}%`)
  })

  it('floors sub-percent weights at <1% instead of rounding them to nothing', () => {
    const a = idx('Melpaca')
    const b = idx('Vanwyrm')
    const pool = mutationPool(ds, a, b)
    const tail = pool[pool.length - 1]
    expect(tail.weight).toBeLessThan(0.01)

    wrap(<MutationPanel a={a} b={b} />)
    const row = screen.getByText(ds.pals[tail.child].name).closest('.mut-row')
    expect(row?.querySelector('.mut-weight')?.textContent).toBe('<1%')
  })

  it('labels the model as community-estimated and prints the cake chances', () => {
    wrap(<MutationPanel a={idx('Foxparks')} b={idx('Bristla')} />)

    expect(screen.getByText('COMMUNITY MODEL')).toBeTruthy()
    const disclaimer = document.querySelector('.disclaimer')
    expect(disclaimer?.textContent).toContain(ds.mutation.source)
    expect(disclaimer?.textContent).toContain('player-measured estimates, not datamined values')

    // Pool weights land on whole percents too, so the chances are read out of their own table.
    const chances = within(screen.getByRole('table'))
    expect(chances.getByText('no cake').nextElementSibling?.textContent).toBe('1%')
    expect(chances.getByText('Vegetable Cake').nextElementSibling?.textContent).toBe('2%')
    expect(chances.getByText('Extravagant Vegetable Cake').nextElementSibling?.textContent).toBe('3%')
  })
})

describe('ViaMutation', () => {
  it('caps the rendered pairs and says how many it is holding back', () => {
    const target = idx('Relaxaurus Lux')
    const pairs = reverseMutation(ds, target)
    expect(pairs.length).toBeGreaterThan(100)

    wrap(<ViaMutation target={target} />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(100)
    expect(screen.getByText(`…${pairs.length - 100} more pairs not shown — narrow with the filter`)).toBeTruthy()
    expect(screen.getByText('COMMUNITY MODEL')).toBeTruthy()
  })
})
