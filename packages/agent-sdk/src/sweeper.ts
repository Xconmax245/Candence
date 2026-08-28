/**
 * @cadence/agent-kit — the claim / settlement sweeper.
 *
 * Winnings on Event Contracts are CLAIMED, not auto-converted. An agent that
 * never redeems has capital stranded across dozens of finalized markets while
 * its wallet balance looks near-zero. The sweeper is therefore a first-class,
 * always-on responsibility — not a cleanup task.
 *
 * It scans the last N finalized markets (Finalized filter — `loadMarkets()`
 * skips these), redeems every claimable position with an EXPLICIT outcome index,
 * and handles voids correctly: on a void BOTH sides redeem at 0.5 each, which is
 * BREAK-EVEN, not a loss. Redeeming a losing position succeeds and pays 0 (it
 * does not revert), so it is safe to attempt every position.
 *
 * Run it on the SAME key/nonce sequence as trading to avoid nonce races.
 */
import type { Hex } from "viem";
import { MarketStatus, Outcome, type BinaryMarket } from "./types.js";
import { loadFinalizedMarkets, type MarketsClient } from "./client.js";

export interface ClaimResult {
  marketId: Hex;
  outcome: Outcome;
  amountBase: bigint;
  voided: boolean;
  txHash: Hex;
}

/** The redeem surface from the SDK's trader tier (explicit outcome index). */
export interface RedeemClient {
  /**
   * Redeem a position by explicit outcome index. Returns the redeemed amount in
   * base units and the tx hash. Redeeming a loser pays 0 and does not revert.
   */
  redeem(args: { marketId: Hex; outcome: Outcome }): Promise<{ amountBase: bigint; txHash: Hex }>;
  /** Owner's outcome-token balance for a market+outcome (to skip empties). */
  positionOf(args: { marketId: Hex; outcome: Outcome }): Promise<bigint>;
}

export interface SweepOptions {
  /** How many finalized markets to scan (bot-kit default: 25). */
  scanLast?: number;
  /** Called for each successful non-zero claim (feed your telemetry here). */
  onClaim?: (r: ClaimResult) => void;
}

/**
 * Sweep claimable winnings across recently finalized markets. Returns every
 * non-zero claim. Voided markets redeem BOTH sides (0.5 each). Idempotent: once
 * a position is redeemed its balance is 0 and it is skipped next pass.
 */
export async function sweepClaims(
  client: MarketsClient,
  redeemer: RedeemClient,
  venueId: Hex,
  opts: SweepOptions = {},
): Promise<ClaimResult[]> {
  const scanLast = opts.scanLast ?? 25;
  const finalized = (await loadFinalizedMarkets(client, venueId))
    .sort((a, b) => b.expiryTimeSec - a.expiryTimeSec)
    .slice(0, scanLast);

  const claims: ClaimResult[] = [];
  for (const m of finalized) {
    const voided = m.status === MarketStatus.Voided;
    // On a void, redeem both sides; otherwise redeeming the loser pays 0 anyway,
    // so we attempt only sides the owner actually holds (saves gas).
    const sides: Outcome[] = voided ? [Outcome.Up, Outcome.Down] : [Outcome.Up, Outcome.Down];
    for (const outcome of sides) {
      const held = await redeemer.positionOf({ marketId: m.marketId, outcome });
      if (held <= 0n) continue;
      const { amountBase, txHash } = await redeemer.redeem({ marketId: m.marketId, outcome });
      if (amountBase > 0n) {
        const r: ClaimResult = { marketId: m.marketId, outcome, amountBase, voided, txHash };
        claims.push(r);
        opts.onClaim?.(r);
      }
    }
  }
  return claims;
}

/**
 * Compute the currently-outstanding unclaimed winnings across finalized markets,
 * WITHOUT redeeming — a useful reliability metric to surface (a rising number is
 * an early warning the sweeper has stalled).
 */
export async function outstandingUnclaimed(
  client: MarketsClient,
  redeemer: RedeemClient,
  venueId: Hex,
  scanLast = 25,
): Promise<bigint> {
  const finalized = (await loadFinalizedMarkets(client, venueId))
    .sort((a, b) => b.expiryTimeSec - a.expiryTimeSec)
    .slice(0, scanLast);
  let total = 0n;
  for (const m of finalized) {
    for (const outcome of [Outcome.Up, Outcome.Down] as const) {
      total += await redeemer.positionOf({ marketId: m.marketId, outcome });
    }
  }
  return total;
}

/** Convenience: the current window for an asset, most-recently opened + Trading. */
export function pickCurrentWindow(
  markets: BinaryMarket[],
  asset: "BTC" | "ETH",
  intervalSec: number,
): BinaryMarket | undefined {
  return markets
    .filter(
      (m) =>
        m.asset === asset &&
        m.intervalSec === intervalSec &&
        m.status === MarketStatus.Trading,
    )
    .sort((a, b) => b.openTimeSec - a.openTimeSec)[0];
}
