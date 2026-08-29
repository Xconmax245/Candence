import { Card, Chip, EmptyState } from "./ui";
import { Reveal } from "./motion";
import { pct, shortHash } from "@/lib/format";
import type { Agent } from "@/lib/onchain";


/**
 * Dual leaderboard (DIRECTIVE §4, Phase 4): Reactive and AI-assisted divisions
 * side by side. Every number is a real onchain read; when no agents are seeded
 * yet the honest dashed empty state renders (§11.8) — never invented rows.
 */
function Row({ agent, rank }: { agent: Agent; rank: number }) {
  return (
    <Card tight className="lift" style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div className="mono" style={{ color: "var(--fog)", width: 22 }}>{rank}</div>

        <div>
          <div className="sub" style={{ fontSize: 16 }}>
            {agent.division === "ai-assisted" ? "Copilot" : "Reactor"} #{agent.strategyId.toString()}
          </div>
          <div className="mono" style={{ color: "var(--fog)" }}>{shortHash(agent.vault)}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ textAlign: "right" }}>
          <div className="sub" style={{ fontSize: 16 }}>{pct(agent.winRate)}</div>
          <div className="meta">win rate</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="sub" style={{ fontSize: 16 }}>{agent.orders}</div>
          <div className="meta">orders</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="sub" style={{ fontSize: 16 }}>{agent.followers}</div>
          <div className="meta">followers</div>
        </div>
      </div>
    </Card>
  );
}

export function Leaderboard({ agents }: { agents: Agent[] }) {
  const reactive = agents.filter((a) => a.division === "reactive");
  const ai = agents.filter((a) => a.division === "ai-assisted");

  return (
    <section id="arena" className="section">
      <div className="shell">
        <div className="eyebrow">THE ARENA</div>
        <h2 className="h-lg" style={{ margin: "12px 0 8px" }}>Two divisions. One order book.</h2>
        <p className="lead" style={{ maxWidth: 640, marginBottom: 40 }}>
          Pure-Reactive agents decide from onchain state alone. AI-assisted agents read an attested signal — and
          degrade to Reactive rules the instant that signal is late. Follow either from your own wallet.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Chip variant="ink">REACTIVE</Chip>
              <span className="meta">decision path: onchain only</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {reactive.length > 0 ? (
                reactive.map((a, i) => (
                  <Reveal key={a.vault} delay={i * 70}>
                    <Row agent={a} rank={i + 1} />
                  </Reveal>
                ))
              ) : (

                <EmptyState title="No reactive agents seeded yet">
                  <span className="meta">House agents come online in Phase 3 — this fills with real activity.</span>
                </EmptyState>
              )}
            </div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Chip variant="ember-soft">AI-ASSISTED</Chip>
              <span className="meta">attested signal · graceful fallback</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ai.length > 0 ? (
                ai.map((a, i) => <Row key={a.vault} agent={a} rank={i + 1} />)
              ) : (
                <EmptyState title="No AI-assisted agents seeded yet">
                  <span className="meta">Signal quality is tracked per window once these are live.</span>
                </EmptyState>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
