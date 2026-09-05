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

  // Read active market pools directly from subscriber's currentMarket
  const moduleAbi = [
    {
      type: "function",
      name: "markets",
      inputs: [{ name: "marketId", type: "bytes32" }],
      outputs: [
        { name: "oracleQuestionId", type: "uint256" },
        { name: "outcomeSlotCount", type: "uint8" },
        { name: "voidPolicy", type: "uint8" },
        { name: "collateral", type: "address" },
        { name: "originOperatorId", type: "uint32" },
        { name: "originVenueId", type: "bytes32" },
        { name: "oracleAdapter", type: "address" },
        { name: "creator", type: "address" },
        { name: "market", type: "address" },
        { name: "pool", type: "address" },
        { name: "yesId", type: "uint256" },
        { name: "noId", type: "uint256" },
        { name: "tradingStart", type: "uint64" },
        { name: "expiry", type: "uint64" },
      ],
      stateMutability: "view",
    },
  ] as const;

  const subscriberAbi = [
    {
      type: "function",
      name: "currentMarket",
      inputs: [{ name: "assetId", type: "bytes32" }, { name: "intervalSec", type: "uint32" }],
      outputs: [{ name: "marketId", type: "bytes32" }],
      stateMutability: "view",
    },
  ] as const;

  const btcAsset = "0x8da9282b75a6f2b404d0263f350c3bc6f0119e0787e9ec85b46e3952f4625b64" as Hex; // keccak256("BTC")
  const subscriber = dep.contracts.ReactivitySubscriber as Hex;

  const btcMarketId = await pub.readContract({
    address: subscriber,
    abi: subscriberAbi,
    functionName: "currentMarket",
    args: [btcAsset, 3600],
  });

  const poolList: Hex[] = [];
  if (btcMarketId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
    const res = await pub.readContract({
      address: DREAMDEX_CORE.BinaryMarketsModule as Hex,
      abi: moduleAbi,
      functionName: "markets",
      args: [btcMarketId],
    });
    if (res[9] && res[9] !== "0x0000000000000000000000000000000000000000") {
      poolList.push(res[9] as Hex);
      console.log(`Found active BTC market pool: ${res[9]}`);
    }
  }

  // Include top indexer pools plus active market pool
  const indexerPools = markets.map((m) => m.poolAddress as Hex);
  const activePools = Array.from(new Set([...poolList, ...indexerPools])).slice(0, 8);
  console.log(`Target pools for operator granting (${activePools.length}):`, activePools);

  const registry = DREAMDEX_CORE.OperatorPermissionsRegistry;
  console.log(`Registry address: ${registry}`);

  const selectors: `0x${string}`[] = [
    OPERATOR_SELECTORS.placeOrderFor as `0x${string}`, // 0x80054449
    OPERATOR_SELECTORS.cancelOrderFor as `0x${string}`, // 0xe37b444b
  ];

  for (const pool of activePools) {
    console.log(`\nProcessing Pool: ${pool}`);
    for (const agent of agents.agents) {
      console.log(`  Vault ${agent.name} (${agent.vault}): granting setOperatorApprovalForPool...`);
      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
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
          console.log(`    ✓ Granted on pool ${pool}`);
          success = true;
          break;
        } catch (err: any) {
          console.log(`    attempt ${attempt} error: ${err.message?.slice(0, 80)}`);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
  }

  console.log("\nTarget pool operator grants complete!");
}

main().catch(console.error);
