import { beforeAll, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from './dataset.ts'
import type { Dataset } from './types.ts'
import { passiveTier, suggestedPassives } from './passive-guidance.ts'

let ds: Dataset

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

describe('passive guidance', () => {
  it('labels rank without pretending rank is a role recommendation', () => {
    expect(passiveTier(4)).toEqual({ label: 'RAINBOW · RANK 4', tone: 'elite' })
    expect(passiveTier(3)).toEqual({ label: 'POSITIVE · RANK 3', tone: 'positive' })
    expect(passiveTier(-1)).toEqual({ label: 'NEGATIVE · RANK -1', tone: 'negative' })
  })

  it('keeps every curated id anchored to the current dataset', () => {
    const roles = ['combat', 'worker', 'mount'] as const
    const all = ds.passives.filter((p) => p.standard)
    for (const role of roles) expect(suggestedPassives(all, role).length).toBeGreaterThan(0)
  })

  it('suggests only available passives and treats rainbow as the unsure default', () => {
    const available = ds.passives.filter((p) => ['Rare', 'CraftSpeed_up2', 'PAL_ALLAttack_down1'].includes(p.id))
    expect(suggestedPassives(available, 'unsure').map((p) => p.id)).toEqual(['Rare'])
    expect(suggestedPassives(available, 'worker').map((p) => p.id)).toEqual(['CraftSpeed_up2', 'Rare'])
  })
})
