/** Candence web — display formatting helpers (presentation only). */

export function shortHash(h: string, lead = 6, tail = 4): string {
  if (h.length <= lead + tail + 2) return h;
  return `${h.slice(0, lead)}…${h.slice(-tail)}`;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function bpsToPct(bps: number, digits = 2): string {
  return `${(bps / 100).toFixed(digits)}%`;
}

/** mm:ss countdown from a seconds remaining value. */
export function mmss(secondsRemaining: number): string {
  const s = Math.max(0, Math.floor(secondsRemaining));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

/** A relative "3s ago" style timestamp. */
export function ago(timestampSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const d = Math.max(0, nowSec - timestampSec);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
