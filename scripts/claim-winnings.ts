import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { activeNetwork, viemChainFor } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";
import * as fs from "fs";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  return pk as Hex;
}

const vaultSweepAbi = [
  {
    type: "function",
    name: "sweepClaims",
    inputs: [
      { name: "ownerWallet", type: "address" },
      { name: "marketKeys", type: "bytes32[]" },
      { name: "outcomes", type: "uint8[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
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

  console.log("Fetching resolved markets from indexer...");
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const [resolvedMarkets, voidedMarkets] = await Promise.all([
    exchange.client.listBinaryMarkets({ status: "Resolved" }).catch(() => []),
    exchange.client.listBinaryMarkets({ status: "Voided" }).catch(() => []),
  ]);

  const allFinished = [...resolvedMarkets, ...voidedMarkets];
  console.log(`  found ${allFinished.length} resolved/voided markets`);

  if (allFinished.length === 0) {
    console.log("No resolved markets to claim right now.");
    return;
  }

  const marketKeys = allFinished.slice(0, 10).map((m) => m.marketId as Hex);
  const outcomes = allFinished.slice(0, 10).map((m) => (m.winningOutcome === "YES" ? 0 : 1));

  console.log(`\nSweeping claims for ${agents.agents.length} house vaults over ${marketKeys.length} markets...`);

  for (const agent of agents.agents) {
    console.log(`  vault: ${agent.name} (${agent.vault})`);
    try {
      const hash = await wallet.writeContract({
        address: agent.vault as `0x${string}`,
        abi: vaultSweepAbi,
        functionName: "sweepClaims",
        args: [account.address, marketKeys, outcomes],
        account,
        chain,
      });
      console.log(`  tx: ${hash}`);
      await pub.waitForTransactionReceipt({ hash });
      console.log(`  ✓ claims swept for ${agent.name}`);
    } catch (e: any) {
      console.log(`  (no claimable balance or already swept: ${e.message?.slice(0, 80)})`);
    }
  }

  console.log("\nClaim sweep completed!");
}

main().catch(console.error);
