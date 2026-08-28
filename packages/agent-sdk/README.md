# @cadence/agent-kit

**Build reactive trading agents for [DreamDEX Event Contracts](https://docs.dreamdex.io) on [Somnia](https://somnia.network).**

This is the exact production-robustness surface [Cadence](https://github.com/cadence-arena/cadence) runs its own agents on, published so you can deploy a strategy against Event Contracts without re-learning every gotcha the hard way. It is intentionally small, dependency-light (viem + the official `@somnia-chain/markets-sdk` as peers), and strategy-agnostic.

> Event Contracts are binary Up/Down markets on BTC/ETH price over rolling 15-minute and 1-hour windows. Winning contracts redeem for exactly 1 USDso; losers expire worthless. Zero fees, fully collateralized. This kit assumes that model.

## Why this exists

Six things will silently break a naive Event Contracts bot. This kit handles all six so you don't have to:

| # | Gotcha | What the kit does |
|---|--------|-------------------|
| 1 | Indexer lags chain state | `assertTradable()` re-reads **live onchain** status before every order |
| 2 | Float prices revert with `InvalidPrice` on 18-dec venues | `snapPriceToTick()` snaps to the grid as a **bigint** |
| 3 | Off-lot sizes revert | `quantizeToLot()` rounds down to the lot grid |
| 4 | Resting remainders stay escrow-locked | `Decision.ioc` makes resting a deliberate choice |
| 5 | Winnings are **claimed, not automatic** | `sweepClaims()` — an always-on redeem loop |
| 6 | Pools are recycled across windows | everything is keyed by `marketId`, never pool address |

## Install

```bash
npm i @cadence/agent-kit @somnia-chain/markets-sdk viem
# requires @somnia-chain/markets-sdk >= 0.25.0
```

## Quick start — a reactive agent in ~30 lines

```ts
import {
  reactiveMomentum,
  runOnce,
  loadTradableMarkets,
  pickCurrentWindow,
  type MarketsClient,
  type PlaceSender,
} from "@cadence/agent-kit";

// You provide these two adapters over @somnia-chain/markets-sdk + your wallet.
const client: MarketsClient = /* wraps exchange.client.* */ myClient;
const sender: PlaceSender = /* wraps exchange.trader.placeOrderFor + a viem walletClient */ mySender;

const strategy = reactiveMomentum({ emaPeriod: 8, minEdge: 0.03 });

async function onPriceEvent(venueId: `0x${string}`, upPriceHistory: number[]) {
  const markets = await loadTradableMarkets(client, venueId);
  const market = pickCurrentWindow(markets, "BTC", 900);
  if (!market) return;

  const outcome = await runOnce(
    { owner: myWallet, maxStake: 5, requoteIntervalSec: 60, collateralDecimals: 6 },
    client,
    sender,
    strategy,
    market,
    { nowSec: Math.floor(Date.now() / 1000), upPriceHistory },
  );

  console.log(outcome); // { status: "placed", txHash } | { status: "skipped", reason }
}
```

`runOnce` applies **every** safety gate in the correct order — status check, headroom, spend cap, owner balance, bigint snapping, operator placement, receipt verification — so a strategy author cannot skip one by accident.

## Non-custodial copy-trading (the operator model)

DreamDEX's real primitive is an **operator**, not a fund-holding vault. An owner grants an operator the `placeOrderFor` / `cancelOrderFor` / `reduceOrderFor` selectors; **fills settle to the owner's own wallet**, and deposits/withdrawals stay owner-only. Authorization is revocable immediately.

```ts
import { buildGrantCalldata, buildRevokeCalldata } from "@cadence/agent-kit";

// One signature onboards a follower — the entire "clone this agent" flow:
const grants = buildGrantCalldata(agentOperatorAddress); // 3 calldata blobs, batch via multicall
// ...owner signs+sends grants to the OperatorPermissionsRegistry.

// Instant opt-out, owner-only:
const revokes = buildRevokeCalldata(agentOperatorAddress);
```

The registry does **not** enforce spend caps — your agent (or Cadence's `RiskEngine`) must. `runOnce`'s `maxStake` is that enforcement point on the offchain side.

## Always-on claiming

```ts
import { sweepClaims, outstandingUnclaimed } from "@cadence/agent-kit";

// Run this on the SAME key/nonce sequence as trading (avoid nonce races):
const claims = await sweepClaims(client, redeemer, venueId, {
  scanLast: 25,
  onClaim: (c) => telemetry.claimSwept(c.marketId, c.amountBase),
});

// Surface this on your dashboard — a rising number means the sweeper stalled:
const outstanding = await outstandingUnclaimed(client, redeemer, venueId);
```

Voided markets are handled correctly: **both sides redeem at 0.5 each (break-even, not a loss)**.

## Writing your own strategy

A `Strategy` is a **pure function** — no IO, no signing — which makes it trivially unit-testable:

```ts
import { Outcome, type Strategy } from "@cadence/agent-kit";

const myStrategy: Strategy = (ctx) => {
  // ctx.market, ctx.upPriceHistory, ctx.signal (optional AI tilt), ctx.maxStake
  if (/* no edge */) return null;
  return { outcome: Outcome.Up, price: 0.55, stake: 2, ioc: true };
};
```

If you consume an attested AI signal via `ctx.signal`, your strategy **must still behave sensibly when it's `undefined`** — that's the graceful-degradation contract that keeps the reactive path independent of any AI service.

## API surface

- **pricing** — `snapPriceToTick`, `quantizeToLot`, `toBaseUnits`, `fromBaseUnits`, `computeExpireNs`, `hasHeadroom`, `windowOpenFor`
- **client** — `loadTradableMarkets`, `loadFinalizedMarkets`, `assertTradable`, `ownerHasBalance`
- **operator** — `buildGrantCalldata`, `buildRevokeCalldata`, `encodePlaceOrderFor`, `OPERATOR_SELECTORS`
- **sweeper** — `sweepClaims`, `outstandingUnclaimed`, `pickCurrentWindow`
- **strategy** — `reactiveMomentum`, `Strategy`, `StrategyContext`
- **runner** — `runOnce`, `RunnerConfig`, `PlaceSender`

## License

MIT — free and public, during the hackathon and after. Contributions welcome.
