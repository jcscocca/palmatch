import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import type { Dataset } from '../../engine/types.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { DatasetContext } from '../dataset-context.ts'
import { ComboTable } from './ComboTable.tsx'
import { comboRowsFor, parentRowsFor } from './combo-rows.ts'
import type { ComboRow } from './combo-rows.ts'

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

function show(rows: ComboRow[], cap?: number) {
  render(
    <DatasetContext value={ds}>
      <ComboTable rows={rows} cap={cap} />
    </DatasetContext>,
  )
}

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table')
  return within(table).getAllByRole('row').slice(1) // drop the header row
}

describe('ComboTable', () => {
  it('lists the parent pairs that breed a target, badged', () => {
    const rows = parentRowsFor(ds, idx('Relaxaurus Lux'))
    show(rows)

    expect(screen.getByText(`${rows.length} combos`)).toBeTruthy()
    const row = screen.getByText('Sparkit').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Relaxaurus')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('UNIQUE')).toBeTruthy()
    // Self-pairs earn both badges; the rest of the table proves same-species renders too.
    expect(screen.getByText('SAME SPECIES')).toBeTruthy()
  })

  it('filters by name against either parent', () => {
    const rows = comboRowsFor(ds, idx('Lamball'))
    show(rows)
    expect(bodyRows()).toHaveLength(rows.length)

    fireEvent.change(screen.getByLabelText('filter combos by pal name'), { target: { value: 'foxparks' } })

    // Foxparks and Foxparks Cryst both survive — the filter is a substring, not an exact name.
    const narrowed = bodyRows()
    expect(narrowed.length).toBeGreaterThan(0)
    expect(narrowed.length).toBeLessThan(rows.length)
    for (const row of narrowed) expect(row.textContent).toContain('Foxparks')
    expect(screen.getByText(`${narrowed.length} combos of ${rows.length}`)).toBeTruthy()
  })

  it('filters by type chip and reports an empty result rather than an empty table', () => {
    show(parentRowsFor(ds, idx('Relaxaurus Lux')))

    fireEvent.click(screen.getByLabelText('filter ice'))
    expect(screen.getByText('no combos match this filter')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('filter ice'))
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('shows a child column for A-combos and promotes any cell', () => {
    const lamball = idx('Lamball')
    useWorkbenchStore.getState().setSlot('a', lamball)
    show(comboRowsFor(ds, lamball))
    expect(screen.getByText('CHILD')).toBeTruthy()

    // Lamball breeds *into* Foxparks as well as with it, so narrow to a single row first.
    fireEvent.change(screen.getByLabelText('filter combos by pal name'), { target: { value: 'foxparks cryst' } })
    const rows = bodyRows()
    expect(rows).toHaveLength(1)
    fireEvent.click(within(rows[0]).getByLabelText('set as Parent B (Foxparks Cryst)'))

    expect(useWorkbenchStore.getState().slotB).toBe(idx('Foxparks Cryst'))
  })

  it('caps rendered rows with an explicit count of what is hidden', () => {
    const rows = comboRowsFor(ds, idx('Lamball'))
    show(rows, 10)

    expect(bodyRows()).toHaveLength(10)
    expect(screen.getByText(`…${rows.length - 10} more pairs not shown — narrow with the filter`)).toBeTruthy()
  })

  it('spells out the gender requirement on a gender-locked row', () => {
    const rows = parentRowsFor(ds, idx('Katress Ignis'))
    show(rows)

    const pill = screen.getByText('♀♂ LOCKED')
    expect(pill.getAttribute('title')).toBe('♀ Katress × ♂ Wixen')
  })
})
