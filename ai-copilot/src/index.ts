/**
 * Candence AI copilot — main loop (DIRECTIVE §5).
 *
 * A strict window-aligned clock that, once per window and WELL INSIDE the window
 * so vaults can read it in time:
 *   1. Discovers the live BTC/ETH windows (REST snapshot, keyed by marketId).
 *   2. Pulls recent candles + book from the live REST surface (no mock data, §3).
 *   3. Computes a directional signal (src/signal.ts) with an optional, budgeted
 *      LLM overlay that can never delay the attestation.
 *   4. Attests + posts it onchain (src/attest.ts) so an AI-assisted vault MAY
 *      read it — with the vault's Reactive fallback fully intact if we're late.
 *   5. Grades the previous window's signal once it has resolved (§6 signal quality).
 *
 * Latency budget (§5): posting targets the first ~20% of the window. If a post
 * is late or fails, that vault simply falls back to Reactive for the window — we
 * log it, never hide it, and NEVER block an order.
 *
 * Run: `pnpm copilot`
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  activeNetwork,
  resolveVenueId,
  fetchBinaryMarketsRest,
  readDeploymentAddresses,
  computeWindowKey,
  fromBaseUnits,
  windowOpenFor,
  type Asset,
  type IntervalSec,
  type RestMarket,
} from "@candence/shared";
import { computeSignal, type Candle, type SignalInputs } from "./signal.js";
import { attestAndPost, gradeWindow, type PostContext } from "./attest.js";

const INTERVAL: IntervalSec = 3600; // 1h hero window (§0.1 — live testnet has 1h/4h/24h, no 15m on operatorId:2)
const POST_WITHIN_FRACTION = 0.2; // post inside the first 20% of the window
const ASSETS: Asset[] = ["BTC", "ETH"];

function requireSignerPk(): Hex {
  const pk = process.env.COPILOT_SIGNER_KEY ?? process.env.SIGNER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("COPILOT_SIGNER_KEY missing/invalid (expected 0x + 64 hex).");
  }
  return pk as Hex;
}

/** Fetch recent candles for an asset from the REST candles surface (live data). */
async function fetchCandles(
  restUrl: string,
  symbol: string,
  intervalSec: number,
): Promise<Candle[]> {
  try {
    const res = await fetch(
      `${restUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=${intervalSec}&limit=32`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    const rows = Array.isArray(body)
      ? body
      : ((body as { candles?: unknown[]; data?: unknown[] }).candles ??
        (body as { data?: unknown[] }).data ??
        []);
    return (rows as Record<string, unknown>[])
      .map((r) => ({
        openSec: Number(r.openTime ?? r.time ?? r.t ?? 0),
        closePrice: Number(r.close ?? r.c ?? r.closePrice ?? 0),
      }))
      .filter((c) => c.closePrice > 0)
      .sort((a, b) => a.openSec - b.openSec);
  } catch {
    return [];
  }
}

interface PendingGrade {
  windowKey: Hex;
  marketId: Hex;
  intervalSec: IntervalSec;
  scoreUp: boolean;
  strike: number;
}

async function main(): Promise<void> {
  const net = activeNetwork();
  const addrs = readDeploymentAddresses(net.name);
  const attestor = addrs?.CopilotAttestor as Address | undefined;
  if (!attestor) {
    throw new Error(`No CopilotAttestor in deployments/${net.name}.json — deploy first.`);
  }
  const signer = privateKeyToAccount(requireSignerPk());
  const ctx: PostContext = { attestor, signer };
  const { venueId } = await resolveVenueId();
  const priceScale = 10n ** BigInt(net.collateral.decimals);

  // eslint-disable-next-line no-console
  console.log(
    `\nCandence AI copilot (attested signals — OFF the reactive critical path)\n` +
      `  network:  ${net.name} (${net.chainId})\n` +
      `  attestor: ${attestor}\n` +
      `  signer:   ${signer.address}\n` +
      `  venue:    ${venueId}\n` +
      `  interval: ${INTERVAL}s, posting within first ${POST_WITHIN_FRACTION * 100}%\n`,
  );

  // windowKeys we've already posted this process, to avoid double-posting.
  const posted = new Set<string>();
  // windows awaiting grading once resolved.
  const toGrade: PendingGrade[] = [];

  async function tick(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const markets = await fetchBinaryMarketsRest({ venueId, priceScale });

    // ── Grade any pending windows that have now resolved ──
    for (let i = toGrade.length - 1; i >= 0; i--) {
      const g = toGrade[i];
      if (!g) continue;
      const m = markets.find(
        (x: RestMarket) => x.marketId.toLowerCase() === g.marketId.toLowerCase(),
      );

      // Resolved(4) or Voided(5): grade against settlement (void → treat as incorrect-neutral).
      if (m && (m.status === 4 || m.status === 5)) {
        const settled = Number(fromBaseUnits(m.upPriceBase, net.collateral.decimals));
        // Up won if settlement (proxied by final up-prob≈1) favored Up.
        const upWon = m.status === 4 ? settled >= 0.5 : false;
        const correct = m.status === 5 ? false : g.scoreUp === upWon;
        const res = await gradeWindow(ctx, g.windowKey, correct);
        // eslint-disable-next-line no-console
        console.log(
          "txHash" in res
            ? `  graded ${g.windowKey.slice(0, 10)}… correct=${correct} (${res.txHash.slice(0, 10)}…)`
            : `  grade failed ${g.windowKey.slice(0, 10)}…: ${res.error}`,
        );
        toGrade.splice(i, 1);
      }
    }

    // ── Post signals for the current live windows ──
    for (const asset of ASSETS) {
      const market = pickCurrent(markets, asset, INTERVAL);
      if (!market) {
        // Loud, not silent: if no Trading market exists for this asset+interval,
        // log it every tick so ops/dashboard can detect "copilot alive but idle"
        // as distinct from normal posting. §5: silence here means AI-division
        // would appear healthy while posting zero signals.
        // eslint-disable-next-line no-console
        console.warn(
          `  [${new Date().toISOString()}] no live ${asset} ${INTERVAL}s Trading market found — skipping tick`,
        );
        continue;
      }

      const windowOpenSec = market.expiryTimeSec - INTERVAL;
      const elapsed = nowSec - windowOpenSec;
      // Only post inside the early fraction of the window (latency budget, §5).
      if (elapsed < 0 || elapsed > INTERVAL * POST_WITHIN_FRACTION) continue;

      const windowKey = computeWindowKey(market.marketId, windowOpenSec);
      if (posted.has(windowKey.toLowerCase())) continue;

      const strike = Number(fromBaseUnits(market.strikeBase, net.collateral.decimals));
      const markPrice =
        Number(fromBaseUnits(market.upPriceBase, net.collateral.decimals)) || strike;
      const candles = await fetchCandles(net.restUrl, market.symbol, INTERVAL);
      const inputs: SignalInputs = {
        asset,
        intervalSec: INTERVAL,
        strike,
        markPrice,
        candles,
      };
      const signal = await computeSignal(inputs, { llmBudgetMs: 1200 });

      const res = await attestAndPost(
        ctx,
        { asset, intervalSec: INTERVAL, marketId: market.marketId, windowOpenSec, issuedAtSec: nowSec },
        signal,
      );
      if ("txHash" in res) {
        posted.add(windowKey.toLowerCase());
        toGrade.push({
          windowKey,
          marketId: market.marketId,
          intervalSec: INTERVAL,
          scoreUp: signal.score >= 0,
          strike,
        });
        // eslint-disable-next-line no-console
        console.log(
          `  posted ${asset} ${INTERVAL}s score=${signal.score.toFixed(3)} ` +
            `conf=${signal.confidence.toFixed(3)} (${res.txHash.slice(0, 10)}…)`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`  post failed ${asset}: ${res.error} — vaults fall back to Reactive.`);
      }
    }
  }

  // Align the clock: run near each window open, plus a mid-window safety tick.
  await tick();
  setInterval(() => void tick(), 30_000);

  process.on("SIGINT", () => {
    // eslint-disable-next-line no-console
    console.log("\n  copilot shutting down …");
    process.exit(0);
  });
}

/** Most-recently-opened live-Trading market for an asset+interval. */
function pickCurrent(
  markets: RestMarket[],
  asset: Asset,
  intervalSec: IntervalSec,
): RestMarket | undefined {
  return markets
    .filter((m) => m.asset === asset && m.intervalSec === intervalSec && m.status === 1)
    .sort((a, b) => b.openTimeSec - a.openTimeSec)[0];
}

// windowOpenFor is re-exported for the CLI helper; reference it so it's kept.
void windowOpenFor;

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("\n✗ copilot failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
