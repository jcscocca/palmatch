/**
 * Palpedia type slug -> palcalc element icon name (`public/elements/{Element}.png`).
 * palcalc ships the neutral icon as `Normal.png`, so `normal` maps to `Normal`.
 */
export const TYPE_TO_ELEMENT: Record<string, string> = {
  normal: 'Normal',
  fire: 'Fire',
  water: 'Water',
  grass: 'Leaf',
  electric: 'Electricity',
  ice: 'Ice',
  ground: 'Earth',
  dark: 'Dark',
  dragon: 'Dragon',
}

export function elementIcon(type: string): string | undefined {
  const element = TYPE_TO_ELEMENT[type]
  return element === undefined ? undefined : `/elements/${element}.png`
}
