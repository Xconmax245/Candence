import "dotenv/config";
import { createPublicClient, http, encodeFunctionData, type Hex } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { DREAMDEX_CORE, OPERATOR_SELECTORS } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";

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

const poolAbi = [
  { type: "function", name: "marketExpiryNs", inputs: [], outputs: [{ name: "", type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "getOrderBookParameters", inputs: [], outputs: [{ name: "tickSize", type: "uint256" }, { name: "minQuantity", type: "uint256" }, { name: "lotSize", type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "placeBinaryOrderFor",
    inputs: [
      { name: "owner", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "price", type: "uint256" },
      { name: "quantity", type: "uint256" },
      { name: "expireTimestampNs", type: "uint64" },
      { name: "orderType", type: "uint8" },
      { name: "selfMatchingOption", type: "uint8" },
      { name: "builder", type: "address" },
      { name: "builderFeeBpsTimes1k", type: "uint96" },
      { name: "userData", type: "uint64" },
    ],
    outputs: [
      { name: "success", type: "bool" },
      { name: "id", type: "uint128" },
    ],
    stateMutability: "payable",
  },
] as const;

async function main() {
  const dep = readDeployment("testnet");
  const agents = JSON.parse(require("fs").readFileSync("./deployments/agents.testnet.json", "utf8"));
  const vault1 = agents.agents[0].vault as Hex;
  const deployer = dep?.deployer as Hex;

  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const marketKey = "0x0000000000000000000000000000000000000000000000000000000000014058" as Hex;
  const mRes = await pub.readContract({
    address: DREAMDEX_CORE.BinaryMarketsModule as Hex,
    abi: moduleAbi,
    functionName: "markets",
    args: [marketKey],
  });
  const poolAddr = mRes[9];

  console.log("Reading pool.marketExpiryNs():");
  const poolExpiryNs = await pub.readContract({
    address: poolAddr,
    abi: poolAbi,
    functionName: "marketExpiryNs",
  }).catch((e: any) => console.log("  marketExpiryNs error:", e?.shortMessage ?? e));
  console.log("  pool.marketExpiryNs:", poolExpiryNs);
  console.log("  mRes[13] expiry sec:", mRes[13]);

  // Test placeBinaryOrderFor with poolExpiryNs
  const expToUse = poolExpiryNs ? BigInt(poolExpiryNs) : BigInt(mRes[13]) * 1000000000n;
  console.log("Testing placeBinaryOrderFor with expireNs =", expToUse);

  for (const q of [1000n, 10000n, 1000000n, 5000000n]) {
    for (const p of [500n, 550n, 600n]) {
      try {
        const callData = encodeFunctionData({
          abi: poolAbi,
          functionName: "placeBinaryOrderFor",
          args: [deployer, 0, p, q, expToUse, 0, 0, "0x0000000000000000000000000000000000000000", 0n, 0n],
        });
        const res = await pub.call({
          account: vault1,
          to: poolAddr,
          data: callData,
        });
        console.log(`  SUCCESS! price=${p}, qty=${q} -> res:`, res);
      } catch (e: any) {
        // error
      }
    }
  }
}

main().catch(console.error);
