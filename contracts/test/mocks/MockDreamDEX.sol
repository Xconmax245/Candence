// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IBinaryMarketsModule,
    IBinarySettlement,
    OrderRequest,
    MarketStatus
} from "../../interfaces/IDreamDEX.sol";

/**
 * @title MockBinaryMarketsModule
 * @notice A faithful stand-in for DreamDEX's Binary Markets module used in the
 *         Foundry suite. It lets tests drive market status (§1.2), the typed
 *         fields (§1.7 #11), and the tick/lot grid (§1.7 #3/#6), and it RECORDS
 *         every placeOrderFor so tests can assert the operator model: fills are
 *         attributed to the OWNER, never the vault (§1.6).
 */
contract MockBinaryMarketsModule is IBinaryMarketsModule {
    struct Recorded {
        address owner;
        OrderRequest req;
    }

    Recorded[] public placed;

    mapping(bytes32 => MarketStatus) public statusOf;
    mapping(bytes32 => address) public poolOf;

    // typed market fields
    struct Info {
        bytes32 asset;
        uint32 intervalSec;
        uint256 strike;
        uint64 openTime;
        uint64 expiryTime;
        bytes32 venueId;
    }

    mapping(bytes32 => Info) public infoOf;

    // grid
    uint256 public priceTick = 10_000; // 0.01 at 1e6 scale
    uint256 public priceScale = 1_000_000; // testnet 6-decimals
    uint256 public lotSize = 1_000_000; // 1.0 contract lots

    bool public failNextPlace;

    function setStatus(bytes32 marketId, MarketStatus s) external {
        statusOf[marketId] = s;
    }

    function setPool(bytes32 marketId, address pool) external {
        poolOf[marketId] = pool;
    }

    function setInfo(
        bytes32 marketId,
        bytes32 asset,
        uint32 intervalSec,
        uint256 strike,
        uint64 openTime,
        uint64 expiryTime,
        bytes32 venueId
    ) external {
        infoOf[marketId] = Info(asset, intervalSec, strike, openTime, expiryTime, venueId);
    }

    function setGrid(uint256 _tick, uint256 _scale, uint256 _lot) external {
        priceTick = _tick;
        priceScale = _scale;
        lotSize = _lot;
    }

    function setFailNextPlace(bool f) external {
        failNextPlace = f;
    }

    // ── IBinaryMarketsModule ──

    function placeOrderFor(address owner, OrderRequest calldata req)
        external
        returns (bytes32 orderId, uint256 filledSize)
    {
        require(!failNextPlace, "mock-place-fail");
        // Enforce the invariants a real venue would: status + tick + lot.
        require(statusOf[req.marketId] == MarketStatus.Trading, "not-trading");
        require(req.price % priceTick == 0 && req.price > 0 && req.price < priceScale, "InvalidPrice");
        require(req.size % lotSize == 0 && req.size > 0, "InvalidLot");
        require(req.expireTimestampNs > 0, "no-expiry");
        placed.push(Recorded(owner, req));
        orderId = keccak256(abi.encode(owner, req.marketId, placed.length));
        filledSize = req.size;
    }

    function cancelOrderFor(address, bytes32) external {}
    function reduceOrderFor(address, bytes32, uint256) external {}

    function marketStatus(bytes32 marketId) external view returns (MarketStatus) {
        return statusOf[marketId];
    }

    function markets(bytes32 marketId) external view returns (address pool) {
        return poolOf[marketId];
    }

    function marketInfo(bytes32 marketId)
        external
        view
        returns (bytes32, uint32, uint256, uint64, uint64, bytes32)
    {
        Info memory i = infoOf[marketId];
        return (i.asset, i.intervalSec, i.strike, i.openTime, i.expiryTime, i.venueId);
    }

    function poolGrid(bytes32) external view returns (uint256, uint256, uint256) {
        return (priceTick, priceScale, lotSize);
    }

    // ── test helpers ──
    function placedCount() external view returns (uint256) {
        return placed.length;
    }

    function lastPlaced() external view returns (address owner, bytes32 marketId, uint256 price, uint256 size) {
        Recorded storage r = placed[placed.length - 1];
        return (r.owner, r.req.marketId, r.req.price, r.req.size);
    }
}

/**
 * @title MockBinarySettlement
 * @notice Stand-in for redemption. Tests set per-(owner,market,outcome) claimable
 *         amounts; `redeemFor` pays out and zeroes it, mirroring §1.3 semantics
 *         (losers redeem 0 without reverting; voids redeem both sides).
 */
contract MockBinarySettlement is IBinarySettlement {
    mapping(bytes32 => uint256) public claim; // key(owner,market,outcome) => amount
    mapping(address => uint256) public paidTo; // owner => total paid

    function _k(address owner, bytes32 marketId, uint8 outcome) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, marketId, outcome));
    }

    function setClaimable(address owner, bytes32 marketId, uint8 outcome, uint256 amount) external {
        claim[_k(owner, marketId, outcome)] = amount;
    }

    function redeemFor(address owner, bytes32 marketId, uint8 outcome) external returns (uint256 amount) {
        bytes32 k = _k(owner, marketId, outcome);
        amount = claim[k];
        claim[k] = 0;
        paidTo[owner] += amount; // settles to the OWNER's wallet (§1.6)
    }

    function pokeOracle(bytes32) external {}
    function voidExpired(bytes32) external {}

    function claimable(address owner, bytes32 marketId, uint8 outcome) external view returns (uint256) {
        return claim[_k(owner, marketId, outcome)];
    }
}
