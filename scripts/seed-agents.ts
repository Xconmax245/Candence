/**
 * Candence — seed-agents.ts (DIRECTIVE §7 Phase 3, §4.2).
 *
 * Deploys the 4–6 house agents (a mix of Reactive and AI-assisted modes) via the
 * AgentVaultFactory, registers each with the ReactivitySubscriber, and prints the
 * operator-grant instructions for the deployer's own wallet (§1.6 operator model).
 *
 * NON-CUSTODIAL (§1.6): this script NEVER moves user funds into a vault. House
 * agents trade the DEPLOYER's own wallet; the vault is only ever a registered
 * operator. Fills settle to the owner wallet. We only print what to fund/grant.
 *
 * "The credibility of measured ecosystem impact scales directly with how many
 *  days of real, visible history exist by judging time" (§7 Phase 3) — run this
 *  as early as the calendar allows and let the agents trade continuously.
 *
 * Run: `pnpm seed`
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
  parseAbi,
  type Hex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  activeNetwork,
  viemChainFor,
  resolveVenueId,
  OPERATOR_SELECTORS,
  CandenceAbi,
} from "../packages/shared/src/index.js";
import { loadArtifact, readDeployment, writeJson, explorerAddr } from "./lib/artifacts.js";

/** VaultMode enum (matches ICandence.sol): 0 = Reactive, 1 = AiAssisted. */
const MODE = { reactive: 0, aiAssisted: 1 } as const;

interface AgentSpec {
  name: string;
  mode: number;
  /** Onchain spend cap for the deployer-owner, in collateral base units. */
  capBase: bigint;
  tokenUri: string;
}

/**
 * The house roster (§7 Phase 3). Candence-original names (musical tempo terms —
 * on-theme for "Candence"). A deliberate mix of divisions so the dashboard's
 * per-division breakdown (§6) has both populated from day one.
 */
const ROSTER: AgentSpec[] = [
  { name: "Metronome", mode: MODE.reactive, capBase: 25_000_000n, tokenUri: "ipfs://candence/metronome" },
  { name: "Downbeat", mode: MODE.reactive, capBase: 25_000_000n, tokenUri: "ipfs://candence/downbeat" },
  { name: "Syncopate", mode: MODE.reactive, capBase: 20_000_000n, tokenUri: "ipfs://candence/syncopate" },
  { name: "Andante", mode: MODE.aiAssisted, capBase: 20_000_000n, tokenUri: "ipfs://candence/andante" },
  { name: "Presto", mode: MODE.aiAssisted, capBase: 20_000_000n, tokenUri: "ipfs://candence/presto" },
  { name: "Rubato", mode: MODE.aiAssisted, capBase: 15_000_000n, tokenUri: "ipfs://candence/rubato" },
];

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid (expected 0x + 64 hex).");
  }
  return pk as Hex;
}

async function main(): Promise<void> {
  const net = activeNetwork();
  if (net.name === "mainnet" && process.env.CANDENCE_ALLOW_MAINNET !== "1") {
    throw new Error("Refusing to seed mainnet without CANDENCE_ALLOW_MAINNET=1 (§0.4).");
  }

  const dep = readDeployment(net.name);
  if (!dep) {
    throw new Error(`No deployments/${net.name}.json — run \`pnpm deploy\` first.`);
  }
  const factoryAddr = dep.contracts.AgentVaultFactory;
  const subscriberAddr = dep.contracts.ReactivitySubscriber;
  if (!factoryAddr || !subscriberAddr) {
    throw new Error("Deployment missing AgentVaultFactory or ReactivitySubscriber.");
  }

  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  const { venueId, source } = await resolveVenueId({ force: true });
  // eslint-disable-next-line no-console
  console.log(`\nCandence seed → ${net.name} (venue ${source}: ${venueId})`);
  // eslint-disable-next-line no-console
  console.log(`factory: ${factoryAddr}\n`);

  const factoryArt = loadArtifact("AgentVaultFactory");
  const subscriberArt = loadArtifact("ReactivitySubscriber");

  const seeded: Array<{ name: string; vault: `0x${string}`; strategyId: string; mode: number }> = [];

  for (const spec of ROSTER) {
    // eslint-disable-next-line no-console
    process.stdout.write(`  deploying ${spec.name} (${spec.mode === 0 ? "reactive" : "ai-assisted"}) ...`);

    const hash = await wallet.writeContract({
      address: factoryAddr,
      abi: factoryArt.abi as Abi,
      functionName: "deployVault",
      args: [spec.name, spec.mode, spec.capBase, spec.tokenUri],
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`deployVault(${spec.name}) failed (tx ${hash}).`);

    // Extract the deployed vault address + strategyId from the VaultDeployed event.
    let vault: `0x${string}` | undefined;
    let strategyId = "?";
    for (const log of receipt.logs) {
      try {
        const parsed = decodeEventLog({
          abi: parseAbi(CandenceAbi.agentVaultFactoryAbi as unknown as string[]),
          data: log.data,
          topics: log.topics,
        });
        if (parsed.eventName === "VaultDeployed") {
          const a = parsed.args as unknown as { vault: `0x${string}`; strategyId: bigint };
          vault = a.vault;
          strategyId = a.strategyId.toString();
        }
      } catch (err) {
        console.error("decode error:", err);
      }
    }
    if (!vault) {
      console.error("LOGS:", receipt.logs);
      throw new Error(`Could not find VaultDeployed for ${spec.name}.`);
    }

    // Register the vault with the subscriber so the reactive path can trigger it (§4.1).
    const regHash = await wallet.writeContract({
      address: subscriberAddr,
      abi: subscriberArt.abi as Abi,
      functionName: "registerVault",
      args: [vault],
      account,
      chain,
    });
    const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regHash });
    if (regReceipt.status !== "success") throw new Error(`registerVault(${spec.name}) failed.`);

    seeded.push({ name: spec.name, vault, strategyId, mode: spec.mode });
    // eslint-disable-next-line no-console
    console.log(` ${vault} (id ${strategyId})  ${explorerAddr(net.explorerBase, vault)}`);
  }

  const outPath = writeJson(`deployments/agents.${net.name}.json`, {
    network: net.name,
    venueId,
    seededAt: new Date().toISOString(),
    deployer: account.address,
    agents: seeded.map((s) => ({
      name: s.name,
      vault: s.vault,
      strategyId: s.strategyId,
      mode: s.mode === 0 ? "reactive" : "ai-assisted",
    })),
  });

  // eslint-disable-next-line no-console
  console.log(`\n✓ ${seeded.length} house agents seeded → ${outPath}`);

  // ── Operator-grant instructions (§1.6) — printed, never auto-executed ──
  // eslint-disable-next-line no-console
  console.log(
    `\nNEXT — authorize each vault as an operator on YOUR OWN wallet (§1.6):\n` +
      `  The vault NEVER custodies funds. It only places orders under your wallet.\n` +
      `  For each vault, call OperatorPermissionsRegistry.grantOperator(vault, selector)\n` +
      `  for selectors: place ${OPERATOR_SELECTORS.placeOrderFor}, cancel ${OPERATOR_SELECTORS.cancelOrderFor}, reduce ${OPERATOR_SELECTORS.reduceOrderFor}\n` +
      `  (follow bot-kit scripts/operator-setup.ts). Revocable immediately, any time.\n` +
      `\n  Also ensure your wallet holds test USDC collateral (escrow leaves/returns to\n` +
      `  YOUR wallet, gotcha #7) and the subscriber holds ≥32 SOMI for handler gas (§4.3).\n`,
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("\n✗ seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
