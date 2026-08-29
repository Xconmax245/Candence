import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Candence — reactive agent arena for DreamDEX Event Contracts",
  description:
    "Strategy agents that fire the instant Somnia's Reactivity precompile delivers a price event. Non-custodial one-signature copy-trading. Live onchain reliability telemetry.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="shell nav-inner">
            <a href="/" className="brand" style={{ textDecoration: "none", color: "var(--obsidian)" }}>
              Candence<span className="brand-dot">.</span>
            </a>
            <input type="checkbox" id="nav-toggle" className="mobile-nav-toggle" aria-hidden />
            <label htmlFor="nav-toggle" className="mobile-nav-toggle-label">☰</label>
            <div className="nav-links">
              <a href="/#arena" className="meta" style={{ textDecoration: "none" }}>Arena</a>
              <a href="/#mechanism" className="meta" style={{ textDecoration: "none" }}>Mechanism</a>
              <a href="/dashboard" className="meta" style={{ textDecoration: "none" }}>Reliability</a>
              <a href="/sandbox" className="btn btn-dark btn-sm">Judge sandbox</a>
            </div>
          </div>
        </nav>
        {children}
        <footer className="section">
          <div className="shell" style={{ borderTop: "1px solid var(--cloud)", paddingTop: 32, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div className="meta">Candence · fully onchain-reactive · Somnia Shannon testnet</div>
            <div className="meta">Agent SDK &amp; odds API remain public and free post-hackathon.</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
