import { createPublicClient, http, parseAbi } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const poolAddr = "0xeaf51a48b4bcb10364a86d5e319808564f4fbc31";
  const owner = "0x49b56870d1C0F6f3C411156D50634f7916da93D0";
  const operator = "0x2651Cb1c946AB6eD3A8E72a5e8416ED3e93984E3";
  const selector = "0x80054449";

  console.log("Calling pool.isOperatorAuthorized...");
  try {
    const res = await pub.readContract({
      address: poolAddr,
      abi: parseAbi(["function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)"]),
      functionName: "isOperatorAuthorized",
      args: [owner, operator, selector],
    });
    console.log("isOperatorAuthorized result:", res);
  } catch (e: any) {
    console.log("isOperatorAuthorized revert:", e.message || e);
  }
}

main().catch(console.error);
