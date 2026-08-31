"use client";
import { useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { LiveDot } from "./motion";

/**
 * The non-custodial "Clone this agent" flow (DIRECTIVE §4, §1.6).
 *
 * Sends 3 sequential eth_sendTransaction calls to OperatorPermissionsRegistry —
 * one per selector (place/cancel/reduce). Each is a real on-chain tx the user
 * signs in their wallet. The vault NEVER holds funds; every fill settles to the
 * user's own wallet; the grant is revocable any time.
 *
 * Props are passed from the server component (sandbox/page.tsx) so the registry
 * address and vault address are resolved server-side from DREAMDEX_CORE and the
 * live agent roster — never hardcoded in this component.
 *
 * ABI matches IOperatorPermissionsRegistry in IDreamDEX.sol (§1.6):
 *   grantOperator(address operator, bytes4 selector)  — 2 params, no pool.
 */

/** grantOperator(address, bytes4) — matches the real on-chain signature. */
const GRANT_ABI = [
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
] as const;

/** revokeOperator(address, bytes4) — immediate, owner-only. */
const REVOKE_ABI = [
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
] as const;

const SELECTORS = {
  place:  "0x80054449" as Hex,   // placeOrderFor
  cancel: "0xe37b444b" as Hex,  // cancelOrderFor
  reduce: "0x364c2587" as Hex,  // reduceOrderFor
} as const;

type Phase = "idle" | "connecting" | "approving" | "granting" | "following" | "error";

interface Props {
  agentName: string;
  /** The vault address to grant operator rights to. Passed from server component. */
  vaultAddress: Address;
  /** The OperatorPermissionsRegistry contract address. From DREAMDEX_CORE §1.6. */
  registryAddress: Address;
}

type Ethereum = {
  request(args: { method: "eth_requestAccounts" }): Promise<string[]>;
  request(args: { method: "eth_sendTransaction"; params: [{ from: string; to: string; data: string }] }): Promise<string>;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export function CloneAgent({ agentName, vaultAddress, registryAddress }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grantStep, setGrantStep] = useState<number>(0); // 0-2 for the 3 selectors
  const [txHashes, setTxHashes] = useState<string[]>([]);

  function getEthereum(): Ethereum | null {
    return (globalThis as unknown as { ethereum?: Ethereum }).ethereum ?? null;
  }

  async function connect() {
    setError(null);
    const eth = getEthereum();
    if (!eth) {
      setPhase("error");
      setError("No wallet detected. Install a Somnia-compatible wallet to follow this agent.");
      return;
    }
    try {
      setPhase("connecting");
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      
      // Ensure we are on Somnia Testnet before proceeding
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xc488" }], // 50312
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0xc488",
              chainName: "Somnia Testnet",
              rpcUrls: ["https://dream-rpc.somnia.network"],
              nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
              blockExplorerUrls: ["https://shannon-explorer.somnia.network"]
            }],
          });
        } else {
          throw switchError;
        }
      }

      setAddress(accounts[0] ?? null);
      setPhase("approving");
    } catch {
      setPhase("error");
      setError("Connection cancelled or network switch rejected.");
    }
  }

  async function approve() {
    const eth = getEthereum();
    if (!eth || !address) return;
    setPhase("granting");
    setGrantStep(0);
    setTxHashes([]);

    const selectorEntries = [
      { name: "place", selector: SELECTORS.place },
      { name: "cancel", selector: SELECTORS.cancel },
      { name: "reduce", selector: SELECTORS.reduce },
    ] as const;

    const hashes: string[] = [];
    try {
      for (let i = 0; i < selectorEntries.length; i++) {
        setGrantStep(i);
        const data = encodeFunctionData({
          abi: GRANT_ABI,
          functionName: "grantOperator",
          args: [vaultAddress, selectorEntries[i]!.selector],
        });
        const txHash = await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: address, to: registryAddress, data, gas: "0x30d40" }],
        });
        hashes.push(txHash as string);
        setTxHashes([...hashes]);
      }
      setPhase("following");
    } catch (e) {
      setPhase("error");
      setError(
        e instanceof Error && e.message.includes("rejected")
          ? `Signature ${grantStep + 1}/3 cancelled. You can retry.`
          : `Grant failed at step ${grantStep + 1}/3.`,
      );
    }
  }

  async function revoke() {
    const eth = getEthereum();
    if (!eth || !address) return;
    setError(null);
    try {
      for (const selector of [SELECTORS.place, SELECTORS.cancel, SELECTORS.reduce]) {
        const data = encodeFunctionData({
          abi: REVOKE_ABI,
          functionName: "revokeOperator",
          args: [vaultAddress, selector],
        });
        await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: address, to: registryAddress, data }],
        });
      }
      setPhase("approving");
      setTxHashes([]);
    } catch {
      setError("Revoke cancelled.");
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div className="eyebrow">FOLLOW</div>
        <div className="sub" style={{ marginTop: 6 }}>Mirror {agentName} from your own wallet</div>
        <p className="meta" style={{ marginTop: 8, lineHeight: 1.5 }}>
          Three approvals let {agentName} place the same calls for you, each window. Your funds never move to us —
          every fill settles straight to your wallet, and you can stop following in a single tap, anytime.
        </p>
      </div>

      {phase === "idle" && (
        <button className="btn btn-dark enter-fade" onClick={connect}>Connect wallet to follow</button>
      )}

      {phase === "connecting" && (
        <button className="btn btn-neutral enter-fade" disabled>Connecting…</button>
      )}

      {phase === "approving" && (
        <div className="enter-up" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mono" style={{ color: "var(--steel)" }}>{address}</div>
          <p className="meta" style={{ lineHeight: 1.5 }}>
            Three grant transactions will open in your wallet one by one —{" "}
            <strong>place</strong>, <strong>cancel</strong>, and <strong>reduce</strong> permissions.
            No funds are transferred.
          </p>
          <button className="btn btn-dark" onClick={approve}>Approve &amp; start following</button>
        </div>
      )}

      {phase === "granting" && (
        <div className="enter-up" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mono" style={{ color: "var(--steel)" }}>{address}</div>
          <div className="meta">
            Granting permission {grantStep + 1} of 3 — sign the transaction in your wallet…
          </div>
          {txHashes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {txHashes.map((h, i) => (
                <div key={h} className="mono" style={{ fontSize: 12, color: "var(--fog)" }}>
                  ✓ grant {i + 1}/3 · {h.slice(0, 10)}…{h.slice(-6)}
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-neutral" disabled>Waiting for wallet…</button>
        </div>
      )}

      {phase === "following" && (
        <div className="enter-scale" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="chip chip-ember" style={{ alignSelf: "flex-start", color: "var(--snow)" }}>
            <LiveDot style={{ color: "var(--snow)" }} /> Following
          </span>
          <div className="meta">
            You&apos;ll mirror {agentName}&apos;s next call automatically. Watch the live feed — your address will
            appear on the same order within the current window.
          </div>
          {txHashes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {txHashes.map((h, i) => (
                <div key={h} className="mono" style={{ fontSize: 12, color: "var(--fog)" }}>
                  grant {i + 1}/3 · {h.slice(0, 10)}…{h.slice(-6)}
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={revoke}>Stop following</button>
        </div>
      )}

      {phase === "error" && (
        <div className="enter-fade" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="meta" style={{ color: "var(--ember)" }}>{error}</div>
          <button className="btn btn-neutral" onClick={connect}>Try again</button>
        </div>
      )}
    </div>
  );
}
