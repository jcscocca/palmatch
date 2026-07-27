import { assetUrl } from '../lib/assets.ts'
import { elementIcon } from '../lib/elements.ts'

interface TypeBadgeProps {
  type: string
  size?: 'sm' | 'md'
}

/**
 * Element icon + type name. `sm` drops the label, so its icon has to carry the name
 * (`alt`/`title`); `md` prints the label beside it, which makes the icon decorative.
 */
export function TypeBadge({ type, size = 'md' }: TypeBadgeProps) {
  const icon = elementIcon(type)
  const labelled = size === 'md' || icon === undefined
  return (
    <span className={`type-badge type-badge-${size}`} title={type}>
      {icon !== undefined && <img className="type-icon" src={assetUrl(icon)} alt={labelled ? '' : type} loading="lazy" />}
      {labelled && <span className="type-label">{type}</span>}
    </span>
  )
}
