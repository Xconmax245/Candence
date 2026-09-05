import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "../packages/shared/src/chains.js";

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

  const collateralAddr = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";

  console.log("Calling tUSDC faucet for", account.address, "...");
  const tx = await wallet.writeContract({
    address: collateralAddr,
    abi: parseAbi(["function faucet(uint256 amount)"]),
    functionName: "faucet",
    args: [parseUnits("10000", 6)],
  });

  console.log("Faucet Tx:", tx);
  await pub.waitForTransactionReceipt({ hash: tx });

  const bal: any = await pub.readContract({
    address: collateralAddr,
    abi: parseAbi(["function balanceOf(address account) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log("✅ New tUSDC balance:", formatUnits(bal, 6), "tUSDC");
}

main().catch(console.error);
