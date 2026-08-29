# Candence — SDK & Docs Feedback Report

Submitted as the optional SDK/docs feedback deliverable. This is written from the perspective of a team that built a production-shaped system (onchain reactive triggering, an operator-based copy-trading layer, a claim sweeper, and a live reliability dashboard) against Event Contracts and `@somnia-chain/markets-sdk`. Every item below cost us real debugging time; each is framed as a concrete, actionable suggestion rather than a complaint. Nothing here is a blocker — the surface is genuinely good — but these are the sharp edges a new integrator will hit in the same order we did.

## 1. Venue id drift is under-documented and easy to hardcode

**What happened.** The venue id differs between testnet and mainnet *and has moved historically*. It's natural to copy the value from a doc into a constant and move on — and everything works until the venue rotates, at which point every `listBinaryMarkets({ venueId })` call silently returns nothing and the agent looks "idle" with no error.

**Suggestion.** Document a canonical **live** resolution path (a `/venues` endpoint or an SDK `getActiveVenue()` helper) as *the* recommended pattern, and mark any literal venue id in the docs as "starting value, resolve live." A one-liner SDK helper would remove the failure mode entirely. We ended up writing our own `resolveVenueId()` with a REST read + cache + fallback; a first-party version would be better.

## 2. The 6-vs-18 collateral decimal split is a latent footgun

**What happened.** Testnet collateral is 6 decimals (faucet USDC), mainnet USDso is 18. Code that's only ever exercised on one network bakes in the wrong scale and then produces off-tick prices or wrong sizes on the other. This interacts nastily with item 3.

**Suggestion.** Surface `collateral.decimals` prominently in the SDK's market/venue objects (not just derivable), and add a doc callout: *"never assume 18; read decimals per network."* A worked example showing the same order sized correctly on both networks would prevent most of these.

## 3. Off-tick float prices revert with `InvalidPrice`, and the trap is silent

**What happened.** `toFixed(18)` (or any float→string price) produces values that are *almost* on the tick grid. On the 6-decimal testnet the coarse grid hides it — trivial values like 0.25/0.5/0.75 survive naive math — so it looks fine. On an 18-decimal venue the same code reverts `InvalidPrice`. This is the single most expensive gotcha we hit.

**Suggestion.** Make bigint tick-snapping the *default, documented* path, not an advanced one. `amountToPrecision` (from 0.24.0) is great but easy to miss; a matching `priceToTick(humanProb, market)` returning a bigint, shown in the very first "place an order" example, would set everyone on the safe path from line one. Also worth a docs warning that testnet's coarse grid masks this class of bug.

## 4. `loadMarkets()` skipping finalized binaries makes claiming look optional

**What happened.** `loadMarkets()` is the obvious discovery call, and it omits finalized binaries. A newcomer building a "place orders" loop never sees the finalized markets, so they never build claiming — and then discover, days later, that winnings are stranded across dozens of resolved markets while the wallet looks near-empty. Winnings being *claimed, not auto-converted* compounds this.

**Suggestion.** In the "getting started" flow, pair *every* order-placement example with a `listBinaryMarkets({ status: "Finalized" })` + redeem example, and add an explicit note: *"positions do not auto-convert; you must redeem."* Consider a doc-level "lifecycle checklist" (place → gate on Trading → settle → **claim**) so the claim step is visually un-skippable.

## 5. `expireTimestampNs` being mandatory is correct — but the failure mode should be spelled out

**What happened.** It's easy to treat the expiry as optional boilerplate. The important, under-stated consequence is the *good* one: setting it just past your requote interval means a crashed bot's stale orders age off on their own instead of resting live indefinitely. We only realized this was a resilience feature (not just a required field) after reading the reference strategies closely.

**Suggestion.** Document `expireTimestampNs` as a *reliability tool*, with the recommended "requote interval + small buffer, capped at market expiry" formula inline. Note the interaction with resting vs IOC orders (a resting remainder stays escrow-locked unless IOC) in the same place, since they're two halves of the same "what happens to my order after I stop watching" question.

## 6. Indexer status lag vs onchain status needs an explicit "gate onchain" instruction

**What happened.** The indexer can lag chain state by seconds. Gating writes on an indexed/REST status occasionally let an order fire against a market that had already left `Trading`, which then reverted. The fix — read status onchain immediately before signing — is obvious in retrospect but wasn't called out as mandatory.

**Suggestion.** A prominent rule in the docs: *"the indexer is for discovery; gate every write on live onchain status === Trading(1)."* Perhaps an SDK `assertTrading(marketId)` convenience that does the onchain read, so the safe pattern is one call.

## 7. Reactivity subscription flow: the SOMI funding contract is the confusing part

**What happened.** The mechanics of *subscribing* via the precompile were clear enough from `SpotStopOrderRegistry`. What took longest was understanding the **gas/SOMI funding lifecycle**: that the handler owner must hold ≥ 32 SOMI at subscription creation, that every invocation draws from that balance, and what *exactly* happens when it runs dry (does the handler revert? silently stop? get dropped from the subscription?). We designed defensively — skip-and-emit on exhaustion — but had to infer the runtime behavior.

**Suggestion.** A dedicated "Reactive handler economics" doc section: the ≥32 SOMI floor, per-invocation cost characteristics, the precise exhaustion behavior, and a recommended top-up/monitoring pattern. A reference "reactive subscriber with funding + telemetry" example (analogous to the ec-* strategy references, but for the *reactive* path specifically) would be the single highest-value addition for teams building on Reactivity rather than on polling.

## 8. Write calls skipping simulation — great that ≥0.23 decodes reverts; make receipt-checking the norm

**What happened.** SDK writes skip simulation; on ≥0.23.0 a failed write throws a decoded revert, which is a big improvement, but it's still easy to fire-and-forget without checking `(order.info as PlaceOrderResult).receipt`. On older versions the "silent success" behavior is a real trap.

**Suggestion.** Pin the ≥0.25.0 recommendation loudly (we did), and show receipt-checking in the canonical example so it reads as normal, not optional. A note that older versions can appear to succeed would save someone a very confusing afternoon.

---

### Net

The Event Contracts surface is coherent and the operator model is genuinely elegant for non-custodial automation — building copy-trading on it was the *easiest* part of this project, which is high praise. The friction is almost entirely in the *implicit* rules (venue drift, decimal split, tick snapping, claim-is-mandatory, gate-onchain, SOMI lifecycle). Making those explicit in the getting-started path — ideally with one reference implementation for the **reactive** path the way ec-* covers the polling path — would meaningfully lower the barrier for the next team. We'd happily contribute our `resolveVenueId`, bigint tick-snapping, and reactive-funding-telemetry patterns upstream if useful.
