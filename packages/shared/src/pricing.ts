/**
 * Cadence — bigint-safe pricing & sizing.
 *
 * THE single most dangerous class of bug on Event Contracts (DIRECTIVE §1.7):
 *   #3 — floating-point prices on 18-decimal venues revert with `InvalidPrice`.
 *        `toFixed(18)` produces off-tick values; only 0.25/0.5/0.75 survive
 *        naive float math. Snap to the tick grid as a BIGINT, always.
 *   #6 — size every order to the pool's lot grid; never hand-round amounts.
 *
 * Everything here operates in integer base units. Human floats are accepted only
 * at the boundary and immediately quantized. The vault contract does the final
 * on-chain snap; this mirrors it off-chain so we never *sign* an off-tick order.
 */

/** Down probability is the complement of Up (DIRECTIVE §1.1). */
export function complementPrice(upPrice: number): number {
  return 1 - upPrice;
}

/**
 * Snap a human probability in (0,1) to the venue tick grid, returned as a bigint
 * in price base units. `tick` and `scale` are read live from the pool — never
 * assumed. Example: scale=1e6 (6-dec testnet), tick=1000 (0.001 grid).
 */
export function snapPriceToTick(
  humanProb: number,
  tick: bigint,
  scale: bigint,
): bigint {
  if (!(humanProb > 0 && humanProb < 1)) {
    throw new Error(`price ${humanProb} out of open interval (0,1)`);
  }
  if (tick <= 0n) throw new Error("tick must be > 0");
  // Scale into base units using integer math on a rounded micro-representation
  // to avoid ever calling toFixed on the raw float (gotcha #3).
  const micro = Math.round(humanProb * 1e9); // 9 dp of intermediate precision
  const raw = (BigInt(micro) * scale) / 1_000_000_000n;
  // Snap DOWN to the nearest tick, then guard the (0,1) open interval.
  let snapped = (raw / tick) * tick;
  if (snapped <= 0n) snapped = tick; // never 0
  if (snapped >= scale) snapped = scale - tick; // never >= 1
  return snapped;
}

/**
 * Quantize an order size (in collateral base units) to the pool lot grid.
 * Mirrors ec-core `quantize` / markets-sdk ≥0.24 `amountToPrecision` (gotcha #6).
 * Rounds DOWN so we never exceed an authorized spend limit by a rounding lot.
 */
export function quantizeToLot(amountBaseUnits: bigint, lot: bigint): bigint {
  if (lot <= 0n) throw new Error("lot must be > 0");
  return (amountBaseUnits / lot) * lot;
}

/** Convert a human collateral amount to base units for a given decimals. */
export function toBaseUnits(human: number, decimals: number): bigint {
  if (!Number.isFinite(human) || human < 0) throw new Error(`bad amount ${human}`);
  // Integer path only — split on the decimal point, never toFixed(18) (gotcha #3).
  const [whole = "0", frac = ""] = human.toString().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");

}

/** Format base units back to a human string (display only). */
export function fromBaseUnits(base: bigint, decimals: number): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const d = 10n ** BigInt(decimals);
  const whole = abs / d;
  const frac = (abs % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/**
 * `expireTimestampNs` for an order (gotcha #5): mandatory on every order, set
 * just past the requote interval so a crashed vault's stale orders age off on
 * their own instead of resting live indefinitely. Capped at market expiry.
 */
export function computeExpireNs(params: {
  nowSec: number;
  requoteIntervalSec: number;
  marketExpirySec: number;
}): bigint {
  const { nowSec, requoteIntervalSec, marketExpirySec } = params;
  const target = Math.min(nowSec + requoteIntervalSec + 5, marketExpirySec);
  return BigInt(target) * 1_000_000_000n;
}

/**
 * Time-headroom gate (gotcha #9): skip windows where remaining time is
 * insufficient for the strategy's own timing assumptions. The buffer MUST scale
 * with the interval — a fixed 300s buffer silently breaks 15-minute windows.
 */
export function hasHeadroom(params: {
  nowSec: number;
  expirySec: number;
  intervalSec: number;
}): boolean {
  const { nowSec, expirySec, intervalSec } = params;
  // Require at least 15% of the window (min 20s) remaining.
  const buffer = Math.max(20, Math.floor(intervalSec * 0.15));
  return expirySec - nowSec >= buffer;
}

/**
 * Void-aware realized PnL for a settled position (DIRECTIVE §1.2).
 * A void is BREAK-EVEN (redeem 0.5 each side), NOT a loss — getting this wrong
 * corrupts the reliability dashboard's win-rate math.
 *
 * @returns realized PnL in collateral base units.
 */
export function realizedPnL(params: {
  stakeBaseUnits: bigint;
  redeemedBaseUnits: bigint;
  voided: boolean;
}): bigint {
  // On a void the vault redeems 0.5/side; the router's redeemed amount already
  // reflects the refund, so PnL = redeemed - stake regardless. This helper exists
  // to make the accounting rule explicit and unit-testable.
  return params.redeemedBaseUnits - params.stakeBaseUnits;
}

/** Win-rate excluding voids from BOTH numerator and denominator (§1.2). */
export function winRate(wins: number, losses: number): number {
  const denom = wins + losses;
  return denom === 0 ? 0 : wins / denom;
}
