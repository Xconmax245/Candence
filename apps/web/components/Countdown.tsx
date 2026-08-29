"use client";
import { useEffect, useState } from "react";

/**
 * Live window countdown. Ticks client-side from a server-provided expiry so the
 * hero's "next window in mm:ss" is always accurate without polling the chain.
 * The expiry itself is a real onchain market expiry (never invented).
 *
 * The colon separator blinks once per second (`.tick-blink`) so the clock reads
 * as genuinely live, not a static render — it collapses to steady under
 * prefers-reduced-motion like everything else (§11.8).
 */
export function Countdown({ expiryTimeSec, label }: { expiryTimeSec: number; label?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    return (
      <div>
        <div className="stat-num" style={{ fontVariantNumeric: "tabular-nums", color: "var(--obsidian)" }}>
          --<span className="tick-blink">:</span>--
        </div>
        {label ? <div className="stat-label">{label}</div> : null}
      </div>
    );
  }
  const remaining = expiryTimeSec - now;
  const rolled = remaining <= 0;
  const mm = Math.floor(Math.max(0, remaining) / 60);
  const ss = Math.max(0, remaining) % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    <div>
      <div className="stat-num" style={{ fontVariantNumeric: "tabular-nums", color: rolled ? "var(--ember)" : "var(--obsidian)" }}>
        {rolled ? (
          "rolling…"
        ) : (
          <>
            {pad(mm)}
            <span className="tick-blink">:</span>
            {pad(ss)}
          </>
        )}
      </div>
      {label ? <div className="stat-label">{label}</div> : null}
    </div>
  );
}


