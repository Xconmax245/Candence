/**
 * Cadence — Foundry artifact loader + deployment persistence (shared by
 * deploy.ts and seed-agents.ts).
 *
 * We deploy with viem using the compiled Foundry artifacts in `contracts/out`.
 * CRITICAL: viem's `deployContract` needs the CREATION/INIT bytecode
 * (`artifact.bytecode.object`), NOT `deployedBytecode` — the latter is the
 * runtime code and produces a non-functional deploy.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi, Hex } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
const OUT_DIR = join(REPO_ROOT, "contracts", "out");
const DEPLOY_DIR = join(REPO_ROOT, "deployments");

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

/** Load a compiled contract artifact by name (e.g. "RiskEngine"). */
export function loadArtifact(name: string): Artifact {
  const path = join(OUT_DIR, `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Missing artifact ${path}. Run \`pnpm contracts:build\` (forge build) first.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    abi: Abi;
    bytecode?: { object?: string };
  };
  const object = raw.bytecode?.object;
  if (!object || object === "0x") {
    throw new Error(`Artifact ${name} has no creation bytecode — rebuild contracts.`);
  }
  return {
    abi: raw.abi,
    bytecode: (object.startsWith("0x") ? object : `0x${object}`) as Hex,
  };
}

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: `0x${string}`;
  contracts: Record<string, `0x${string}`>;
  params: Record<string, string | number>;
}

export function deploymentPath(network: string): string {
  return join(DEPLOY_DIR, `${network}.json`);
}

export function readDeployment(network: string): DeploymentRecord | undefined {
  const path = deploymentPath(network);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as DeploymentRecord;
}

export function writeDeployment(rec: DeploymentRecord): string {
  if (!existsSync(DEPLOY_DIR)) mkdirSync(DEPLOY_DIR, { recursive: true });
  const path = deploymentPath(rec.network);
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\n", "utf8");
  return path;
}

export function writeJson(relPath: string, data: unknown): string {
  const path = join(REPO_ROOT, relPath);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  return path;
}

/** Explorer URLs for tx / address (nice for judges cross-checking, §1.3). */
export function explorerTx(base: string, hash: string): string {
  return `${base.replace(/\/$/, "")}/tx/${hash}`;
}
export function explorerAddr(base: string, addr: string): string {
  return `${base.replace(/\/$/, "")}/address/${addr}`;
}
