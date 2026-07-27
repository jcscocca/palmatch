import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useUrlWarningToasts } from './useUrlWarningToasts.ts'

describe('useUrlWarningToasts', () => {
  it('ignores empty warning batches', () => {
    const { result } = renderHook(() => useUrlWarningToasts())
    act(() => result.current.onWarnings([]))
    expect(result.current.toasts).toEqual([])
  })

  it('queues a toast per non-empty batch and assigns increasing ids', () => {
    const { result } = renderHook(() => useUrlWarningToasts())
    act(() => result.current.onWarnings(['one']))
    act(() => result.current.onWarnings(['two', 'three']))
    expect(result.current.toasts).toEqual([
      { id: 0, warnings: ['one'] },
      { id: 1, warnings: ['two', 'three'] },
    ])
  })

  it('dismiss removes only the matching toast', () => {
    const { result } = renderHook(() => useUrlWarningToasts())
    act(() => result.current.onWarnings(['one']))
    act(() => result.current.onWarnings(['two']))
    const [first] = result.current.toasts
    act(() => result.current.dismiss(first.id))
    expect(result.current.toasts).toEqual([{ id: 1, warnings: ['two'] }])
  })
})
