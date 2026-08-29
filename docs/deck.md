# Candence — Deck

*Three slides. Stands alone without the video.*

---

## Slide 1 — The gap

### Event Contracts are single-shot and single-player.

DreamDEX ships something genuinely new: fully-collateralized, zero-fee binary markets on BTC/ETH price, in rolling 1-hour (and 4-hour) windows. But today each window is a solo, manual act — a human watches a price, forms a view, places one order, and does it again next window.

Three things are missing:

- **No continuous, reactive participation.** Nothing places a call *the instant the price moves* — the reaction is as slow as a person or a polling bot.
- **No way to follow a proven trader.** A great strategy helps exactly one wallet.
- **No public proof of reliability.** There's no live, falsifiable record of who is actually performing.

> The window rolls every hour, all day. That candence is begging for agents. Nobody's built the arena.

---

## Slide 2 — The mechanic

### Reactive agents that fire onchain, plus strategies you can clone.

**Candence's core claim is architectural, not cosmetic:** agents are triggered by Somnia's Reactivity precompile (`0x0100`), not by an offchain cron. When the oracle posts a price, the chain itself invokes our `ReactivitySubscriber`, which routes — with per-vault `try/catch` isolation — to each `AgentVault`, which snaps a tick-grid order and places it within the same reactive flow.

```
MarkPriceUpdated (0x0100)  →  ReactivitySubscriber  →  AgentVault.onEvent  →  placeOrder
```

- **Two divisions.** A pure-Reactive division (decisions from onchain-readable state only) and an AI-assisted division (an *attested*, graded signal as one weighted input — with a mandatory, logged fallback to reactive rules if the signal is late or invalid). The AI never sits on the decision path.
- **Tradeable strategy configs.** Each strategy is a soulbound-gated `StrategyNFT` representing the configuration, not the capital.
- **Risk enforced onchain.** Spend caps, a drawdown circuit-breaker, and a timelocked global pause live in `RiskEngine` — not in a UI.

> Every trigger, success, failure, skip, and fallback is an onchain event with a matching onchain counter. The claim is verifiable block by block.

---

## Slide 3 — The adoption loop

### Copy-trading + an open SDK turn one good agent into ecosystem volume.

**Copy-trading, one signature, non-custodial.** Candence is built on DreamDEX's **operator model**: a user grants an agent permission to place orders *on their own wallet*. Funds and fills never leave that wallet; the grant is revocable instantly. Cloning a top agent is a single approval — no deposits, no custody, no jargon.

**Open Agent SDK.** [`@candence/agent-kit`](../packages/agent-sdk) lets any builder ship their own agent against Event Contracts, with every hard-won gotcha (bigint tick-snapping, live-status gating, mandatory expiry, claim sweeping) baked in. More agents → more windows traded → measurable volume for the venue.

**Public reliability dashboard.** A live board proves reactive success rate, event→order latency, fallback recoveries, per-division win rate/ROI, AI signal quality, and Candence-generated trading volume — every number sourced from onchain events and tagged with its own provenance.

---

### Closing — Sustainability

- **Mainnet migration is a config change, not a rewrite.** Core addresses are identical testnet↔mainnet via CREATE3; only collateral decimals and the venue id differ, and both are resolved at runtime.
- **SOMI/gas economics are budgeted, not hoped for.** Burn rate and runway are displayed live; low-balance alerts fire before exhaustion; on exhaustion a vault skips-and-logs rather than bricking.
- **Revenue is non-custodial and claimable.** A performance fee on copy-trades is taken as a claimable share of *realized* winnings — never by holding user funds.
- **The commons stay open.** The Agent SDK and the odds API remain public and free after the hackathon.
