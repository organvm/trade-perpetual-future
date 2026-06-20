import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDriftMarkets } from './use-drift-markets'
import { markets as marketDefs } from '@/utils/markets'

type DriftClientStub = NonNullable<Parameters<typeof useDriftMarkets>[0]>

type MarketAccount = {
  amm?: {
    baseAssetAmountWithUnsettledLp?: number
    baseAssetAmountLong?: number
    baseAssetAmountShort?: number
    lastFundingRate?: number
  }
}

const NOW = new Date('2026-06-20T12:00:00.000Z')

function makeClient(
  prices: Record<number, number>,
  accounts: Record<number, MarketAccount> = {},
): DriftClientStub {
  return {
    getOracleDataForPerpMarket: (marketIndex: number) => ({
      price: prices[marketIndex] ?? 0,
    }),
    getPerpMarketAccount: (marketIndex: number) => accounts[marketIndex] ?? { amm: {} },
  }
}

async function flushEffects() {
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useDriftMarkets', () => {
  it('stays offline when no Drift client is supplied', async () => {
    const { result } = renderHook(() => useDriftMarkets(null))

    await flushEffects()

    expect(result.current.markets).toEqual([])
    expect(result.current.isLive).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('normalizes oracle and AMM data into simulated markets', async () => {
    const client = makeClient(
      {
        0: 24_500_000,
        1: 61_250_000_000,
        2: 3_450_000_000,
      },
      {
        0: {
          amm: {
            baseAssetAmountWithUnsettledLp: 7_250_000_000,
            baseAssetAmountLong: 3_250_000_000,
            baseAssetAmountShort: 2_000_000_000,
            lastFundingRate: -420_000,
          },
        },
      },
    )

    const { result } = renderHook(() => useDriftMarkets(client))

    await flushEffects()

    expect(result.current.isLive).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.markets).toHaveLength(marketDefs.length)

    const sol = result.current.markets.find((market) => market.symbol === 'SOL-PERP')
    expect(sol).toMatchObject({
      symbol: 'SOL-PERP',
      name: 'SOL Perp',
      currentPrice: 24.5,
      change24h: 0,
      volume24h: 7.25,
      openInterest: 5.25,
      high24h: 24.5,
      low24h: 24.5,
      basePrice: 24.5,
    })
    expect(sol?.fundingRate).toBeCloseTo(-0.00042)
    expect(sol?.priceHistory).toHaveLength(1)
    expect(sol?.priceHistory[0]).toMatchObject({
      time: NOW.getTime(),
      timestamp: NOW.getTime(),
      price: 24.5,
      open: 24.5,
      high: 24.5,
      low: 24.5,
      close: 24.5,
      volume: 7.25,
    })
  })

  it('polls for updates while preserving session highs, lows, and history', async () => {
    const prices = {
      0: 20_000_000,
      1: 60_000_000_000,
      2: 3_000_000_000,
    }
    const client = makeClient(prices)

    const { result } = renderHook(() => useDriftMarkets(client))

    await flushEffects()

    prices[0] = 22_000_000
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await flushEffects()

    const sol = result.current.markets.find((market) => market.symbol === 'SOL-PERP')
    expect(sol?.currentPrice).toBe(22)
    expect(sol?.high24h).toBe(22)
    expect(sol?.low24h).toBe(20)
    expect(sol?.basePrice).toBe(20)
    expect(sol?.change24h).toBeCloseTo(10)
    expect(sol?.priceHistory.map((point) => point.price)).toEqual([20, 22])
    expect(sol?.priceHistory[1].timestamp).toBe(NOW.getTime() + 3000)
  })

  it('reports fetch errors and recovers on a later poll', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prices = {
      0: 21_000_000,
      1: 62_000_000_000,
      2: 3_200_000_000,
    }
    let shouldThrow = true
    const client: DriftClientStub = {
      getOracleDataForPerpMarket: (marketIndex: number) => {
        if (shouldThrow) {
          throw new Error('oracle unavailable')
        }

        return { price: prices[marketIndex] ?? 0 }
      },
      getPerpMarketAccount: () => ({ amm: {} }),
    }

    const { result } = renderHook(() => useDriftMarkets(client))

    await flushEffects()

    expect(consoleSpy).toHaveBeenCalled()
    expect(result.current.isLive).toBe(false)
    expect(result.current.error).toBe('oracle unavailable')
    expect(result.current.markets).toEqual([])

    shouldThrow = false
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await flushEffects()

    expect(result.current.isLive).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.markets).toHaveLength(marketDefs.length)
  })
})
