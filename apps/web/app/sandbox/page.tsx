import { Eyebrow, Card, Chip } from "@/components/ui";
import { CloneAgent } from "@/components/CloneAgent";
import { Reveal } from "@/components/motion";
import { shortHash, pct } from "@/lib/format";
import { getAgents, getLiveWindows, networkInfo } from "@/lib/onchain";
import { DREAMDEX_CORE } from "@cadence/shared";
import { ErrorState } from "@/components/ui";


// Live: the sandbox must reflect the real current window and top agent (§7).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Sandbox() {
  const [agents, windows] = await Promise.all([getAgents(), getLiveWindows()]);
  const net = networkInfo();

  if (!agents || !windows) {
    return (
      <main className="section">
        <div className="shell">
          <ErrorState title="RPC or Indexer Connection Failed">
            <span className="meta">Unable to fetch live data from {net.name}. Check RPC health.</span>
          </ErrorState>
        </div>
      </main>
    );
  }

  const top = agents[0];
  const hero =
    windows.find((w) => w.asset === "BTC" && w.intervalSec === 3600) ?? windows[0];

  return (
    <main className="section">
      <div className="shell" style={{ maxWidth: 880 }}>
        <Eyebrow accent>JUDGE SANDBOX</Eyebrow>
        <h1 className="h-lg" style={{ margin: "12px 0 8px" }}>Clone the top agent in under a minute.</h1>
        <p className="lead" style={{ marginBottom: 32 }}>
          No setup, no reading. Connect a wallet, approve once, and watch the same call the top agent makes land on
          your own wallet inside the current window. Your funds never leave your wallet.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Left: the invitation-to-act (dashed state §11.8 → clone flow). */}
          <Reveal variant="left" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {top ? (
              <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Chip variant={top.division === "ai-assisted" ? "ember-soft" : "ink"}>
                    {top.division === "ai-assisted" ? "AI-ASSISTED" : "REACTIVE"}
                  </Chip>
                  <span className="chip chip-ember">TOP AGENT</span>
                </div>
                <div className="sub">
                  {top.division === "ai-assisted" ? "Copilot" : "Reactor"} #{top.strategyId.toString()}
                </div>
                <div className="mono" style={{ color: "var(--fog)" }}>{shortHash(top.vault)}</div>
                <div style={{ display: "flex", gap: 28, marginTop: 6 }}>
                  <div><div className="sub" style={{ fontSize: 18 }}>{pct(top.winRate)}</div><div className="meta">win rate</div></div>
                  <div><div className="sub" style={{ fontSize: 18 }}>{top.orders}</div><div className="meta">orders</div></div>
                  <div><div className="sub" style={{ fontSize: 18 }}>{top.followers}</div><div className="meta">followers</div></div>
                </div>
              </Card>
            ) : (
              <div className="state">
                <div className="sub" style={{ color: "var(--steel)", marginBottom: 8 }}>No agent to clone yet</div>
                <div className="meta">
                  The sandbox activates once house agents are seeded (Phase 3). It will always point at the real,
                  current leader — never a placeholder.
                </div>
              </div>
            )}

            <CloneAgent
              agentName={top ? `${top.division === "ai-assisted" ? "Copilot" : "Reactor"} #${top.strategyId.toString()}` : "the top agent"}
              vaultAddress={(top?.vault ?? "0x0000000000000000000000000000000000000000") as `0x${string}`}
              registryAddress={DREAMDEX_CORE.OperatorPermissionsRegistry as `0x${string}`}
            />
          </Reveal>

          {/* Right: what's happening + honesty notes. */}
          <Reveal variant="right" delay={120} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Eyebrow>CURRENT WINDOW</Eyebrow>
              {hero ? (
                <>
                  <div className="sub">{hero.asset} · {hero.intervalSec === 3600 ? "1h" : hero.intervalSec === 14400 ? "4h" : "24h"} Up/Down</div>
                  <div className="meta">Line to beat: {hero.strike > 0 ? `$${hero.strike.toLocaleString()}` : "—"}</div>
                  <div className="meta">
                    When you approve, your wallet becomes eligible to mirror the next call this agent makes — which
                    fires the instant the reactivity precompile delivers the next price event.
                  </div>
                </>
              ) : (
                <div className="meta">Waiting on a live BTC/ETH window from {net.name}. The next one opens automatically.</div>
              )}
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Eyebrow>WHAT YOU&apos;RE APPROVING</Eyebrow>
              <div className="meta" style={{ lineHeight: 1.6 }}>
                A single, revocable operator permission — the agent may place the same orders for you, but can never
                move, withdraw, or hold your funds. Every fill settles to your wallet. Stop following anytime and the
                permission is revoked immediately.
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </main>

  );
}
