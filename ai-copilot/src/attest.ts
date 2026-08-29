/**
 * Candence AI copilot — onchain attestation posting (DIRECTIVE §5, §6).
 *
 * Takes a computed signal, produces the EIP-191 attestation via the shared
 * `attestSignal` (whose digest matches CopilotAttestor.sol byte-for-byte), and
 * relays it onchain with `postSignal`. After a window resolves, `gradeSignal`
 * records whether the signal was directionally correct — this is the raw feed
 * for the dashboard's "signal quality" metric (§5, §6).
 *
 * The signer key is dedicated to attestation and is DISTINCT from any trading
 * key (§5). Posting is best-effort and fully off the reactive critical path: a
 * failed post simply means AI-assisted vaults fall back to Reactive for that
 * window (§4.2) — it never blocks or delays an order.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import {
  activeNetwork,
  viemChainFor,
  attestSignal,
  postSignalArgs,
  CandenceAbi,
  type Asset,
  type IntervalSec,
  type AttestedSignal,
} from "@candence/shared";
import type { SignalOutput } from "./signal.js";

export interface PostContext {
  attestor: Address;
  signer: LocalAccount;
}

/** Attest a computed signal for a window and post it onchain. */
export async function attestAndPost(
  ctx: PostContext,
  window: {
    asset: Asset;
    intervalSec: IntervalSec;
    marketId: Hex;
    windowOpenSec: number;
    issuedAtSec: number;
  },
  signal: SignalOutput,
): Promise<{ attested: AttestedSignal; txHash: Hex } | { error: string }> {
  const net = activeNetwork();
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account: ctx.signer, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  try {
    const attested = await attestSignal(ctx.signer, {
      asset: window.asset,
      intervalSec: window.intervalSec,
      marketId: window.marketId,
      windowOpenSec: window.windowOpenSec,
      score: signal.score,
      confidence: signal.confidence,
      issuedAtSec: window.issuedAtSec,
    });

    const hash = await wallet.writeContract({
      address: ctx.attestor,
      abi: CandenceAbi.copilotAttestorAbi as unknown as Abi,
      functionName: "postSignal",
      args: postSignalArgs(attested),
      account: ctx.signer,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return { error: `postSignal reverted (${hash})` };
    return { attested, txHash: hash };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Grade a resolved window's signal (owner/oracle role on the attestor). */
export async function gradeWindow(
  ctx: PostContext,
  windowKey: Hex,
  correct: boolean,
): Promise<{ txHash: Hex } | { error: string }> {
  const net = activeNetwork();
  const chain = viemChainFor(net.name);
  const transport = http(net.rpcUrl);
  const wallet = createWalletClient({ account: ctx.signer, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  try {
    const hash = await wallet.writeContract({
      address: ctx.attestor,
      abi: CandenceAbi.copilotAttestorAbi as unknown as Abi,
      functionName: "gradeSignal",
      args: [windowKey, correct],
      account: ctx.signer,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return { error: `gradeSignal reverted (${hash})` };
    return { txHash: hash };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
