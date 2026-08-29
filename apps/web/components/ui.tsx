/**
 * Candence design-system primitives (DIRECTIVE §11).
 *
 * Thin, semantic wrappers over the verbatim CSS classes in globals.css so the
 * card/chip/stat/button anatomy is reused exactly (§11.10) and can't drift.
 */
import type { ReactNode } from "react";

export function Eyebrow({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <div className="eyebrow" style={accent ? { color: "var(--ember)" } : undefined}>{children}</div>;
}

export function Card({ children, tight, className, style }: { children: ReactNode; tight?: boolean; className?: string; style?: React.CSSProperties }) {
  return <div className={`card${tight ? " card-tight" : ""}${className ? " " + className : ""}`} style={style}>{children}</div>;
}

type ChipVariant =
  | "ember"
  | "ember-soft"
  | "ember-outline"
  | "ink"
  | "dashed"
  | "neutral";

export function Chip({ children, variant = "neutral" }: { children: ReactNode; variant?: ChipVariant }) {
  return <span className={`chip chip-${variant}`}>{children}</span>;
}

export function Stat({ num, label }: { num: ReactNode; label: ReactNode }) {
  return (
    <div>
      <div className="stat-num">{num}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius = 10 }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden />;
}

export function FlowNode({ children, accent, style }: { children: ReactNode; accent?: boolean; style?: React.CSSProperties }) {
  return <span className={`flow-node${accent ? " flow-node-accent" : ""}`} style={style}>{children}</span>;
}

export function FlowArrow() {
  return <span className="flow-arrow" aria-hidden>→</span>;
}

/** A dashed empty/invitation state (§11.8). */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <div className="sub" style={{ color: "var(--steel)", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

/** An error state for failed RPC/REST reads. */
export function ErrorState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state" style={{ borderColor: "var(--ember)", background: "rgba(255, 90, 0, 0.05)" }}>
      <div className="sub" style={{ color: "var(--ember)", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
