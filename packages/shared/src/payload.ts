/**
 * Cadence — reactive event payload codec (shared).
 *
 * The ReactivitySubscriber and AgentVault agree on a fixed 96-byte payload
 * layout for the price event `data` (see ReactivitySubscriber._extractMarketKey
 * and AgentVault._decide):
 *
 *   data[0:32]   = marketKey  (bytes32, == on-chain marketId)
 *   data[32:64]  = markPrice  (uint256, in venue price base units)
 *   data[64:96]  = strike     (uint256, in venue price base units)
 *
 * The offchain fallback watcher must construct this EXACT layout when it calls
 * `submitFallbackTrigger(bytes32 marketKey, bytes data)`, or the vault will
 * misread direction. Keeping the encoder here (one place) prevents drift between
 * the contract and every offchain caller.
 */
import { concat, pad, toHex, type Hex } from "viem";

/** Encode the 96-byte reactive payload the vault expects. */
export function encodeReactivePayload(params: {
  marketId: Hex;
  markPriceBase: bigint;
  strikeBase: bigint;
}): Hex {
  const marketId = pad(params.marketId, { size: 32 });
  const markPrice = pad(toHex(params.markPriceBase), { size: 32 });
  const strike = pad(toHex(params.strikeBase), { size: 32 });
  return concat([marketId, markPrice, strike]);
}

/** Decode a 96-byte reactive payload (tests / dashboard display). */
export function decodeReactivePayload(data: Hex): {
  marketId: Hex;
  markPriceBase: bigint;
  strikeBase: bigint;
} {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length < 192) {
    throw new Error(`reactive payload too short: ${hex.length / 2} bytes (need 96)`);
  }
  const word = (i: number): Hex => `0x${hex.slice(i * 64, i * 64 + 64)}`;
  return {
    marketId: word(0),
    markPriceBase: BigInt(word(1)),
    strikeBase: BigInt(word(2)),
  };
}
