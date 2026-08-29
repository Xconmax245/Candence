import { Countdown } from "@/components/Countdown";
import { MechanismBand } from "@/components/MechanismBand";
import { Leaderboard } from "@/components/Leaderboard";
import { CallFeed } from "@/components/CallFeed";
import { Eyebrow, Chip } from "@/components/ui";
import { Reveal, CountUp, LiveDot } from "@/components/motion";
import { ErrorState } from "@/components/ui";

import {
  getLiveWindows,
  getAgents,
  getCallFeed,
  totalVolume,
  networkInfo,
} from "@/lib/onchain";

// Always render fresh: this is a live arena, never a cached snapshot (§6).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const [windows, agents] = await Promise.all([getLiveWindows(), getAgents()]);
  const feed = agents ? await getCallFeed(agents) : null;
  const net = networkInfo();

  if (!windows || !agents || !feed) {
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

  // Prefer the 1h BTC hero window (§0.1 — live testnet has 1h/4h/24h, never 15m on operatorId:2).
  const hero =
    windows.find((w) => w.asset === "BTC" && w.intervalSec === 3600) ??
    windows.find((w) => w.intervalSec === 3600) ??
    windows[0];

  const volume = totalVolume(agents);
  const followers = agents.reduce((s, a) => s + a.followers, 0);

  return (
    <main>
      {/* ── Hero (§11.3) ── */}
      <section className="section">
        <div className="shell" style={{ display: "grid", gridTemplateColumns: "1.18fr 1fr", gap: 48, alignItems: "center" }}>
          <div>
            <span className="chip chip-ember-soft enter-fade" style={{ marginBottom: 20, display: "inline-flex" }}>
              SOMNIA × DREAMDEX · EVENT CONTRACTS
            </span>
            <h1 className="display enter-up" style={{ marginBottom: 20, animationDelay: "80ms" }}>
              Agents that trade the instant the chain says&nbsp;now<span style={{ color: "var(--ember)" }}>.</span>
            </h1>
            <p className="lead enter-up" style={{ maxWidth: 520, marginBottom: 28, animationDelay: "180ms" }}>
              Candence turns single-shot Event Contracts into a live arena. Strategy agents fire the moment Somnia&apos;s
              Reactivity precompile delivers a price event — no cron, no polling. Follow a top agent from your own
              wallet in one signature.
            </p>
            <div className="enter-up" style={{ display: "flex", gap: 12, marginBottom: 40, flexWrap: "wrap", animationDelay: "280ms" }}>
              <a href="#arena" className="btn btn-dark">Enter the arena</a>
              <a href="/dashboard" className="btn btn-ghost">See reliability proof</a>
            </div>
            <div className="enter-up" style={{ display: "flex", gap: 48, animationDelay: "380ms" }}>
              <div>
                <div className="stat-num"><CountUp value={agents.length} /></div>
                <div className="stat-label">live agents</div>
              </div>
              <div>
                <div className="stat-num"><CountUp value={followers} /></div>
                <div className="stat-label">wallets following</div>
              </div>
              <div>
                <div className="stat-num">
                  <CountUp value={volume} separator />
                </div>
                <div className="stat-label">orders placed</div>

              </div>
            </div>
          </div>

          {/* Right: live window viewport (replaces reference's graph canvas). */}
          <div className="card enter-scale float" style={{ position: "relative", height: 460, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", animationDelay: "220ms" }}>
            <div className="aurora" />
            <div style={{ position: "relative", zIndex: 1, padding: 24, borderBottom: "1px solid var(--cloud)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Eyebrow>CURRENT WINDOW</Eyebrow>
              {hero ? (
                <span className="chip chip-ember" style={{ color: "var(--snow)" }}>
                  <LiveDot style={{ color: "var(--snow)" }} /> TRADING
                </span>
              ) : (
                <Chip variant="dashed">awaiting feed</Chip>
              )}
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 8, padding: 24 }}>
              {hero ? (
                <>
                  <div className="sub" style={{ color: "var(--steel)" }}>{hero.asset} · {hero.intervalSec === 3600 ? "1h" : hero.intervalSec === 14400 ? "4h" : "24h"} Up/Down</div>
                  <Countdown expiryTimeSec={hero.expiryTimeSec} label="until this window locks" />
                  <div style={{ display: "flex", gap: 32, marginTop: 16 }}>
                    <div style={{ textAlign: "center" }}>
                      <div className="sub">{hero.strike > 0 ? `$${hero.strike.toLocaleString()}` : "—"}</div>
                      <div className="meta">line to beat</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div className="sub" style={{ color: "var(--ember)" }}>{hero.upPrice > 0 ? hero.upPrice.toFixed(2) : "—"}</div>
                      <div className="meta">Up probability</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="state" style={{ border: "none", background: "transparent" }}>
                  <div className="sub" style={{ color: "var(--steel)", marginBottom: 6 }}>Reading live windows…</div>
                  <div className="meta">
                    Markets load from DreamDEX REST for {net.name}. If none show, the venue has no live BTC/ETH window
                    this moment — the next opens automatically.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <MechanismBand />

      {/* Arena: leaderboard + live feed side by side. */}
      <div className="shell" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
        <Leaderboard agents={agents} />
      </div>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="shell" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
          <Reveal variant="left">
            <CallFeed items={feed} />
          </Reveal>
          <Reveal variant="right" delay={120}>
            <div className="card lift" style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
              <Eyebrow accent>ODDS TRANSPARENCY</Eyebrow>
              <div className="sub">Every price is auditable at the source</div>
              <p className="meta" style={{ lineHeight: 1.6 }}>
                Candence never invents a number. Implied Up probabilities reconstruct from onchain fills, and each
                market links to Somnia&apos;s oracle pipeline explorer — sources, median, and the exact answer that
                settled the window. A judge can verify any call end to end.
              </p>
              <a
                href="https://prd.oracle.somnia.host"
                target="_blank"
                rel="noreferrer"
                className="btn btn-neutral btn-sm"
                style={{ alignSelf: "flex-start" }}
              >
                Open oracle explorer →
              </a>
            </div>
          </Reveal>
        </div>
      </section>

    </main>
  );
}
