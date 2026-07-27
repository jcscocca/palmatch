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

  if (palIndex === null) {
    return (
      <button type="button" className="slot slot-empty" onClick={onOpen}>
        <span className="slot-label">{heading}</span>
        <span className="slot-hint">{HINTS[label]}</span>
      </button>
    )
  }

  const pal = ds.pals[palIndex]
  return (
    <div className={`slot slot-filled${accent ? ' slot-accent' : ''}`}>
      <div className="slot-head">
        <span className="slot-label">{heading}</span>
        <button type="button" className="slot-clear" title={`clear ${label.toLowerCase()}`} onClick={onClear}>
          ×
        </button>
      </div>
      <button type="button" className="slot-body" onClick={onOpen} title={`change ${label.toLowerCase()}`}>
        <PalTile pal={pal} size="lg" />
      </button>
    </div>
  )
}
