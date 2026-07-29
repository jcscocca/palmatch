import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { searchPals } from '../engine/search.ts'
import { useWorkbenchStore } from '../state/store.ts'
import { useDataset } from './dataset-context.ts'
import { PalTile } from './PalTile.tsx'
import { TypeChips } from './TypeChips.tsx'

export interface SearchPaletteProps {
  /** Slot the palette was opened for; `null` means it was opened generally (Enter lands on A). */
  forSlot: 'a' | 'b' | 't' | null
  onClose: () => void
}

const DIGIT_SLOTS: Record<string, 'a' | 'b' | 't'> = { '1': 'a', '2': 'b', '3': 't' }
const LISTBOX_ID = 'palette-listbox'
const ALPHA_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function optionId(row: number): string {
  return `palette-option-${row}`
}

/**
 * Modal pal picker. Mounted only while open (the Workbench decides), and rendered as a native
 * `<dialog>` opened with `showModal()` — that buys the focus trap, top-layer stacking and
 * background inertness for free instead of hand-rolling them.
 *
 * Focus stays in the text input the whole time; the result list is a combobox/listbox pair driven
 * by `aria-activedescendant`, so arrow keys move the active option without ever moving focus.
 */
export function SearchPalette({ forSlot, onClose }: SearchPaletteProps) {
  const ds = useDataset()
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [activeRow, setActiveRow] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const downTargetRef = useRef<EventTarget | null>(null)
  const restoreFrameRef = useRef<number | null>(null)

  const browsing = query.trim() === ''
  const results = useMemo(() => {
    if (!browsing) return searchPals(ds.pals, query, typeFilter)

    return ds.pals
      .map((pal, index) => ({ pal, index }))
      .filter(({ pal }) => typeFilter.length === 0 || pal.types.some((type) => typeFilter.includes(type)))
      .sort((a, b) => ALPHA_COLLATOR.compare(a.pal.name, b.pal.name))
      .map(({ index }) => index)
  }, [browsing, ds.pals, query, typeFilter])
  const active = results.length === 0 ? -1 : Math.min(activeRow, results.length - 1)

  useEffect(() => {
    // The focus restore below is queued from *this effect's cleanup*, so cancelling it belongs at
    // the top of the next run rather than in that same cleanup: React StrictMode tears the effect
    // down and sets it up again immediately, and a frame left over from the teardown would yank
    // focus out of the input this run is about to claim.
    if (restoreFrameRef.current !== null) {
      cancelAnimationFrame(restoreFrameRef.current)
      restoreFrameRef.current = null
    }
    const dialog = dialogRef.current
    // Whatever opened the palette — a slot card, the header button — gets focus back on close.
    // Recorded once, and never from inside the palette itself: StrictMode runs this effect
    // twice, and by the second run focus is already sitting in the search input.
    const previous = document.activeElement
    if (openerRef.current === null && previous instanceof HTMLElement && dialog?.contains(previous) !== true) {
      openerRef.current = previous
    }
    // `showModal` is absent in DOMs without dialog support (jsdom, pre-2022 browsers); opening
    // the dialog non-modally there keeps the palette visible and usable, just without the
    // top-layer focus trap.
    if (dialog !== null) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    inputRef.current?.focus()
    return () => {
      const opener = openerRef.current
      if (opener === null) return
      const restore = (): void => {
        if (opener.isConnected) opener.focus()
      }
      restore()
      // Tearing down an open modal dialog resets focus to <body> on its own, which lands after
      // this cleanup — so claim it again on the next frame, once that has happened.
      if (typeof requestAnimationFrame === 'function') {
        restoreFrameRef.current = requestAnimationFrame(() => {
          restoreFrameRef.current = null
          restore()
        })
      }
    }
  }, [])

  // A dialog closed by the user agent (native Esc, `dialog.close()`) has to tell the Workbench,
  // or the palette would stay mounted-but-invisible.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    dialog.addEventListener('close', onClose)
    return () => dialog.removeEventListener('close', onClose)
  }, [onClose])

  useEffect(() => {
    if (active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const promote = (slot: 'a' | 'b' | 't', row: number): void => {
    if (row < 0) return
    setSlot(slot, results[row])
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Escape') {
      // Handled here rather than left to the dialog's own Esc so the close path is identical in
      // every DOM the palette runs in.
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveRow((Math.max(active, 0) + step + results.length) % results.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      promote(forSlot ?? 'a', active)
      return
    }
    // `searchPals` also matches dex numbers, so a digit typed into an all-digit query keeps
    // building that number; anywhere else it is the slot shortcut.
    const slot = DIGIT_SLOTS[e.key]
    if (slot !== undefined && !e.metaKey && !e.ctrlKey && !/^\d*$/.test(query) && active >= 0) {
      e.preventDefault()
      promote(slot, active)
    }
  }

  const toggleType = (type: string): void => {
    setTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
    setActiveRow(0)
  }

  const slotName = forSlot === null ? '' : forSlot === 't' ? ' → TARGET' : ` → PARENT ${forSlot.toUpperCase()}`

  return (
    <dialog
      ref={dialogRef}
      className="palette-dialog"
      aria-label="search pals"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        downTargetRef.current = e.target
      }}
      onClick={(e) => {
        // Both ends of the click have to land on the backdrop. Checking only the click target
        // closes the palette when a text selection dragged out of the input is released out here.
        const fromBackdrop = downTargetRef.current === dialogRef.current
        downTargetRef.current = null
        if (fromBackdrop && e.target === dialogRef.current) onClose()
      }}
    >
      <div className="palette search-palette">
        <div className="palette-head">
          <span className="label-caps">
            SEARCH
            {slotName}
          </span>
          <span className="palette-keys">↑↓ move · ENTER pick · 1/2/3 A/B/⌖ · ESC close</span>
        </div>

        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-label="search pals by name or dex"
          placeholder="name or dex number…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveRow(0)
          }}
        />

        <TypeChips selected={typeFilter} onToggle={toggleType} />

        <ul
          className={`result-list${browsing ? ' result-grid' : ''}`}
          id={LISTBOX_ID}
          role="listbox"
          aria-label={browsing ? 'all pals alphabetically' : 'search results'}
        >
          {results.map((index, row) => (
            <li
              key={ds.pals[index].id}
              id={optionId(row)}
              role="option"
              aria-selected={row === active}
              className={`result-row${row === active ? ' result-active' : ''}`}
              onMouseEnter={() => setActiveRow(row)}
              onClick={() => promote(forSlot ?? 'a', row)}
            >
              <PalTile pal={ds.pals[index]} size={browsing ? 'md' : 'sm'} />
            </li>
          ))}
        </ul>

        {results.length === 0 && (
          <p className="palette-empty">{browsing ? 'no pals match these types' : 'no pals match'}</p>
        )}
      </div>
    </dialog>
  )
}
