/**
 * Candence — chain configuration.
 *
 * Shannon testnet (50312) is the default target until explicitly told otherwise
 * (MASTER DIRECTIVE §0.4). Mainnet (5031) config is present but must never be
 * selected without `doctor.ts`-style verification first.
 *
 * Contract addresses are IDENTICAL across testnet and mainnet via CREATE3
 * (DIRECTIVE §1.5) — the only per-network differences are RPC/REST/WS endpoints,
 * the collateral token (+ its decimals), and the *starting* venue id.
 */
import { defineChain } from "viem";

export type NetworkName = "testnet" | "mainnet";

/** The Reactivity precompile (DIRECTIVE §1.3, §4.1, §10). Never changes. */
export const REACTIVITY_PRECOMPILE = "0x0000000000000000000000000000000000000100" as const;

/**
 * Core DreamDEX / Event Contracts addresses — verified 21 Aug 2026 (DIRECTIVE §1.5).
 * Identical on both networks via CREATE3. Per-market Market/Pool addresses are
 * NEVER hardcoded — resolve them live from the module registry (§1.2, §1.5).
 */
export const DREAMDEX_CORE = {
  BinaryMarketsModule: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  MarketsCore: "0x2802504314685D89bF6C992CA5a8e7cC78bc0294",
  BinarySettlement: "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23",
  OutcomeToken6909: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9",
  OracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b",
  CollateralRouter: "0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C",
  /** Owner calls grantOperator(vault, selector) here — the §1.6 non-custodial grant target. */
  OperatorPermissionsRegistry: "0x2802504314685D89bF6C992CA5a8e7cC78bc0294",
} as const;

/**
 * Operator model selectors (DIRECTIVE §1.6). The vault is an OPERATOR, never a
 * custodian — these are the only selectors it is ever granted.
 */
export const OPERATOR_SELECTORS = {
  placeOrderFor: "0x80054449",
  cancelOrderFor: "0xe37b444b",
  reduceOrderFor: "0x364c2587",
} as const;

interface NetworkConfig {
  name: NetworkName;
  chainId: number;
  rpcUrl: string;
  restUrl: string;
  wsUrl: string;
  /** Collateral token address + decimals. THE DECIMAL DIFFERENCE IS DANGEROUS (§1.5, gotcha #3). */
  collateral: { address: `0x${string}`; decimals: number; symbol: string };
  /** STARTING venue id only — always confirmed/overridden by a live read (§1.5, gotcha #8). */
  startingVenueId: `0x${string}`;
  explorerBase: string;
}

const ENV = (key: string, fallback: string): string => {
  const v = typeof process !== "undefined" ? process.env?.[key] : undefined;
  return v && v.length > 0 ? v : fallback;
};

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    chainId: 50312,
    rpcUrl: ENV("TESTNET_RPC_URL", "https://dream-rpc.somnia.network"),
    restUrl: ENV("TESTNET_REST_URL", "https://stg.api.dreamdex.io/v0"),
    wsUrl: ENV("TESTNET_WS_URL", "wss://stg.api.dreamdex.io/v0/ws/public"),
    // Testnet uses faucet test USDC at 6 decimals (DIRECTIVE §1.5).
    collateral: {
      address: "0x0000000000000000000000000000000000000000",
      decimals: 6,
      symbol: "tUSDC",
    },
    startingVenueId:
      "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
    explorerBase: ENV(
      "NEXT_PUBLIC_EXPLORER_BASE",
      "https://shannon-explorer.somnia.network",
    ),
  },
  mainnet: {
    name: "mainnet",
    chainId: 5031,
    rpcUrl: ENV("MAINNET_RPC_URL", "https://api.infra.mainnet.somnia.network"),
    restUrl: ENV("MAINNET_REST_URL", "https://api.dreamdex.io/v0"),
    wsUrl: ENV("MAINNET_WS_URL", "wss://api.dreamdex.io/v0/ws/public"),
    // Mainnet USDso, 18 decimals (DIRECTIVE §1.5).
    collateral: {
      address: "0x00000022dA000002656c64D9eA6011ea952D008A",
      decimals: 18,
      symbol: "USDso",
    },
    startingVenueId:
      "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
    explorerBase: ENV("NEXT_PUBLIC_EXPLORER_BASE", "https://explorer.somnia.network"),
  },
};

/** Resolve the active network from env, defaulting to testnet (DIRECTIVE §0.4). */
export function activeNetwork(): NetworkConfig {
  const sel = (ENV("CANDENCE_NETWORK", "testnet") as NetworkName) ?? "testnet";
  const cfg = NETWORKS[sel];
  if (!cfg) throw new Error(`Unknown CANDENCE_NETWORK "${sel}" (expected testnet|mainnet)`);
  return cfg;
}

/** viem chain definitions. */
export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "Somnia", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [NETWORKS.testnet.rpcUrl] } },
  blockExplorers: {
    default: { name: "Shannon Explorer", url: NETWORKS.testnet.explorerBase },
  },
  testnet: true,
});

export const somniaMainnet = defineChain({
  id: 5031,
  name: "Somnia",
  nativeCurrency: { name: "Somnia", symbol: "SOMI", decimals: 18 },
  rpcUrls: { default: { http: [NETWORKS.mainnet.rpcUrl] } },
  blockExplorers: {
    default: { name: "Somnia Explorer", url: NETWORKS.mainnet.explorerBase },
  },
});

export function viemChainFor(net: NetworkName) {
  return net === "mainnet" ? somniaMainnet : somniaTestnet;
}
