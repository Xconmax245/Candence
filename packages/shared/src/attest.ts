/**
 * Candence — AI signal attestation (DIRECTIVE §5, §4.2).
 *
 * The AI copilot NEVER gates order timing. It only *offers* a signed, timestamped
 * directional signal that an AI-assisted vault MAY read as one weighted input. If
 * no valid attested signal exists for the current window at trigger time, the
 * vault falls back to pure Reactive rules (§4.2) — this module makes "valid" a
 * precise, verifiable predicate rather than a vibe.
 *
 * ┌── CRITICAL: this MUST match CopilotAttestor.sol byte-for-byte ───────────────┐
 * │ The onchain verifier computes:                                               │
 * │   digest   = keccak256(abi.encodePacked(                                      │
 * │                "CANDENCE_SIGNAL_V1", windowKey, scoreBps, confidenceBps,       │
 * │                issuedAt))                                                     │
 * │   ethSigned= keccak256("\x19Ethereum Signed Message:\n32" ‖ digest)          │
 * │   require(ecrecover(ethSigned, sig) == signer)                               │
 * │ and the AgentVault reads the signal at                                       │
 * │   windowKey = keccak256(abi.encode(bytes32 marketId, uint256 windowOpen))    │
 * │ where windowOpen = expiry − interval. If the offchain digest/key drift from  │
 * │ these, every posted signature is rejected and every AI vault silently        │
 * │ degrades to Reactive — so these two derivations are the whole contract.      │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */
import {
  keccak256,
  encodePacked,
  encodeAbiParameters,
  recoverMessageAddress,
  type Hex,
  type LocalAccount,
} from "viem";
import type { AttestedSignal, Asset, IntervalSec } from "./types.js";

/** Clamp helpers so the integer bps fields can never overflow their onchain types. */
export function toScoreBps(score: number): number {
  return Math.max(-10000, Math.min(10000, Math.round(score * 10000)));
}
export function toConfidenceBps(confidence: number): number {
  return Math.max(0, Math.min(10000, Math.round(confidence * 10000)));
}

/**
 * The AgentVault/CopilotAttestor storage key for a window. MUST equal the
 * contract's `_windowKey`: keccak256(abi.encode(bytes32 marketId, uint256 windowOpen)).
 * `abi.encode` (not encodePacked) — matches AgentVault._windowKey exactly.
 */
export function computeWindowKey(marketId: Hex, windowOpenSec: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [marketId, BigInt(windowOpenSec)],
    ),
  );
}

/**
 * The pre-personal-sign digest. MUST equal CopilotAttestor's
 * keccak256(abi.encodePacked("CANDENCE_SIGNAL_V1", windowKey, scoreBps,
 * confidenceBps, issuedAt)). Note scoreBps is int32 (signed) onchain.
 */
export function signalDigest(params: {
  windowKey: Hex;
  scoreBps: number;
  confidenceBps: number;
  issuedAtSec: number;
}): Hex {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "int32", "uint16", "uint64"],
      [
        "CANDENCE_SIGNAL_V1",
        params.windowKey,
        params.scoreBps,
        params.confidenceBps,
        BigInt(params.issuedAtSec),
      ],
    ),
  );
}

/**
 * Produce a fully-attested signal ready to POST to CopilotAttestor and to serve
 * to the frontend/vault. Signs the digest with EIP-191 personal_sign via the
 * dedicated signer account (distinct from any trading key, §5). The resulting
 * signature verifies under `ecrecover(ethSigned, sig)` onchain because viem's
 * `signMessage({ message: { raw } })` applies the identical \x19 prefix.
 */
export async function attestSignal(
  signer: LocalAccount,
  input: {
    asset: Asset;
    intervalSec: IntervalSec;
    marketId: Hex;
    windowOpenSec: number;
    score: number;
    confidence: number;
    issuedAtSec: number;
  },
): Promise<AttestedSignal> {
  const windowKey = computeWindowKey(input.marketId, input.windowOpenSec);
  const scoreBps = toScoreBps(input.score);
  const confidenceBps = toConfidenceBps(input.confidence);
  const digest = signalDigest({
    windowKey,
    scoreBps,
    confidenceBps,
    issuedAtSec: input.issuedAtSec,
  });
  const signature = await signer.signMessage({ message: { raw: digest } });
  return {
    asset: input.asset,
    intervalSec: input.intervalSec,
    marketId: input.marketId,
    windowOpenSec: input.windowOpenSec,
    windowKey,
    score: input.score,
    confidence: input.confidence,
    issuedAtSec: input.issuedAtSec,
    signer: signer.address,
    signature,
    correct: null,
  };
}

/** The bps arguments for a `postSignal` call, in the exact onchain order. */
export function postSignalArgs(
  s: AttestedSignal,
): [Hex, number, number, bigint, Hex] {
  return [
    s.windowKey,
    toScoreBps(s.score),
    toConfidenceBps(s.confidence),
    BigInt(s.issuedAtSec),
    s.signature,
  ];
}

/**
 * Verify an attested signal is valid FOR A GIVEN WINDOW at trigger time.
 * Returns a discriminated result so the vault fallback path (§4.2) can log the
 * precise reason it degraded to Reactive-only.
 */
export async function verifySignal(
  signal: AttestedSignal,
  ctx: {
    expectedMarketId: Hex;
    expectedWindowOpenSec: number;
    nowSec: number;
    /** Max age a signal may have and still be considered fresh for this window. */
    maxAgeSec: number;
    /** Optional pin: only accept signals from this signer. */
    trustedSigner?: Hex;
  },
): Promise<
  | { valid: true }
  | {
      valid: false;
      reason:
        | "wrong-window"
        | "stale"
        | "bad-signature"
        | "untrusted-signer"
        | "low-confidence";
    }
> {
  const expectedKey = computeWindowKey(ctx.expectedMarketId, ctx.expectedWindowOpenSec);
  if (
    signal.windowOpenSec !== ctx.expectedWindowOpenSec ||
    signal.windowKey.toLowerCase() !== expectedKey.toLowerCase()
  ) {
    return { valid: false, reason: "wrong-window" };
  }
  if (ctx.nowSec - signal.issuedAtSec > ctx.maxAgeSec) {
    return { valid: false, reason: "stale" };
  }
  if (signal.confidence <= 0) {
    return { valid: false, reason: "low-confidence" };
  }
  const digest = signalDigest({
    windowKey: signal.windowKey,
    scoreBps: toScoreBps(signal.score),
    confidenceBps: toConfidenceBps(signal.confidence),
    issuedAtSec: signal.issuedAtSec,
  });
  let recovered: Hex;
  try {
    recovered = await recoverMessageAddress({
      message: { raw: digest },
      signature: signal.signature,
    });
  } catch {
    return { valid: false, reason: "bad-signature" };
  }
  if (recovered.toLowerCase() !== signal.signer.toLowerCase()) {
    return { valid: false, reason: "bad-signature" };
  }
  if (ctx.trustedSigner && recovered.toLowerCase() !== ctx.trustedSigner.toLowerCase()) {
    return { valid: false, reason: "untrusted-signer" };
  }
  return { valid: true };
}

/** The window-open timestamp for a given time + interval (alignment key, §5). */
export function windowOpenFor(nowSec: number, intervalSec: number): number {
  return Math.floor(nowSec / intervalSec) * intervalSec;
}
