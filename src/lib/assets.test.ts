import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetUrl } from './assets.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assetUrl', () => {
  it('leaves root-absolute paths alone at the root base', () => {
    vi.stubEnv('BASE_URL', '/')
    expect(assetUrl('/sprites/Alpaca.webp')).toBe('/sprites/Alpaca.webp')
    expect(assetUrl('/elements/Fire.png')).toBe('/elements/Fire.png')
  })

  it('rewrites them under a subpath base', () => {
    vi.stubEnv('BASE_URL', '/palmatch/')
    expect(assetUrl('/sprites/Alpaca.webp')).toBe('/palmatch/sprites/Alpaca.webp')
    expect(assetUrl('/elements/Fire.png')).toBe('/palmatch/elements/Fire.png')
  })

  it('keeps a relative base relative', () => {
    vi.stubEnv('BASE_URL', './')
    expect(assetUrl('/sprites/Alpaca.webp')).toBe('./sprites/Alpaca.webp')
    expect(assetUrl('/elements/Fire.png')).toBe('./elements/Fire.png')
  })

  it('accepts a base without a trailing slash and a path without a leading one', () => {
    vi.stubEnv('BASE_URL', '/palmatch')
    expect(assetUrl('sprites/Alpaca.webp')).toBe('/palmatch/sprites/Alpaca.webp')
  })
})
