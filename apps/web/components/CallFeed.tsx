import { Card, Chip, EmptyState } from "./ui";
import { shortHash } from "@/lib/format";

import { networkInfo, type CallFeedItem } from "@/lib/onchain";

/**
 * Live call feed (DIRECTIVE §4, Phase 4): the most recent orders placed by
 * Candence agents, each linking to the real transaction on the explorer so a
 * judge can verify it. No item exists here that isn't an onchain OrderPlaced.
 */
export function CallFeed({ items }: { items: CallFeedItem[] }) {
  const net = networkInfo();
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="sub">Live calls</div>
        <Chip variant="ember">● LIVE</Chip>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No calls yet this run">
          <span className="meta">The feed populates the instant a reactive trigger fires an order.</span>
        </EmptyState>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it, i) => (
            <a
              key={it.txHash}
              href={`${net.explorer}/tx/${it.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="feed-item"
              style={{ textDecoration: "none", color: "inherit", animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <div className="card-tight lift" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid var(--cloud)", borderRadius: 14 }}>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Chip variant={it.outcome === "Up" ? "ember-outline" : "ink"}>{it.outcome}</Chip>
                  {it.isFallback && <Chip variant="dashed">fallback</Chip>}
                  <span className="mono" style={{ color: "var(--steel)" }}>{shortHash(it.vault)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="mono" style={{ color: "var(--fog)" }}>#{it.blockNumber.toString()}</span>
                  <span className="meta">tx {shortHash(it.txHash, 6, 4)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
      <div className="meta">Every call links to its onchain transaction · {net.name}</div>
    </Card>
  );
}
