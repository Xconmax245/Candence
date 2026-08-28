/**
 * Cadence — deploy.ts (DIRECTIVE §7 Phase 1/3, §3).
 *
 * Deploys the full Cadence contract suite to the selected network using the
 * compiled Foundry artifacts (creation bytecode) and viem. Then wires the
 * cross-contract permissions and persists every address to
 * `deployments/<network>.json` with explorer links.
 *
 * SAFETY (§0.4): testnet by default; mainnet refused unless CADENCE_ALLOW_MAINNET=1.
 * Run `pnpm doctor` first. Never deploys with staged data. Real writes only.
 *
 * Deploy order (dependencies first):
 *   RiskEngine → StrategyNFT → CopilotAttestor → ReactivitySubscriber → AgentVaultFactory
 * Wiring:
 *   risk.setFactory(factory); nft.setMinter(factory); factory.setSubscriber(subscriber)
 *
 * Run: `pnpm deploy`
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type Abi,
} from "viem";

import { privateKeyToAccount } from "viem/accounts";
import { activeNetwork, viemChainFor, DREAMDEX_CORE } from "../packages/shared/src/index.js";
import {
  loadArtifact,
  readDeployment,
  writeDeployment,
  explorerAddr,
  type DeploymentRecord,
} from "./lib/artifacts.js";

// ── Deploy-time parameters (base units; testnet collateral is 6-decimals) ──
const TIMELOCK_DELAY = BigInt(process.env.TIMELOCK_DELAY_SEC ?? 3600); // 1h min (Auth.MIN_DELAY)
const PRICE_SCALE = BigInt(process.env.PRICE_SCALE ?? 1_000_000); // 1.0 == 1e6 on 6-dec testnet
const DEFAULT_DRAWDOWN = BigInt(process.env.DEFAULT_DRAWDOWN_BASE ?? 50_000_000); // 50 USDso
const DEFAULT_BASE_POS = BigInt(process.env.DEFAULT_BASE_POSITION_BASE ?? 5_000_000); // 5 contracts

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid (expected 0x + 64 hex).");
  }
  return pk as Hex;
}

async function main(): Promise<void> {
  const net = activeNetwork();
  if (net.name === "mainnet" && process.env.CADENCE_ALLOW_MAINNET !== "1") {
    throw new Error("Refusing mainnet deploy without CADENCE_ALLOW_MAINNET=1 (§0.4).");
  }

  const existing = readDeployment(net.name);
  if (existing) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n⚠  deployments/${net.name}.json already exists (deployed ${existing.deployedAt}).\n` +
        `   Re-deploying will overwrite it. Ctrl-C within 4s to abort.\n`,
    );
    await new Promise((r) => setTimeout(r, 4000));
  }

  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  // eslint-disable-next-line no-console
  console.log(`\nCadence deploy → ${net.name} (chainId ${net.chainId})`);
  // eslint-disable-next-line no-console
  console.log(`deployer: ${account.address}\n`);

  const deployed: Record<string, `0x${string}`> = {};

  /** Deploy one artifact, wait for the receipt, return its address. */
  async function deploy(
    name: string,
    args: readonly unknown[],
  ): Promise<`0x${string}`> {
    const { abi, bytecode } = loadArtifact(name);
    // eslint-disable-next-line no-console
    process.stdout.write(`  deploying ${name} ...`);
    const hash = await wallet.deployContract({ abi, bytecode, args, account, chain });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${name} deploy failed (tx ${hash}).`);
    }
    const addr = receipt.contractAddress;
    deployed[name] = addr;
    // eslint-disable-next-line no-console
    console.log(` ${addr}  (${explorerAddr(net.explorerBase, addr)})`);
    return addr;
  }

  // 1. RiskEngine(owner, timelockDelay)
  const risk = await deploy("RiskEngine", [account.address, TIMELOCK_DELAY]);
  // 2. StrategyNFT(owner)
  const nft = await deploy("StrategyNFT", [account.address]);
  // 3. CopilotAttestor(owner, signer) — signer defaults to deployer if unset
  const copilotSigner = (process.env.COPILOT_SIGNER_ADDRESS as `0x${string}`) ?? account.address;
  const attestor = await deploy("CopilotAttestor", [account.address, copilotSigner]);
  // 4. ReactivitySubscriber(owner, timelockDelay)
  const subscriber = await deploy("ReactivitySubscriber", [account.address, TIMELOCK_DELAY]);
  // 5. AgentVaultFactory(owner, risk, nft, module, settlement, scale, drawdown, basePos)
  const factory = await deploy("AgentVaultFactory", [
    account.address,
    risk,
    nft,
    DREAMDEX_CORE.BinaryMarketsModule,
    DREAMDEX_CORE.BinarySettlement,
    PRICE_SCALE,
    DEFAULT_DRAWDOWN,
    DEFAULT_BASE_POS,
  ]);

  // ── Wiring (permissions) ──
  // eslint-disable-next-line no-console
  console.log(`\n  wiring permissions ...`);

  async function call(
    addr: `0x${string}`,
    name: string,
    fn: string,
    args: readonly unknown[],
  ): Promise<void> {
    const { abi } = loadArtifact(name);
    const hash = await wallet.writeContract({
      address: addr,
      abi: abi as Abi,
      functionName: fn,
      args: args as unknown[],
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${name}.${fn} failed (tx ${hash}).`);
    // eslint-disable-next-line no-console
    console.log(`    ${name}.${fn}() ✓`);
  }

  await call(risk, "RiskEngine", "setFactory", [factory]);
  await call(nft, "StrategyNFT", "setMinter", [factory]);
  await call(factory, "AgentVaultFactory", "setSubscriber", [subscriber]);

  // ── Persist ──
  const record: DeploymentRecord = {
    network: net.name,
    chainId: net.chainId,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      RiskEngine: risk,
      StrategyNFT: nft,
      CopilotAttestor: attestor,
      ReactivitySubscriber: subscriber,
      AgentVaultFactory: factory,
      // Protocol references (verified §1.5) for convenience.
      BinaryMarketsModule: DREAMDEX_CORE.BinaryMarketsModule as `0x${string}`,
      BinarySettlement: DREAMDEX_CORE.BinarySettlement as `0x${string}`,
      OracleHub: DREAMDEX_CORE.OracleHub as `0x${string}`,
    },
    params: {
      timelockDelaySec: Number(TIMELOCK_DELAY),
      priceScale: PRICE_SCALE.toString(),
      defaultDrawdownBase: DEFAULT_DRAWDOWN.toString(),
      defaultBasePositionBase: DEFAULT_BASE_POS.toString(),
      copilotSigner,
    },
  };
  const path = writeDeployment(record);

  // eslint-disable-next-line no-console
  console.log(`\n✓ deployment written → ${path}`);
  // eslint-disable-next-line no-console
  console.log(
    `\nNext:\n` +
      `  1. Fund the subscriber with ≥32 SOMI, then subscribe() to the price source (§4.3, §10).\n` +
      `  2. Authorize the watcher wallet: subscriber.setFallbackWatcher(<watcher>, true) (§4.5).\n` +
      `  3. Seed house agents: \`pnpm seed\` (§7 Phase 3).\n`,
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("\n✗ deploy failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
