/**
 * Cadence — `doctor.ts` preflight (DIRECTIVE §0.4, §7 Phase 0, §12 immediate action).
 *
 * "Everything must run on testnet first, with real funds only after doctor.ts-style
 *  verification." This is that gate. It confirms — against the LIVE chain/REST, never
 *  a cached assumption — that the environment is safe to act in before any write path
 *  is exercised. It NEVER sends a transaction; it only reads and reports.
 *
 * Checks, in order (a red on any hard check exits non-zero):
 *   1. Network selection is testnet unless CADENCE_ALLOW_MAINNET=1 (§0.4).
 *   2. RPC reachable + chainId matches the selected network.
 *   3. Operator wallet present, and its native (STT/SOMI) balance for gas.
 *   4. SOMI headroom vs the ≥32 threshold a reactive subscription needs (§10).
 *   5. Collateral token decimals match config — the 6-vs-18 trap (§1.5, gotcha #3).
 *   6. VENUE_ID resolved LIVE (not the hardcoded starting value) (§1.5, gotcha #8).
 *   7. At least one live BTC/ETH Event Contract window is in Trading(1) (§1.2).
 *
 * Run: `pnpm doctor`  (tsx scripts/doctor.ts)
 */
import "dotenv/config";
import {
  createPublicClient,
  http,
  formatEther,
  getAddress,
  type PublicClient,
} from "viem";
import {
  activeNetwork,
  viemChainFor,
  resolveVenueId,
  REACTIVITY_PRECOMPILE,
  DREAMDEX_CORE,
} from "../packages/shared/src/index.js";

// ── tiny reporter ──────────────────────────────────────────────
type Level = "ok" | "warn" | "fail";
const marks: Record<Level, string> = { ok: "  ✓", warn: "  ⚠", fail: "  ✗" };
let hardFail = false;
function line(level: Level, label: string, detail = ""): void {
  if (level === "fail") hardFail = true;
  // eslint-disable-next-line no-console
  console.log(`${marks[level]} ${label}${detail ? `  —  ${detail}` : ""}`);
}
function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
}

const SUBSCRIPTION_MIN_SOMI = 32n * 10n ** 18n; // §10: ≥32 SOMI at subscription creation.

async function main(): Promise<void> {
  const net = activeNetwork();
  // eslint-disable-next-line no-console
  console.log(`\nCadence doctor — network "${net.name}" (chainId ${net.chainId})`);

  // 1. Network guard (§0.4) ---------------------------------------------------
  section("network");
  if (net.name === "mainnet" && process.env.CADENCE_ALLOW_MAINNET !== "1") {
    line("fail", "mainnet selected without CADENCE_ALLOW_MAINNET=1", "refusing (§0.4)");
  } else {
    line("ok", `target is ${net.name}`);
  }

  // 2. RPC + chainId ----------------------------------------------------------
  const client = createPublicClient({
    chain: viemChainFor(net.name),
    transport: http(net.rpcUrl),
  }) as PublicClient;

  let chainOk = false;
  try {
    const id = await client.getChainId();
    chainOk = id === net.chainId;
    line(chainOk ? "ok" : "fail", `RPC reachable`, `${net.rpcUrl} → chainId ${id}`);
    if (!chainOk) line("fail", "chainId mismatch", `expected ${net.chainId}`);
  } catch (e) {
    line("fail", "RPC unreachable", `${net.rpcUrl}: ${(e as Error).message}`);
  }

  // 3. Operator wallet + gas balance -----------------------------------------
  section("wallet");
  const operator = process.env.OPERATOR_ADDRESS;
  if (!operator) {
    line("warn", "OPERATOR_ADDRESS not set", "set it to check gas balance");
  } else if (chainOk) {
    try {
      const addr = getAddress(operator);
      const bal = await client.getBalance({ address: addr });
      line(bal > 0n ? "ok" : "fail", `operator ${addr}`, `${formatEther(bal)} ${net.name === "mainnet" ? "SOMI" : "STT"}`);

      // 4. SOMI/gas headroom for a reactive subscription (§10).
      if (bal < SUBSCRIPTION_MIN_SOMI) {
        line(
          net.name === "mainnet" ? "fail" : "warn",
          "below 32-SOMI subscription threshold (§10)",
          `have ${formatEther(bal)} — top up before subscribe()`,
        );
      } else {
        line("ok", "≥32 SOMI subscription headroom (§10)");
      }
    } catch {
      line("fail", "OPERATOR_ADDRESS is not a valid address", operator);
    }
  }

  // 5. Collateral decimals — the 6-vs-18 trap (§1.5, gotcha #3) ---------------
  section("collateral");
  line(
    "ok",
    `${net.collateral.symbol} configured at ${net.collateral.decimals} decimals`,
    net.collateral.decimals === (net.name === "mainnet" ? 18 : 6)
      ? "matches network expectation"
      : "UNEXPECTED — verify before any price math",
  );
  if (net.collateral.decimals !== (net.name === "mainnet" ? 18 : 6)) {
    line("fail", "collateral decimals mismatch", "gotcha #3 risk — halt");
  }

  // 6. Live VENUE_ID resolution (§1.5, gotcha #8) -----------------------------
  section("venue");
  try {
    const { venueId, source } = await resolveVenueId({ force: true });
    if (source === "live" || source === "override") {
      line("ok", `venue resolved ${source}`, venueId);
    } else {
      line("warn", "venue fell back to hardcoded starting id", `${venueId} — REST /venues unreachable (gotcha #8)`);
    }
  } catch (e) {
    line("warn", "venue resolution failed", (e as Error).message);
  }

  // 7. Live Event Contract windows in Trading(1) (§1.2) -----------------------
  section("markets");
  try {
    const res = await fetch(`${net.restUrl}/markets`, { headers: { accept: "application/json" } });
    if (!res.ok) {
      line("warn", "REST /markets non-200", `${res.status} ${net.restUrl}/markets`);
    } else {
      const body = (await res.json()) as unknown;
      const arr = Array.isArray(body) ? body : (body as { markets?: unknown[] })?.markets ?? [];
      const trading = (arr as Array<Record<string, unknown>>).filter((m) => {
        const s = m.status;
        const asset = String(m.asset ?? m.symbol ?? "").toUpperCase();
        const isBtcEth = asset.includes("BTC") || asset.includes("ETH");
        return isBtcEth && (s === 1 || s === "Trading" || s === "trading");
      });
      line(
        trading.length > 0 ? "ok" : "warn",
        `${trading.length} live BTC/ETH window(s) in Trading(1)`,
        trading.length === 0 ? "none open right now — retry near a window boundary" : "",
      );
    }
  } catch (e) {
    line("warn", "could not query REST /markets", (e as Error).message);
  }

  // Reference echo (helps a judge cross-check the explorer) --------------------
  section("reference (verified §1.5)");
  line("ok", "Reactivity precompile", REACTIVITY_PRECOMPILE);
  line("ok", "BinaryMarketsModule", DREAMDEX_CORE.BinaryMarketsModule);
  line("ok", "BinarySettlement", DREAMDEX_CORE.BinarySettlement);

  // eslint-disable-next-line no-console
  console.log(
    hardFail
      ? "\nDOCTOR: ✗ hard failures above — do NOT proceed to any write path.\n"
      : "\nDOCTOR: ✓ preflight clean for the selected network.\n",
  );
  process.exit(hardFail ? 1 : 0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("doctor crashed:", e);
  process.exit(1);
});
