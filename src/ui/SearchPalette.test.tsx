import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import { searchPals } from '../engine/search.ts'
import type { Dataset } from '../engine/types.ts'
import { useWorkbenchStore } from '../state/store.ts'
import { DatasetContext } from './dataset-context.ts'
import { SearchPalette } from './SearchPalette.tsx'

let ds: Dataset
let lamball: number
let foxparks: number

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
  lamball = ds.pals.findIndex((p) => p.name === 'Lamball')
  foxparks = ds.pals.findIndex((p) => p.name === 'Foxparks')
  expect(lamball).toBeGreaterThanOrEqual(0)
  expect(foxparks).toBeGreaterThanOrEqual(0)
})

beforeEach(() => {
  useWorkbenchStore.getState().clearAll()
})

afterEach(cleanup)

function open(forSlot: 'a' | 'b' | 't' | null, onClose: () => void = () => {}) {
  render(
    <DatasetContext value={ds}>
      <SearchPalette forSlot={forSlot} onClose={onClose} />
    </DatasetContext>,
  )
  return screen.getByLabelText('search pals by name or dex')
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

/** The rows the palette should be showing for `query`, straight from the engine. */
function expected(query: string): number[] {
  return searchPals(ds.pals, query)
}

describe('SearchPalette', () => {
  it('lists matches for a partial name', () => {
    const input = open('a')
    expect(screen.queryByText('Lamball')).toBeNull()
    type(input, 'lam')
    expect(screen.getByText('Lamball')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(expected('lam').length)
  })

  it('Enter sends the active row to the bound slot and closes', () => {
    const onClose = vi.fn()
    const input = open('a', onClose)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useWorkbenchStore.getState().slotA).toBe(expected('lam')[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('Enter lands on slot A when the palette was opened generally', () => {
    const input = open(null)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useWorkbenchStore.getState().slotA).toBe(lamball)
  })

  it('clicking a row picks that pal', () => {
    const onClose = vi.fn()
    const input = open('t', onClose)
    type(input, 'lam')
    fireEvent.click(screen.getByText('Lamball'))
    expect(useWorkbenchStore.getState().target).toBe(lamball)
    expect(onClose).toHaveBeenCalled()
  })

  it('arrow keys move the active option', () => {
    const input = open('a')
    type(input, 'la')
    const rows = expected('la')
    expect(rows.length).toBeGreaterThan(1)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-1')
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useWorkbenchStore.getState().slotA).toBe(rows[1])
  })

  it('digit keys send the active row to A / B / target', () => {
    useWorkbenchStore.getState().setSlot('a', foxparks)
    const onClose = vi.fn()
    const input = open('a', onClose)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: '2' })
    expect(useWorkbenchStore.getState().slotB).toBe(expected('lam')[0])
    expect(onClose).toHaveBeenCalled()
    cleanup()

    const input2 = open('a')
    type(input2, 'lam')
    fireEvent.keyDown(input2, { key: '3' })
    expect(useWorkbenchStore.getState().target).toBe(expected('lam')[0])
  })

  it('a digit picks the second result once the active row has moved', () => {
    const input = open('t')
    type(input, 'la')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: '3' })
    expect(useWorkbenchStore.getState().target).toBe(expected('la')[1])
  })

  it('digits still type into an all-digit (dex) query', () => {
    const input = open('a')
    type(input, '1')
    fireEvent.keyDown(input, { key: '2' })
    expect(useWorkbenchStore.getState().slotA).toBe(null)
  })

  it('Escape closes without picking', () => {
    const onClose = vi.fn()
    const input = open('a', onClose)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(useWorkbenchStore.getState().slotA).toBe(null)
  })

  it('type chips filter results and toggle off again', () => {
    const input = open('a')
    type(input, 'lam')
    const fire = screen.getByLabelText('filter fire')
    fireEvent.click(fire)
    expect(fire.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('Lamball')).toBeNull() // Lamball is normal-type
    fireEvent.click(fire)
    expect(screen.getByText('Lamball')).toBeTruthy()
  })

  it('opens as a modal dialog and restores focus to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = render(
      <DatasetContext value={ds}>
        <SearchPalette forSlot="a" onClose={() => {}} />
      </DatasetContext>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('search pals by name or dex'))

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('rows use BASE_URL-resolved sprites and fall back to a lettered silhouette', () => {
    const input = open('a')
    type(input, 'lam')
    const row = screen.getAllByRole('option')[0]
    const sprite = row.querySelector('.pal-sprite')
    expect(sprite).not.toBeNull()
    expect(sprite?.getAttribute('src')).toBe(ds.pals[lamball].sprite)
    fireEvent.error(sprite as Element)
    expect(row.querySelector('.pal-sprite')).toBeNull()
    expect(row.querySelector('.silhouette')?.textContent).toBe('L')
  })
})
