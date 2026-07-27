import { useState } from 'react'
import { assetUrl } from '../lib/assets.ts'
import type { PalRecord } from '../engine/types.ts'
import { TypeBadge } from './TypeBadge.tsx'

export interface PalTileProps {
  pal: PalRecord
  size: 'sm' | 'md' | 'lg'
  /** When given, the tile grows a hover/focus action strip that sends this pal to a slot. */
  onPromote?: (slot: 'a' | 'b' | 't') => void
  showDex?: boolean
}

const PROMOTE_ACTIONS: Array<{ slot: 'a' | 'b' | 't'; glyph: string; title: string }> = [
  { slot: 'a', glyph: 'A', title: 'set as Parent A' },
  { slot: 'b', glyph: 'B', title: 'set as Parent B' },
  { slot: 't', glyph: '⌖', title: 'set as Target' },
]

/**
 * The one pal primitive: sprite (or a lettered silhouette if the sprite fails to load), name,
 * element badges, dex/power caption. Sprites ship for every pal, so the silhouette is a runtime
 * fallback only — tracking the failed `src` rather than a bare boolean means swapping the tile to
 * a different pal retries the image instead of inheriting the previous pal's failure.
 */
export function PalTile({ pal, size, onPromote, showDex = true }: PalTileProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = failedSrc === pal.sprite

  return (
    <div className={`pal-tile pal-tile-${size}`}>
      <div className="pal-art">
        {failed ? (
          <div className="silhouette" aria-hidden="true">
            {pal.name.slice(0, 1)}
          </div>
        ) : (
          <img
            className="pal-sprite"
            src={assetUrl(pal.sprite)}
            alt={pal.name}
            loading="lazy"
            onError={() => setFailedSrc(pal.sprite)}
          />
        )}
      </div>

      <div className="pal-body">
        <div className="pal-name">{pal.name}</div>
        <div className="pal-types">
          {pal.types.map((type) => (
            <TypeBadge key={type} type={type} size={size === 'lg' ? 'md' : 'sm'} />
          ))}
        </div>
        {showDex && (
          <div className="pal-caption">
            #{pal.dex} · r{pal.power}
          </div>
        )}
      </div>

      {onPromote !== undefined && (
        <div className="promote-strip">
          {PROMOTE_ACTIONS.map(({ slot, glyph, title }) => (
            <button
              key={slot}
              type="button"
              className="promote-btn"
              title={`${title} (${pal.name})`}
              onClick={(e) => {
                e.stopPropagation()
                onPromote(slot)
              }}
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
