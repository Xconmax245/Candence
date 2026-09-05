import { contractErrorsAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/contractErrorsAbi.js";
import { keccak256, toBytes } from "viem";

async function main() {
  const targetSelectors = ["0x6e4ba61d", "0x3fb0ba2e", "0x3154078e", "0xc04ad919"];

  for (const item of contractErrorsAbi as any[]) {
    const inputsStr = (item.inputs || []).map((i: any) => i.type).join(",");
    const sigStr = `${item.name}(${inputsStr})`;
    const hash = keccak256(toBytes(sigStr)).slice(0, 10);
    if (targetSelectors.includes(hash)) {
      console.log(`🎯 MATCH! Selector ${hash} => ${sigStr}`);
    }
  }
}

main().catch(console.error);
