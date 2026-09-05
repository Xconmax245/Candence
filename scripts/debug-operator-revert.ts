import "dotenv/config";
import { createPublicClient, http, type Hex } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";
import { readDeployment } from "./lib/artifacts.js";

const vaultAbi = [
  { type: "function", name: "subscriber", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "ownerList", inputs: [], outputs: [{ name: "", type: "address[]" }], stateMutability: "view" },
  { type: "function", name: "isOwnerGranted", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "riskEngine", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

const riskAbi = [
  { type: "function", name: "isVaultPaused", inputs: [{ name: "vault", type: "address" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "checkSpend", inputs: [{ name: "vault", type: "address" }, { name: "owner", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "ok", type: "bool" }, { name: "reason", type: "string" }], stateMutability: "view" },
] as const;

async function main() {
  const dep = readDeployment("testnet");
  const agents = JSON.parse(require("fs").readFileSync("./deployments/agents.testnet.json", "utf8"));
  const subscriber = dep?.contracts?.ReactivitySubscriber as Hex;
  const vault1 = agents.agents[0].vault as Hex;
  const deployer = dep?.deployer as Hex;

  console.log("Subscriber:", subscriber);
  console.log("Vault 1:", vault1);
  console.log("Deployer:", deployer);

  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const subOnVault = await pub.readContract({ address: vault1, abi: vaultAbi, functionName: "subscriber" });
  console.log("Vault.subscriber:", subOnVault, subOnVault.toLowerCase() === subscriber.toLowerCase() ? "✓ MATCH" : "✗ MISMATCH");

  const owners = await pub.readContract({ address: vault1, abi: vaultAbi, functionName: "ownerList" });
  console.log("Vault.owners:", owners);

  const isGranted = await pub.readContract({ address: vault1, abi: vaultAbi, functionName: "isOwnerGranted", args: [deployer] });
  console.log("Vault.isOwnerGranted(deployer):", isGranted);

  const riskAddr = await pub.readContract({ address: vault1, abi: vaultAbi, functionName: "riskEngine" });
  console.log("Vault.riskEngine:", riskAddr);

  const paused = await pub.readContract({ address: riskAddr, abi: riskAbi, functionName: "isVaultPaused", args: [vault1] });
  console.log("RiskEngine.isVaultPaused(vault1):", paused);

  const checkSpend = await pub.readContract({ address: riskAddr, abi: riskAbi, functionName: "checkSpend", args: [vault1, deployer, 2750000n] });
  console.log("RiskEngine.checkSpend(vault1, deployer, 2.75m):", checkSpend);
}

main().catch(console.error);
