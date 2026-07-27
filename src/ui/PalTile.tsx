import { useState } from 'react'
import { assetUrl } from '../lib/assets.ts'
import type { PalRecord } from '../engine/types.ts'
import { TypeBadge } from './TypeBadge.tsx'

export interface PalTileProps {
  pal: PalRecord
  size: 'sm' | 'md' | 'lg'
  /** When given, the tile grows a hover/focus action strip that sends this pal to a slot. */
  onPromote?: (slot: 'a' | 'b' | 't') => void
}

const PROMOTE_ACTIONS: Array<{ slot: 'a' | 'b' | 't'; glyph: string; label: string }> = [
  { slot: 'a', glyph: 'A', label: 'set as Parent A' },
  { slot: 'b', glyph: 'B', label: 'set as Parent B' },
  { slot: 't', glyph: '⌖', label: 'set as Target' },
]

/**
 * The one pal primitive: sprite (or a lettered silhouette if the sprite fails to load), name,
 * element badges, dex/power caption. Sprites ship for every pal, so the silhouette is a runtime
 * fallback only — tracking the failed `src` rather than a bare boolean means swapping the tile to
 * a different pal retries the image instead of inheriting the previous pal's failure.
 *
 * The sprite is `alt=""`: the name is printed right below it, so announcing it twice is noise.
 * The promote buttons are the tile's only interactive parts, which is why every clickable
 * container this sits inside is a `role="button"`/`role="option"` element and never a `<button>`.
 */
export function PalTile({ pal, size, onPromote }: PalTileProps) {
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
            alt=""
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
        <div className="pal-caption">
          #{pal.dex} · r{pal.power}
        </div>
      </div>

      {onPromote !== undefined && (
        <div className="promote-strip">
          {PROMOTE_ACTIONS.map(({ slot, glyph, label }) => (
            <button
              key={slot}
              type="button"
              className="promote-btn"
              title={`${label} (${pal.name})`}
              aria-label={`${label} (${pal.name})`}
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
