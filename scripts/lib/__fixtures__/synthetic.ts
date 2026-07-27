import type { BreedingEntry, PalcalcDb } from '../transform.ts'

/**
 * A three-pal stand-in for palcalc's data, small enough to reason about by hand.
 * `Bbb`/`Ccc` share the display name "Bee" the way Gumoss is two pals sharing one sprite,
 * and `Ccc` is breedable only from itself.
 */
export function syntheticDb(): PalcalcDb {
  return {
    Pals: [
      {
        Id: { PalDexNo: 1, IsVariant: false },
        Name: 'Ay',
        InternalName: 'Aaa',
        BreedingPower: 100,
        BreedingPowerPriority: 10000,
        GuaranteedPassivesInternalIds: [],
      },
      {
        Id: { PalDexNo: 2, IsVariant: false },
        Name: 'Bee',
        InternalName: 'Bbb',
        BreedingPower: 200,
        BreedingPowerPriority: 20000,
        GuaranteedPassivesInternalIds: ['Swift'],
      },
      {
        Id: { PalDexNo: 2, IsVariant: true },
        Name: 'Bee',
        InternalName: 'Ccc',
        BreedingPower: 300,
        BreedingPowerPriority: 30000,
        GuaranteedPassivesInternalIds: [],
      },
    ],
    PassiveSkills: [
      {
        Name: 'Swift',
        InternalName: 'Swift',
        Rank: 2,
        RandomInheritanceAllowed: true,
        RandomInheritanceWeight: 50,
        IsStandardPassiveSkill: true,
      },
      {
        Name: 'en Text',
        InternalName: 'TestSkill1',
        Rank: 1,
        RandomInheritanceAllowed: false,
        RandomInheritanceWeight: 100,
        IsStandardPassiveSkill: false,
      },
      {
        Name: 'Runner',
        InternalName: 'Runner',
        Rank: 1,
        RandomInheritanceAllowed: true,
        RandomInheritanceWeight: 10,
        IsStandardPassiveSkill: true,
      },
    ],
    // Ccc is deliberately absent so the 0.5 default is exercised.
    BreedingGenderProbability: {
      Aaa: { MALE: 0.3, FEMALE: 0.7 },
      Bbb: { MALE: 0.5, FEMALE: 0.5 },
    },
  }
}

export const SYNTHETIC_TYPES: Record<string, string[]> = {
  aaa: ['fire'],
  bbb: ['water'],
  ccc: ['grass'],
}

const wildcard = (a: string, b: string, child: string): BreedingEntry => ({
  Parent1InternalName: a,
  Parent1Gender: 'WILDCARD',
  Parent2InternalName: b,
  Parent2Gender: 'WILDCARD',
  ChildInternalName: child,
})

/** Fills every unordered pair; only Ccc has no producer other than itself. */
export function syntheticEntries(): BreedingEntry[] {
  return [
    wildcard('Aaa', 'Aaa', 'Aaa'),
    wildcard('Bbb', 'Bbb', 'Bbb'),
    wildcard('Ccc', 'Ccc', 'Ccc'),
    wildcard('Aaa', 'Bbb', 'Aaa'),
    wildcard('Aaa', 'Ccc', 'Bbb'),
    wildcard('Bbb', 'Ccc', 'Bbb'),
  ]
}
