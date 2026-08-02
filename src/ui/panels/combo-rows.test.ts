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

  it('returns every cross-species special recipe, lowest child rank first', () => {
    const rows = specialRowsFor(ds, 'breeding-rank')
    const expected = ds.combos.unique.filter(({ a, b, child }) => a !== b && child !== a && child !== b)

    expect(rows).toHaveLength(expected.length)
    expect(rows.length).toBeGreaterThan(10)
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
    const rows = specialRowsFor(ds, 'rank-jump')
    const jump = (row: (typeof rows)[number]): number => {
      const child = row.child as number
      return Math.min(ds.pals[row.a].power, ds.pals[row.b].power) - ds.pals[child].power
    }

    expect(ds.pals[rows[0].child as number].name).toBe('Loupmoon Cryst')
    for (let i = 1; i < rows.length; i++) expect(jump(rows[i - 1])).toBeGreaterThanOrEqual(jump(rows[i]))
  })
})
