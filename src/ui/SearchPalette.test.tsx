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
  it('opens with every pal in an alphabetized photo grid', () => {
    open('a')
    const list = screen.getByRole('listbox', { name: 'all pals alphabetically' })
    const options = screen.getAllByRole('option')
    const expectedNames = ds.pals.map((pal) => pal.name).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))

    expect(list.classList.contains('result-grid')).toBe(true)
    expect(options).toHaveLength(ds.pals.length)
    expect(options.map((option) => option.querySelector('.pal-name')?.textContent)).toEqual(expectedNames)
    expect(options[0].querySelector('.pal-sprite')).not.toBeNull()
  })

  it('lists matches for a partial name', () => {
    const input = open('a')
    expect(screen.getByText('Lamball')).toBeTruthy()
    type(input, 'lam')
    expect(screen.getByText('Lamball')).toBeTruthy()
    expect(screen.getByRole('listbox', { name: 'search results' }).classList.contains('result-grid')).toBe(false)
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

  it('ArrowUp from the first result wraps around to the last', () => {
    const input = open('a')
    type(input, 'la')
    const rows = searchPals(ds.pals, 'la')
    expect(rows.length).toBeGreaterThan(1)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.getAttribute('aria-activedescendant')).toBe(`palette-option-${rows.length - 1}`)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useWorkbenchStore.getState().slotA).toBe(rows[rows.length - 1])
  })

  it('digit 2 sends the active (first) row to slot B', () => {
    useWorkbenchStore.getState().setSlot('a', foxparks)
    const onClose = vi.fn()
    const input = open('a', onClose)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: '2' })
    expect(useWorkbenchStore.getState().slotB).toBe(searchPals(ds.pals, 'lam')[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('digit 3 sends the active (first) row to the target', () => {
    const input = open('a')
    type(input, 'lam')
    fireEvent.keyDown(input, { key: '3' })
    expect(useWorkbenchStore.getState().target).toBe(searchPals(ds.pals, 'lam')[0])
  })

  it('digit 2 promotes the second result to slot B once the active row has moved', () => {
    // slotB only holds a value while slotA is filled — normalizeSlots otherwise promotes it to A.
    useWorkbenchStore.getState().setSlot('a', foxparks)
    const input = open('a')
    type(input, 'la')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: '2' })
    expect(useWorkbenchStore.getState().slotB).toBe(searchPals(ds.pals, 'la')[1])
  })

  it('digit 3 promotes the second result to the target once the active row has moved', () => {
    const input = open('t')
    type(input, 'la')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: '3' })
    expect(useWorkbenchStore.getState().target).toBe(searchPals(ds.pals, 'la')[1])
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

  it('only dismisses on a backdrop click that also started on the backdrop', () => {
    const onClose = vi.fn()
    const input = open('a', onClose)
    const dialog = screen.getByLabelText('search pals')

    // Text dragged out of the input and released outside is a selection, not a dismissal.
    fireEvent.mouseDown(input)
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalled()
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
