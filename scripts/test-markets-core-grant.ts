import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { somniaTestnet } from "../packages/shared/src/chains.js";

async function main() {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
  const ownerAccount = privateKeyToAccount(pk);
  const operatorAccount = privateKeyToAccount(generatePrivateKey());

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

  // Fund operator
  const fundTx = await ownerWallet.sendTransaction({
    to: operatorAccount.address,
    value: parseUnits("0.5", 18),
  });
  await pub.waitForTransactionReceipt({ hash: fundTx });

  const poolAddr = "0xeaf51a48b4bcb10364a86d5e319808564f4fbc31";
  const collateralAddr = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
  const marketsCore = "0x2802504314685D89bF6C992CA5a8e7cC78bc0294";
  const registry = "0x15C7e8CE38F021c5b45d098AaD788f63090bF20A";

  const selectors = ["0x80054449", "0xe37b444b", "0x364c2587"] as `0x${string}`[];

  console.log("Granting on MarketsCore 0x2802...");
  try {
    const tx1 = await ownerWallet.writeContract({
      address: marketsCore,
      abi: parseAbi(["function setOperatorApprovalGlobal(address operator, bytes4[] selectors, bool approved)"]),
      functionName: "setOperatorApprovalGlobal",
      args: [operatorAccount.address, selectors, true],
    });
    console.log("MarketsCore global grant tx:", tx1);
    await pub.waitForTransactionReceipt({ hash: tx1 });
  } catch (e: any) {
    console.log("MarketsCore global grant failed:", e.message?.slice(0, 80));
  }

  try {
    const tx2 = await ownerWallet.writeContract({
      address: marketsCore,
      abi: parseAbi(["function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)"]),
      functionName: "setOperatorApprovalForPool",
      args: [poolAddr, operatorAccount.address, selectors, true],
    });
    console.log("MarketsCore pool grant tx:", tx2);
    await pub.waitForTransactionReceipt({ hash: tx2 });
  } catch (e: any) {
    console.log("MarketsCore pool grant failed:", e.message?.slice(0, 80));
  }

  // Also grant on registry 0x15C7
  console.log("Granting on Registry 0x15C7...");
  const tx3 = await ownerWallet.writeContract({
    address: registry,
    abi: parseAbi(["function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)"]),
    functionName: "setOperatorApprovalForPool",
    args: [poolAddr, operatorAccount.address, selectors, true],
  });
  await pub.waitForTransactionReceipt({ hash: tx3 });

  const expNs: any = await pub.readContract({
    address: poolAddr,
    abi: parseAbi(["function marketExpiryNs() view returns (uint64)"]),
    functionName: "marketExpiryNs",
  });

  console.log("Testing placeBinaryOrderFor from operator...");
  const placeTx = await operatorWallet.writeContract({
    address: poolAddr,
    abi: parseAbi([
      "function placeBinaryOrderFor(address owner, uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable returns (bool success, uint128 id)",
    ]),
    functionName: "placeBinaryOrderFor",
    args: [
      ownerAccount.address,
      0, // BUY_YES
      parseUnits("0.5", 18),
      parseUnits("1", 6),
      expNs,
      0, // LIMIT
      0,
      "0x0000000000000000000000000000000000000000",
      0n,
      0n,
    ],
  });

  console.log("placeBinaryOrderFor Tx:", placeTx);
  const receipt = await pub.waitForTransactionReceipt({ hash: placeTx });
  console.log("🎉🎉🎉 OPERATOR ORDER PLACED! Receipt status:", receipt.status);
}

main().catch(console.error);
