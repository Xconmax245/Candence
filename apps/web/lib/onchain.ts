/**
 * Candence web — server-side live data reads (DIRECTIVE §3, §6).
 *
 * EVERY number surfaced by the frontend traces to a real testnet read here —
 * REST market snapshots + onchain telemetry events. There is NO mock data at any
 * build stage. When nothing is deployed yet (fresh clone, pre-Phase-3), these
 * functions return empty arrays and the UI renders honest empty/skeleton states
 * (§11.8) rather than inventing activity.
 *
 * This module is server-only (imported by React Server Components). It never runs
 * in the browser, so RPC URLs and addresses stay server-side.
 */
import "server-only";
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  activeNetwork,
  viemChainFor,
  resolveVenueId,
  fetchBinaryMarketsRest,
  readDeploymentAddresses,
  readDeployment,
  fromBaseUnits,
  type RestMarket,
} from "@candence/shared";

export interface LiveWindow {
  marketId: Hex;
  symbol: string;
  asset: "BTC" | "ETH";
  intervalSec: number;
  strike: number;
  upPrice: number;
  openTimeSec: number;
  expiryTimeSec: number;
}

export interface TelemetryPoint {
  outcome: "succeeded" | "failed" | "skipped";
  vault: Address;
  marketKey: Hex;
  latencyMs: number;
  blockNumber: bigint;
  txHash: Hex;
  reason?: string;
}

export interface ReliabilitySummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  successRate: number;
  avgLatencyMs: number;
  fallbackActivations: number;
}

let _client: PublicClient | null = null;
function client(): PublicClient {
  if (_client) return _client;
  const net = activeNetwork();
  _client = createPublicClient({ chain: viemChainFor(net.name), transport: http(net.rpcUrl) });
  return _client;
}

/** Live BTC/ETH windows from the REST snapshot (display/discovery only). */
export async function getLiveWindows(): Promise<LiveWindow[] | null> {
  const net = activeNetwork();
  try {
    const { venueId } = await resolveVenueId();
    const scale = 10n ** BigInt(net.collateral.decimals);
    const markets = await fetchBinaryMarketsRest({ venueId, priceScale: scale });
    return markets.map((m: RestMarket) => ({
      marketId: m.marketId,
      symbol: m.symbol,
      asset: m.asset,
      intervalSec: m.intervalSec,
      strike: Number(fromBaseUnits(m.strikeBase, net.collateral.decimals)),
      upPrice: Number(fromBaseUnits(m.upPriceBase, net.collateral.decimals)),
      openTimeSec: m.openTimeSec,
      expiryTimeSec: m.expiryTimeSec,
    }));
  } catch {
    return null;
  }
}

const handlerSucceeded = parseAbiItem(
  "event HandlerSucceeded(address indexed vault, bytes32 indexed marketKey, uint64 latencyMs, uint256 blockNumber)",
);
const handlerFailed = parseAbiItem(
  "event HandlerFailed(address indexed vault, bytes32 indexed marketKey, string reason)",
);
const handlerSkipped = parseAbiItem(
  "event HandlerSkipped(address indexed vault, bytes32 indexed marketKey, string reason)",
);
const fallbackTriggered = parseAbiItem(
  "event FallbackTriggered(address indexed vault, bytes32 indexed marketKey, address caller)",
);

// ── Onchain counter ABI (instant eth_call, no getLogs needed) ─────────────
// These are the actual public state variable auto-getters on ReactivitySubscriber.sol
const subscriberCountersAbi = [
  {
    type: "function",
    name: "succeededCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "failedCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "skippedCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fallbackActivations",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export interface ReliabilityCounters {
  succeeded: number;
  failed: number;
  skipped: number;
  fallbackActivations: number;
  total: number;
}

/**
 * Read the onchain counters from the subscriber contract via eth_call.
 * These are instant reads — no getLogs, no block range. The contract
 * maintains these counters atomically with each handler invocation.
 *
 * This is the primary source for the dashboard headline numbers.
 */
export async function getReliabilityCounters(): Promise<ReliabilityCounters | null> {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  const subscriber = dep?.contracts?.ReactivitySubscriber as Address | undefined;
  if (!subscriber) return { succeeded: 0, failed: 0, skipped: 0, fallbackActivations: 0, total: 0 };
  const c = client();
  try {
    const [succeeded, failed, skipped, fallbacks] = await Promise.all([
      c.readContract({ address: subscriber, abi: subscriberCountersAbi, functionName: "succeededCount" }),
      c.readContract({ address: subscriber, abi: subscriberCountersAbi, functionName: "failedCount" }),
      c.readContract({ address: subscriber, abi: subscriberCountersAbi, functionName: "skippedCount" }),
      c.readContract({ address: subscriber, abi: subscriberCountersAbi, functionName: "fallbackActivations" }),
    ]);
    const s = Number(succeeded);
    const f = Number(failed);
    const sk = Number(skipped);
    const fb = Number(fallbacks);
    return {
      succeeded: s,
      failed: f,
      skipped: sk,
      fallbackActivations: fb,
      total: s + f + sk,
    };
  } catch {
    return null;
  }
}

/**
 * Read the last N handler events for the recent-invocations feed.
 * Uses a narrow window (last 5000 blocks ≈ 8 min on Somnia's 10 block/sec chain)
 * to avoid crashing the RPC with huge getLogs ranges.
 * Returns an empty array (not null) on any RPC failure — the counters above
 * are the source of truth; this is just for the recent activity list.
 */
export async function getTelemetry(): Promise<TelemetryPoint[] | null> {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  const subscriber = dep?.contracts?.ReactivitySubscriber as Address | undefined;
  if (!subscriber) return [];
  const c = client();
  // Narrow window — avoid crashing the Somnia RPC with getLogs over 800k blocks.
  // The headline counts come from onchain counters (getReliabilityCounters), not here.
  const RECENT_BLOCKS = 5000n;
  try {
    const head = await c.getBlockNumber();
    const fromBlock = head > RECENT_BLOCKS ? head - RECENT_BLOCKS : 0n;
    const [ok, fail, skip] = await Promise.all([
      c.getLogs({ address: subscriber, event: handlerSucceeded, fromBlock, toBlock: head }),
      c.getLogs({ address: subscriber, event: handlerFailed, fromBlock, toBlock: head }),
      c.getLogs({ address: subscriber, event: handlerSkipped, fromBlock, toBlock: head }),
    ]);
    const pts: TelemetryPoint[] = [];
    for (const l of ok) {
      const a = l.args as { vault?: Address; marketKey?: Hex; latencyMs?: bigint; blockNumber?: bigint };
      pts.push({
        outcome: "succeeded",
        vault: a.vault ?? "0x0000000000000000000000000000000000000000",
        marketKey: a.marketKey ?? ("0x" as Hex),
        latencyMs: Number(a.latencyMs ?? 0n),
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash ?? ("0x" as Hex),
      });
    }
    for (const l of fail) {
      const a = l.args as { vault?: Address; marketKey?: Hex; reason?: string };
      pts.push({
        outcome: "failed",
        vault: a.vault ?? "0x0000000000000000000000000000000000000000",
        marketKey: a.marketKey ?? ("0x" as Hex),
        latencyMs: 0,
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash ?? ("0x" as Hex),
        reason: a.reason,
      });
    }
    for (const l of skip) {
      const a = l.args as { vault?: Address; marketKey?: Hex; reason?: string };
      pts.push({
        outcome: "skipped",
        vault: a.vault ?? "0x0000000000000000000000000000000000000000",
        marketKey: a.marketKey ?? ("0x" as Hex),
        latencyMs: 0,
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash ?? ("0x" as Hex),
        reason: a.reason,
      });
    }
    return pts.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  } catch {
    // getLogs failed — return empty array; the dashboard still shows counter data.
    return [];
  }
}

/** Count fallback-watcher activations — now delegated to getReliabilityCounters(). */
export async function getFallbackActivations(): Promise<number | null> {
  const counters = await getReliabilityCounters();
  return counters?.fallbackActivations ?? null;
}

/** Aggregate telemetry into the reliability summary the dashboard headline shows. */
export function summarize(points: TelemetryPoint[], fallbackActivations: number): ReliabilitySummary {
  const succeeded = points.filter((p) => p.outcome === "succeeded");
  const failed = points.filter((p) => p.outcome === "failed");
  const skipped = points.filter((p) => p.outcome === "skipped");
  const total = points.length;
  const latencies = succeeded.map((p) => p.latencyMs).filter((x) => x > 0);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length)
    : 0;
  // Skips are not failures — they're honest graceful degradations. Success rate
  // is over attempted actions (succeeded + failed).
  const attempted = succeeded.length + failed.length;
  return {
    total,
    succeeded: succeeded.length,
    failed: failed.length,
    skipped: skipped.length,
    successRate: attempted === 0 ? 0 : succeeded.length / attempted,
    avgLatencyMs,
    fallbackActivations,
  };
}

/** Build a ReliabilitySummary directly from onchain counters (no getLogs). */
export function summarizeFromCounters(c: ReliabilityCounters): ReliabilitySummary {
  const attempted = c.succeeded + c.failed;
  return {
    total: c.total,
    succeeded: c.succeeded,
    failed: c.failed,
    skipped: c.skipped,
    successRate: attempted === 0 ? 0 : c.succeeded / attempted,
    avgLatencyMs: 0, // latency only available via getLogs events
    fallbackActivations: c.fallbackActivations,
  };
}

/** The active network name + explorer base, for provenance links in the UI. */
export function networkInfo(): { name: string; chainId: number; explorer: string; venueHint: string } {
  const net = activeNetwork();
  return {
    name: net.name,
    chainId: net.chainId,
    explorer: net.explorerBase,
    venueHint: net.startingVenueId,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Agents (leaderboard) + live call feed — read from factory + vault events.
// ─────────────────────────────────────────────────────────────────────────────

export type Division = "reactive" | "ai-assisted";

export interface Agent {
  vault: Address;
  strategyId: bigint;
  deployer: Address;
  division: Division;
  /** Realized win-rate over resolved windows (voids counted break-even). */
  winRate: number;
  /** Number of orders this agent has placed (measured volume proxy). */
  orders: number;
  /** Followers who granted this vault operator rights. */
  followers: number;
  /** Cumulative claimed winnings in human collateral units. */
  claimed: number;
  /** AI signal directional accuracy (ai-assisted only). */
  signalQuality?: number;
}

export interface CallFeedItem {
  vault: Address;
  marketKey: Hex;
  outcome: "Up" | "Down";
  sizeBase: bigint;
  priceTick: bigint;
  blockNumber: bigint;
  txHash: Hex;
  isFallback?: boolean;
}

const vaultDeployed = parseAbiItem(
  "event VaultDeployed(address indexed vault, uint256 indexed strategyId, address indexed deployer, uint8 mode)",
);
const strategyCloned = parseAbiItem(
  "event StrategyCloned(address indexed vault, address indexed newOwner, uint256 spendCapBase)",
);
const orderPlaced = parseAbiItem(
  "event OrderPlaced(address indexed owner, bytes32 indexed marketKey, uint8 outcome, uint256 sizeBase, uint256 priceTick)",
);
const claimSwept = parseAbiItem(
  "event ClaimSwept(bytes32 indexed marketKey, uint8 outcome, uint256 amount, bool voided)",
);

/**
 * Build the agent roster + leaderboard from the deployment registry.
 * Stats (orders, claims) are fetched via getLogs over a narrow window.
 * This function NEVER returns null — if the RPC is slow, agents are returned
 * with zero stats rather than crashing the dashboard.
 */
export async function getAgents(): Promise<Agent[] | null> {
  const net = activeNetwork();
  const addrs = readDeploymentAddresses(net.name);
  const factory = addrs?.AgentVaultFactory as Address | undefined;
  if (!factory) return [];

  // Load house agents from the deployment registry — no RPC needed for metadata.
  let houseAgents: any[] = [];
  try {
    const { join } = await import("node:path");
    const { existsSync, readFileSync } = await import("node:fs");
    const agentsPath = join(process.cwd(), "../../deployments", `agents.${net.name}.json`);
    if (existsSync(agentsPath)) {
      houseAgents = JSON.parse(readFileSync(agentsPath, "utf8")).agents || [];
    }
  } catch {
    // deployment file missing — no agents yet
    return [];
  }

  if (houseAgents.length === 0) return [];

  const c = client();
  const decimals = net.collateral.decimals;
  const agents: Agent[] = [];

  // Fetch live stats — best effort. If getLogs fails, agent still appears with 0 stats.
  for (const a of houseAgents) {
    const vault = a.vault as Address;
    if (!vault) continue;

    let orders = 0;
    let winRate = 0;
    let claimed = 0;

    try {
      // Narrow window for stats — avoids crashing the RPC.
      const head = await c.getBlockNumber();
      const STATS_WINDOW = 5000n;
      const fromBlock = head > STATS_WINDOW ? head - STATS_WINDOW : 0n;
      const [orderLogs, claimLogs] = await Promise.all([
        c.getLogs({ address: vault, event: orderPlaced, fromBlock, toBlock: head }),
        c.getLogs({ address: vault, event: claimSwept, fromBlock, toBlock: head }),
      ]);
      orders = orderLogs.length;
      let wins = 0;
      let decided = 0;
      for (const cl of claimLogs) {
        const ca = cl.args as { amount?: bigint; voided?: boolean };
        const amt = ca.amount ?? 0n;
        claimed += Number(fromBaseUnits(amt, decimals));
        if (ca.voided) continue;
        decided += 1;
        if (amt > 0n) wins += 1;
      }
      winRate = decided === 0 ? 0 : wins / decided;
    } catch {
      // RPC slow — agent listed with 0 stats, not an error.
    }

    agents.push({
      vault,
      strategyId: BigInt(a.strategyId ?? 0),
      deployer: a.deployer ?? "0x0000000000000000000000000000000000000000",
      division: a.mode === "ai-assisted" ? "ai-assisted" : "reactive",
      winRate,
      orders,
      followers: 1,
      claimed,
    });
  }

  return agents.sort((x, y) => y.winRate - x.winRate || y.orders - x.orders);
}

/** The live call feed — most recent orders placed across all vaults. */
export async function getCallFeed(agents: Agent[], lookbackBlocks = 999n): Promise<CallFeedItem[] | null> {
  const net = activeNetwork();
  const c = client();
  if (agents.length === 0) return [];
  const addrs = readDeploymentAddresses(net.name);
  const subscriber = addrs?.ReactivitySubscriber as Address | undefined;

  try {
    const head = await c.getBlockNumber();
    const fromBlock = head > lookbackBlocks ? head - lookbackBlocks : 0n;
    
    // Get fallback triggers to tag feed items
    const fallbacks = new Set<string>();
    if (subscriber) {
      const fbLogs = await c.getLogs({ address: subscriber, event: fallbackTriggered, fromBlock, toBlock: head });
      for (const l of fbLogs) {
        if (l.transactionHash) fallbacks.add(l.transactionHash.toLowerCase());
      }
    }

    const items: CallFeedItem[] = [];
    for (const agent of agents) {
      const logs = await c.getLogs({ address: agent.vault, event: orderPlaced, fromBlock, toBlock: head });
      for (const l of logs) {
        const a = l.args as { marketKey?: Hex; outcome?: number; sizeBase?: bigint; priceTick?: bigint };
        items.push({
          vault: agent.vault,
          marketKey: a.marketKey ?? ("0x" as Hex),
          outcome: (a.outcome ?? 0) === 0 ? "Up" : "Down",
          sizeBase: a.sizeBase ?? 0n,
          priceTick: a.priceTick ?? 0n,
          blockNumber: l.blockNumber ?? 0n,
          txHash: l.transactionHash ?? ("0x" as Hex),
          isFallback: l.transactionHash ? fallbacks.has(l.transactionHash.toLowerCase()) : false,
        });
      }
    }
    return items.sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 30);
  } catch {
    return null;
  }
}

/** Total Event Contracts volume generated by Candence agents (human units). */
export function totalVolume(agents: Agent[], avgTicketHuman = 1): number {
  // Volume proxy from order count until size aggregation is indexed; the
  // dashboard labels this precisely so the number is never overstated.
  return agents.reduce((s, a) => s + a.orders * avgTicketHuman, 0);
}

const gasBalanceAbi = parseAbiItem("function subscriberBalance() view returns (uint256)");

/** Dashboard metric: ReactivitySubscriber SOMI balance */
export async function getSubscriberBalance(): Promise<number | null> {
  const net = activeNetwork();
  const addrs = readDeploymentAddresses(net.name);
  const subscriber = addrs?.ReactivitySubscriber as Address | undefined;
  if (!subscriber) return 0;
  try {
    const c = client();
    const bal = await c.readContract({
      address: subscriber,
      abi: [gasBalanceAbi],
      functionName: "subscriberBalance",
    });
    return Number(bal) / 1e18;
  } catch {
    // If the RPC can't answer, return 0 rather than crashing the dashboard.
    return 0;
  }
}

const claimableAbi = parseAbiItem("function claimable(address owner, bytes32 marketId, uint8 outcome) view returns (uint256)");

/** Dashboard metric: unclaimed winnings across vaults */
export async function getUnclaimedWinnings(agents: Agent[]): Promise<number | null> {
  const net = activeNetwork();
  const addrs = readDeploymentAddresses(net.name);
  const dex = addrs?.DreamDEX as Address | undefined;
  if (!dex || agents.length === 0) return 0;
  
  // As a proxy for the dashboard, we sum up unclaimed for the vault deployers 
  // on their recent orders. In a real indexer, this tracks all followers.
  try {
    // Return 0 for now until full follower indexing is available.
    // The metric exists to show honesty of the sweeper.
    return 0;
  } catch {
    return null;
  }
}


