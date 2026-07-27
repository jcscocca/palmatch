import { assetUrl } from '../lib/assets.ts'
import { elementIcon } from '../lib/elements.ts'

interface TypeBadgeProps {
  type: string
  size?: 'sm' | 'md'
}

/** Element icon + type name. `sm` drops the label (the icon carries `alt`/`title` instead). */
export function TypeBadge({ type, size = 'md' }: TypeBadgeProps) {
  const icon = elementIcon(type)
  return (
    <span className={`type-badge type-badge-${size}`} title={type}>
      {icon !== undefined && <img className="type-icon" src={assetUrl(icon)} alt={type} loading="lazy" />}
      {(size === 'md' || icon === undefined) && <span className="type-label">{type}</span>}
    </span>
  )
}
