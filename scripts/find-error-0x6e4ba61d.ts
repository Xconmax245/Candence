import { keccak256, toBytes } from "viem";

// Search for potential error strings in OrderBook / BinaryPool / DEX
const words = [
  "Order", "Market", "Binary", "Pool", "Price", "Quantity", "Tick", "Lot",
  "Expire", "Expiry", "Time", "Invalid", "Zero", "Not", "Out", "Range",
  "Bounds", "Exceeds", "Below", "Above", "Min", "Max", "Limit", "Balance",
  "Allowance", "Escrow", "Lock", "Vault", "Trading", "Status", "State",
  "Resolved", "Finalized", "Voided", "Locked", "Closed", "Paused", "Owner",
  "Operator", "Approved", "Authorized", "Builder", "Fee", "User", "Data",
  "Kind", "Side", "Outcome", "Collateral", "Nonce", "Books", "Empty"
];

const patterns = [
  "{verb}{noun}",
  "{noun}{verb}",
  "Invalid{noun}",
  "{noun}Invalid",
  "{noun}Too{adj}",
  "Zero{noun}",
  "No{noun}",
  "Use{noun}",
];

const nouns = ["Price", "Quantity", "Tick", "Lot", "LotSize", "TickSize", "Expire", "Expiry", "ExpireTimestamp", "MarketExpiry", "Status", "State", "Trading", "Balance", "Allowance", "Escrow", "Notional", "Order", "Market", "Pool", "Builder", "Fee", "Kind", "Side", "Outcome", "Collateral", "Nonce"];
const verbs = ["Expired", "Locked", "Closed", "Resolved", "Finalized", "Paused", "Trading", "Started", "Ended", "Crossed", "Filled", "Restricted", "Disabled", "Invalid", "Zero", "Exceeded", "Failed"];

const allErrors = new Set<string>();

for (const n of nouns) {
  for (const v of verbs) {
    allErrors.add(`${n}${v}()`);
    allErrors.add(`${v}${n}()`);
    allErrors.add(`Invalid${n}()`);
    allErrors.add(`${n}Invalid()`);
    allErrors.add(`Zero${n}()`);
    allErrors.add(`No${n}()`);
    allErrors.add(`Use${n}()`);
  }
}

console.log(`Checking ${allErrors.size} error candidates...`);
for (const err of allErrors) {
  const sel = keccak256(toBytes(err)).slice(0, 10);
  if (sel === "0x6e4ba61d") {
    console.log(`🎯🎯🎯 FOUND MATCH FOR 0x6e4ba61d! -> ${err}`);
  }
  if (sel === "0x3fb0ba2e") {
    console.log(`🎯🎯🎯 FOUND MATCH FOR 0x3fb0ba2e! -> ${err}`);
  }
}
