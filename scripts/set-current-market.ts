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

  const markets = await exchange.client.listBinaryMarkets({
    status: "Trading",
  });
  console.log(`  fetched ${markets.length} Trading markets from GraphQL`);

  // Filter for our venue (if necessary) and prefer BTC 1h, ETH 1h, then any.
  const venueMarkets = markets.filter(m => m.venueId.toLowerCase() === venueId.toLowerCase());
  
  let market =
    venueMarkets.find((m) => m.asset === "BTC" && m.intervalSec === 3600) ??
    venueMarkets.find((m) => m.asset === "ETH" && m.intervalSec === 3600) ??
    venueMarkets[0] ??
    markets[0]; // fallback to ANY open market if venue filter fails

  if (!market) {
    console.log("\nNo open Trading window found on the indexer right now.");
    console.log("This is expected when between windows. Re-run when a window opens.");
    return;
  }

  console.log(`\nSelected market: ${market.symbol} (${market.intervalSec}s window)`);
  console.log(`  marketId:     ${market.marketId}`);
  console.log(`  status:       ${market.status} (should be 1 = Trading)`);
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = market.expiryTimeSec - nowSec;
  console.log(`  expires in:   ${Math.floor(remaining / 60)}m ${remaining % 60}s`);

  // Use keccak256(asset_symbol) as the assetId, just like the contract does internally
  const assetId = keccak256(toBytes(market.asset)) as Hex;
  const intervalSec = market.intervalSec;
  const marketId = market.marketId as Hex;

  console.log("\nChecking current onchain market registry...");
  const current = await pub.readContract({
    address: subscriber,
    abi: setCurrentMarketAbi,
    functionName: "currentMarket",
    args: [assetId, intervalSec],
  });
  if (current === marketId) {
    console.log("currentMarket already set to the live window. Nothing to do.");
    return;
  }
  console.log(`  current: ${current === "0x0000000000000000000000000000000000000000000000000000000000000000" ? "(empty)" : current}`);
  console.log(`  new:     ${marketId}`);

  console.log("\nCalling setCurrentMarket()...");
  const hash = await wallet.writeContract({
    address: subscriber,
    abi: setCurrentMarketAbi,
    functionName: "setCurrentMarket",
    args: [assetId, intervalSec, marketId],
    account,
    chain,
  });
  console.log(`  tx: ${hash}`);
  console.log("  waiting for receipt...");
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);

  if (receipt.status === "success") {
    console.log(`
✅ currentMarket set!
   asset:       ${market.asset}
   assetId:     ${assetId}
   intervalSec: ${intervalSec}
   marketId:    ${marketId}

The ReactivitySubscriber will now trade against this window on the next
MarkPriceUpdated event. Window expires in ~${Math.floor(remaining / 60)} minutes.

Explorer: ${net.explorerBase}/tx/${hash}
`);
  }
}

main().catch(console.error);
