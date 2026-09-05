import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

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

  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    privateKey: pk,
    rpcUrl: "https://dream-rpc.somnia.network",
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const markets = await exchange.client.listBinaryMarkets({ status: "Trading" });
  const now = Math.floor(Date.now() / 1000);
  
  // Pick BTC 1h or market with at least 300s (5m) remaining!
  const targetMarket = markets.find((m: any) => m.asset === "BTC" && Number(m.expiry) - now > 300) || markets.find((m: any) => Number(m.expiry) - now > 300);
  if (!targetMarket) throw new Error("No market with >300s remaining found");

  const marketId = targetMarket.marketId as `0x${string}`;
  const poolAddr = targetMarket.poolAddress as `0x${string}`;
  const remSec = Number(targetMarket.expiry) - now;
  console.log(`Found target market: ${targetMarket.asset} (${targetMarket.interval || targetMarket.intervalSec}), marketId=${marketId}, pool=${poolAddr}, expires in ${remSec}s`);

  // Collateral allowance
  const collateralAddr = targetMarket.collateralToken || "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
  const allowance = await pub.readContract({
    address: collateralAddr as `0x${string}`,
    abi: parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]),
    functionName: "allowance",
    args: [account.address, poolAddr],
  });
  if (allowance < parseUnits("10", 6)) {
    console.log("Approving collateral to pool...");
    const tx = await wallet.writeContract({
      address: collateralAddr as `0x${string}`,
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      functionName: "approve",
      args: [poolAddr, parseUnits("1000000", 6)],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
  }

  console.log("Placing order via exchange.trader.placeOrder...");
  const res = await exchange.trader.placeOrder({
    pool: poolAddr,
    side: "BUY_YES",
    price: parseUnits("0.5", 18),
    quantity: parseUnits("1", 6), // 1 USDC
    orderType: 0, // LIMIT
  });

  console.log("🎉🎉🎉 SUCCESS! trader.placeOrder result:", res);
}

main().catch(console.error);
