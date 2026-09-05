import { keccak256, toBytes } from "viem";

const errorNames = [
  "NotOperator()",
  "OperatorNotApproved()",
  "OperatorNotAuthorized()",
  "UnauthorizedOperator()",
  "Unauthorized()",
  "NotAuthorized()",
  "OperatorDenied()",
  "InvalidOperator()",
];

for (const err of errorNames) {
  const sel = keccak256(toBytes(err)).slice(0, 10);
  console.log(`${err} -> ${sel}`);
  if (sel === "0x3fb0ba2e") {
    console.log(`🎯 MATCH FOUND! ${err} = ${sel}`);
  }
}
