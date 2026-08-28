/**
 * Cadence AI copilot — directional signal computation (DIRECTIVE §5).
 *
 * Produces a directional score in [-1, 1] (>0 favors Up) and a confidence in
 * [0, 1] for a given window, from REAL market data only (no mock data, §3):
 *
 *   1. Momentum:   sign & magnitude of recent mark-price drift vs the window
 *                  strike (opening price). This is the dominant term.
 *   2. Microstructure: order-book imbalance (bid vs ask depth) as a lighter,
 *                  faster-moving confirmation term.
 *   3. Optional LLM overlay: an async narrative/analysis call that can nudge the
 *                  score. It is STRICTLY off the critical path — if it is slow or
 *                  errors, we ship the quantitative score on time regardless
 *                  (§5). The loop never waits past its latency budget for it.
 *
 * The score is deterministic given its inputs so the same window always attests
 * consistently. All inputs are fetched live; nothing here is fabricated.
 */
import type { Asset, IntervalSec } from "@cadence/shared";

export interface Candle {
  openSec: number;
  closePrice: number;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface SignalInputs {
  asset: Asset;
  intervalSec: IntervalSec;
  /** Window opening price — the line to beat (§1.1). */
  strike: number;
  /** Latest mark price. */
  markPrice: number;
  /** Recent candles (oldest→newest), same asset. */
  candles: Candle[];
  /** Top-of-book depth for the Up token, optional. */
  book?: { bids: BookLevel[]; asks: BookLevel[] };
}

export interface SignalOutput {
  /** Directional score in [-1, 1]; >0 favors Up. */
  score: number;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Human-readable component breakdown for the dashboard's transparency panel. */
  components: {
    momentum: number;
    imbalance: number;
    llm: number;
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** tanh without Math.tanh dependency quirks; squashes to (-1, 1). */
function squash(x: number): number {
  const e2 = Math.exp(-2 * x);
  return (1 - e2) / (1 + e2);
}

/**
 * Momentum term: recent drift of mark vs strike, normalized by realized vol of
 * the candle series so a calm market and a volatile one are comparable.
 */
function momentumTerm(inp: SignalInputs): number {
  const rel = (inp.markPrice - inp.strike) / (inp.strike || 1);
  // realized vol proxy: mean abs of consecutive returns.
  let vol = 0;
  for (let i = 1; i < inp.candles.length; i++) {
    const prev = inp.candles[i - 1];
    const cur = inp.candles[i];
    if (!prev || !cur) continue;
    const a = prev.closePrice;
    const b = cur.closePrice;
    if (a > 0) vol += Math.abs((b - a) / a);
  }

  vol = inp.candles.length > 1 ? vol / (inp.candles.length - 1) : 0;
  const denom = Math.max(vol, 0.0005); // floor so a flat series doesn't explode
  return squash(rel / denom);
}

/** Order-book imbalance term in [-1, 1]: (bidDepth - askDepth)/(sum). */
function imbalanceTerm(inp: SignalInputs): number {
  if (!inp.book) return 0;
  const depth = (levels: BookLevel[]): number =>
    levels.slice(0, 5).reduce((s, l) => s + Math.max(0, l.size), 0);
  const bid = depth(inp.book.bids);
  const ask = depth(inp.book.asks);
  const total = bid + ask;
  if (total <= 0) return 0;
  return clamp((bid - ask) / total, -1, 1);
}

/** Optional async LLM overlay. Off the critical path; returns 0 on any failure. */
export type LlmOverlay = (inp: SignalInputs) => Promise<number>;

/**
 * Compute the signal. `llm` is awaited only up to `llmBudgetMs`; if it doesn't
 * resolve in time (or throws), we proceed with the quantitative score alone and
 * mark the llm component 0 — the signal is NEVER delayed for the model (§5).
 */
export async function computeSignal(
  inp: SignalInputs,
  opts?: { llm?: LlmOverlay; llmBudgetMs?: number },
): Promise<SignalOutput> {
  const momentum = momentumTerm(inp);
  const imbalance = imbalanceTerm(inp);

  let llm = 0;
  if (opts?.llm) {
    const budget = opts.llmBudgetMs ?? 1500;
    try {
      llm = await Promise.race<number>([
        opts.llm(inp),
        new Promise<number>((resolve) => setTimeout(() => resolve(0), budget)),
      ]);
      llm = clamp(Number.isFinite(llm) ? llm : 0, -1, 1);
    } catch {
      llm = 0; // model failure never blocks or corrupts the signal
    }
  }

  // Weighted blend. Momentum dominates; imbalance confirms; llm nudges.
  const score = clamp(0.6 * momentum + 0.25 * imbalance + 0.15 * llm, -1, 1);

  // Confidence rises with agreement between terms and with |score|.
  const agree =
    Math.sign(momentum) === Math.sign(imbalance) && imbalance !== 0 ? 0.2 : 0;
  const confidence = clamp(Math.abs(score) * 0.8 + agree, 0, 1);

  return { score, confidence, components: { momentum, imbalance, llm } };
}
