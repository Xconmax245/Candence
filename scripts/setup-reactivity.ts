import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Hex, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeNetwork, viemChainFor, DREAMDEX_CORE } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  }
  return pk as Hex;
}

async function main() {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  if (!dep || !dep.contracts.ReactivitySubscriber) {
    throw new Error("ReactivitySubscriber deployment missing.");
  }

  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const subscriber = dep.contracts.ReactivitySubscriber;
  
  // Use a known MarkPriceUpdated emitter (e.g. BTC Spot Pool)
  // For the hackathon, we can use the oracle hub or a known pool.
  const BTC_SPOT_POOL = "0x89d910bf368940c5d2ebd431ce35ed7cdf8ba357";
  const PRICE_TOPIC = "0xdcb615e4f4fdebd80766322b7a0fb8720fa7bd42f360c7f763db9dd668beea5c"; // MarkPriceUpdated

  const subAbi = [{
    type: "function",
    name: "queueSetPriceSource",
    inputs: [{ name: "emitter", type: "address" }, { name: "topic", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable"
  }] as const;

  console.log(`Queueing price source for ReactivitySubscriber at ${subscriber}...`);
  try {
    const hash = await wallet.writeContract({
      address: subscriber,
      abi: subAbi,
      functionName: "queueSetPriceSource",
      args: [BTC_SPOT_POOL as `0x${string}`, PRICE_TOPIC as `0x${string}`],
      account,
      chain
    });
    console.log(`Transaction submitted (hash: ${hash}). Waiting for receipt...`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("\nSuccess! The 1-hour timelock has started.");
    console.log("In 1 hour, run `pnpm tsx scripts/finalize-reactivity.ts` to execute and subscribe.");
  } catch (err: any) {
    console.log(err.message);
  }
}

main().catch(console.error);
