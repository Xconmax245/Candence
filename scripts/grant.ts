import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Hex, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeNetwork, viemChainFor, DREAMDEX_CORE, OPERATOR_SELECTORS } from "../packages/shared/src/index.js";
import { readDeployment } from "./lib/artifacts.js";
import * as fs from "fs";

function requirePk(): Hex {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid.");
  }
  return pk as Hex;
}

async function main() {
  const net = activeNetwork();
  const dep = readDeployment(net.name);
  if (!dep) throw new Error("No deployments found.");
  
  const agentsPath = `./deployments/agents.${net.name}.json`;
  if (!fs.existsSync(agentsPath)) throw new Error("No seeded agents found.");
  const agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));

  const account = privateKeyToAccount(requirePk());
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const registry = DREAMDEX_CORE.OperatorPermissionsRegistry;
  
  const grantAbi = [{
    type: "function",
    name: "setOperatorApprovalGlobal",
    inputs: [
      { name: "operator", type: "address" },
      { name: "selectors", type: "bytes4[]" },
      { name: "approved", type: "bool" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }, {
    type: "function",
    name: "setOperatorApprovalForPool",
    inputs: [
      { name: "pool", type: "address" },
      { name: "operator", type: "address" },
      { name: "selectors", type: "bytes4[]" },
      { name: "approved", type: "bool" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }] as const;

  const selectors = Object.values(OPERATOR_SELECTORS) as `0x${string}`[];

  console.log(`Granting operator permissions to 6 seeded vaults on ${net.name} via ${registry}...`);
  for (const agent of agents.agents) {
    console.log(`\nAgent: ${agent.name} (${agent.vault})`);
    console.log(`  granting global approvals for selectors [${selectors.join(", ")}]`);
    const hash = await wallet.writeContract({
      address: registry,
      abi: grantAbi,
      functionName: "setOperatorApprovalGlobal",
      args: [agent.vault as `0x${string}`, selectors, true],
      account,
      chain
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ✓ tx: ${hash}`);
  }
  console.log("\nAll grants complete! The house agents are authorized on deployer wallet.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
