import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCursorParticles } from './use-cursor-particles'

const NOW = new Date('2026-06-20T12:00:00.000Z')
const originalRequestAnimationFrame = window.requestAnimationFrame
const originalCancelAnimationFrame = window.cancelAnimationFrame

let rafCallbacks: FrameRequestCallback[] = []
let cancelAnimationFrameMock: ReturnType<typeof vi.fn>

function dispatchMouseMove(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  rafCallbacks = []
  cancelAnimationFrameMock = vi.fn()

  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    }),
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: cancelAnimationFrameMock,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: originalRequestAnimationFrame,
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: originalCancelAnimationFrame,
  })
})

describe('useCursorParticles', () => {
  it('does not attach listeners or animate when disabled', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

    const { result } = renderHook(() => useCursorParticles(false))

    expect(result.current).toEqual([])
    expect(rafCallbacks).toEqual([])
    expect(addEventListenerSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function))
  })

  it('throttles mouse moves and emits deterministic particle pairs', () => {
    const { result } = renderHook(() => useCursorParticles(true))

    act(() => {
      dispatchMouseMove(100, 200)
    })

    expect(result.current).toEqual([])

    act(() => {
      vi.advanceTimersByTime(31)
      dispatchMouseMove(100, 200)
    })

    expect(result.current).toHaveLength(2)
    expect(result.current[0]).toMatchObject({
      id: 0,
      x: 100,
      y: 200,
      vx: 0,
      vy: -1,
      life: 0,
      maxLife: 90,
      size: 3.5,
      color: 'oklch(0.75 0.18 220)',
    })
    expect(result.current[1].id).toBe(1)
  })

  it('advances particles on animation frames', () => {
    const { result } = renderHook(() => useCursorParticles(true))

    act(() => {
      vi.advanceTimersByTime(31)
      dispatchMouseMove(100, 200)
    })

    act(() => {
      rafCallbacks.shift()?.(NOW.getTime() + 31)
    })

    expect(result.current[0]).toMatchObject({
      x: 100,
      y: 199,
      life: 1,
      vy: -0.9,
    })
    expect(rafCallbacks).toHaveLength(1)
  })

  it('removes the mouse listener and cancels animation on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useCursorParticles(true))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1)
  })
})
