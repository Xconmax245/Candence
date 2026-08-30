// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IReactivity
 * @notice Candence-specific constants for the Somnia on-chain reactivity
 *         integration. The real protocol interface lives in the official
 *         npm package @somnia-chain/reactivity-contracts@0.2.1:
 *
 *           - SomniaEventHandler  — inherit for reactive callback handling.
 *           - SomniaExtensions    — library for subscribe/unsubscribe.
 *
 * This file only holds constants that are Candence-specific, not redefined
 * inside the upstream package.
 */

/// @dev keccak256("MarkPriceUpdated(address,uint256,uint256)")
/// Emitted by the DreamDEX spot pool (the price source).
/// eventTopics[0] = this hash   (topic0, the event signature)
/// eventTopics[1] = asset addr  (indexed, the underlying token e.g. WBTC)
/// data           = markPrice (uint256) ++ rawMidpoint (uint256)  [non-indexed]
bytes32 constant MARK_PRICE_UPDATED_TOPIC =
    keccak256("MarkPriceUpdated(address,uint256,uint256)");

// ── Option C placeholder ─────────────────────────────────────────────────────
// If the deployed BinaryMarketsModule emits MarketCreated when a new Event
// Contract window opens, a second SomniaExtensions.subscribe() call on that
// topic allows the subscriber to maintain currentMarket[] reactively without
// a keeper. Verify the exact event signature on the testnet explorer before
// uncommenting and wiring a second subscription.
//
// bytes32 constant MARKET_CREATED_TOPIC =
//     keccak256("MarketCreated(bytes32,bytes32,uint32,uint64,uint64)");
