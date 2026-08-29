// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IDreamDEX
 * @notice The subset of DreamDEX Event Contracts surfaces Candence integrates with
 *         (DIRECTIVE §1). This is deliberately the OPERATOR model (§1.6), not a
 *         custody model:
 *
 *         - An authorized operator calls `placeOrderFor` / `cancelOrderFor` /
 *           `reduceOrderFor` on the OWNER's behalf.
 *         - The operator NEVER touches funds. Fills settle directly to the owner's
 *           own wallet. Deposits/withdrawals stay owner-only, always.
 *         - Authorization lives in `OperatorPermissionsRegistry`, grantable per
 *           selector, and revocable immediately by the owner.
 *
 *         Selectors (§1.6): place 0x80054449, cancel 0xe37b444b, reduce 0x364c2587.
 *
 *         Candence's AgentVault is a registered operator. Spend caps are NOT
 *         enforced by the registry — the vault's own RiskEngine enforces them
 *         (§1.6, §4.4).
 */

/// @notice Market lifecycle status (DIRECTIVE §1.2). Only Trading(1) accepts orders.
enum MarketStatus {
    Listed, // 0
    Trading, // 1
    Locked, // 2
    Settling, // 3 — almost never observable
    Resolved, // 4
    Voided // 5

}

/// @notice A limit order request routed through an operator (§1.6, §1.7).
struct OrderRequest {
    bytes32 marketId; // key by marketId, NEVER pool address (§1.2 #10)
    uint8 outcome; // 0 = Up, 1 = Down (§1.1)
    uint256 price; // tick-snapped bigint price in venue base units (§1.7 #3)
    uint256 size; // lot-quantized size in collateral base units (§1.7 #6)
    uint64 expireTimestampNs; // MANDATORY (§1.7 #5)
    bool ioc; // immediate-or-cancel; avoids resting escrow lock (§1.7 #4)
}

/**
 * @notice The Binary Markets module — order routing under the operator model.
 */
interface IBinaryMarketsModule {
    /// @notice Place an order on the owner's behalf. Operator must be authorized
    ///         for selector 0x80054449 on `owner` (globally or for this pool).
    function placeOrderFor(address owner, OrderRequest calldata req)
        external
        returns (bytes32 orderId, uint256 filledSize);

    /// @notice Cancel an order on the owner's behalf (selector 0xe37b444b).
    function cancelOrderFor(address owner, bytes32 orderId) external;

    /// @notice Reduce an order on the owner's behalf (selector 0x364c2587).
    function reduceOrderFor(address owner, bytes32 orderId, uint256 newSize) external;

    /// @notice LIVE onchain status — the authoritative pre-write gate (§1.2 #1).
    function marketStatus(bytes32 marketId) external view returns (MarketStatus);

    /// @notice Resolve the current pool address for a market. Recycled per window
    ///         — read live, NEVER hardcode/persist (§1.2, §1.5).
    function markets(bytes32 marketId) external view returns (address pool);

    /// @notice Typed market fields — never parse question text (§1.7 #11).
    function marketInfo(bytes32 marketId)
        external
        view
        returns (
            bytes32 asset,
            uint32 intervalSec,
            uint256 strike,
            uint64 openTime,
            uint64 expiryTime,
            bytes32 venueId
        );

    /// @notice Pool tick + lot grid for bigint snapping (§1.7 #3, #6).
    function poolGrid(bytes32 marketId)
        external
        view
        returns (uint256 priceTick, uint256 priceScale, uint256 lotSize);
}

/**
 * @notice Settlement / redemption. Winnings are CLAIMED, not auto-converted
 *         (DIRECTIVE §1.3, §4.6). Redeem with an EXPLICIT outcome index.
 *         Redeeming a loser succeeds and pays 0 (does not revert). On a void,
 *         redeem both sides at 0.5 each.
 */
interface IBinarySettlement {
    /// @notice Redeem a settled position for `owner` by explicit outcome index.
    /// @return amount Collateral paid to the owner (0 for a losing side).
    function redeemFor(address owner, bytes32 marketId, uint8 outcome)
        external
        returns (uint256 amount);

    /// @notice Backstop: poke a stalled oracle (§1.3).
    function pokeOracle(bytes32 questionId) external;

    /// @notice Backstop: void a market whose settlement window has passed (§1.3).
    function voidExpired(bytes32 marketId) external;

    /// @notice Redeemable balance for an owner's position on an outcome.
    function claimable(address owner, bytes32 marketId, uint8 outcome)
        external
        view
        returns (uint256);
}

/**
 * @notice The operator permissions registry (§1.6). Owner-controlled; the vault
 *         is granted only the three trading selectors and can be revoked instantly.
 */
interface IOperatorPermissionsRegistry {
    function grantOperator(address operator, bytes4 selector) external;
    function grantOperatorForPool(address operator, bytes4 selector, bytes32 marketId) external;
    function revokeOperator(address operator, bytes4 selector) external;
    function isAuthorized(address owner, address operator, bytes4 selector)
        external
        view
        returns (bool);
}
