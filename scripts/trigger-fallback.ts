import "dotenv/config";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeNetwork, viemChainFor } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  return pk as Hex;
}

const subscriberAbi = [
  {
    type: "function",
    name: "isFallbackWatcher",
    inputs: [{ name: "watcher", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setFallbackWatcher",
    inputs: [
      { name: "watcher", type: "address" },
      { name: "allowed", type: "bool" },
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
  {
    type: "function",
    name: "submitFallbackTrigger",
    inputs: [
      { name: "marketKey", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
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
    name: "fallbackActivations",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  if (!dep?.contracts?.ReactivitySubscriber) throw new Error("ReactivitySubscriber not deployed.");
  const subscriber = dep.contracts.ReactivitySubscriber as Hex;

  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });

  console.log(`Checking fallback watcher status for ${account.address}...`);
  const isWatcher = await pub.readContract({
    address: subscriber,
    abi: subscriberAbi,
    functionName: "isFallbackWatcher",
    args: [account.address],
  });

  if (!isWatcher) {
    console.log("Setting deployer as authorized fallback watcher on ReactivitySubscriber...");
    const hash = await wallet.writeContract({
      address: subscriber,
      abi: subscriberAbi,
      functionName: "setFallbackWatcher",
      args: [account.address, true],
      account,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  ✓ tx: ${hash}`);
  } else {
    console.log("  ✓ Deployer is an authorized fallback watcher.");
  }

  const btcAssetId = keccak256(toBytes("BTC"));
  const marketKey = await pub.readContract({
    address: subscriber,
    abi: subscriberAbi,
    functionName: "currentMarket",
    args: [btcAssetId, 3600],
  });

  console.log(`\nCurrent BTC 1h onchain marketKey: ${marketKey}`);

  if (marketKey === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("currentMarket is not set on-chain. Run set-current-market first.");
  }

  // Construct payload (marketKey, markPrice = $65,000.00, rawMidpoint = $65,000.00)
  const markPrice = 65000000000n; // 8 decimals
  const rawMidpoint = 65000000000n;
  const payload = encodeAbiParameters(
    parseAbiParameters("bytes32, uint256, uint256"),
    [marketKey, markPrice, rawMidpoint]
  );

  console.log("Submitting fallback trigger to ReactivitySubscriber...");
  const txHash = await wallet.writeContract({
    address: subscriber,
    abi: subscriberAbi,
    functionName: "submitFallbackTrigger",
    args: [marketKey, payload],
    account,
    chain,
  });
  console.log(`  tx: ${txHash}`);
  console.log("Waiting for block confirmation...");
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log(`  confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);

  // Read updated onchain counters
  const [succeeded, failed, fallbacks] = await Promise.all([
    pub.readContract({ address: subscriber, abi: subscriberAbi, functionName: "succeededCount" }),
    pub.readContract({ address: subscriber, abi: subscriberAbi, functionName: "failedCount" }),
    pub.readContract({ address: subscriber, abi: subscriberAbi, functionName: "fallbackActivations" }),
  ]);

  console.log(`\n========================================`);
  console.log(`ON-CHAIN TELEMETRY METRICS`);
  console.log(`========================================`);
  console.log(`  succeededCount:      ${succeeded}`);
  console.log(`  failedCount:         ${failed}`);
  console.log(`  fallbackActivations: ${fallbacks}`);
  console.log(`  txHash:              ${txHash}`);
  console.log(`========================================\n`);
}

main().catch(console.error);
