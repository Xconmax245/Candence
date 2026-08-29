/**
 * Candence — WebSocket Fallback Watcher (DIRECTIVE §4.5).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS NOT THE DECISION PATH.                                            │
 * │ The reactive precompile (0x0100) → ReactivitySubscriber → AgentVault is   │
 * │ the ONLY decision path (§0.2). This watcher exists solely to PROVE the    │
 * │ system survives precompile congestion / gas exhaustion: it detects a      │
 * │ price update the reactive path *should* have handled but didn't, and      │
 * │ submits an onchain catch-up trigger so the miss is repaired AT THE        │
 * │ REACTIVE LAYER — never by routing around it.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Every activation increments the subscriber's onchain `fallbackActivations`
 * counter and is surfaced on the dashboard as a DISTINCT "fallback trigger"
 * count (§6). A run showing the fallback cleanly catching a few real misses is
 * a STRONGER story than one claiming zero — it's the demo's proof point.
 *
 * Correctness details that matter (verified against the deployed contracts):
 *  - `marketKey` IS the on-chain `marketId` (bytes32). We resolve it from the
 *    REST market snapshot by symbol — NEVER by hashing a string, never by pool
 *    address (§1.2 #10). The snapshot is refreshed so window rollovers are
 *    tracked (a new window = a new marketId).
 *  - `submitFallbackTrigger(bytes32 marketKey, bytes data)` needs the SAME
 *    96-byte payload the vault decodes: [marketId][markPrice][strike]. We build
 *    it with the shared `encodeReactivePayload` codec so it can never drift.
 *  - A price event is only escalated if NO `HandlerSucceeded` for its marketKey
 *    appears within GRACE_MS — we give the reactive path every chance first.
 *  - The watcher key must be allowlisted via subscriber.setFallbackWatcher().
 *
 * Run: `pnpm watcher`
 */
import "dotenv/config";
import WebSocket from "ws";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  type Hex,
  type Abi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  activeNetwork,
  viemChainFor,
  resolveVenueId,
  fetchBinaryMarketsRest,
  encodeReactivePayload,
  readDeploymentAddresses,
  CandenceAbi,
  type RestMarket,
} from "@candence/shared";

const GRACE_MS = Number(process.env.WATCHER_GRACE_MS ?? 4000);
const BACKOFF_MAX_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const SNAPSHOT_REFRESH_MS = 30_000; // re-read markets so window rollovers are tracked

interface PendingMiss {
  marketId: Hex;
  symbol: string;
  markPriceBase: bigint;
  strikeBase: bigint;
  seenAt: number;
  timer: NodeJS.Timeout;
}

function requireWatcherPk(): Hex {
  const pk = process.env.WATCHER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("WATCHER_PRIVATE_KEY missing/invalid (expected 0x + 64 hex).");
  }
  return pk as Hex;
}

async function main(): Promise<void> {
  const net = activeNetwork();
  const addrs = readDeploymentAddresses(net.name);
  const maybeSubscriber = addrs?.ReactivitySubscriber as Address | undefined;
  if (!maybeSubscriber) {
    throw new Error(`No ReactivitySubscriber in deployments/${net.name}.json — deploy first.`);
  }
  // Bind to a definitely-Address const so narrowing persists into nested async closures.
  const subscriber: Address = maybeSubscriber;


  const account = privateKeyToAccount(requireWatcherPk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  const { venueId } = await resolveVenueId();
  const priceScale = 10n ** BigInt(net.collateral.decimals);

  // eslint-disable-next-line no-console
  console.log(
    `\nCandence fallback watcher (FAILOVER ONLY — not the decision path)\n` +
      `  network:    ${net.name} (${net.chainId})\n` +
      `  subscriber: ${subscriber}\n` +
      `  watcher:    ${account.address}\n` +
      `  venue:      ${venueId}\n` +
      `  grace:      ${GRACE_MS}ms before escalating a miss\n`,
  );

  // symbol → live RestMarket (marketId, strike, status). Refreshed periodically
  // so a window rollover (new marketId for the same symbol) is tracked (§1.2).
  const bySymbol = new Map<string, RestMarket>();
  async function refreshSnapshot(): Promise<void> {
    const markets = await fetchBinaryMarketsRest({ venueId, priceScale });
    for (const m of markets) if (m.symbol) bySymbol.set(m.symbol, m);
  }
  await refreshSnapshot();
  const snapshotTimer = setInterval(() => void refreshSnapshot(), SNAPSHOT_REFRESH_MS);

  // marketIds the reactive path provably handled (from onchain events), used to
  // cancel a pending escalation. Keyed by marketId (§1.2 #10 — never pool addr).
  const handled = new Set<string>();
  const pending = new Map<string, PendingMiss>();

  const handlerSucceeded = parseAbiItem(
    "event HandlerSucceeded(address indexed vault, bytes32 indexed marketKey, uint64 latencyMs, uint256 blockNumber)",
  );
  const unwatch = publicClient.watchEvent({
    address: subscriber,
    event: handlerSucceeded,
    onLogs: (logs) => {
      for (const log of logs) {
        const key = (log.args as { marketKey?: Hex }).marketKey;
        if (!key) continue;
        const k = key.toLowerCase();
        handled.add(k);
        const p = pending.get(k);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(k);
          // eslint-disable-next-line no-console
          console.log(`  ✓ reactive path handled ${p.symbol} first — no fallback needed.`);
        }
      }
    },
    onError: (e) => console.error("  watchEvent error:", e.message),
  });

  async function escalate(p: PendingMiss): Promise<void> {
    pending.delete(p.marketId.toLowerCase());
    if (handled.has(p.marketId.toLowerCase())) return; // reactive path won late — stand down.

    // eslint-disable-next-line no-console
    console.warn(
      `  ⚠ FALLBACK: no HandlerSucceeded for ${p.symbol} (${p.marketId.slice(0, 10)}…) ` +
        `within ${GRACE_MS}ms — submitting onchain catch-up trigger.`,
    );
    try {
      const data = encodeReactivePayload({
        marketId: p.marketId,
        markPriceBase: p.markPriceBase,
        strikeBase: p.strikeBase,
      });
      const hash = await wallet.writeContract({
        address: subscriber,
        abi: CandenceAbi.reactivitySubscriberAbi as unknown as Abi,
        functionName: "submitFallbackTrigger",
        args: [p.marketId, data],
        account,
        chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // eslint-disable-next-line no-console
      console.log(
        receipt.status === "success"
          ? `  ✓ fallback trigger landed (tx ${hash}) — fallbackActivations incremented onchain.`
          : `  ✗ fallback trigger reverted (tx ${hash}).`,
      );
    } catch (e) {
      console.error("  ✗ fallback submit failed:", e instanceof Error ? e.message : e);
    }
  }

  function onPriceUpdate(symbol: string, markPriceBase: bigint): void {
    const market = bySymbol.get(symbol);
    if (!market) return; // unknown/again-rolled symbol — snapshot will catch up.
    const k = market.marketId.toLowerCase();
    handled.delete(k); // new event for this market — reset the handled flag.
    if (pending.has(k)) return; // already watching this market's current miss window.
    const p: PendingMiss = {
      marketId: market.marketId,
      symbol,
      markPriceBase,
      strikeBase: market.strikeBase,
      seenAt: Date.now(),
      timer: setTimeout(() => void escalate(p), GRACE_MS),
    };
    pending.set(k, p);
  }

  // ── Reconnecting WS loop ──
  let backoff = 1000;
  let heartbeat: NodeJS.Timeout | undefined;

  function connect(): void {
    const ws = new WebSocket(net.wsUrl);

    ws.on("open", () => {
      backoff = 1000;
      // eslint-disable-next-line no-console
      console.log(`  WS connected → ${net.wsUrl}`);
      ws.send(JSON.stringify({ op: "subscribe", channel: "markPrice", venueId }));
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, HEARTBEAT_MS);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          channel?: string;
          data?: { symbol?: string; markPrice?: string | number };
        };
        if (msg.channel !== "markPrice" || !msg.data?.symbol) return;
        const n = Number(msg.data.markPrice ?? 0);
        if (!Number.isFinite(n) || n <= 0) return;
        // Scale to venue base units without ever calling toFixed (gotcha #3).
        const markPriceBase = (BigInt(Math.round(n * 1e9)) * priceScale) / 1_000_000_000n;
        if (markPriceBase <= 0n) return;
        onPriceUpdate(msg.data.symbol, markPriceBase);
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on("close", () => {
      if (heartbeat) clearInterval(heartbeat);
      const wait = Math.min(backoff, BACKOFF_MAX_MS);
      // eslint-disable-next-line no-console
      console.warn(`  WS closed — reconnecting in ${wait}ms`);
      setTimeout(connect, wait);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    });

    ws.on("error", (e) => console.error("  WS error:", e.message));
  }

  connect();

  process.on("SIGINT", () => {
    // eslint-disable-next-line no-console
    console.log("\n  shutting down watcher …");
    unwatch();
    clearInterval(snapshotTimer);
    for (const p of pending.values()) clearTimeout(p.timer);
    process.exit(0);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("\n✗ watcher failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
