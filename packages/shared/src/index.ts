/**
 * @cadence/shared — the single source of truth for chain config, protocol types,
 * bigint-safe pricing, live venue resolution, market gating, and AI attestation.
 *
 * Every other workspace (scripts, watcher, ai-copilot, agent-sdk, web, dashboard)
 * imports protocol constants and helpers from here so the Event Contracts spec
 * (DIRECTIVE §1) lives in exactly one place.
 */
export * from "./chains.js";
export * from "./types.js";
export * from "./pricing.js";
export * from "./venue.js";
export * from "./markets.js";
export * from "./rest.js";
export * from "./payload.js";
export * from "./deployments.js";
export * from "./attest.js";
export * as CadenceAbi from "./abi/index.js";


