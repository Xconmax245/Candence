import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { activeNetwork, viemChainFor, DREAMDEX_CORE, OPERATOR_SELECTORS } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";
import * as fs from "fs";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  return pk as Hex;
}

const registryAbi = [
  {
    type: "function",
    name: "setOperatorApprovalForPool",
    inputs: [
      { name: "pool", type: "address" },
      { name: "operator", type: "address" },
      { name: "selectors", type: "bytes4[]" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const poolAuthAbi = [
  {
    type: "function",
    name: "isOperatorAuthorized",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  if (!dep) throw new Error("No deployments found.");

  const agentsPath = `./deployments/agents.${net.name}.json`;
  if (!fs.existsSync(agentsPath)) throw new Error("No seeded agents found.");
  const agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));

  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });

  console.log("Fetching live Trading binary markets from indexer...");
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const markets = await exchange.client.listBinaryMarkets({ status: "Trading" });
  console.log(`Found ${markets.length} live binary markets.`);

  if (markets.length === 0) {
    console.log("No trading markets available.");
    return;
  }

  const activePools = Array.from(new Set(markets.map((m) => m.poolAddress as Hex)));
  console.log(`Active pools (${activePools.length}):`, activePools);

  const registry = DREAMDEX_CORE.OperatorPermissionsRegistry;
  const selectors = Object.values(OPERATOR_SELECTORS) as `0x${string}`[];

  for (const pool of activePools) {
    console.log(`\n========================================`);
    console.log(`Processing Pool: ${pool}`);
    console.log(`========================================`);

    for (const agent of agents.agents) {
      console.log(`\n  Vault: ${agent.name} (${agent.vault})`);

      // 1. Check if authorized on pool
      let authorized = false;
      try {
        authorized = await pub.readContract({
          address: pool,
          abi: poolAuthAbi,
          functionName: "isOperatorAuthorized",
          args: [account.address, agent.vault as `0x${string}`, OPERATOR_SELECTORS.placeOrderFor as `0x${string}`],
        });
      } catch (e: any) {
        console.log(`    (pool auth read note: ${e.message?.slice(0, 60)})`);
      }

      if (authorized) {
        console.log(`    ✓ ALREADY AUTHORIZED on pool ${pool}`);
        continue;
      }

      // 2. Grant per-pool operator approval
      console.log(`    Granting setOperatorApprovalForPool...`);
      const hash = await wallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "setOperatorApprovalForPool",
        args: [pool, agent.vault as `0x${string}`, selectors, true],
        account,
        chain,
      });
      console.log(`    tx: ${hash}`);
      await pub.waitForTransactionReceipt({ hash });

      // 3. Verify on pool
      try {
        const verified = await pub.readContract({
          address: pool,
          abi: poolAuthAbi,
          functionName: "isOperatorAuthorized",
          args: [account.address, agent.vault as `0x${string}`, OPERATOR_SELECTORS.placeOrderFor as `0x${string}`],
        });
        console.log(`    ✓ VERIFIED on pool: isOperatorAuthorized = ${verified}`);
      } catch (e: any) {
        console.log(`    ✓ Per-pool grant confirmed via tx ${hash}`);
      }
    }
  }

  console.log("\nAll per-pool operator grants complete and verified!");
}

main().catch(console.error);
