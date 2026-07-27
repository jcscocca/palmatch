import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import type { Dataset } from '../engine/types.ts'
import { useOwnedStore } from '../state/owned.ts'
import { useWorkbenchStore } from '../state/store.ts'
import { DatasetContext } from './dataset-context.ts'
import { Workbench } from './Workbench.tsx'

let ds: Dataset

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

beforeEach(() => {
  useWorkbenchStore.getState().clearAll()
  useOwnedStore.getState().clearOwned()
})

afterEach(cleanup)

function renderWorkbench(): void {
  render(
    <DatasetContext value={ds}>
      <Workbench />
    </DatasetContext>,
  )
}

/** The palette renders as a `<dialog aria-label="search pals">` — see SearchPalette.tsx. */
function palette(): HTMLElement | null {
  return screen.queryByLabelText('search pals')
}

describe('Workbench keyboard shortcuts', () => {
  it('/ opens the search palette', () => {
    renderWorkbench()
    expect(palette()).toBeNull()
    fireEvent.keyDown(window, { key: '/' })
    expect(palette()).not.toBeNull()
  })

  it('Cmd-K opens the search palette', () => {
    renderWorkbench()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(palette()).not.toBeNull()
  })

  it('Ctrl-K opens the search palette', () => {
    renderWorkbench()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(palette()).not.toBeNull()
  })

  it('a bare "k" without a modifier does not open the palette', () => {
    renderWorkbench()
    fireEvent.keyDown(window, { key: 'k' })
    expect(palette()).toBeNull()
  })

  it('Escape closes an open palette', () => {
    renderWorkbench()
    fireEvent.keyDown(window, { key: '/' })
    expect(palette()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(palette()).toBeNull()
  })

  it('isTyping guard: a shortcut key typed into an already-focused text field does not open the palette', () => {
    renderWorkbench()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(document.activeElement).toBe(input)

    // Dispatched on the input itself (not `window`) so it bubbles up to the workbench's window
    // listener the same way a real keystroke would, with `e.target` genuinely the focused field.
    fireEvent.keyDown(input, { key: '/' })
    expect(palette()).toBeNull()

    input.remove()
  })

  it('the import panel takes the keyboard from the palette shortcuts while it is open', () => {
    renderWorkbench()
    fireEvent.click(screen.getByText('MY PALS'))
    expect(screen.queryByLabelText('my pals')).not.toBeNull()

    fireEvent.keyDown(window, { key: '/' })
    expect(palette()).toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('my pals')).toBeNull()
  })

  it('the open palette owns the keyboard: typing an ordinary letter into its input does not close or reopen it', () => {
    renderWorkbench()
    fireEvent.keyDown(window, { key: '/' })
    const input = screen.getByLabelText('search pals by name or dex')

    // A real keydown on the input bubbles to the same window listener the shortcut is bound
    // to — `l` is not itself a shortcut key, but this also covers `/` being retyped as a query
    // character while already open, which is: the workbench must not treat it as "reopen".
    fireEvent.keyDown(input, { key: 'l' })
    fireEvent.keyDown(input, { key: '/' })

    expect(screen.getAllByLabelText('search pals')).toHaveLength(1)
  })
})

describe('MY PALS header button', () => {
  it('opens the import panel', () => {
    renderWorkbench()
    expect(screen.queryByLabelText('my pals')).toBeNull()
    fireEvent.click(screen.getByText('MY PALS'))
    expect(screen.queryByLabelText('my pals')).not.toBeNull()
  })

  it('carries the owned species count once a list exists', () => {
    useOwnedStore.getState().loadShared(
      [
        [1, 4],
        [2, 1],
      ],
      'shared list',
    )
    renderWorkbench()
    expect(screen.getByText('MY PALS · 2')).toBeTruthy()
  })

  it('opens straight onto the confirm step for a #/own/ share link', () => {
    render(
      <DatasetContext value={ds}>
        <Workbench shareBlob="not-a-real-blob" />
      </DatasetContext>,
    )
    expect(screen.queryByLabelText('my pals')).not.toBeNull()
    expect(screen.getByText(/shared list is damaged/)).toBeTruthy()
  })
})
