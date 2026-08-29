/**
 * @candence/agent-kit — market discovery & status gating.
 *
 * The golden rule: gate EVERY write on live onchain status === Trading (1). The
 * indexer can lag seconds behind chain state, so `assertTradable` re-reads status
 * directly onchain immediately before you sign. Discovery is keyed by marketId
 * (never pool address) and includes finalized markets so the sweeper can find
 * unclaimed winnings — `loadMarkets()` alone skips finalized binaries.
 */
import type { Address, Hex, PublicClient } from "viem";
import { MarketStatus, type BinaryMarket } from "./types.js";

/**
 * The minimal read surface this kit needs from `@somnia-chain/markets-sdk`'s
 * client tier. Passing it as an interface keeps the kit decoupled from any
 * specific SDK minor version while still requiring ≥ 0.25.0 at the peer level.
 */
export interface MarketsClient {
  listBinaryMarkets(args: {
    venueId: Hex;
    status?: "Trading" | "Finalized" | "All";
  }): Promise<RawMarket[]>;
  /** Live onchain status for a single market (the authoritative gate). */
  getMarketStatus(marketId: Hex): Promise<number>;
}

/** The raw shape returned by the SDK; normalized into BinaryMarket below. */
export interface RawMarket {
  marketId: Hex;
  symbol: string;
  asset: string;
  intervalSec: number;
  status: number;
  strike: bigint;
  upPrice: bigint;
  openTime: number;
  expiryTime: number;
  pool: Address;
  venueId: Hex;
  tick: bigint;
  lot: bigint;
  priceScale: bigint;
}

function normalize(m: RawMarket): BinaryMarket | null {
  if (m.asset !== "BTC" && m.asset !== "ETH") return null;
  if (m.intervalSec !== 900 && m.intervalSec !== 3600) return null;
  return {
    marketId: m.marketId,
    symbol: m.symbol,
    asset: m.asset,
    intervalSec: m.intervalSec,
    status: m.status as MarketStatus,
    strikeBase: m.strike,
    upPriceBase: m.upPrice,
    openTimeSec: m.openTime,
    expiryTimeSec: m.expiryTime,
    poolAddress: m.pool,
    venueId: m.venueId,
    tick: m.tick,
    lot: m.lot,
    priceScale: m.priceScale,
  };
}

/** Live Trading markets for the venue (the tradable set). */
export async function loadTradableMarkets(
  client: MarketsClient,
  venueId: Hex,
): Promise<BinaryMarket[]> {
  const raw = await client.listBinaryMarkets({ venueId, status: "Trading" });
  return raw.map(normalize).filter((m): m is BinaryMarket => m !== null);
}

/**
 * Finalized markets for the venue — the sweeper's input. MUST use the Finalized
 * status filter; `loadMarkets()` skips these and makes an agent look idle when it
 * actually has unclaimed winnings.
 */
export async function loadFinalizedMarkets(
  client: MarketsClient,
  venueId: Hex,
): Promise<BinaryMarket[]> {
  const raw = await client.listBinaryMarkets({ venueId, status: "Finalized" });
  return raw.map(normalize).filter((m): m is BinaryMarket => m !== null);
}

/**
 * THE write gate. Re-reads live onchain status and throws unless it is exactly
 * Trading (1). Call this immediately before every order — never trust a cached
 * or indexed status.
 */
export async function assertTradable(client: MarketsClient, marketId: Hex): Promise<void> {
  const status = await client.getMarketStatus(marketId);
  if (status !== MarketStatus.Trading) {
    throw new Error(
      `market ${marketId.slice(0, 10)}… not Trading (onchain status=${status}) — refusing to place order`,
    );
  }
}

/**
 * Check the OWNER's wallet has enough collateral to cover a stake. Escrow leaves
 * from and returns to the owner's wallet (not the vault), so checking here avoids
 * burning gas on an avoidable revert.
 */
export async function ownerHasBalance(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
  needBase: bigint,
): Promise<boolean> {
  const bal = (await publicClient.readContract({
    address: token,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "a", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
  return bal >= needBase;
}
