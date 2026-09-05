import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

async function main() {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
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

  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    privateKey: pk,
    rpcUrl: "https://dream-rpc.somnia.network",
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const markets = await exchange.client.listBinaryMarkets({ status: "Trading" });
  const now = Math.floor(Date.now() / 1000);
  const targetMarket = markets.find((m: any) => m.asset === "BTC" && Number(m.expiry) - now > 300) || markets.find((m: any) => Number(m.expiry) - now > 300);
  if (!targetMarket) throw new Error("No market >300s remaining");

  const poolAddr = targetMarket.poolAddress as `0x${string}`;
  const collateralAddr = targetMarket.collateralToken || "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";

  console.log(`Target Market: ${targetMarket.asset}, pool: ${poolAddr}`);

  // Ensure approval
  const allowance = await pub.readContract({
    address: collateralAddr as `0x${string}`,
    abi: parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]),
    functionName: "allowance",
    args: [account.address, poolAddr],
  });
  if (allowance < parseUnits("1000", 6)) {
    const tx = await wallet.writeContract({
      address: collateralAddr as `0x${string}`,
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      functionName: "approve",
      args: [poolAddr, parseUnits("1000000", 6)],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
  }

  const expNs: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function marketExpiryNs() view returns (uint64)"]),
    functionName: "marketExpiryNs",
  });

  // Price on 6-dec testnet: 1.0 = 1,000,000 (1e6). 50% = 500,000!
  const price50Percent = 500_000n; // 50%
  const quantity1Lot = 1_000_000n; // 1 USDC lot (6 dec)

  console.log("Simulating eth_call for placeBinaryOrder with price=500000n...");
  try {
    const res = await pub.call({
      account: account.address,
      to: poolAddr,
      data: ("0x718c2d4d" +
        "0000000000000000000000000000000000000000000000000000000000000000" + // 0 = BUY_YES
        price50Percent.toString(16).padStart(64, "0") +
        quantity1Lot.toString(16).padStart(64, "0") +
        expNs.toString(16).padStart(64, "0") +
        "0000000000000000000000000000000000000000000000000000000000000000" + // 0 = LIMIT
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`,
    });
    console.log("🎉🎉🎉 SUCCESS! eth_call result:", res);
  } catch (e: any) {
    console.log("eth_call revert data:", e.data || e.cause?.data || e.raw || e);
  }

  console.log("\nExecuting live placeBinaryOrder transaction...");
  const placeTx = await wallet.writeContract({
    address: poolAddr,
    abi: parseAbi([
      "function placeBinaryOrder(uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable returns (bool success, uint128 id)",
    ]),
    functionName: "placeBinaryOrder",
    args: [
      0, // BUY_YES
      price50Percent,
      quantity1Lot,
      expNs,
      0, // LIMIT
      0,
      "0x0000000000000000000000000000000000000000",
      0n,
      0n,
    ],
  });
  console.log("placeTx Hash:", placeTx);
  const receipt = await pub.waitForTransactionReceipt({ hash: placeTx });
  console.log("🎉🎉🎉 LIVE TRANSACTION CONFIRMED ON-CHAIN! Status:", receipt.status);
}

main().catch(console.error);
