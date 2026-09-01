# Candence — Pitch Deck (3-Slide Executive Summary)

---

## Slide 1: The Gap — Single-Shot Event Contracts Need Real-Time Execution

### The Problem in Web3 Event Contracts & Binary Options
- **Polling & Cron Latency**: Existing bot networks rely on off-chain polling loops or cron jobs. When an underlying price event occurs on-chain, off-chain keepers react seconds late, suffering from front-running, high slippage, and missed settlement windows.
- **Custodial Copy-Trading**: Traditional copy-trading requires depositing funds into pooled vaults or smart contract managers, exposing users to bridge risk, rug pulls, and locked capital.

### The Candence Solution
- **Zero-Latency Reactive Trigger**: Candence harnesses Somnia's **Reactivity Precompile (`0x0100`)**. Price updates on underlying spot pools trigger an event that instantly invokes Candence's `ReactivitySubscriber` in the exact same block — zero cron, zero polling.
- **Non-Custodial Operator Copy-Trading**: Built on DreamDEX's **Operator Permissions Model (`0x15C7e8CE38F021c5b45d098AaD788f63090bF20A`)**. Followers grant an `AgentVault` single-signature operator rights to place matching orders directly from their own wallets. Funds never leave the follower's wallet.

---

## Slide 2: The Mechanic — Reactive Architecture & Dual Division Strategy

```
MarkPriceUpdated (0x0100 Precompile)
            │
            ▼
┌───────────────────────────┐
│   ReactivitySubscriber    │ (Zero-latency dispatch, per-vault isolation)
└─────────────┬─────────────┘
              │
      ┌───────┴───────┐
      ▼               ▼
┌───────────┐   ┌───────────┐
│ Reactive  │   │AI-Assisted│ (Attested signal bias with instant fallback)
│  Vaults   │   │  Vaults   │
└─────┬─────┘   └─────┬─────┘
      │               │
      └───────┬───────┘
              ▼
  IBinaryMarketsModule.placeOrderFor (On-chain settlement & wallet isolation)
```

### Key Technical Innovations
1. **On-Chain Isolation**: Every strategy vault invocation is wrapped in a guarded `try/catch` handler. If one strategy vault reverts or hits a spend cap, it emits a `HandlerFailed` event without blocking sibling vaults.
2. **Dual Division Arena**:
   - **Pure-Reactive Division**: Pure mathematical / on-chain state strategies (Metronome, Downbeat, Syncopate).
   - **AI-Assisted Division**: Copilot strategies (Andante, Presto, Rubato) reading signed off-chain signals. If the AI signal is delayed, it gracefully degrades to pure reactive execution in the same block.
3. **On-Chain Risk Engine**: Enforces drawdown breakers and spend caps natively on-chain before order placement.

---

## Slide 3: The Adoption Loop — Developer SDK & Platform Sustainability

### Ecosystem Growth & Flywheel
1. **Traders & Followers**: Browse live leaderboards on the **Candence Arena**, compare win-rates and latencies, and clone top strategy agents in one signature.
2. **Strategy Developers (`@candence/agent-kit`)**: Build and deploy custom strategy vaults using our open TypeScript SDK in under 10 lines of code.
3. **Open Infra & Sustainability**:
   - Gas for `ReactivitySubscriber` is funded via native STT pre-loading.
   - Settlement claims are swept asynchronously by keepers without custody risks.
   - Identical contract deployment via CREATE3 across testnet and mainnet (`50312` / `5031`).

---
*Candence · Fully Onchain-Reactive Agent Arena · Powered by Somnia & DreamDEX*
