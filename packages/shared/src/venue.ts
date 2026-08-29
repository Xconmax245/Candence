/**
 * Candence — live venue resolution (DIRECTIVE §1.5, gotcha #8).
 *
 * Venue IDs MOVE over time and differ between testnet and mainnet. Hardcoding
 * one is gotcha #8 — treat the value in `chains.ts` as a *starting point* only.
 * This module resolves the live venue at runtime and caches it briefly.
 *
 * Resolution order:
 *   1. `VENUE_ID_OVERRIDE` env (explicit operator override) — logged loudly.
 *   2. Live read from the REST `/venues` surface (source of truth).
 *   3. The network's `startingVenueId` (last-resort fallback, warns).
 */
import { activeNetwork, type NetworkName, NETWORKS } from "./chains.js";

interface VenueCacheEntry {
  venueId: `0x${string}`;
  fetchedAtMs: number;
  source: "override" | "live" | "fallback";
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<NetworkName, VenueCacheEntry>();

function envOverride(): `0x${string}` | undefined {
  const v = typeof process !== "undefined" ? process.env?.VENUE_ID_OVERRIDE : undefined;
  return v && v.startsWith("0x") && v.length === 66 ? (v as `0x${string}`) : undefined;
}

/**
 * Resolve the active venue id live. Pass `force` to bypass the cache (e.g. after
 * a suspected venue migration). Never throws on a network hiccup — degrades to
 * the last known good value or the starting id, and reports which.
 */
export async function resolveVenueId(opts?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ venueId: `0x${string}`; source: VenueCacheEntry["source"] }> {
  const net = activeNetwork();
  const doFetch = opts?.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);

  const override = envOverride();
  if (override) {
    const entry: VenueCacheEntry = {
      venueId: override,
      fetchedAtMs: Date.now(),
      source: "override",
    };
    cache.set(net.name, entry);
    return { venueId: entry.venueId, source: entry.source };
  }

  const cached = cache.get(net.name);
  if (!opts?.force && cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
    return { venueId: cached.venueId, source: cached.source };
  }

  // Live read from REST. The venues endpoint returns the currently active venue
  // for the Event Contracts (binary) product. Shape-tolerant parsing.
  if (doFetch) {
    try {
      const res = await doFetch(`${net.restUrl}/venues`, {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as unknown;
        const live = extractVenueId(body);
        if (live) {
          const entry: VenueCacheEntry = {
            venueId: live,
            fetchedAtMs: Date.now(),
            source: "live",
          };
          cache.set(net.name, entry);
          return { venueId: entry.venueId, source: entry.source };
        }
      }
    } catch {
      // fall through to fallback
    }
  }

  const fallback: VenueCacheEntry = {
    venueId: NETWORKS[net.name].startingVenueId,
    fetchedAtMs: Date.now(),
    source: "fallback",
  };
  cache.set(net.name, fallback);
  return { venueId: fallback.venueId, source: fallback.source };
}

/** Best-effort extraction of a venue id from the REST /venues response. */
function extractVenueId(body: unknown): `0x${string}` | undefined {
  const isHex = (s: unknown): s is `0x${string}` =>
    typeof s === "string" && s.startsWith("0x") && s.length === 66;

  const scan = (node: unknown, depth: number): `0x${string}` | undefined => {
    if (depth > 4 || node == null) return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = scan(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // Prefer an explicit binary/event-contracts venue marker if present.
      const key = obj.venueId ?? obj.id ?? obj.venue;
      if (isHex(key)) return key;
      for (const v of Object.values(obj)) {
        const found = scan(v, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return scan(body, 0);
}

/** Clear the cache (tests / forced re-resolution after a suspected migration). */
export function _clearVenueCache(): void {
  cache.clear();
}
