import { createPublicClient, http, parseAbi } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import * as MarketsSDK from "@somnia-chain/markets-sdk";

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const poolAddr = "0xeaf51a48b4bcb10364a86d5e319808564f4fbc31";

  console.log("Reading pool params...");
  const obParams: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function getOrderBookParameters() view returns ((uint256 tickSize, uint256 minQuantity, uint256 lotSize))"]),
    functionName: "getOrderBookParameters",
  });
  console.log("getOrderBookParameters:", obParams);

  try {
    const poolParams: any = await pub.readContract({
      address: poolAddr,
      abi: (MarketsSDK as any).binaryPoolReadAbi,
      functionName: "getBinaryPoolParams",
    });
    console.log("getBinaryPoolParams:", poolParams);
  } catch (e: any) {
    console.log("getBinaryPoolParams failed:", e.message?.slice(0, 80));
  }
}

main().catch(console.error);
