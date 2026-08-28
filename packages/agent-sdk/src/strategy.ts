/**
 * @cadence/agent-kit — the strategy interface and a reference reactive strategy.
 *
 * A Strategy is a pure function from live market state to an optional Decision.
 * It performs NO IO and signs NOTHING — the runner does the status-gating,
 * balance check, tick/lot snapping, and placement. This separation is what makes
 * a strategy trivially unit-testable and impossible to accidentally wire onto a
 * cached-status path.
 */
import { Outcome, type BinaryMarket, type Decision } from "./types.js";
import { fromBaseUnits } from "./pricing.js";

export interface StrategyContext {
  market: BinaryMarket;
  nowSec: number;
  /** Recent Up-probability history for this symbol (human floats, oldest→newest). */
  upPriceHistory: number[];
  /**
   * Optional attested directional signal in [-1,1] for the current window, if an
   * AI copilot posted one and it verified. Undefined ⇒ the strategy runs on pure
   * reactive rules (the mandatory fallback). A strategy MUST behave sensibly with
   * or without it.
   */
  signal?: number;
  /** Per-decision human stake ceiling (the runner also enforces the hard cap). */
  maxStake: number;
}

export type Strategy = (ctx: StrategyContext) => Decision | null;

/** Simple EMA over a series. */
function ema(values: number[], period: number): number | null {
  if (values.length === 0) return null;
  const k = 2 / (period + 1);
  let e = values[0]!;
  for (let i = 1; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

/**
 * Reference reactive momentum strategy:
 *  - Compute the EMA of recent Up probability.
 *  - If live Up prob is meaningfully above its EMA (upward momentum), buy Up;
 *    if below, buy Down. The edge is the deviation from the EMA.
 *  - If an attested AI signal is present, blend it in as a light tilt — but the
 *    decision is fully defined WITHOUT it (graceful degradation).
 *  - Cross for a fast fill (IOC) rather than resting, on the hero 1h path.
 *
 * Returns null when there's no clear edge (do nothing this window).
 */
export function reactiveMomentum(opts?: {
  emaPeriod?: number;
  minEdge?: number;
  signalWeight?: number;
}): Strategy {
  const emaPeriod = opts?.emaPeriod ?? 8;
  const minEdge = opts?.minEdge ?? 0.03;
  const signalWeight = opts?.signalWeight ?? 0.25;

  return (ctx: StrategyContext): Decision | null => {
    const up = Number(fromBaseUnits(ctx.market.upPriceBase, decimalsOf(ctx.market)));
    const base = ema(ctx.upPriceHistory, emaPeriod);
    if (base === null) return null;

    // Reactive edge from momentum, plus optional AI tilt.
    let edge = up - base;
    if (typeof ctx.signal === "number") edge += signalWeight * ctx.signal * 0.1;

    if (Math.abs(edge) < minEdge) return null;

    const outcome = edge > 0 ? Outcome.Up : Outcome.Down;
    // Buy the chosen side near its current market price. Down price = 1 - up.
    const price = outcome === Outcome.Up ? up : 1 - up;
    // Kelly-lite: scale stake by edge magnitude, capped at maxStake.
    const frac = Math.min(1, Math.abs(edge) / (minEdge * 4));
    const stake = Math.max(0, Math.min(ctx.maxStake, ctx.maxStake * frac));
    if (stake <= 0) return null;

    return {
      outcome,
      price: clampProb(price),
      stake,
      ioc: true, // hero 1h path crosses for a fast fill; no resting exposure
    };
  };
}

function clampProb(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

/** Price base units share the collateral decimals on these venues. */
function decimalsOf(m: BinaryMarket): number {
  // priceScale = 10 ** decimals.
  let d = 0;
  let s = m.priceScale;
  while (s > 1n) {
    s /= 10n;
    d++;
  }
  return d;
}
