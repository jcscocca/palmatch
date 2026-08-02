import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findParents } from '../../engine/breed.ts'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import type { Dataset } from '../../engine/types.ts'
import { useOwnedStore } from '../../state/owned.ts'
import { useWorkbenchStore } from '../../state/store.ts'
import { DatasetContext } from '../dataset-context.ts'
import { ResultTabs } from './ResultTabs.tsx'

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
  useOwnedStore.getState().clearOwned()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** ChainView builds a real module worker when it mounts, which jsdom has no answer for. */
class SilentWorker {
  onmessage: unknown = null
  onerror: unknown = null
  postMessage(): void {}
  terminate(): void {}
}

function own(...names: string[]): void {
  useOwnedStore.getState().loadShared(names.map((name) => [idx(name), 1]))
}

function show() {
  render(
    <DatasetContext value={ds}>
      <ResultTabs />
    </DatasetContext>,
  )
}

function pair(): void {
  useWorkbenchStore.getState().setSlot('a', idx('Foxparks'))
  useWorkbenchStore.getState().setSlot('b', idx('Bristla'))
}

describe('ResultTabs', () => {
  it('offers the pair tabs and opens on the child panel', () => {
    pair()
    show()

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'CHILD',
      'MUTATIONS',
      'PASSIVE PLAN',
      'ALL A-COMBOS',
    ])
    expect(screen.getByRole('tabpanel').id).toBe('result-panel')
    // Every tab points at the one panel element, whichever tab is selected.
    for (const tab of screen.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe('result-panel')
    expect(screen.getByText('standard combo')).toBeTruthy()
  })

  it('switches panels on click', () => {
    pair()
    show()

    fireEvent.click(screen.getByRole('tab', { name: 'MUTATIONS' }))
    expect(useWorkbenchStore.getState().tab).toBe('mutations')
    expect(screen.getByText('COMMUNITY MODEL')).toBeTruthy()
  })

  it('moves between tabs with the arrow keys, keeping one tab stop', () => {
    pair()
    show()

    const [child, mutations] = screen.getAllByRole('tab')
    expect(child.getAttribute('tabindex')).toBe('0')
    expect(mutations.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(child, { key: 'ArrowRight' })
    expect(useWorkbenchStore.getState().tab).toBe('mutations')
    expect(document.activeElement).toBe(mutations)
    expect(mutations.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(mutations, { key: 'ArrowLeft' })
    expect(useWorkbenchStore.getState().tab).toBe('child')
    expect(document.activeElement).toBe(child)
  })

  it('counts the parent combos in the target tab label', () => {
    const target = idx('Relaxaurus Lux')
    useWorkbenchStore.getState().setSlot('t', target)
    show()

    const count = findParents(ds, target).length
    expect(screen.getByRole('tab', { name: `PARENT COMBOS (${count})` })).toBeTruthy()
    expect(screen.getByText(`${count} combos`)).toBeTruthy()
  })

  it('does not carry a combo filter from one tab into another', () => {
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()
    fireEvent.change(screen.getByLabelText('filter combos by pal name'), { target: { value: 'sparkit' } })

    // Both tabs render a ComboTable; unkeyed, React would hand the next one the same instance —
    // and its filter — which is what a shared link or a back/forward step lands on.
    act(() => {
      useWorkbenchStore.getState().setSlot('t', null)
      useWorkbenchStore.getState().setSlot('a', idx('Lamball'))
    })

    expect(screen.getByRole('tab', { name: 'ALL A-COMBOS' }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByLabelText('filter combos by pal name') as HTMLInputElement).value).toBe('')
  })

  it('shows special combinations when nothing is picked', () => {
    show()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'SPECIAL COMBINATIONS' })).toBeTruthy()
    expect(screen.getByText('88 RECIPES')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    const recipeRows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(recipeRows.length).toBeGreaterThan(10)
    expect(screen.queryByLabelText('filter combos by pal name')).toBeNull()
    expect(screen.getByText('Frostallion Noct')).toBeTruthy()
    expect((screen.getByLabelText('sort special combinations') as HTMLSelectElement).value).toBe('breeding-rank')

    fireEvent.click(within(recipeRows[0]).getByLabelText('set as Parent A (Helzephyr)'))
    expect(useWorkbenchStore.getState().slotA).toBe(idx('Helzephyr'))
    expect(screen.getByRole('tab', { name: 'ALL A-COMBOS' })).toBeTruthy()
  })

  it('sorts special combinations by biggest rank jump', () => {
    show()
    const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(bodyRows()[0].textContent).toContain('Frostallion Noct')

    fireEvent.change(screen.getByLabelText('sort special combinations'), { target: { value: 'rank-jump' } })

    expect(screen.getByText('Largest rank improvement over the stronger parent first.')).toBeTruthy()
    expect(bodyRows()[0].textContent).toContain('Loupmoon Cryst')
  })

  it('adds a CHAINS tab to target mode only for a player who owns pals', () => {
    const target = idx('Relaxaurus Lux')
    useWorkbenchStore.getState().setSlot('t', target)
    show()
    expect(screen.queryByRole('tab', { name: 'CHAINS' })).toBeNull()

    // The owned list is what makes a chain answerable without a starter slot, so the tab it earns
    // appears without the workbench mode changing at all.
    cleanup()
    own('Lamball', 'Chikipi')
    show()

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs[tabs.length - 1]).toBe('CHAINS')
    // Appended, not promoted: the tab the mode already opened on stays the default.
    const count = findParents(ds, target).length
    expect(screen.getByRole('tab', { name: `PARENT COMBOS (${count})` }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens the owned chains panel from that tab', () => {
    vi.stubGlobal('Worker', SilentWorker)
    own('Lamball', 'Chikipi')
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    show()

    fireEvent.click(screen.getByRole('tab', { name: 'CHAINS' }))
    expect(useWorkbenchStore.getState().tab).toBe('chains')
    expect(screen.getByText('2 owned species as starters')).toBeTruthy()
  })

  it('drops a shared chains tab when the recipient owns nothing', () => {
    useWorkbenchStore.getState().setSlot('t', idx('Relaxaurus Lux'))
    // What `#/t/relaxaurus_lux@chains` decodes to: a tab the sharer's palbox earned and this
    // browser's cannot show.
    useWorkbenchStore.setState({ tab: 'chains' })
    show()

    expect(useWorkbenchStore.getState().tab).toBe(null)
    expect(screen.getByRole('tab', { name: /PARENT COMBOS/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the special-combos front page when the player owns pals', () => {
    show()
    expect(screen.getByRole('heading', { name: 'SPECIAL COMBINATIONS' })).toBeTruthy()

    cleanup()
    own('Lamball')
    show()
    expect(screen.getByRole('heading', { name: 'SPECIAL COMBINATIONS' })).toBeTruthy()
  })

  it('drops a tab id that does not belong to the current mode', () => {
    pair()
    // Straight into the store: `setSlot` clears the tab itself, and this is the shared-link case.
    useWorkbenchStore.setState({ tab: 'chains' })
    show()

    expect(useWorkbenchStore.getState().tab).toBe(null)
    expect(screen.getByRole('tab', { name: 'CHILD' }).getAttribute('aria-selected')).toBe('true')
  })
})
