import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { searchPals } from '../engine/search.ts'
import { TYPE_TO_ELEMENT } from '../lib/elements.ts'
import { useWorkbenchStore } from '../state/store.ts'
import { useDataset } from './dataset-context.ts'
import { PalTile } from './PalTile.tsx'
import { TypeBadge } from './TypeBadge.tsx'

export interface SearchPaletteProps {
  open: boolean
  /** Slot the palette was opened for; `null` means it was opened generally (Enter lands on A). */
  forSlot: 'a' | 'b' | 't' | null
  onClose: () => void
}

const TYPES = Object.keys(TYPE_TO_ELEMENT)
const DIGIT_SLOTS: Record<string, 'a' | 'b' | 't'> = { '1': 'a', '2': 'b', '3': 't' }

export function SearchPalette({ open, forSlot, onClose }: SearchPaletteProps) {
  const ds = useDataset()
  const setSlot = useWorkbenchStore((s) => s.setSlot)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [activeRow, setActiveRow] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => searchPals(ds.pals, query, typeFilter), [ds.pals, query, typeFilter])
  const active = results.length === 0 ? -1 : Math.min(activeRow, results.length - 1)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const promote = (slot: 'a' | 'b' | 't', row: number): void => {
    if (row < 0) return
    setSlot(slot, results[row])
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
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
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="search pals" onKeyDown={onKeyDown}>
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
          autoFocus
          placeholder="name or dex number…"
          aria-label="search pals by name or dex"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveRow(0)
          }}
        />

        <div className="chip-row">
          {TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`chip${typeFilter.includes(type) ? ' chip-on' : ''}`}
              aria-label={`filter ${type}`}
              aria-pressed={typeFilter.includes(type)}
              onClick={() => toggleType(type)}
            >
              <TypeBadge type={type} size="sm" />
            </button>
          ))}
        </div>

        <ul className="result-list">
          {results.map((index, row) => (
            <li key={ds.pals[index].id}>
              <button
                type="button"
                className={`result-row${row === active ? ' result-active' : ''}`}
                onMouseEnter={() => setActiveRow(row)}
                onClick={() => promote(forSlot ?? 'a', row)}
              >
                <PalTile pal={ds.pals[index]} size="sm" />
              </button>
            </li>
          ))}
        </ul>

        {results.length === 0 && (
          <p className="palette-empty">
            {query.trim() === '' ? `type to search ${ds.pals.length} pals` : 'no pals match'}
          </p>
        )}
      </div>
    </div>
  )
}
