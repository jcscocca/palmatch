import { TYPE_TO_ELEMENT } from '../lib/elements.ts'
import { TypeBadge } from './TypeBadge.tsx'

const TYPES = Object.keys(TYPE_TO_ELEMENT)

export interface TypeChipsProps {
  /** Raw palpedia type strings, as stored in `PalRecord.types`. */
  selected: string[]
  onToggle: (type: string) => void
}

/**
 * The element filter row, shared by the search palette and the combo tables so both spell the
 * filter the same way. Toggles are announced through `aria-pressed` — the icon alone carries the
 * type name, which is why `TypeBadge` is rendered at `sm` with its own label.
 */
export function TypeChips({ selected, onToggle }: TypeChipsProps) {
  return (
    <div className="chip-row">
      {TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={`chip${selected.includes(type) ? ' chip-on' : ''}`}
          aria-label={`filter ${type}`}
          aria-pressed={selected.includes(type)}
          onClick={() => onToggle(type)}
        >
          <TypeBadge type={type} size="sm" />
        </button>
      ))}
    </div>
  )
}
