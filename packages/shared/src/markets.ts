/**
 * Candence — market discovery & status gating (DIRECTIVE §1.2, §1.3, §4.6).
 *
 * Hard rules enforced here:
 *  - Every write is gated on LIVE onchain status === Trading(1). The indexer lags
 *    seconds behind chain state, so we read status onchain right before firing
 *    and never trust a cached/REST value for the gate (§1.2, gotcha #1).
 *  - Finalized markets are discovered via `listBinaryMarkets({status:"Finalized"})`
 *    — `loadMarkets()` alone skips finalized binaries and makes a vault look idle
 *    while it has unclaimed winnings (§1.3, §4.6).
 *  - State is keyed by marketId/symbol, NEVER pool address (§1.2, gotcha #10).
 *
 * This module is intentionally thin over `@somnia-chain/markets-sdk`. It accepts
 * an injected exchange handle so it can be unit-tested without a live chain and
 * so the SDK version boundary lives in exactly one place.
 */
import { MarketStatus, type Asset, type BinaryMarket, type IntervalSec } from "./types.js";

/**
 * Minimal structural interface of the markets-sdk surfaces Candence relies on.
 * Require markets-sdk ≥ 0.25.0 (DIRECTIVE §1.4) — older versions are broken on
 * reads and lack `amountToPrecision`.
 */
export interface ExchangeLike {
  client: {
    /** Onchain truth for a single market's status (§1.2). */
    getMarketStatus(marketId: string): Promise<number>;
    listBinaryMarkets(args: {
      venueId: `0x${string}`;
      status?: "Trading" | "Finalized" | "All";
    }): Promise<RawMarket[]>;
  };
}

export interface RawMarket {
  marketId: string;
  symbol: string;
  asset: string;
  intervalSec: number;
  strike: number;
  status: number;
  openTimeSec: number;
  expiryTimeSec: number;
  upPrice: number;
  poolAddress: `0x${string}`;
  venueId: `0x${string}`;
}

function normalizeAsset(a: string): Asset {
  const up = a.toUpperCase();
  if (up.includes("BTC")) return "BTC";
  if (up.includes("ETH")) return "ETH";
  // Candence only trades the BTC/ETH hero path (§8); anything else is filtered out upstream.
  return up as Asset;
}

function normalizeInterval(sec: number): IntervalSec {
  if (sec >= 86400) return 86400; // 24h
  if (sec >= 14400) return 14400; // 4h
  return 3600;                    // 1h hero (operatorId:4 15m/5m filtered upstream)
}

export function toBinaryMarket(raw: RawMarket): BinaryMarket {
  return {
    marketId: raw.marketId,
    symbol: raw.symbol,
    asset: normalizeAsset(raw.asset),
    intervalSec: normalizeInterval(raw.intervalSec),
    strike: raw.strike,
    status: raw.status as MarketStatus,
    openTimeSec: raw.openTimeSec,
    expiryTimeSec: raw.expiryTimeSec,
    upPrice: raw.upPrice,
    poolAddress: raw.poolAddress,
    venueId: raw.venueId,
  };
}

/**
 * Discover the current tradeable window for an asset+interval. Returns only
 * markets with LIVE onchain status Trading(1). Never keys by pool (§1.2 #10).
 */
export async function findTradingMarket(
  exchange: ExchangeLike,
  venueId: `0x${string}`,
  asset: Asset,
  intervalSec: IntervalSec,
): Promise<BinaryMarket | undefined> {
  const raws = await exchange.client.listBinaryMarkets({ venueId, status: "Trading" });
  const candidates = raws
    .map(toBinaryMarket)
    .filter((m) => m.asset === asset && m.intervalSec === intervalSec);

  // Re-confirm status ONCHAIN before returning — the list may be indexer-sourced
  // and lag (gotcha #1). This is the authoritative gate.
  for (const m of candidates.sort((a, b) => b.openTimeSec - a.openTimeSec)) {
    const live = await exchange.client.getMarketStatus(m.marketId);
    if (live === MarketStatus.Trading) return { ...m, status: MarketStatus.Trading };
  }
  return undefined;
}

/**
 * The authoritative pre-write gate (DIRECTIVE §1.2, gotcha #1). Call this
 * immediately before signing any order. Returns true only if the market is
 * live-Trading AND has time headroom is left to the caller (see pricing.hasHeadroom).
 */
export async function isWritable(
  exchange: ExchangeLike,
  marketId: string,
): Promise<boolean> {
  const live = await exchange.client.getMarketStatus(marketId);
  return live === MarketStatus.Trading;
}

/**
 * Finalized markets for the claim sweeper (DIRECTIVE §1.3, §4.6). Includes both
 * Resolved(4) and Voided(5). MUST use listBinaryMarkets — loadMarkets() skips
 * these. Caps the scan window (bot-kit default: last 25 settled).
 */
export async function findFinalizedMarkets(
  exchange: ExchangeLike,
  venueId: `0x${string}`,
  scanLastN = 25,
): Promise<BinaryMarket[]> {
  const raws = await exchange.client.listBinaryMarkets({ venueId, status: "Finalized" });
  return raws
    .map(toBinaryMarket)
    .filter((m) => m.status === MarketStatus.Resolved || m.status === MarketStatus.Voided)
    .sort((a, b) => b.expiryTimeSec - a.expiryTimeSec)
    .slice(0, scanLastN);
}
