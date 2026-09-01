import "dotenv/config";
import { createPublicClient, createWalletClient, http, maxUint256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeNetwork, viemChainFor, DREAMDEX_CORE } from "../packages/shared/src/index.js";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  return pk as Hex;
}

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const net = activeNetwork();
  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });

  const collateral = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
  const spenders = [
    { name: "BinarySettlement", address: DREAMDEX_CORE.BinarySettlement },
    { name: "MarketsCore", address: DREAMDEX_CORE.MarketsCore },
    { name: "BinaryMarketsModule", address: DREAMDEX_CORE.BinaryMarketsModule },
  ];

  console.log(`Approving tUSDC collateral for deployer wallet (${account.address})...`);

  for (const s of spenders) {
    const allowance = await pub.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, s.address as `0x${string}`],
    });

    if (allowance > 1_000_000_000_000n) {
      console.log(`  ✓ ${s.name} (${s.address}) already has sufficient allowance.`);
      continue;
    }

    console.log(`  approving max tUSDC for ${s.name} (${s.address})...`);
    const hash = await wallet.writeContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "approve",
      args: [s.address as `0x${string}`, maxUint256],
      account,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  ✓ tx: ${hash}`);
  }

  console.log("Collateral approvals complete!");
}

main().catch(console.error);
