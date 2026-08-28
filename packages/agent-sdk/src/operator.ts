/**
 * @cadence/agent-kit — the operator (session-key) model for non-custodial
 * copy-trading.
 *
 * DreamDEX's real primitive is an OPERATOR model, not a vault that holds
 * delegated funds. An authorized operator calls `placeOrderFor` /
 * `cancelOrderFor` / `reduceOrderFor` on the owner's behalf; fills settle
 * directly to the owner's OWN wallet, and deposits/withdrawals remain owner-only,
 * always. Authorization lives in the OperatorPermissionsRegistry, is grantable
 * per selector (globally or per-pool), and is revocable immediately by the owner.
 *
 * Spend caps are NOT enforced by the registry — the caller (Cadence's vault, or
 * your own agent) must enforce them. This module builds the grant/revoke calldata
 * and the `*For` order calldata; enforce your own spend limit before signing.
 */
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { OPERATOR_SELECTORS, Outcome } from "./types.js";

/** Minimal registry ABI — matches IOperatorPermissionsRegistry in IDreamDEX.sol §1.6. */
export const operatorRegistryAbi = [
  {
    type: "function",
    name: "grantOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isAuthorized",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Build the calldata for an owner to grant an operator the place+cancel+reduce
 * selectors globally. The owner sends these 3 txs sequentially to
 * OperatorPermissionsRegistry — this IS the entire "Clone this agent" flow (§1.6).
 * Returns one calldata blob per selector.
 */
export function buildGrantCalldata(operator: Address): Hex[] {
  return [OPERATOR_SELECTORS.place, OPERATOR_SELECTORS.cancel, OPERATOR_SELECTORS.reduce].map(
    (selector) =>
      encodeFunctionData({
        abi: operatorRegistryAbi,
        functionName: "grantOperator",
        args: [operator, selector],
      }),
  );
}

/** Build calldata for an owner to REVOKE the operator (immediate, owner-only). */
export function buildRevokeCalldata(operator: Address): Hex[] {
  return [OPERATOR_SELECTORS.place, OPERATOR_SELECTORS.cancel, OPERATOR_SELECTORS.reduce].map(
    (selector) =>
      encodeFunctionData({
        abi: operatorRegistryAbi,
        functionName: "revokeOperator",
        args: [operator, selector],
      }),
  );
}

/** Args for a `placeOrderFor` call, in the exact onchain order. */
export interface PlaceForArgs {
  owner: Address;
  marketId: Hex;
  outcome: Outcome;
  /** Price in base units (bigint, snapped to tick — never a float). */
  priceBase: bigint;
  /** Size in base units (bigint, quantized to lot). */
  sizeBase: bigint;
  /** IOC removes any unfilled remainder instead of leaving it escrow-locked. */
  ioc: boolean;
  /** Mandatory expiry in ns, capped at market expiry. */
  expireTimestampNs: bigint;
}

/** DreamDEX write ABI subset for the operator `*For` variants. */
export const operatorTradeAbi = [
  {
    type: "function",
    name: "placeOrderFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "outcome", type: "uint8" },
      { name: "price", type: "uint256" },
      { name: "size", type: "uint256" },
      { name: "ioc", type: "bool" },
      { name: "expireTimestampNs", type: "uint64" },
    ],
    outputs: [{ name: "orderId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelOrderFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "orderId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/** Encode a `placeOrderFor` call. The order settles to the OWNER's wallet. */
export function encodePlaceOrderFor(a: PlaceForArgs): Hex {
  return encodeFunctionData({
    abi: operatorTradeAbi,
    functionName: "placeOrderFor",
    args: [
      a.owner,
      a.marketId,
      a.outcome,
      a.priceBase,
      a.sizeBase,
      a.ioc,
      a.expireTimestampNs,
    ],
  });
}
