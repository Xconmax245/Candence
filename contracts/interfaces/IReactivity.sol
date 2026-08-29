// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IReactivity
 * @notice Interface to Somnia's Reactivity precompile at 0x0100 and the callback
 *         shape a subscriber must implement (DIRECTIVE §1.3, §4.1, §10).
 *
 * Candence's entire thesis: agent decisions are triggered by this precompile
 * delivering a price event, NOT by an offchain cron (DIRECTIVE §0.2). The
 * subscription is created onchain; gas for every invocation is drawn from the
 * handler owner's SOMI balance (≥ 32 SOMI required at subscription creation,
 * DIRECTIVE §10) — which is why the SOMI funding model (§4.3) is first-class.
 *
 * This mirrors DreamDEX's own `SpotStopOrderRegistry` reactive pattern: the
 * precompile calls `onReactiveEvent` on the registered handler when the watched
 * topic fires on the watched emitter.
 */

/// @dev The precompile address is constant across Somnia networks.
address constant REACTIVITY_PRECOMPILE = address(0x0100);

interface IReactivityPrecompile {
    /**
     * @notice Register a subscription: deliver `topic` events emitted by
     *         `emitter` to `handler.onReactiveEvent`.
     * @param emitter  The contract whose events we watch (e.g. the spot price source).
     * @param topic    The event topic (topic0 / keccak signature) to match.
     * @param handler  The contract to call back (a ReactivitySubscriber).
     * @return subscriptionId Opaque id used to update/cancel the subscription.
     */
    function subscribe(address emitter, bytes32 topic, address handler)
        external
        payable
        returns (uint256 subscriptionId);

    /// @notice Cancel a subscription; refunds remaining prepaid gas to the owner.
    function cancel(uint256 subscriptionId) external;

    /// @notice Onchain SOMI gas balance backing a handler's invocations.
    function gasBalanceOf(address handler) external view returns (uint256);

    /// @notice Top up a handler's invocation gas balance.
    function fund(address handler) external payable;
}

/**
 * @notice The callback surface a reactive handler must expose. The precompile
 *         invokes this when a subscribed event fires. Implementations MUST wrap
 *         per-consumer dispatch in try/catch so one failing vault never blocks
 *         others in the same block (DIRECTIVE §4.1) and MUST NOT revert the whole
 *         callback on a single handler's failure.
 */
interface IReactiveHandler {
    /**
     * @param subscriptionId The subscription that matched.
     * @param emitter        The emitting contract.
     * @param topic          The matched topic0.
     * @param data           ABI-encoded event payload (topics + data).
     */
    function onReactiveEvent(
        uint256 subscriptionId,
        address emitter,
        bytes32 topic,
        bytes calldata data
    ) external;
}
