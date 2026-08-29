/**
 * Candence — deployment address reader (shared, Node-only).
 *
 * Reads `deployments/<network>.json` (written by scripts/deploy.ts) and returns
 * the contract address map. This is imported by Node-side consumers only
 * (watcher, ai-copilot, dashboard server, scripts). The web/edge frontends never
 * import this — they receive addresses via env or a generated JSON. Returns
 * `undefined` on any failure so a missing deployment degrades gracefully.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkName } from "./chains.js";

export type DeploymentAddresses = Record<string, `0x${string}`>;

interface DeploymentFile {
  network: string;
  chainId: number;
  contracts: DeploymentAddresses;
  params?: Record<string, unknown>;
}

/**
 * Return the `contracts` address map for a network, or undefined if the file is
 * missing / unreadable.
 */
export function readDeploymentAddresses(
  network: NetworkName,
): DeploymentAddresses | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // packages/shared/src → repo root is three levels up.
    const repoRoot = join(here, "..", "..", "..");
    const file = join(repoRoot, "deployments", `${network}.json`);
    if (!existsSync(file)) return undefined;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as DeploymentFile;
    return parsed.contracts;
  } catch {
    return undefined;
  }
}
