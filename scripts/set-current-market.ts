/**
 * set-current-market.ts
 *
 * Fetches the live BTC 1h Event Contract window from the DreamDEX indexer via
 * @somnia-chain/markets-sdk and calls setCurrentMarket() on the
 * ReactivitySubscriber so the reactive handler knows which marketId to trade
 * against on the next price event.
 *
 * Run:
 *   npx tsx scripts/set-current-market.ts
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { activeNetwork, viemChainFor, resolveVenueId } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  return pk as Hex;
}

const setCurrentMarketAbi = [
  {
    type: "function",
    name: "setCurrentMarket",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "intervalSec", type: "uint32" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "currentMarket",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "intervalSec", type: "uint32" },
    ],
    outputs: [{ name: "marketId", type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  if (!dep?.contracts.ReactivitySubscriber) throw new Error("ReactivitySubscriber not deployed.");

  const subscriber = dep.contracts.ReactivitySubscriber;
  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });

  console.log("Resolving live venue...");
  const { venueId, source } = await resolveVenueId();
  console.log(`  venueId: ${venueId} (source: ${source})`);

  console.log("\nConnecting to markets-sdk indexer...");
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  let markets: any[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      markets = await exchange.client.listBinaryMarkets({ status: "Trading" });
      break;
    } catch (e: any) {
      console.log(`  attempt ${attempt} failed: ${e.message?.slice(0, 80)}. Retrying...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log(`  fetched ${markets.length} Trading markets from GraphQL`);

  // Filter for our venue (if necessary) and prefer BTC 1h, ETH 1h, then any.
  const targetMarkets = [
    markets.find((m) => m.asset === "BTC"),
    markets.find((m) => m.asset === "ETH"),
  ].filter(Boolean);

  if (targetMarkets.length === 0 && markets.length > 0) {
    targetMarkets.push(markets[0]);
  }

  if (targetMarkets.length === 0) {
    console.log("\nNo open Trading window found on the indexer right now.");
    return;
  }

  for (const m of targetMarkets) {
    const market = m!;
    const assetId = keccak256(toBytes(market.asset)) as Hex;
    const intervalSec = 3600; // Tracked hero interval on ReactivitySubscriber
    const expirySec = Number((market as any).expiry || (market as any).expiryTimeSec || 0);
    const marketId = market.marketId as Hex;

    console.log(`\nMarket: ${market.asset} (${intervalSec}s window)`);
    console.log(`  marketId:     ${market.marketId}`);
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = expirySec - nowSec;
    console.log(`  expires in:   ${Math.floor(remaining / 60)}m ${remaining % 60}s`);

    console.log("  Checking onchain currentMarket...");
    const current = await pub.readContract({
      address: subscriber,
      abi: setCurrentMarketAbi,
      functionName: "currentMarket",
      args: [assetId, intervalSec],
    });

    if (current === marketId) {
      console.log("  ✓ currentMarket already set to live window.");
      continue;
    }

    console.log(`  updating currentMarket (${current === "0x0000000000000000000000000000000000000000000000000000000000000000" ? "empty" : current} -> ${marketId})...`);
    const hash = await wallet.writeContract({
      address: subscriber,
      abi: setCurrentMarketAbi,
      functionName: "setCurrentMarket",
      args: [assetId, intervalSec, marketId],
      account,
      chain,
    });
    console.log(`  tx: ${hash}`);
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  ✅ currentMarket set for ${market.asset}!`);
  }

  console.log("\nDone setting current markets.");
}

main().catch(console.error);
