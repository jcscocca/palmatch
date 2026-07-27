import { describe, expect, it } from 'vitest'
import { passiveOdds } from './passives.ts'

describe('passiveOdds', () => {
  it('is certain when nothing is wanted', () => {
    for (let pool = 0; pool <= 6; pool++) expect(passiveOdds(pool, 0)).toBe(1)
  })

  it('is impossible past four slots or past the pool', () => {
    expect(passiveOdds(3, 4)).toBe(0)
    expect(passiveOdds(6, 5)).toBe(0)
    expect(passiveOdds(2, 3)).toBe(0)
  })

  it('collapses to the single inheritable count when the pool is that small', () => {
    expect(passiveOdds(1, 1)).toBe(0.4)
    expect(passiveOdds(2, 2)).toBe(0.3)
    expect(passiveOdds(3, 3)).toBe(0.2)
    expect(passiveOdds(4, 4)).toBe(0.1)
  })

  it('sums the hypergeometric draw across every inheritable count', () => {
    // 0.4·C(3,0)/C(4,1) + 0.3·C(3,1)/C(4,2) + 0.2·C(3,2)/C(4,3) + 0.1·C(3,3)/C(4,4)
    expect(passiveOdds(4, 1)).toBeCloseTo(0.5, 12)
    // 0.3·C(1,0)/C(3,2) + 0.2·C(1,1)/C(3,3), k=1 cannot cover two desired
    expect(passiveOdds(3, 2)).toBeCloseTo(0.3 / 3 + 0.2, 12)
  })

  it('gets harder as the parents carry more junk', () => {
    expect(passiveOdds(6, 1)).toBeLessThan(passiveOdds(2, 1))
    expect(passiveOdds(10, 2)).toBeLessThan(passiveOdds(4, 2))
  })
})
