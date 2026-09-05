import * as MarketsSDK from "@somnia-chain/markets-sdk";
import { keccak256, toBytes } from "viem";

async function main() {
  const targetErrors = ["0xc04ad919", "0x6e4ba61d", "0x3154078e"];
  console.log("Searching errors in MarketsSDK ABIs...");

  for (const [k, v] of Object.entries(MarketsSDK)) {
    if (Array.isArray(v)) {
      for (const item of v as any[]) {
        if (item.type === "error") {
          const inputsStr = (item.inputs || []).map((i: any) => i.type).join(",");
          const sigStr = `${item.name}(${inputsStr})`;
          const hash = keccak256(toBytes(sigStr)).slice(0, 10);
          console.log(`[${k}] ${sigStr} -> ${hash}`);
          if (targetErrors.includes(hash)) {
            console.log(`🎯 MATCH! ${sigStr} = ${hash}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
