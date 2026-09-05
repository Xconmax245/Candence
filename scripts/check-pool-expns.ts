import { createPublicClient, http, parseAbi } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import * as MarketsSDK from "@somnia-chain/markets-sdk";

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const poolAddr = "0x2acc476b71be2b180db670927bce1fe22e490940";

  const expNs: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function marketExpiryNs() view returns (uint64)"]),
    functionName: "marketExpiryNs",
  });
  console.log("pool.marketExpiryNs():", expNs);

  const nonce: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function marketNonce() view returns (uint64)"]),
    functionName: "marketNonce",
  });
  console.log("pool.marketNonce():", nonce);

  const finalized: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function finalized() view returns (bool)"]),
    functionName: "finalized",
  });
  console.log("pool.finalized():", finalized);
}

main().catch(console.error);
