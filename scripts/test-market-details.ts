import "dotenv/config";
import { createPublicClient, http, type Hex } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { DREAMDEX_CORE } from "../packages/shared/src/index.js";

const moduleAbi = [
  {
    type: "function",
    name: "markets",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      { name: "oracleQuestionId", type: "uint256" },
      { name: "outcomeSlotCount", type: "uint8" },
      { name: "voidPolicy", type: "uint8" },
      { name: "collateral", type: "address" },
      { name: "originOperatorId", type: "uint32" },
      { name: "originVenueId", type: "bytes32" },
      { name: "oracleAdapter", type: "address" },
      { name: "creator", type: "address" },
      { name: "market", type: "address" },
      { name: "pool", type: "address" },
      { name: "yesId", type: "uint256" },
      { name: "noId", type: "uint256" },
      { name: "tradingStart", type: "uint64" },
      { name: "expiry", type: "uint64" },
    ],
    stateMutability: "view",
  },
] as const;

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const marketKey = "0x0000000000000000000000000000000000000000000000000000000000013bc2" as Hex;
  console.log("Querying module.markets for", marketKey, "at module:", DREAMDEX_CORE.BinaryMarketsModule);

  const res = await pub.readContract({
    address: DREAMDEX_CORE.BinaryMarketsModule as Hex,
    abi: moduleAbi,
    functionName: "markets",
    args: [marketKey],
  });

  console.log("Module.markets result:");
  console.log("  market contract:", res[8]);
  console.log("  pool contract:  ", res[9]);
  console.log("  tradingStart:   ", res[12]);
  console.log("  expiry:         ", res[13]);
}

main().catch(console.error);
