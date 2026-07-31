import { beforeAll, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../../engine/dataset.ts'
import type { Dataset } from '../../engine/types.ts'
import { specialRowsFor } from './combo-rows.ts'

let ds: Dataset

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

describe('specialRowsFor', () => {
  it('honours an empty limit', () => {
    expect(specialRowsFor(ds, 'breeding-rank', 0)).toEqual([])
  })

  it('returns distinct cross-species special recipes, lowest child rank first', () => {
    const rows = specialRowsFor(ds, 'breeding-rank', 10)

    expect(rows).toHaveLength(10)
    expect(new Set(rows.map((row) => row.child)).size).toBe(rows.length)
    for (const [i, row] of rows.entries()) {
      expect(row.a).not.toBe(row.b)
      expect(row.child).not.toBe(row.a)
      expect(row.child).not.toBe(row.b)
      expect(row.badges).toEqual(['unique'])
      if (i > 0) {
        expect(ds.pals[rows[i - 1].child as number].power).toBeLessThanOrEqual(
          ds.pals[row.child as number].power,
        )
      }
    }
  })

  it('orders by the largest improvement over the stronger parent', () => {
    const rows = specialRowsFor(ds, 'rank-jump', 10)
    const jump = (row: (typeof rows)[number]): number => {
      const child = row.child as number
      return Math.min(ds.pals[row.a].power, ds.pals[row.b].power) - ds.pals[child].power
    }

    expect(ds.pals[rows[0].child as number].name).toBe('Loupmoon Cryst')
    for (let i = 1; i < rows.length; i++) expect(jump(rows[i - 1])).toBeGreaterThanOrEqual(jump(rows[i]))
  })
})
