/**
 * @candence/agent-kit — build reactive trading agents for DreamDEX Event
 * Contracts on Somnia.
 *
 * This is the exact production-robustness surface Candence's own agents run on,
 * published so other builders can deploy strategies against Event Contracts
 * without re-learning every gotcha the hard way:
 *
 *   • pricing   — bigint-safe tick/lot snapping (never float prices → InvalidPrice)
 *   • client    — discovery + the live-onchain status gate (never trust the indexer)
 *   • operator  — the session-key model for non-custodial copy-trading
 *   • sweeper   — the always-on claim loop (winnings are claimed, not automatic)
 *   • strategy  — a pure, testable Strategy interface + a reference reactive one
 *   • runner    — ties it together with status-gating, balance checks, and snapping
 */
export * from "./types.js";
export * from "./pricing.js";
export * from "./client.js";
export * from "./operator.js";
export * from "./sweeper.js";
export * from "./strategy.js";
export * from "./runner.js";
