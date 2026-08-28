# Cadence

**A fully onchain-reactive agent arena for [DreamDEX](https://dreamdex.io) Event Contracts on [Somnia](https://somnia.network).**

Cadence's thesis in one line: **strategy agents place directional calls the instant Somnia's Reactivity precompile (`0x0100`) delivers a price event — never on an offchain cron.** The reactive path *is* the product. Everything else is built so a judge can verify that claim on the explorer.

---

## Three stacked value props

Each is individually competitive; together they compound.

1. **Reactive infrastructure** — an onchain `ReactivitySubscriber` subscribes to the price feed via the `0x0100` precompile and routes callbacks to per-strategy `AgentVault`s, with per-trigger `try/catch` isolation and onchain success/fail/skip counters. *(Technical Implementation, Innovation.)*
2. **Non-custodial copy-trading + tradeable strategies** — anyone clones a top agent in **one signature** using DreamDEX's **operator model** (the vault is a registered operator, never a custodian; funds and fills never leave the user's wallet). Strategy configs are soulbound-gated `StrategyNFT`s. *(Business & Ecosystem Impact, UX.)*
3. **Open Agent SDK + public reliability dashboard** — [`@cadence/agent-kit`](./packages/agent-sdk) lets any builder ship an agent against Event Contracts, and a live dashboard proves reliability + volume from onchain events only. *(Ecosystem Impact, Presentation, sustainability.)*

---

## Repository structure

```
cadence/
├── contracts/            # Foundry — the reactive core (see contracts/ for the suite)
│   ├── ReactivitySubscriber.sol   # subscribes to 0x0100, routes callbacks, telemetry counters
│   ├── AgentVault.sol             # operator (not custodian); reactive + AI-assisted modes; claim sweep
│   ├── AgentVaultFactory.sol      # deploys vaults, mints StrategyNFT, wires clone flow
│   ├── RiskEngine.sol             # onchain spend caps, drawdown breaker, timelocked pause
│   ├── StrategyNFT.sol            # ERC-721, soulbound-gated
│   ├── CopilotAttestor.sol        # onchain registry of AI signal correctness
│   ├── interfaces/  base/  test/
├── packages/
│   ├── shared/           # @cadence/shared — single source of truth for chain cfg, pricing, ABIs
│   └── agent-sdk/        # @cadence/agent-kit — publishable SDK for external builders
├── watcher/              # WebSocket fallback watcher (offchain, failover ONLY)
├── ai-copilot/           # attested directional signal service (off the critical path)
├── apps/web/             # Next.js 14 consumer frontend (countdown, leaderboard, clone flow)
├── dashboard/            # public reliability + volume telemetry (onchain-sourced)
├── scripts/              # doctor.ts (preflight), deploy.ts, seed-agents.ts
└── docs/                 # architecture.md, deck.md, feedback-report.md
```

## Quickstart

```bash
pnpm install

# 1. PREFLIGHT — never skip. Verifies RPC, wallet, SOMI headroom, collateral decimals,
#    live venue id, and that a BTC/ETH window is actually Trading(1). Testnet by default.
pnpm doctor

# 2. Contracts
pnpm contracts:build         # forge build
pnpm contracts:test          # forge test -vvv  (incl. the spend-limit invariant)

# 3. Deploy the suite to Shannon testnet (chain 50312) and wire permissions
pnpm deploy                  # writes deployments/testnet.json

# 4. Seed the 4–6 house agents and let them trade continuously (start this EARLY)
pnpm seed                    # writes deployments/agents.testnet.json

# 5. Offchain support services
pnpm watcher                 # fallback watcher (failover only — NOT the decision path)
pnpm copilot                 # AI signal service (only ever *offers* a signal)

# 6. Frontend (consumer arena + reliability dashboard + judge sandbox, one app)
pnpm dev:web                 # → http://localhost:3000
#   ├─ /            the arena: countdown, dual leaderboard, live call feed, odds panel
#   ├─ /dashboard   public reliability + volume telemetry (onchain-sourced, §6)
#   └─ /sandbox     judge sandbox: clone the top agent in under 60s (§7)
```

> The reliability dashboard (§6) is served by the web app at **`/dashboard`**, not a
> separate deployment — it shares the exact §11 design system and the single
> `apps/web/lib/onchain.ts` data layer so a displayed number can never drift from
> what the arena shows. See [`dashboard/README.md`](./dashboard/README.md) for why.


## Environment

Copy `.env.example` → `.env`. Key variables:

| Variable | Purpose |
|---|---|
| `CADENCE_NETWORK` | `testnet` (default) or `mainnet` |
| `CADENCE_ALLOW_MAINNET` | must be `1` to allow any mainnet action (§0.4 guard) |
| `DEPLOYER_PRIVATE_KEY` | deploys contracts + seeds agents |
| `OPERATOR_ADDRESS` | operator wallet checked by `doctor.ts` |
| `WATCHER_PRIVATE_KEY` | signs fallback catch-up triggers (must be allowlisted) |
| `COPILOT_SIGNER_PRIVATE_KEY` | signs AI attestations (distinct from trading key) |
| `VENUE_ID_OVERRIDE` | optional; forces a venue id (else resolved live) |

## Non-negotiables (the rules this codebase is built to honor)

- **The reactive path is sacred.** No offchain polling on the core decision path. Reliability is fixed *at the reactive layer* (subscriber isolation, SOMI funding, fallback watcher), never by routing around it.
- **No mock data, anywhere, ever.** Every UI number traces to a real testnet read. A judge checking the explorer finds exactly what the dashboard claims.
- **Testnet first.** Real funds only after a clean `pnpm doctor`. Mainnet is refused without an explicit flag.
- **Non-custodial always.** The vault is an operator, not a custodian. Deposits/withdrawals stay owner-only; fills settle to the owner's wallet.
- **AI is secondary.** It never blocks or delays the reactive path. If a signal is late/invalid, the vault degrades gracefully to reactive-only rules for that window — logged honestly, never hidden.

## Docs

- [`docs/architecture.md`](./docs/architecture.md) — full architecture, the reactive thesis, SOMI/gas economics, telemetry→dashboard flow.
- [`docs/deck.md`](./docs/deck.md) — the 3-slide pitch (stands alone without the video).
- [`docs/feedback-report.md`](./docs/feedback-report.md) — specific, technical SDK/docs feedback from building against Event Contracts.
- [`packages/agent-sdk/README.md`](./packages/agent-sdk/README.md) — ship your own agent in ~20 lines.

## License

MIT. The Agent SDK and the odds API remain public and free after the hackathon.
