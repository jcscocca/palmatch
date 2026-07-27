import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
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
      <SearchPalette open forSlot={forSlot} onClose={onClose} />
    </DatasetContext>,
  )
  return screen.getByLabelText('search pals by name or dex')
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

describe('SearchPalette', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <DatasetContext value={ds}>
        <SearchPalette open={false} forSlot={null} onClose={() => {}} />
      </DatasetContext>,
    )
    expect(container.innerHTML).toBe('')
  })

  it('lists matches for a partial name', () => {
    const input = open('a')
    expect(screen.queryByText('Lamball')).toBeNull()
    type(input, 'lam')
    expect(screen.getByText('Lamball')).toBeTruthy()
  })

  it('Enter sends the active row to the bound slot and closes', () => {
    const onClose = vi.fn()
    const input = open('a', onClose)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useWorkbenchStore.getState().slotA).toBe(lamball)
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

  it('arrow keys move the active row before Enter', () => {
    const input = open('a')
    type(input, 'la')
    const rows = screen.getAllByRole('button').filter((el) => el.className.startsWith('result-row'))
    expect(rows.length).toBeGreaterThan(1)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    const picked = useWorkbenchStore.getState().slotA
    expect(picked).not.toBe(null)
    expect(picked).not.toBe(lamball)
  })

  it('digit keys send the active row to A / B / target', () => {
    useWorkbenchStore.getState().setSlot('a', foxparks)
    const onClose = vi.fn()
    const input = open('a', onClose)
    type(input, 'lam')
    fireEvent.keyDown(input, { key: '2' })
    expect(useWorkbenchStore.getState().slotB).toBe(lamball)
    expect(onClose).toHaveBeenCalled()
    cleanup()

    const input2 = open('a')
    type(input2, 'lam')
    fireEvent.keyDown(input2, { key: '3' })
    expect(useWorkbenchStore.getState().target).toBe(lamball)
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

  it('rows use BASE_URL-resolved sprites and fall back to a lettered silhouette', () => {
    const input = open('a')
    type(input, 'lam')
    const sprite = screen.getByAltText('Lamball')
    expect(sprite.getAttribute('src')).toBe(ds.pals[lamball].sprite)
    fireEvent.error(sprite)
    expect(screen.queryByAltText('Lamball')).toBeNull()
    expect(screen.getByText('L')).toBeTruthy()
  })
})
