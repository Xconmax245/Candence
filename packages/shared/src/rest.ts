/**
 * Candence — REST market snapshot (shared, isomorphic).
 *
 * A lightweight read of the DreamDEX REST `/markets` surface, used by the
 * failover watcher and the dashboard for discovery + display. This is NEVER the
 * write gate — every write is still gated on LIVE onchain status (§1.2, gotcha
 * #1); REST/indexer data can lag seconds behind chain state.
 *
 * CRITICAL (§1.2, gotcha #10): every market is keyed by its `marketId` (bytes32),
 * which is exactly the `marketKey` the contracts use. We NEVER key by pool
 * address (pools are recycled across windows). Typed `asset`/`intervalSec`/
 * `strike` fields are used directly — never parsed from question text (#11).
 */
import { activeNetwork } from "./chains.js";
import type { Asset, IntervalSec } from "./types.js";

export interface RestMarket {
  /** bytes32 — identical to the on-chain marketKey. */
  marketId: `0x${string}`;
  symbol: string;
  asset: Asset;
  intervalSec: IntervalSec;
  /** Opening/strike price in collateral base units (venue scale). */
  strikeBase: bigint;
  /** Latest Up probability in base units (venue scale), if quoted. */
  upPriceBase: bigint;
  /** Raw numeric status (0..5); gate writes onchain regardless. */
  status: number;
  openTimeSec: number;
  expiryTimeSec: number;
}

function toAsset(a: unknown): Asset {
  const up = String(a ?? "").toUpperCase();
  if (up.includes("BTC")) return "BTC";
  return "ETH";
}
function toInterval(sec: unknown): IntervalSec {
  const n = Number(sec);
  if (n >= 86400) return 86400; // 24h
  if (n >= 14400) return 14400; // 4h
  return 3600;                  // 1h hero (15m/5m from operatorId:4 test harness filtered upstream)
}
/** Scale a human/number price into base units without ever calling toFixed (#3). */
function toBase(v: unknown, scale: bigint): bigint {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  const micro = Math.round(n * 1e9);
  return (BigInt(micro) * scale) / 1_000_000_000n;
}

/**
 * Fetch the current binary markets for a venue from REST. Shape-tolerant: the
 * REST payload has evolved, so we scan defensively and skip anything missing a
 * marketId. `priceScale` defaults to the active network's collateral scale.
 */
export async function fetchBinaryMarketsRest(params: {
  venueId: `0x${string}`;
  priceScale?: bigint;
  fetchImpl?: typeof fetch;
  restUrl?: string;
}): Promise<RestMarket[]> {
  const net = activeNetwork();
  const doFetch = params.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (!doFetch) return [];
  const scale = params.priceScale ?? 10n ** BigInt(net.collateral.decimals);
  const base = params.restUrl ?? net.restUrl;

  try {
    const res = await doFetch(
      `${base}/markets?venueId=${params.venueId}&product=binary`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    const rows = extractRows(body);
    const out: RestMarket[] = [];
    for (const r of rows) {
      const o = r as Record<string, unknown>;
      const marketId = (o.marketId ?? o.id) as string | undefined;
      if (typeof marketId !== "string" || !marketId.startsWith("0x")) continue;
      out.push({
        marketId: marketId as `0x${string}`,
        symbol: String(o.symbol ?? o.ticker ?? ""),
        asset: toAsset(o.asset ?? o.symbol),
        intervalSec: toInterval(o.intervalSec ?? o.interval),
        strikeBase: toBase(o.strike ?? o.openingPrice ?? o.openPrice, scale),
        upPriceBase: toBase(o.upPrice ?? o.priceUp ?? o.markPrice, scale),
        status: Number(o.status ?? o.state ?? 0),
        openTimeSec: Number(o.openTimeSec ?? o.openTime ?? 0),
        expiryTimeSec: Number(o.expiryTimeSec ?? o.expiryTime ?? o.expiry ?? 0),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Best-effort extraction of a market array from a shape-varying REST body. */
function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const key of ["markets", "data", "items", "result"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
}

/** Pick the live-trading market for an asset+interval (most recently opened). */
export function pickTradingMarket(
  markets: RestMarket[],
  asset: Asset,
  intervalSec: IntervalSec,
): RestMarket | undefined {
  return markets
    .filter((m) => m.asset === asset && m.intervalSec === intervalSec && m.status === 1)
    .sort((a, b) => b.openTimeSec - a.openTimeSec)[0];
}
