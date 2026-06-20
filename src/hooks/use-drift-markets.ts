import { useEffect, useState, useRef } from 'react'
import type { SimMarket, PricePoint } from '@/types'
import { markets as marketDefs } from '@/utils/markets'

type DriftClientLike = {
  getOracleDataForPerpMarket: (marketIndex: number) => any
  getPerpMarketAccount: (marketIndex: number) => any
}

const POLL_INTERVAL = 3000

export function useDriftMarkets(driftClient: DriftClientLike | null) {
  const [markets, setMarkets] = useState<SimMarket[]>([])
  const [isLive, setIsLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestMarkets = useRef<SimMarket[]>([])
  const sessionHighs = useRef<Map<string, number>>(new Map())
  const sessionLows = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!driftClient) {
      setIsLive(false)
      return
    }

    const fetchPrices = () => {
      try {
        const updated: SimMarket[] = marketDefs.map((def) => {
          const oracleData = driftClient.getOracleDataForPerpMarket(def.marketIndex)
          const perpMarket = driftClient.getPerpMarketAccount(def.marketIndex)

          // Oracle price is in QUOTE_PRECISION (1e6)
          const currentPrice = oracleData?.price
            ? Number(oracleData.price) / 1e6
            : 0

          // Track session high/low
          const prevHigh = sessionHighs.current.get(def.symbol) ?? currentPrice
          const prevLow = sessionLows.current.get(def.symbol) ?? currentPrice
          const high24h = Math.max(prevHigh, currentPrice)
          const low24h = Math.min(prevLow, currentPrice)
          sessionHighs.current.set(def.symbol, high24h)
          sessionLows.current.set(def.symbol, low24h)

          // Extract AMM data
          const amm = perpMarket?.amm
          const volume24h = amm?.baseAssetAmountWithUnsettledLp
            ? Number(amm.baseAssetAmountWithUnsettledLp) / 1e9
            : 0
          const openInterest = amm?.baseAssetAmountLong
            ? (Number(amm.baseAssetAmountLong) + Number(amm.baseAssetAmountShort ?? 0)) / 1e9
            : 0
          const fundingRate = amm?.lastFundingRate
            ? Number(amm.lastFundingRate) / 1e9
            : 0

          // Base price for % change (first reading)
          const basePrice = prevHigh === currentPrice && prevLow === currentPrice
            ? currentPrice
            : (prevHigh + prevLow) / 2
          const change24h = basePrice > 0
            ? ((currentPrice - basePrice) / basePrice) * 100
            : 0

          const newPoint: PricePoint = {
            time: Date.now(),
            price: currentPrice,
            timestamp: Date.now(),
            open: currentPrice,
            high: currentPrice,
            low: currentPrice,
            close: currentPrice,
            volume: volume24h,
          }

          // Find existing market to append history
          const existingMarket = latestMarkets.current.find(m => m.symbol === def.name)
          const priceHistory = existingMarket
            ? [...existingMarket.priceHistory, newPoint].slice(-100)
            : [newPoint]

          return {
            symbol: def.name,
            name: `${def.symbol} Perp`,
            currentPrice,
            change24h,
            volume24h,
            openInterest,
            fundingRate,
            high24h,
            low24h,
            basePrice,
            priceHistory,
          }
        })

        latestMarkets.current = updated
        setMarkets(updated)
        setIsLive(true)
        setError(null)
      } catch (err) {
        console.error('Error fetching Drift market data:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch market data')
        setIsLive(false)
      }
    }

    fetchPrices()
    const interval = setInterval(fetchPrices, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [driftClient])

  return { markets, isLive, error }
}
