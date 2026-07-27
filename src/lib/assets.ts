/**
 * Artifact paths (`pal.sprite`, `elementIcon()`, `public/data/*`) are stored root-absolute so the
 * pipeline never has to know where the app is deployed. Everything that turns one into a real URL
 * goes through here, which prefixes Vite's `BASE_URL` — `/` in dev, `/repo/` or `./` on Pages.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${prefix}${suffix}`
}
