import type { KeyboardEvent } from 'react'
import { useDataset } from './dataset-context.ts'
import { PalTile } from './PalTile.tsx'

export interface SlotProps {
  label: 'PARENT A' | 'PARENT B' | 'TARGET'
  palIndex: number | null
  onOpen: () => void
  onClear: () => void
  /** Target slot: accent border + `⌖` in the label once filled. */
  accent?: boolean
}

const HINTS: Record<SlotProps['label'], string> = {
  'PARENT A': 'click or press / to pick',
  'PARENT B': 'pick a partner',
  TARGET: 'what you want to hatch',
}

export function Slot({ label, palIndex, onOpen, onClear, accent = false }: SlotProps) {
  const ds = useDataset()
  const heading = accent ? `⌖ ${label}` : label
  const name = label.toLowerCase()

  if (palIndex === null) {
    return (
      <button type="button" className="slot slot-empty" onClick={onOpen}>
        <span className="label-caps slot-label">{heading}</span>
        <span className="slot-hint">{HINTS[label]}</span>
      </button>
    )
  }

  // A filled slot's body is a `role="button"` div rather than a `<button>`: `PalTile` renders its
  // own promote buttons when a caller passes `onPromote`, and nesting those inside a button is
  // invalid HTML that React 19 rejects outright.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onOpen()
  }

  const pal = ds.pals[palIndex]
  return (
    <div className={`slot slot-filled${accent ? ' slot-accent' : ''}`}>
      <div className="slot-head">
        <span className="label-caps slot-label">{heading}</span>
        <button
          type="button"
          className="slot-clear"
          title={`clear ${name}`}
          aria-label={`clear ${name}`}
          onClick={onClear}
        >
          ×
        </button>
      </div>
      <div
        className="slot-body"
        role="button"
        tabIndex={0}
        aria-label={`change ${name} (${pal.name})`}
        onClick={onOpen}
        onKeyDown={onKeyDown}
      >
        <PalTile pal={pal} size="lg" />
      </div>
    </div>
  )
}
