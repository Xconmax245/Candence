import { keccak256, toBytes } from "viem";

const errorNames = [
  "InsufficientCollateral()",
  "InsufficientFunds()",
  "InsufficientVaultBalance()",
  "InvalidPriceScale()",
  "InvalidPriceTick()",
  "InvalidPrice()",
  "PriceTickInvalid()",
  "PriceNotOnGrid()",
  "InvalidTick()",
  "InvalidLot()",
  "InvalidLotSize()",
  "LotSizeInvalid()",
  "SizeNotOnGrid()",
  "QuantityNotOnGrid()",
  "OrderExpired()",
  "ExpireTimestampPast()",
  "ExpireTimestampTooFar()",
  "ExpireTimestampInvalid()",
  "ExceedsMaxExpiry()",
  "ExpireTimestampExceedsExpiry()",
  "ExpiryPassed()",
  "TradingNotStarted()",
  "TradingEnded()",
  "MarketNotTrading()",
  "PoolNotTrading()",
  "NotTrading()",
];

for (const err of errorNames) {
  const sel = keccak256(toBytes(err)).slice(0, 10);
  if (sel === "0x3154078e") console.log(`MATCH FOUND! ${err} -> ${sel}`);
}
