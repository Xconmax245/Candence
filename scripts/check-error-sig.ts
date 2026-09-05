import { keccak256, toBytes } from "viem";

const errorNames = [
  "ImmediateOrCancelNoFill()",
  "NoFill()",
  "OrderNotFillable()",
  "PriceOutOfRange()",
  "MinQuantityNotMet()",
  "InvalidLotSize()",
  "InsufficientBalance()",
  "InsufficientAllowance()",
  "InvalidPrice()",
  "InvalidQuantity()",
  "OrderTypeNotSupported()",
  "SelfMatchCancelTaker()",
  "InvalidExpireTimestamp()",
  "TradingNotStarted()",
  "MarketNotTrading()",
  "PoolNotTrading()",
  "ZeroQuantity()",
  "ZeroPrice()",
  "PriceTickNotMet()",
  "InvalidTickSize()",
];

for (const err of errorNames) {
  const sel = keccak256(toBytes(err)).slice(0, 10);
  if (sel === "0x6e4ba61d") console.log(`MATCH FOUND! ${err} -> ${sel}`);
  else console.log(`${err} -> ${sel}`);
}
