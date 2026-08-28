/**
 * @cadence/agent-kit — the agent runner.
 *
 * Ties a pure Strategy to the live chain with EVERY safety gate applied in the
 * right order, so a strategy author cannot accidentally skip one:
 *
 *   1. Re-read live onchain status; refuse unless Trading (1).  (never the indexer)
 *   2. Enforce time headroom scaled to the interval.            (no 300s-on-15m bug)
 *   3. Ask the strategy for a Decision (pure, no IO).
 *   4. Enforce the hard spend cap.                              (contract-mirrored)
 *   5. Check the OWNER's wallet balance.                        (escrow is owner-side)
 *   6. Snap price to tick + size to lot, as bigints.            (never float → revert)
 *   7. Place via the operator `*For` variant so fills settle to the OWNER.
 *   8. Verify the receipt (SDK writes skip simulation).
 *
 * This is deliberately the ONLY path to placement in the kit. The reactive
 * decision *trigger* (the 0x0100 precompile) lives in Cadence's contracts; this
 * runner is what an offchain agent or the operator loop calls once triggered.
 */
import type { Address, Hex } from "viem";
import {
  assertTradable,
  ownerHasBalance,
  type MarketsClient,
} from "./client.js";
import {
  snapPriceToTick,
  quantizeToLot,
  toBaseUnits,
  computeExpireNs,
  hasHeadroom,
} from "./pricing.js";
import { encodePlaceOrderFor } from "./operator.js";
import { type BinaryMarket, type Decision } from "./types.js";
import type { Strategy, StrategyContext } from "./strategy.js";

export interface PlaceSender {
  /**
   * Send a pre-encoded `placeOrderFor` call to the exchange and return the tx
   * hash + success. Wrap your walletClient here; the runner never holds a key.
   */
  sendPlaceOrderFor(to: Address, data: Hex): Promise<{ txHash: Hex; success: boolean }>;
  /** The exchange/module address the encoded call targets. */
  exchangeAddress: Address;
  /** The collateral token (checked against the owner's wallet). */
  collateralToken: Address;
  /** viem PublicClient for the balance read. */
  publicClient: import("viem").PublicClient;
}

export interface RunnerConfig {
  owner: Address;
  /** Hard per-order human stake cap. Mirrors the vault's onchain spend limit. */
  maxStake: number;
  /** Requote interval — drives order expiry so stale orders age off. */
  requoteIntervalSec: number;
  collateralDecimals: number;
}

export type RunOutcome =
  | { status: "placed"; txHash: Hex; decision: Decision }
  | { status: "skipped"; reason: string };

/**
 * Evaluate a strategy for one market and, if it decides to act, place the order
 * with all gates applied. Returns a structured outcome — the caller feeds this
 * straight into telemetry (`HandlerSucceeded` / `HandlerSkipped`).
 */
export async function runOnce(
  cfg: RunnerConfig,
  client: MarketsClient,
  sender: PlaceSender,
  strategy: Strategy,
  market: BinaryMarket,
  extra: { nowSec: number; upPriceHistory: number[]; signal?: number },
): Promise<RunOutcome> {
  // 2. Time headroom (scaled to interval — never a fixed buffer).
  if (!hasHeadroom({ nowSec: extra.nowSec, expirySec: market.expiryTimeSec, intervalSec: market.intervalSec })) {
    return { status: "skipped", reason: "insufficient-headroom" };
  }

  // 3. Pure strategy decision.
  const ctx: StrategyContext = {
    market,
    nowSec: extra.nowSec,
    upPriceHistory: extra.upPriceHistory,
    signal: extra.signal,
    maxStake: cfg.maxStake,
  };
  const decision = strategy(ctx);
  if (!decision) return { status: "skipped", reason: "no-edge" };

  // 4. Hard spend cap (defense in depth; the vault also enforces this onchain).
  if (decision.stake > cfg.maxStake) {
    return { status: "skipped", reason: "over-spend-cap" };
  }

  // 1. Live onchain status gate — LAST read before signing.
  try {
    await assertTradable(client, market.marketId);
  } catch (e) {
    return { status: "skipped", reason: e instanceof Error ? e.message : "not-tradable" };
  }

  // 6. Snap to grids as bigints.
  const priceBase = snapPriceToTick(decision.price, market.tick, market.priceScale);
  const rawSize = toBaseUnits(decision.stake, cfg.collateralDecimals);
  const sizeBase = quantizeToLot(rawSize, market.lot);
  if (sizeBase <= 0n) return { status: "skipped", reason: "size-below-lot" };

  // 5. Owner wallet balance check (escrow leaves the owner's wallet).
  const ok = await ownerHasBalance(sender.publicClient, sender.collateralToken, cfg.owner, sizeBase);
  if (!ok) return { status: "skipped", reason: "owner-insufficient-balance" };

  // 7. Encode + place via the operator variant (settles to the OWNER).
  const expireTimestampNs = computeExpireNs({
    nowSec: extra.nowSec,
    requoteIntervalSec: cfg.requoteIntervalSec,
    marketExpirySec: market.expiryTimeSec,
  });
  const data = encodePlaceOrderFor({
    owner: cfg.owner,
    marketId: market.marketId,
    outcome: decision.outcome,
    priceBase,
    sizeBase,
    ioc: decision.ioc,
    expireTimestampNs,
  });

  // 8. Send + verify receipt (SDK writes skip simulation — always check).
  const { txHash, success } = await sender.sendPlaceOrderFor(sender.exchangeAddress, data);
  if (!success) return { status: "skipped", reason: `place-reverted:${txHash}` };
  return { status: "placed", txHash, decision };
}
