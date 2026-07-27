import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toasts } from './Toasts.tsx'

afterEach(cleanup)

describe('Toasts', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<Toasts toasts={[]} onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('lists every warning in the toast and dismisses it on the × button', () => {
    const onDismiss = vi.fn()
    render(
      <Toasts
        toasts={[{ id: 1, warnings: ["unknown pal 'ghostpal' cleared from link", "unknown pal 'xyz' cleared from link"] }]}
        onDismiss={onDismiss}
      />,
    )
    expect(screen.getByText("unknown pal 'ghostpal' cleared from link")).toBeTruthy()
    expect(screen.getByText("unknown pal 'xyz' cleared from link")).toBeTruthy()

    fireEvent.click(screen.getByLabelText('dismiss warning'))
    expect(onDismiss).toHaveBeenCalledWith(1)
  })

  it('auto-dismisses a toast after 6 seconds', () => {
    vi.useFakeTimers()
    try {
      const onDismiss = vi.fn()
      render(<Toasts toasts={[{ id: 7, warnings: ['a warning'] }]} onDismiss={onDismiss} />)

      act(() => {
        vi.advanceTimersByTime(5999)
      })
      expect(onDismiss).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onDismiss).toHaveBeenCalledWith(7)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders one card per toast, stacked in the order they arrived', () => {
    render(
      <Toasts
        toasts={[
          { id: 1, warnings: ['first'] },
          { id: 2, warnings: ['second'] },
        ]}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toEqual([expect.stringContaining('first'), expect.stringContaining('second')])
  })
})
