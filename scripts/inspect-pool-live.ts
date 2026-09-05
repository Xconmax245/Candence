import "dotenv/config";
import { createPublicClient, http, type Hex } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";

const poolAbi = [
  {
    type: "function",
    name: "getOrderBookParameters",
    inputs: [],
    outputs: [
      { name: "tickSize", type: "uint256" },
      { name: "minQuantity", type: "uint256" },
      { name: "lotSize", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const poolAddr = "0x8bbeeb8a47782b429abb37ee58ac93346c2d638b" as Hex;
  console.log("Calling getOrderBookParameters on pool:", poolAddr);

  try {
    const res = await pub.readContract({
      address: poolAddr,
      abi: poolAbi,
      functionName: "getOrderBookParameters",
    });
    console.log("getOrderBookParameters result:", res);
  } catch (e: any) {
    console.error("getOrderBookParameters failed:", e?.message ?? e);
  }
}

main().catch(console.error);
