/**
 * @candence/agent-kit — bigint-safe pricing & sizing.
 *
 * The single most dangerous class of bug on Event Contracts: floating-point
 * prices on 18-decimal venues revert with `InvalidPrice`. `toFixed(18)` produces
 * off-tick values; only 0.25/0.5/0.75 survive naive float math. This module
 * keeps everything in integer base units and snaps to the venue tick/lot grid as
 * a bigint — always. Human floats are accepted only at the boundary and
 * immediately quantized.
 */

/** Down probability is the complement of Up. */
export function complementPrice(upPrice: number): number {
  return 1 - upPrice;
}

/**
 * Snap a human probability in (0,1) to the venue tick grid, returned as a bigint
 * in price base units. `tick` and `scale` MUST be read live from the pool.
 * Snaps DOWN, then clamps strictly inside the open interval (0,1).
 */
export function snapPriceToTick(humanProb: number, tick: bigint, scale: bigint): bigint {
  if (!(humanProb > 0 && humanProb < 1)) {
    throw new Error(`price ${humanProb} out of open interval (0,1)`);
  }
  if (tick <= 0n) throw new Error("tick must be > 0");
  const micro = Math.round(humanProb * 1e9);
  const raw = (BigInt(micro) * scale) / 1_000_000_000n;
  let snapped = (raw / tick) * tick;
  if (snapped <= 0n) snapped = tick;
  if (snapped >= scale) snapped = scale - tick;
  return snapped;
}

/** Quantize an order size to the pool lot grid. Rounds DOWN (never overspend). */
export function quantizeToLot(amountBaseUnits: bigint, lot: bigint): bigint {
  if (lot <= 0n) throw new Error("lot must be > 0");
  return (amountBaseUnits / lot) * lot;
}

/** Convert a human collateral amount to base units without ever calling toFixed. */
export function toBaseUnits(human: number, decimals: number): bigint {
  if (!Number.isFinite(human) || human < 0) throw new Error(`bad amount ${human}`);
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
 * `expireTimestampNs` for an order — mandatory on every order, capped at market
 * expiry. Set it just past the requote interval so a crashed agent's stale
 * orders age off on their own instead of resting live indefinitely.
 */
export function computeExpireNs(params: {
  nowSec: number;
  requoteIntervalSec: number;
  marketExpirySec: number;
}): bigint {
  const target = Math.min(
    params.nowSec + params.requoteIntervalSec + 5,
    params.marketExpirySec,
  );
  return BigInt(target) * 1_000_000_000n;
}

/**
 * Time-headroom gate: skip windows where remaining time is insufficient for the
 * strategy's timing assumptions. The buffer MUST scale with the interval — a
 * fixed 300s buffer silently breaks 15-minute windows.
 */
export function hasHeadroom(params: {
  nowSec: number;
  expirySec: number;
  intervalSec: number;
}): boolean {
  const buffer = Math.max(20, Math.floor(params.intervalSec * 0.15));
  return params.expirySec - params.nowSec >= buffer;
}

/** Window-open timestamp for a given time + interval. */
export function windowOpenFor(nowSec: number, intervalSec: number): number {
  return Math.floor(nowSec / intervalSec) * intervalSec;
}
