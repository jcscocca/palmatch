/**
 * Sprite and element-icon paths (`pal.sprite`, `elementIcon()`) are stored root-absolute so the
 * pipeline never has to know where the app is deployed; every `<img src>` resolves one through
 * here, prefixing Vite's `BASE_URL` — `/` in dev, `/repo/` or `./` on Pages. The five data
 * artifacts don't come through here: `loadDataset` is handed `BASE_URL` directly and does the
 * same join itself (`src/engine/dataset.ts`).
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${prefix}${suffix}`
}
