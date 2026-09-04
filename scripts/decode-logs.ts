import "dotenv/config";
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { readDeployment } from "./lib/artifacts.js";

const handlerFailed = parseAbiItem(
  "event HandlerFailed(address indexed vault, bytes32 indexed marketKey, string reason)"
);
const handlerSkipped = parseAbiItem(
  "event HandlerSkipped(address indexed vault, bytes32 indexed marketKey, string reason)"
);
const handlerSucceeded = parseAbiItem(
  "event HandlerSucceeded(address indexed vault, bytes32 indexed marketKey, uint64 latencyMs, uint256 blockNumber)"
);

async function main() {
  const dep = readDeployment("testnet");
  const subscriber = dep?.contracts?.ReactivitySubscriber as Address;
  console.log(`Subscriber: ${subscriber}`);

  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const head = await pub.getBlockNumber();
  console.log(`Head block: ${head}`);
  
  // Search over last 20,000 blocks
  const fromBlock = BigInt(dep?.deployedAtBlock ?? 475565379);
  console.log(`Scanning logs from deployment block ${fromBlock} to ${head}...`);

  const [failed, skipped, succeeded] = await Promise.all([
    pub.getLogs({ address: subscriber, event: handlerFailed, fromBlock, toBlock: head }).catch(() => []),
    pub.getLogs({ address: subscriber, event: handlerSkipped, fromBlock, toBlock: head }).catch(() => []),
    pub.getLogs({ address: subscriber, event: handlerSucceeded, fromBlock, toBlock: head }).catch(() => []),
  ]);

  console.log(`\n=== SUBSCRIBER LOG SUMMARY ===`);
  console.log(`HandlerSucceeded events: ${succeeded.length}`);
  console.log(`HandlerFailed events:    ${failed.length}`);
  console.log(`HandlerSkipped events:   ${skipped.length}`);

  if (failed.length > 0) {
    console.log(`\n--- FAILED REASONS ---`);
    for (const f of failed.slice(-10)) {
      const a = f.args;
      console.log(`Block ${f.blockNumber} | Vault: ${a.vault} | Market: ${a.marketKey} | Reason: ${a.reason}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n--- SKIPPED REASONS ---`);
    for (const s of skipped.slice(-10)) {
      const a = s.args;
      console.log(`Block ${s.blockNumber} | Vault: ${a.vault} | Market: ${a.marketKey} | Reason: ${a.reason}`);
    }
  }

  if (succeeded.length > 0) {
    console.log(`\n--- SUCCEEDED EVENTS ---`);
    for (const s of succeeded.slice(-10)) {
      const a = s.args;
      console.log(`Block ${s.blockNumber} | Vault: ${a.vault} | Market: ${a.marketKey} | Latency: ${a.latencyMs}ms | Tx: ${s.transactionHash}`);
    }
  }
}

main().catch(console.error);
