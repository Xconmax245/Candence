import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import * as MarketsSDK from "@somnia-chain/markets-sdk";

async function main() {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
  if (!pk) throw new Error("PRIVATE_KEY missing");
  const account = privateKeyToAccount(pk);

  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const wallet = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const moduleAddr = "0x3ecC694Cef705358864a646142ac17A90E29e388";
  const marketId = "0x0000000000000000000000000000000000000000000000000000000000012caf"; // fresh live BTC market

  console.log("Account address:", account.address);

  // 1. Fetch market details from module
  const marketTuple: any = await pub.readContract({
    address: moduleAddr,
    abi: (MarketsSDK as any).binaryModuleReadAbi,
    functionName: "markets",
    args: [marketId],
  });

  const poolAddr = marketTuple[9];
  const marketAddr = marketTuple[8];
  const collateralAddr = marketTuple[3];
  const expiry = BigInt(marketTuple[13]);

  console.log("Pool address:", poolAddr);
  console.log("Market address:", marketAddr);
  console.log("Collateral address:", collateralAddr);
  console.log("Expiry:", expiry);

  // 2. Try placing order directly as owner with orderType = 0 (LIMIT)
  const price = parseUnits("0.5", 18); // 50%
  const quantity = parseUnits("1", 6); // 1 USDC lot
  const expireTimestampNs = expiry * 1_000_000_000n;

  console.log("Placing LIMIT binary order on pool directly...");
  const placeTx = await wallet.writeContract({
    address: poolAddr,
    abi: parseAbi([
      "function placeBinaryOrder(uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable returns (bool success, uint128 id)",
    ]),
    functionName: "placeBinaryOrder",
    args: [
      0, // 0 = BUY_YES
      price,
      quantity,
      expireTimestampNs,
      0, // 0 = LIMIT (or resting limit order)
      0, // CANCEL_TAKER
      "0x0000000000000000000000000000000000000000",
      0n,
      0n,
    ],
  });
  console.log("placeBinaryOrder TX Hash:", placeTx);
  const receipt = await pub.waitForTransactionReceipt({ hash: placeTx });
  console.log("🎉 SUCCESS! Transaction receipt status:", receipt.status);
}

main().catch(console.error);
