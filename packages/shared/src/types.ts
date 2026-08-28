/**
 * Cadence — shared domain types.
 * Mirrors the Event Contracts protocol surface (DIRECTIVE §1) and Cadence's own
 * telemetry model (DIRECTIVE §4.1, §6).
 */

/** Market lifecycle (DIRECTIVE §1.2). Only `Trading` accepts new orders. */
export enum MarketStatus {
  Listed = 0,
  Trading = 1,
  Locked = 2,
  Settling = 3, // almost never observable — never build logic that depends on catching it
  Resolved = 4,
  Voided = 5,
}

/** The two tradeable outcomes. Down price = 1 - Up price (§1.1). */
export enum Outcome {
  Up = 0,
  Down = 1,
}

export type Asset = "BTC" | "ETH";

/** Hero + secondary windows (DIRECTIVE §0.1 corrected — live testnet: 1h hero, 4h + 24h secondary; 15m only exists on operatorId:4 test harness, never trade it). */
export type IntervalSec = 3600 | 14400 | 86400;

/**
 * A resolved binary market. ALWAYS keyed by `marketId` / symbol — NEVER by pool
 * address (DIRECTIVE §1.2, gotcha #10). Typed fields only; never parse question
 * text (gotcha #11).
 */
export interface BinaryMarket {
  marketId: string;
  symbol: string;
  asset: Asset;
  intervalSec: IntervalSec;
  /** The line to beat — window opening price (§1.1). */
  strike: number;
  status: MarketStatus;
  openTimeSec: number;
  expiryTimeSec: number;
  /** Live Up probability in (0,1). Down = 1 - up. */
  upPrice: number;
  /** Resolved pool address for THIS window only — never persist/key by it. */
  poolAddress: `0x${string}`;
  venueId: `0x${string}`;
}

/** Vault decision modes, immutable per instance (DIRECTIVE §4.2). */
export type VaultMode = "reactive" | "ai-assisted";

/** Outcome of a single reactive handler invocation (DIRECTIVE §4.1). */
export type HandlerOutcome = "succeeded" | "failed" | "skipped";

export interface HandlerEvent {
  outcome: HandlerOutcome;
  vault: `0x${string}`;
  marketId: string;
  /** ms latency from price-event delivery to order placement (reactive path). */
  latencyMs?: number;
  blockNumber: bigint;
  txHash?: `0x${string}`;
  reason?: string;
  timestampSec: number;
}

/** A directional signal from the AI copilot (DIRECTIVE §5). */
export interface AttestedSignal {
  asset: Asset;
  intervalSec: IntervalSec;
  /**
   * The on-chain market id (bytes32) this signal targets. Combined with
   * `windowOpenSec` it derives the exact `windowKey` the AgentVault reads and the
   * CopilotAttestor stores — see attest.computeWindowKey. NEVER a pool address.
   */
  marketId: `0x${string}`;
  /** Window open time this signal targets — the alignment key (= expiry − interval). */
  windowOpenSec: number;
  /**
   * keccak256(abi.encode(marketId, windowOpenSec)) — the storage key on the
   * CopilotAttestor and the AgentVault. Precomputed so consumers don't re-derive.
   */
  windowKey: `0x${string}`;
  /** Directional score in [-1, 1]: >0 favors Up, <0 favors Down. */
  score: number;
  /** Confidence in [0,1]. */
  confidence: number;
  issuedAtSec: number;
  /** Attestation signer + signature (EIP-191 personal_sign over the digest). */
  signer: `0x${string}`;
  signature: `0x${string}`;
  /** Post-resolution: was it directionally correct? null until resolved. */
  correct?: boolean | null;
}


/** A claim sweep event (DIRECTIVE §4.6). */
export interface ClaimEvent {
  vault: `0x${string}`;
  marketId: string;
  outcomeIndex: Outcome;
  /** Amount redeemed in collateral base units. */
  amount: bigint;
  /** True when the market voided (redeemed at 0.5 — break-even, not a loss). */
  voided: boolean;
  txHash: `0x${string}`;
  timestampSec: number;
}

/** Aggregated per-vault performance (DIRECTIVE §6). Void = break-even (§1.2). */
export interface VaultStats {
  vault: `0x${string}`;
  name: string;
  mode: VaultMode;
  wins: number;
  losses: number;
  voids: number; // break-even — excluded from win-rate denominator's loss side
  /** wins / (wins + losses); voids excluded entirely (§1.2 accounting rule). */
  winRate: number;
  roiBps: number;
  volumeCollateral: bigint;
  unclaimedOutstanding: bigint;
  somiBalance: bigint;
}
