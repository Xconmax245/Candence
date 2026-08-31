import "dotenv/config";
import { createPublicClient, createWalletClient, http, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeNetwork, viemChainFor } from "../packages/shared/src/index.js";
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
  
  // We need to authorize the deployer as a fallback watcher first!
  const authAbi = [{
    type: "function",
    name: "setFallbackWatcher",
    inputs: [{ name: "watcher", type: "address" }, { name: "allowed", type: "bool" }],
    outputs: [],
    stateMutability: "nonpayable"
  }] as const;

  console.log("Authorizing your wallet as a Fallback Watcher...");
  const authHash = await wallet.writeContract({
    address: subscriber,
    abi: authAbi,
    functionName: "setFallbackWatcher",
    args: [account.address, true],
    account,
    chain
  });
  await publicClient.waitForTransactionReceipt({ hash: authHash });

  // Now submit the fallback trigger
  const fallbackAbi = [{
    type: "function",
    name: "submitFallbackTrigger",
    inputs: [{ name: "marketKey", type: "bytes32" }, { name: "data", type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable"
  }] as const;

  // Fake a marketKey and some price data for the demo
  const dummyMarketKey = "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000";
  // The vaults expect data to be encoded as: abi.encode(marketKey, markPrice, rawMidpoint)
  // Let's create a hex string of the abi encoded data for testing!
  // Let's create a hex string of the abi encoded data for testing!
  const encodedData = encodeAbiParameters(
    parseAbiParameters("bytes32, uint256, uint256"),
    [dummyMarketKey, 60000000000n, 60000000000n]
  );

  console.log(`Submitting manual fallback trigger to light up telemetry...`);
  try {
    const hash = await wallet.writeContract({
      address: subscriber,
      abi: fallbackAbi,
      functionName: "submitFallbackTrigger",
      args: [dummyMarketKey, encodedData],
      account,
      chain,
      gas: 5_000_000n // Ensure enough gas for fan-out
    });
    console.log(`Transaction submitted (hash: ${hash}). Waiting for receipt...`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("\nSuccess! Fallback event triggered. Check the dashboard!");
  } catch (err) {
    console.log(err);
  }
}

main().catch(console.error);
