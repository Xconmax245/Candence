// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IDreamDEX
 * @notice The subset of DreamDEX Event Contracts surfaces Candence integrates with
 *         (DIRECTIVE §1). This is deliberately the OPERATOR model (§1.6), not a
 *         custody model:
 *
 *         - An authorized operator calls `placeBinaryOrderFor` / `cancelOrder` /
 *           `reduceOrder` on the OWNER's behalf directly on the BinaryPool.
 *         - The operator NEVER touches funds. Fills settle directly to the owner's
 *           own wallet. Deposits/withdrawals stay owner-only, always.
 *         - Authorization lives in `OperatorPermissionsRegistry`, grantable per
 *           selector (0x80054449 for placeBinaryOrderFor), and revocable immediately.
 */

/// @notice Market lifecycle status (DIRECTIVE §1.2). Only Trading(1) accepts orders.
enum MarketStatus {
    Listed,   // 0
    Trading,  // 1
    Locked,   // 2
    Settling, // 3
    Resolved, // 4
    Voided    // 5
}

/// @notice A limit order request routed through an operator (§1.6, §1.7).
struct OrderRequest {
    bytes32 marketId;
    uint8 outcome; // 0 = Up, 1 = Down
    uint256 price;
    uint256 size;
    uint64 expireTimestampNs;
    bool ioc;
}

interface IBinaryMarket {
    function status() external view returns (MarketStatus);
    function isResolved() external view returns (bool);
    function isVoided() external view returns (bool);
    function expiry() external view returns (uint64);
}

interface IBinaryPool {
    function getOrderBookParameters() external view returns (uint256 tickSize, uint256 minQuantity, uint256 lotSize);
    function marketExpiryNs() external view returns (uint64);
    function placeBinaryOrderFor(
        address owner,
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 id);
    function cancelOrder(uint128 orderId) external;
    function reduceOrder(uint128 orderId, uint256 newQuantityRemaining) external;
}

interface IBinaryMarketsModule {
    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256 oracleQuestionId,
            uint8 outcomeSlotCount,
            uint8 voidPolicy,
            address collateral,
            uint32 originOperatorId,
            bytes32 originVenueId,
            address oracleAdapter,
            address creator,
            address market,
            address pool,
            uint256 yesId,
            uint256 noId,
            uint64 tradingStart,
            uint64 expiry
        );
}

interface IBinarySettlement {
    function redeemFor(address owner, bytes32 marketId, uint8 outcome) external returns (uint256 amount);
    function claimable(address owner, bytes32 marketId, uint8 outcome) external view returns (uint256);
}

interface IOperatorPermissionsRegistry {
    function setOperatorApprovalGlobal(address operator, bytes4[] calldata selectors, bool approved) external;
    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved) external;
    function isGloballyApproved(address owner, address operator, bytes4 selector) external view returns (bool);
    function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) external view returns (bool);
}
