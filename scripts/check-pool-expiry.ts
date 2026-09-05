import { createPublicClient, http, parseAbi } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import * as MarketsSDK from "@somnia-chain/markets-sdk";

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const poolAddr = "0x96a2F46Dca8aD398a50d0f183200eA14766f8026";
  const moduleAddr = "0x3ecC694Cef705358864a646142ac17A90E29e388";
  const marketId = "0x0000000000000000000000000000000000000000000000000000000000012caf";

  const marketTuple: any = await pub.readContract({
    address: moduleAddr,
    abi: (MarketsSDK as any).binaryModuleReadAbi,
    functionName: "markets",
    args: [marketId],
  });

  console.log("marketTuple:", {
    tradingStart: marketTuple[12],
    expiry: marketTuple[13],
  });

  const poolParams: any = await pub.readContract({
    address: poolAddr,
    abi: (MarketsSDK as any).binaryPoolReadAbi,
    functionName: "getBinaryPoolParams",
  });
  console.log("poolParams:", poolParams);

  const nowSec = Math.floor(Date.now() / 1000);
  console.log("Current block/local timestamp (sec):", nowSec);
}

main().catch(console.error);
