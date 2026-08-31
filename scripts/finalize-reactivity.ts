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
  
  const BTC_SPOT_POOL = "0x89d910bf368940c5d2ebd431ce35ed7cdf8ba357"; 
  const PRICE_TOPIC = "0xdcb615e4f4fdebd80766322b7a0fb8720fa7bd42f360c7f763db9dd668beea5c"; 

  const execAbi = [{
    type: "function",
    name: "executeSetPriceSource",
    inputs: [{ name: "emitter", type: "address" }, { name: "topic", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable"
  }] as const;

  const subAbi = [{
    type: "function",
    name: "subscribe",
    inputs: [],
    outputs: [{ name: "subscriptionId", type: "uint256" }],
    stateMutability: "nonpayable"
  }] as const;

  console.log(`Executing price source for ReactivitySubscriber at ${subscriber}...`);
  try {
    const hash1 = await wallet.writeContract({
      address: subscriber,
      abi: execAbi,
      functionName: "executeSetPriceSource",
      args: [BTC_SPOT_POOL as `0x${string}`, PRICE_TOPIC as `0x${string}`],
      account,
      chain
    });
    console.log(`Transaction submitted (hash: ${hash1}). Waiting for receipt...`);
    await publicClient.waitForTransactionReceipt({ hash: hash1 });
    console.log("Success!");

    console.log(`Subscribing...`);
    const hash2 = await wallet.writeContract({
      address: subscriber,
      abi: subAbi,
      functionName: "subscribe",
      args: [],
      account,
      chain
    });
    console.log(`Transaction submitted (hash: ${hash2}). Waiting for receipt...`);
    await publicClient.waitForTransactionReceipt({ hash: hash2 });
    console.log("\nSuccess! The on-chain Reactivity loop is fully active!");
  } catch (err: any) {
    console.log(err.message);
  }
}

main().catch(console.error);
