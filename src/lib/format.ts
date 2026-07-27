/**
 * A probability (0..1) as a percentage, with a trailing `.0` trimmed: `0.5` reads `50%`, `0.505`
 * reads `50.5%`. One decimal is as far as any of these numbers are trustworthy.
 */
export function percent(p: number): string {
  return `${+(p * 100).toFixed(1)}%`
}
