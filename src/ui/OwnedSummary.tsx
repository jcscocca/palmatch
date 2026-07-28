import { useMemo } from 'react'
import type { PalRecord } from '../engine/types.ts'
import type { OwnedBySpecies } from '../state/owned.ts'
import { ownedRows } from '../state/owned.ts'
import { PalTile } from './PalTile.tsx'

export interface OwnedSummaryProps {
  pals: PalRecord[]
  bySpecies: OwnedBySpecies
  warnings: string[]
  sourceLabel: string | null
  /**
   * Players in the save this list came from; 0 for a shared list, which carries no such count.
   * Only reported above 1 — see `countLine`.
   */
  playerRows: number
  /** Inline confirmation for SHARE / DOWNLOAD — announced politely, not as a toast over the dialog. */
  note: string | null
  onImportAgain: () => void
  onClear: () => void
  onShare: () => void
  onDownload: () => void
}

/**
 * What the import produced: the counts, whatever the parser wanted to say about it, and the
 * species grid. Presentational on purpose — the panel owns the store and the clipboard, so this
 * renders the same way from a save import, a shared link or a test fixture.
 *
 * A species index the dataset doesn't have is dropped rather than rendered: a list can outlive the
 * paldex it was made against (an old localStorage entry, a link from a newer build), and the store
 * is not the place to discover that.
 */
export function OwnedSummary({
  pals,
  bySpecies,
  warnings,
  sourceLabel,
  playerRows,
  note,
  onImportAgain,
  onClear,
  onShare,
  onDownload,
}: OwnedSummaryProps) {
  const rows = useMemo(() => ownedRows(pals, bySpecies), [bySpecies, pals])
  // Summed over the rows actually rendered, not over the whole store: a list carrying species this
  // build doesn't have would otherwise print a total the grid below it can't account for.
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  // One string rather than a row of JSX expressions: this line is the panel's headline, and a
  // sentence split across a dozen text nodes is one no assistive tech or test can read as a whole.
  // Only past one player: a single-player world has exactly one player row, and calling that "a
  // guild of 1" is noise on every solo save — the line is there to explain a shared palbox.
  const countLine = `${rows.length} species · ${total} pal${total === 1 ? '' : 's'}${
    playerRows > 1 ? ` · guild of ${playerRows} players` : ''
  }${sourceLabel === null ? '' : ` · from ${sourceLabel}`}`

  return (
    <div className="owned-summary">
      <p className="count-line">{countLine}</p>

      {rows.length === 0 && (
        <p className="panel-note">no pals palmatch could place — check that this was the world you meant</p>
      )}

      {warnings.length > 0 && (
        <ul className="import-warnings">
          {warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <ul className="owned-grid" aria-label="owned pals">
          {rows.map(({ index, pal, count }) => (
            <li className="owned-cell" key={index}>
              <PalTile pal={pal} size="sm" />
              <span className="owned-count" aria-label={`${count} owned`}>
                ×{count}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="import-actions">
        <button type="button" className="file-btn" onClick={onImportAgain}>
          IMPORT AGAIN
        </button>
        <button type="button" className="file-btn" onClick={onClear}>
          CLEAR
        </button>
        <button type="button" className="file-btn" onClick={onShare}>
          SHARE
        </button>
        <button type="button" className="file-btn" onClick={onDownload}>
          DOWNLOAD
        </button>
      </div>

      {note !== null && (
        <p className="share-note" role="status">
          {note}
        </p>
      )}
    </div>
  )
}
