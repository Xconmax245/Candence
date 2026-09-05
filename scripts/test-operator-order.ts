import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

async function main() {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
  const ownerAccount = privateKeyToAccount(pk);

  // Random operator account to act like AgentVault
  const operatorPk = generatePrivateKey();
  const operatorAccount = privateKeyToAccount(operatorPk);

  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const ownerWallet = createWalletClient({
    account: ownerAccount,
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const operatorWallet = createWalletClient({
    account: operatorAccount,
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  // Fund operator with some STT for gas
  console.log("Funding operator with STT for gas...");
  const fundTx = await ownerWallet.sendTransaction({
    to: operatorAccount.address,
    value: parseUnits("0.5", 18),
  });
  await pub.waitForTransactionReceipt({ hash: fundTx });

  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const markets = await exchange.client.listBinaryMarkets({ status: "Trading" });
  const now = Math.floor(Date.now() / 1000);
  const targetMarket = markets.find((m: any) => m.asset === "BTC" && Number(m.expiry) - now > 300) || markets.find((m: any) => Number(m.expiry) - now > 300);
  if (!targetMarket) throw new Error("No market >300s remaining");

  const poolAddr = targetMarket.poolAddress as `0x${string}`;
  const collateralAddr = targetMarket.collateralToken || "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
  const registryAddr = "0x15C7e8CE38F021c5b45d098AaD788f63090bF20A";

  console.log("Pool:", poolAddr);
  console.log("Owner:", ownerAccount.address);
  console.log("Operator:", operatorAccount.address);

  // 1. Owner approves tUSDC for pool
  const allowance = await pub.readContract({
    address: collateralAddr as `0x${string}`,
    abi: parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]),
    functionName: "allowance",
    args: [ownerAccount.address, poolAddr],
  });
  if (allowance < parseUnits("1000", 6)) {
    console.log("Owner approving tUSDC to pool...");
    const tx = await ownerWallet.writeContract({
      address: collateralAddr as `0x${string}`,
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      functionName: "approve",
      args: [poolAddr, parseUnits("1000000", 6)],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
  }

  // 2. Owner grants operator permission for pool on registry 0x15C7...
  console.log("Owner granting operator permission for pool on registry...");
  const selectors = ["0x80054449", "0xe37b444b", "0x364c2587"] as `0x${string}`[];
  const grantTx = await ownerWallet.writeContract({
    address: registryAddr,
    abi: parseAbi([
      "function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)",
    ]),
    functionName: "setOperatorApprovalForPool",
    args: [poolAddr, operatorAccount.address, selectors, true],
  });
  await pub.waitForTransactionReceipt({ hash: grantTx });

  // 3. Verify operator authorization on registry
  const isAuth: any = await pub.readContract({
    address: registryAddr,
    abi: parseAbi(["function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)"]),
    functionName: "isApprovedForPool",
    args: [poolAddr, ownerAccount.address, operatorAccount.address, "0x80054449"],
  });
  console.log("isApprovedForPool on registry:", isAuth);

  // 4. Operator calls placeBinaryOrderFor(owner, ...)
  const expNs: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function marketExpiryNs() view returns (uint64)"]),
    functionName: "marketExpiryNs",
  });

  console.log("Operator calling placeBinaryOrderFor on pool...");
  const placeTx = await operatorWallet.writeContract({
    address: poolAddr,
    abi: parseAbi([
      "function placeBinaryOrderFor(address owner, uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable returns (bool success, uint128 id)",
    ]),
    functionName: "placeBinaryOrderFor",
    args: [
      ownerAccount.address,
      0, // 0 = BUY_YES
      parseUnits("0.5", 18),
      parseUnits("1", 6),
      expNs,
      0, // LIMIT (0)
      0,
      "0x0000000000000000000000000000000000000000",
      0n,
      0n,
    ],
  });

  console.log("placeBinaryOrderFor Tx:", placeTx);
  const receipt = await pub.waitForTransactionReceipt({ hash: placeTx });
  console.log("🎉🎉🎉 OPERATOR PLACEMENT SUCCESS! Status:", receipt.status);
}

main().catch(console.error);
