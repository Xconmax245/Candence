import { createPublicClient, http, parseAbi } from "viem";
import { somniaTestnet } from "../packages/shared/src/chains.js";

async function main() {
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const poolAddr = "0xeaf51a48b4bcb10364a86d5e319808564f4fbc31";

  const fns = [
    "operatorPermissionsRegistry() view returns (address)",
    "registry() view returns (address)",
    "permissionsRegistry() view returns (address)",
    "marketsCore() view returns (address)",
    "module() view returns (address)",
  ];

  for (const fn of fns) {
    try {
      const res = await pub.readContract({
        address: poolAddr,
        abi: parseAbi([`function ${fn}`]),
        functionName: fn.split("(")[0],
      });
      console.log(`  ✓ ${fn} -> ${res}`);
    } catch (e: any) {
      console.log(`  ✗ ${fn} -> revert`);
    }
  }
}

main().catch(console.error);
