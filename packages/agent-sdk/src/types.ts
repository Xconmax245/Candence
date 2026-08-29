/**
 * @candence/agent-kit — shared types for the Event Contracts surface.
 */
import type { Address, Hex } from "viem";

/** Market lifecycle. Only `Trading` accepts new orders. */
export enum MarketStatus {
  Listed = 0,
  Trading = 1,
  Locked = 2,
  Settling = 3,
  Resolved = 4,
  Voided = 5,
}

/** The two tradeable outcomes. Down price = 1 - Up price. */
export enum Outcome {
  Up = 0,
  Down = 1,
}

export type Asset = "BTC" | "ETH";
export type IntervalSec = 900 | 3600;

/** A live binary market, ALWAYS keyed by marketId — never by pool address. */
export interface BinaryMarket {
  marketId: Hex;
  symbol: string;
  asset: Asset;
  intervalSec: IntervalSec;
  status: MarketStatus;
  /** Line to beat — window opening price, in price base units. */
  strikeBase: bigint;
  /** Live Up probability in price base units. */
  upPriceBase: bigint;
  openTimeSec: number;
  expiryTimeSec: number;
  poolAddress: Address;
  venueId: Hex;
  /** Tick grid + lot grid, read live from the pool (bigint base units). */
  tick: bigint;
  lot: bigint;
  priceScale: bigint;
}

/** Operator selectors on the DreamDEX OperatorPermissionsRegistry. */
export const OPERATOR_SELECTORS = {
  place: "0x80054449" as Hex,
  cancel: "0xe37b444b" as Hex,
  reduce: "0x364c2587" as Hex,
} as const;

/** A directional decision produced by a strategy. */
export interface Decision {
  /** The side to buy. */
  outcome: Outcome;
  /** Target human probability in (0,1) to quote/cross at. */
  price: number;
  /** Human collateral stake to commit. */
  stake: number;
  /** IOC (no resting remainder) vs resting limit. */
  ioc: boolean;
}
