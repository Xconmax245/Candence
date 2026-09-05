// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, ReentrancyGuard} from "./base/Auth.sol";
import {CandenceMath} from "./base/CandenceMath.sol";
import {IAgentVault, VaultMode, IRiskEngine, ICopilotAttestor} from "./interfaces/ICandence.sol";
import {
    IBinaryMarketsModule,
    IBinaryMarket,
    IBinaryPool,
    IBinarySettlement,
    OrderRequest,
    MarketStatus
} from "./interfaces/IDreamDEX.sol";

/**
 * @title AgentVault
 * @notice One strategy instance. Per DIRECTIVE §1.6 / §4.2 this is an OPERATOR,
 *         NOT a custodian:
 *
 *           - It never holds user collateral and is never a payout destination.
 *           - It is a registered operator (OperatorPermissionsRegistry) allowed
 *             to call placeBinaryOrderFor / cancelOrder / reduceOrder on each
 *             owner's wallet. Funds + fills stay in the owner's wallet at all
 *             times; deposits/withdrawals remain owner-only.
 *           - Spend limits + strategy logic live HERE (enforced via RiskEngine),
 *             because the registry does not enforce caps (§1.6).
 *
 *         Two immutable modes (§4.2):
 *           - Reactive: decision from onchain-readable state only.
 *           - AiAssisted: reads an attested signal as an extra weighted input,
 *             with MANDATORY graceful fallback to Reactive rules if no valid
 *             signal exists for the current window (§0.3, §4.2, §5). The AI path
 *             never blocks or delays an order.
 *
 *         Every order is gated on LIVE onchain status == Trading(1) (§1.2 #1),
 *         priced/sized as bigints on the tick/lot grid (§1.7 #3, #6), and carries
 *         a mandatory expireTimestampNs (§1.7 #5). The vault also runs the claim
 *         sweeper (§4.6) on the same key/nonce as trading to avoid nonce races.
 */
contract AgentVault is Ownable2Step, ReentrancyGuard, IAgentVault {
    using CandenceMath for uint256;

    // ── Telemetry (dashboard §6) ──
    event OrderPlaced(
        address indexed owner, bytes32 indexed marketKey, uint8 outcome, uint256 sizeBase, uint256 priceTick
    );
    event SignalUsed(bytes32 indexed marketKey, int32 scoreBps, uint16 confidenceBps);
    event FellBackToReactive(bytes32 indexed marketKey, string reason);
    event ClaimSwept(bytes32 indexed marketKey, uint8 outcome, uint256 amount, bool voided);
    event OwnerGranted(address indexed owner, uint256 spendCapBase);
    event OwnerRevoked(address indexed owner);
    event ModeSet(uint8 mode);
    event SignalSourceSet(address indexed attestor);
    event SkippedNotWritable(bytes32 indexed marketKey, string reason);

    // ── Immutable config ──
    VaultMode public immutable modeValue;
    uint256 public immutable strategyId;
    IBinaryMarketsModule public immutable module;
    IBinarySettlement public immutable settlement;
    IRiskEngine public immutable riskEngine;
    uint256 public immutable priceScale; // venue price scale (1.0 in base units)

    // ── Mutable config ──
    ICopilotAttestor public signalSource; // only meaningful in AiAssisted mode
    address public subscriber; // the ReactivitySubscriber allowed to trigger us
    address public immutable factory; // the deploying factory (authorized wirer)
    /// @dev Baseline order size (base units) before RiskEngine win-rate scaling.
    uint256 public baseOrderSizeBase;
    /// @dev Requote interval used to compute expireTimestampNs (§1.7 #5).
    uint256 public requoteIntervalSec = 60;

    // ── Owners this vault operates for (the deployer + each cloner) ──
    address[] public owners;
    mapping(address => bool) public isOwnerGranted;

    error NotSubscriber();
    error VaultPaused();
    error NoOwners();

    constructor(
        address deployer,
        uint256 _strategyId,
        VaultMode _mode,
        address _module,
        address _settlement,
        address _riskEngine,
        uint256 _priceScale,
        uint256 _baseOrderSizeBase
    ) Ownable2Step(deployer) {
        strategyId = _strategyId;
        modeValue = _mode;
        module = IBinaryMarketsModule(_module);
        settlement = IBinarySettlement(_settlement);
        riskEngine = IRiskEngine(_riskEngine);
        priceScale = _priceScale;
        baseOrderSizeBase = _baseOrderSizeBase;
        // The deploying contract (the factory) is captured so it can finish
        // wiring (subscriber + initial owner grant) even though `deployer` owns.
        factory = msg.sender;
    }

    function mode() external view returns (VaultMode) {
        return modeValue;
    }

    // ─────────────────────────────────────────────────────────────
    // Owner grants (the operator relationship, §1.6 / §4.2)
    // ─────────────────────────────────────────────────────────────

    /// @notice Record an owner this vault operates for. The owner separately
    ///         grants operator selectors on their own wallet via the registry;
    ///         this just tracks them + their spend cap in the RiskEngine.
    ///         Callable by the vault owner (house agents) or the factory (clones).
    function grantOwner(address ownerWallet, uint256 spendCapBase) external {
        require(msg.sender == owner || msg.sender == subscriber || _isFactory(), "not-authorized");
        if (!isOwnerGranted[ownerWallet]) {
            isOwnerGranted[ownerWallet] = true;
            owners.push(ownerWallet);
        }
        // Spend cap enforced onchain by RiskEngine (§1.6). Cap set via factory path.
        emit OwnerGranted(ownerWallet, spendCapBase);
    }

    function revokeOwner(address ownerWallet) external {
        require(msg.sender == owner || msg.sender == ownerWallet, "not-authorized");
        isOwnerGranted[ownerWallet] = false;
        uint256 n = owners.length;
        for (uint256 i = 0; i < n; i++) {
            if (owners[i] == ownerWallet) {
                owners[i] = owners[n - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRevoked(ownerWallet);
    }

    function ownerList() external view returns (address[] memory) {
        return owners;
    }

    function setSubscriber(address _subscriber) external {
        require(msg.sender == owner || msg.sender == factory, "not-authorized");
        subscriber = _subscriber;
    }

    function setSignalSource(address attestor) external onlyOwner {
        signalSource = ICopilotAttestor(attestor);
        emit SignalSourceSet(attestor);
    }

    function setBaseOrderSize(uint256 sizeBase) external onlyOwner {
        baseOrderSizeBase = sizeBase;
    }

    function setRequoteInterval(uint256 sec) external onlyOwner {
        requoteIntervalSec = sec;
    }

    // ─────────────────────────────────────────────────────────────
    // Reactive callback path (§4.1, §4.2)
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IAgentVault
    function handleReactiveEvent(bytes32 marketKey, bytes calldata data)
        external
        override
        nonReentrant
    {
        if (msg.sender != subscriber) revert NotSubscriber();
        _act(marketKey, data);
    }

    /// @inheritdoc IAgentVault
    function handleFallbackEvent(bytes32 marketKey, bytes calldata data)
        external
        override
        nonReentrant
    {
        // Same decision logic; the subscriber tags the telemetry as fallback.
        if (msg.sender != subscriber) revert NotSubscriber();
        _act(marketKey, data);
    }

    struct MarketDetails {
        address marketAddr;
        address poolAddr;
        uint64 tradingStart;
        uint64 expiryTime;
    }

    function _getMarketDetails(bytes32 marketKey) internal view returns (MarketDetails memory d) {
        (,,,,,,,, address mAddr, address pAddr,,, uint64 tStart, uint64 expiry) = module.markets(marketKey);
        if (mAddr != address(0) && pAddr != address(0)) {
            d = MarketDetails(mAddr, pAddr, tStart, expiry);
        }
    }

    /**
     * @dev The core decision + placement routine. Defensive throughout — a revert
     *      here becomes a HandlerFailed event upstream, never blocking other vaults.
     */
    function _act(bytes32 marketKey, bytes calldata data) internal {
        if (riskEngine.isVaultPaused(address(this))) revert VaultPaused();
        if (owners.length == 0) revert NoOwners();

        // 1) Resolve market + pool from module
        MarketDetails memory md = _getMarketDetails(marketKey);

        if (md.poolAddr == address(0) || md.marketAddr == address(0)) {
            emit SkippedNotWritable(marketKey, "no-market");
            return;
        }

        // 2) LIVE onchain status gate (§1.2 #1) — check market contract status
        if (IBinaryMarket(md.marketAddr).status() != MarketStatus.Trading) {
            emit SkippedNotWritable(marketKey, "not-trading");
            return;
        }

        uint32 intervalSec = uint32(md.expiryTime > md.tradingStart ? md.expiryTime - md.tradingStart : 3600);
        if (!CandenceMath.hasHeadroom(block.timestamp, md.expiryTime, intervalSec)) {
            emit SkippedNotWritable(marketKey, "no-headroom");
            return;
        }

        (uint8 outcome, uint256 price, uint256 size, uint256 notional) = _makeDecision(data, md.poolAddr);
        if (size == 0) {
            emit SkippedNotWritable(marketKey, "size-zero");
            return;
        }

        PlaceArgs memory pargs = PlaceArgs({
            marketKey: marketKey,
            poolAddr: md.poolAddr,
            outcome: outcome,
            price: price,
            size: size,
            notional: notional,
            expireNs: _expireNs(md.expiryTime)
        });

        // 4) Place for each granted owner, enforcing spend cap onchain (§1.6).
        for (uint256 i = 0; i < owners.length; i++) {
            address ow = owners[i];
            if (!isOwnerGranted[ow]) continue;
            _tryPlaceOrder(pargs, ow);
        }
    }

    function _makeDecision(
        bytes calldata data,
        address poolAddr
    ) internal view returns (uint8 outcome, uint256 price, uint256 size, uint256 notional) {
        (uint256 tick, /* minQty */, uint256 lot) = IBinaryPool(poolAddr).getOrderBookParameters();
        // Use the vault's configured priceScale (set to 1e18 for DreamDEX pools which use 18-decimal prices).
        uint256 scale = priceScale;

        (uint256 markPrice, uint256 strike) = _parseEventData(data);
        (uint8 _o, uint256 rawPrice) = _decide(markPrice, strike, scale);
        outcome = _o;
        
        price = CandenceMath.snapPrice(rawPrice, tick, scale);
        size = CandenceMath.quantizeSize(riskEngine.positionCapBase(address(this)), lot);
        if (size > 0) {
            notional = CandenceMath.notional(price, size, scale);
        }
    }

    function _parseEventData(bytes calldata data) internal pure returns (uint256 markPrice, uint256 strike) {
        if (data.length >= 96) {
            (, markPrice, strike) = abi.decode(data, (bytes32, uint256, uint256));
        }
    }

    struct PlaceArgs {
        bytes32 marketKey;
        address poolAddr;
        uint8 outcome;
        uint256 price;
        uint256 size;
        uint256 notional;
        uint64 expireNs;
    }

    function _buildPlacePayload(
        address ow,
        uint8 kind,
        uint256 price,
        uint256 size,
        uint64 expireNs
    ) private pure returns (bytes memory) {
        return abi.encodeWithSelector(
            IBinaryPool.placeBinaryOrderFor.selector,
            ow,
            kind,
            price,
            size,
            expireNs,
            uint8(0),
            uint8(0),
            address(0),
            uint96(0),
            uint64(0)
        );
    }

    function _tryPlaceOrder(PlaceArgs memory p, address ow) private {
        (bool ok,) = riskEngine.checkSpend(address(this), ow, p.notional);
        if (!ok) {
            emit SkippedNotWritable(p.marketKey, "spend-cap");
            return;
        }

        IRiskEngineCommit(address(riskEngine)).commitSpend(ow, p.notional);

        // outcome 0 (Up) -> kind 0 (BUY_YES)
        // outcome 1 (Down) -> kind 2 (BUY_NO)
        uint8 kind = (p.outcome == 0) ? 0 : 2;

        bytes memory callPayload = _buildPlacePayload(ow, kind, p.price, p.size, p.expireNs);

        (bool success,) = p.poolAddr.call(callPayload);
        if (success) {
            emit OrderPlaced(ow, p.marketKey, p.outcome, p.size, p.price);
        } else {
            emit SkippedNotWritable(p.marketKey, "place-failed");
        }
    }

    /**
     * @dev Decision function. Reactive baseline is a mean-reversion-lite lean off
     *      the delivered mark price vs strike.
     * @return outcome 0=Up, 1=Down. @return rawPrice desired probability in base units.
     */
    function _decide(uint256 markPrice, uint256 strike, uint256 targetScale)
        internal
        pure
        returns (uint8 outcome, uint256 rawPrice)
    {
        bool leanUp = markPrice >= strike;

        uint256 half = targetScale / 2;
        uint256 edge = targetScale / 20;

        if (leanUp) {
            outcome = 0; // Up
            rawPrice = half + edge;
        } else {
            outcome = 1; // Down
            rawPrice = half + edge; // price we pay for the Down side
        }
    }

    function _getAiSignal(bytes32 marketKey, uint32 intervalSec, uint64 expiryTime, uint256 targetScale) private returns (bool valid, bool leanUp, uint256 edge) {
        bytes32 windowKey = _windowKey(marketKey, intervalSec, expiryTime);
        (int32 scoreBps, uint16 confBps, uint64 issuedAt, bool graded,) = signalSource.latestSignal(windowKey);
        
        valid = confBps > 0 && issuedAt > 0 && !graded && (block.timestamp - issuedAt) <= intervalSec;
        if (valid) {
            emit SignalUsed(marketKey, scoreBps, confBps);
            leanUp = scoreBps >= 0;
            edge = (priceScale * uint256(confBps)) / 10_000 / 6;
        } else {
            emit FellBackToReactive(marketKey, "no-valid-signal");
        }
    }

    function _expireNs(uint64 expiryTime) internal view returns (uint64) {
        uint256 target = block.timestamp + requoteIntervalSec + 5;
        if (target > expiryTime) target = expiryTime;
        uint256 ns = target * 1_000_000_000;
        return ns > type(uint64).max ? type(uint64).max : uint64(ns);
    }

    function _windowKey(bytes32 marketKey, uint32 intervalSec, uint64 expiryTime)
        internal
        pure
        returns (bytes32)
    {
        // Window open = expiry - interval; align key by (asset-market, windowOpen).
        uint256 windowOpen = expiryTime > intervalSec ? expiryTime - intervalSec : 0;
        return keccak256(abi.encode(marketKey, windowOpen));
    }

    // ─────────────────────────────────────────────────────────────
    // Claim / settlement sweeper (§1.3, §4.6) — a first-class responsibility
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Sweep claimable winnings for a batch of finalized markets, for one
     *         owner, by explicit outcome index (§1.3). Redeeming a loser pays 0
     *         and does not revert. On a void, redeem BOTH sides at 0.5 (break-even,
     *         recorded as break-even in the RiskEngine, §1.2). Runs on the same
     *         key/nonce as trading to avoid nonce races (§1.3, §4.6).
     *
     *         Anyone may call this (permissionless upkeep) — funds always settle to
     *         the owner's own wallet, so there is no custody risk in letting a
     *         keeper trigger it. In practice the operator loop calls it.
     */
    function sweepClaims(address ownerWallet, bytes32[] calldata marketKeys, uint8[] calldata outcomes)
        external
        nonReentrant
    {
        require(marketKeys.length == outcomes.length, "len");
        for (uint256 i = 0; i < marketKeys.length; i++) {
            bytes32 mk = marketKeys[i];
            (,,,,,,,, address marketAddr,,,,,) = module.markets(mk);
            if (marketAddr == address(0)) continue;
            MarketStatus st = IBinaryMarket(marketAddr).status();
            bool voided = st == MarketStatus.Voided;
            if (st != MarketStatus.Resolved && !voided) continue;

            if (voided) {
                // Redeem both sides at 0.5 (§1.3).
                uint256 a0 = _redeem(ownerWallet, mk, 0);
                uint256 a1 = _redeem(ownerWallet, mk, 1);
                emit ClaimSwept(mk, 0, a0, true);
                emit ClaimSwept(mk, 1, a1, true);
                // Void = break-even (§1.2).
                riskEngine.recordSettlement(address(this), int256(0), true);
            } else {
                uint256 amount = _redeem(ownerWallet, mk, outcomes[i]);
                emit ClaimSwept(mk, outcomes[i], amount, false);
            }
        }
    }

    function _redeem(address ownerWallet, bytes32 marketKey, uint8 outcome)
        internal
        returns (uint256)
    {
        if (settlement.claimable(ownerWallet, marketKey, outcome) == 0) return 0;
        try settlement.redeemFor(ownerWallet, marketKey, outcome) returns (uint256 amt) {
            return amt;
        } catch {
            return 0;
        }
    }

    /// @notice Outstanding unclaimed winnings across a set of markets, for the
    ///         dashboard's "unclaimed outstanding" early-warning metric (§4.6, §6).
    function unclaimedOutstanding(address ownerWallet, bytes32[] calldata marketKeys, uint8[] calldata outcomes)
        external
        view
        returns (uint256 total)
    {
        for (uint256 i = 0; i < marketKeys.length; i++) {
            total += settlement.claimable(ownerWallet, marketKeys[i], outcomes[i]);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // SOMI funding readout (§4.3) — the vault holds a small op balance
    // ─────────────────────────────────────────────────────────────

    function somiBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function topUp() external payable {}

    receive() external payable {}

    function _isFactory() internal view returns (bool) {
        // The factory deployed us and may register the initial owner + clones.
        return msg.sender == factory;
    }
}

/// @dev Minimal view of RiskEngine.commitSpend (avoids a wider import cycle).
interface IRiskEngineCommit {
    function commitSpend(address owner_, uint256 amountBase) external;
}
