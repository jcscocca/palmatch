import { useMemo } from 'react'
import type { GenderCode, PalRecord } from '../engine/types.ts'
import type { OwnedBySpecies, OwnedGenders } from '../state/owned.ts'
import { genderTotals, onlyGender, ownedRows } from '../state/owned.ts'
import { PalTile } from './PalTile.tsx'

const GLYPH: Record<GenderCode, string> = { M: '♂', F: '♀' }
const WORD: Record<GenderCode, string> = { M: 'male', F: 'female' }

/**
 * `♂2 ♀1`, with either half dropped when it is zero.
 *
 * A zero is never printed, and that is a rule about honesty rather than about terseness: the split
 * only accounts for pals whose save row carried a gender, so `♀0` beside `×3` would read as "no
 * females" when the truth may be "two males and one the save never said". The halves it does print
 * are counts of confirmed pals, which is a claim this list can always stand behind.
 */
function splitLabel(genders: OwnedGenders): { text: string; label: string } {
  const parts: Array<[GenderCode, number]> = []
  if (genders.males > 0) parts.push(['M', genders.males])
  if (genders.females > 0) parts.push(['F', genders.females])
  return {
    text: parts.map(([g, n]) => `${GLYPH[g]}${n}`).join(' '),
    label: parts.map(([g, n]) => `${n} ${WORD[g]}${n === 1 ? '' : 's'}`).join(', '),
  }
}

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
  // All-or-nothing, by `genderTotals`: either every rendered species knows its split and the
  // headline can carry one, or the nudge below asks for a re-import. The two states are exclusive,
  // so the line never prints a total that only covers part of the grid.
  const totals = useMemo(() => genderTotals(rows), [rows])
  const unknown = totals === null && rows.length > 0
  // A recipient of a pre-gender share link has no save of their own to re-import; only the sharer
  // can fix that list. `loadShared` is the sole writer of this label (src/state/owned.ts).
  const fromShare = sourceLabel === 'shared list'
  // Same zero-dropping as the cells, for the same reason — see `splitLabel`.
  const totalsText = totals === null ? '' : splitLabel(totals).text
  // One string rather than a row of JSX expressions: this line is the panel's headline, and a
  // sentence split across a dozen text nodes is one no assistive tech or test can read as a whole.
  // Only past one player: a single-player world has exactly one player row, and calling that "a
  // guild of 1" is noise on every solo save — the line is there to explain a shared palbox.
  const countLine = `${rows.length} species · ${total} pal${total === 1 ? '' : 's'}${
    totalsText === '' ? '' : ` · ${totalsText}`
  }${playerRows > 1 ? ` · guild of ${playerRows} players` : ''}${
    sourceLabel === null ? '' : ` · from ${sourceLabel}`
  }`

  return (
    <div className="owned-summary">
      <p className="count-line">{countLine}</p>

      {/*
        One line for the whole grid, not one per cell. A list from before genders were stored, or
        from an older share link, has no split to show — and inventing zeroes for it would be worse
        than saying nothing, so the cells stay quiet and this says how to fix it.
      */}
      {unknown && (
        <p className="panel-note">
          {fromShare
            ? 'this shared list predates genders — ask whoever sent it to re-import and re-share'
            : 're-import your save to see genders'}
        </p>
      )}

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
          {rows.map(({ index, pal, count, genders }) => {
            const only = onlyGender(count, genders)
            // Suppressed under the ONLY marker rather than shown beside it: that marker only fires
            // when every pal is accounted for, so `×4` and `♂ ONLY` already say "four males" and
            // `♂4 ♂ ONLY` would print the same fact twice in a grid with no room for it.
            const split = genders === null || only !== null ? null : splitLabel(genders)
            return (
              <li className="owned-cell" key={index}>
                <PalTile pal={pal} size="sm" />
                <span className="owned-tally">
                  <span className="owned-count" aria-label={`${count} owned`}>
                    ×{count}
                  </span>
                  {split !== null && split.text !== '' && (
                    <span className="owned-split" aria-label={split.label}>
                      {split.text}
                    </span>
                  )}
                  {only !== null && (
                    <span
                      className="owned-only"
                      aria-label={`${WORD[only]}s only — cannot be bred with itself`}
                      title={`every ${pal.name} you own is ${WORD[only]} — this species needs a partner from somewhere else`}
                    >
                      {GLYPH[only]} ONLY
                    </span>
                  )}
                </span>
              </li>
            )
          })}
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
