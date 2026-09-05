import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

async function main() {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const markets = await exchange.client.listBinaryMarkets({ status: "Trading" });
  const now = Math.floor(Date.now() / 1000);
  console.log(`Found ${markets.length} Trading markets. Current time: ${now}`);

  for (const m of markets) {
    const rem = Number(m.expiry) - now;
    console.log(`- Market ${m.asset} (${m.interval || m.intervalSec}): marketId=${m.marketId}, pool=${m.poolAddress}, expires in ${rem}s`);
  }
}

main().catch(console.error);
