import type { PassiveRecord } from './types.ts'

export type PassiveRole = 'unsure' | 'combat' | 'worker' | 'mount'

export const PASSIVE_ROLE_LABELS: Record<PassiveRole, string> = {
  unsure: 'Not sure',
  combat: 'Combat',
  worker: 'Base worker',
  mount: 'Mount',
}

/**
 * A deliberately small, auditable catalog of broadly useful standard passives. It is guidance,
 * not an encoded claim that one four-skill loadout is universally best: species, content and
 * player preference all change that answer. Internal ids are stable across localization.
 */
const ROLE_IDS: Record<Exclude<PassiveRole, 'unsure'>, readonly string[]> = {
  combat: [
    'PAL_ALLAttack_up3', // Demon God
    'Legend',
    'CoolTimeReduction_Up_1', // Serenity
    'Deffence_up3', // Diamond Body
    'Vampire',
    'PAL_ALLAttack_up2', // Ferocious
    'Noukin', // Musclehead
    'Rare', // Lucky
  ],
  worker: [
    'CraftSpeed_up3', // Remarkable Craftsmanship
    'CraftSpeed_up2', // Artisan
    'CraftSpeed_up1', // Serious
    'PAL_CorporateSlave', // Work Slave
    'PAL_Sanity_Down_2', // Workaholic
    'Nocturnal', // Insomnia
    'Rare', // Lucky
  ],
  mount: [
    'MoveSpeed_up_3', // Swift
    'MoveSpeed_up_2', // Runner
    'MoveSpeed_up_1', // Nimble
    'Stamina_Up_3', // Eternal Engine
    'Stamina_Up_1', // Infinite Stamina
    'Legend',
  ],
}

export type PassiveTierTone = 'elite' | 'positive' | 'neutral' | 'negative'

export interface PassiveTier {
  label: string
  tone: PassiveTierTone
}

/** Factual in-game rank presentation, kept separate from the role recommendation above. */
export function passiveTier(rank: number): PassiveTier {
  if (rank >= 4) return { label: `RAINBOW · RANK ${rank}`, tone: 'elite' }
  if (rank > 0) return { label: `POSITIVE · RANK ${rank}`, tone: 'positive' }
  if (rank < 0) return { label: `NEGATIVE · RANK ${rank}`, tone: 'negative' }
  return { label: 'UNRANKED', tone: 'neutral' }
}

/** Suggested keepers among passives the selected parents actually carry. */
export function suggestedPassives(available: PassiveRecord[], role: PassiveRole): PassiveRecord[] {
  const usable = available.filter((p) => p.standard && p.rank > 0)
  if (role === 'unsure') {
    return usable.filter((p) => p.rank >= 4).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
  }
  const order = new Map(ROLE_IDS[role].map((id, index) => [id, index]))
  return usable
    .filter((p) => order.has(p.id))
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.name.localeCompare(b.name))
}
