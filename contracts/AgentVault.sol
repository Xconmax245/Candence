// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, ReentrancyGuard} from "./base/Auth.sol";
import {CadenceMath} from "./base/CadenceMath.sol";
import {IAgentVault, VaultMode, IRiskEngine, ICopilotAttestor} from "./interfaces/ICadence.sol";
import {
    IBinaryMarketsModule,
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
 *             to call placeOrderFor / cancelOrderFor / reduceOrderFor on each
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
    using CadenceMath for uint256;

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

    /**
     * @dev The core decision + placement routine. Defensive throughout — a revert
     *      here becomes a HandlerFailed event upstream, never blocking other vaults.
     */
    function _act(bytes32 marketKey, bytes calldata data) internal {
        if (riskEngine.isVaultPaused(address(this))) revert VaultPaused();
        if (owners.length == 0) revert NoOwners();

        // 1) LIVE onchain status gate (§1.2 #1) — never trust cached/indexed.
        if (module.marketStatus(marketKey) != MarketStatus.Trading) {
            emit SkippedNotWritable(marketKey, "not-trading");
            return;
        }

        // 2) Typed market fields only (§1.7 #11) + interval-scaled headroom (§1.7 #9).
        (, uint32 intervalSec,,, uint64 expiryTime,) = module.marketInfo(marketKey);
        if (!CadenceMath.hasHeadroom(block.timestamp, expiryTime, intervalSec)) {
            emit SkippedNotWritable(marketKey, "no-headroom");
            return;
        }

        // 3) Decide direction + a raw probability price from the event payload.
        (uint8 outcome, uint256 rawPrice) = _decide(marketKey, data, intervalSec, expiryTime);

        // 4) Snap price + size to grid as bigints (§1.7 #3, #6).
        (uint256 tick, uint256 scale, uint256 lot) = module.poolGrid(marketKey);
        uint256 price = CadenceMath.snapPrice(rawPrice, tick, scale);
        uint256 sizeCap = riskEngine.positionCapBase(address(this));
        uint256 size = CadenceMath.quantizeSize(sizeCap, lot);
        if (size == 0) {
            emit SkippedNotWritable(marketKey, "size-zero");
            return;
        }

        uint256 notional = CadenceMath.notional(price, size, scale);
        uint64 expireNs = _expireNs(expiryTime);

        // 5) Place for each granted owner, enforcing the spend cap onchain (§1.6).
        for (uint256 i = 0; i < owners.length; i++) {
            address ow = owners[i];
            if (!isOwnerGranted[ow]) continue;

            (bool ok,) = riskEngine.checkSpend(address(this), ow, notional);
            if (!ok) {
                // Never revert the whole dispatch on one owner's cap; skip them.
                emit SkippedNotWritable(marketKey, "spend-cap");
                continue;
            }

            // Commit spend BEFORE routing (reverts if racey) — the invariant point.
            IRiskEngineCommit(address(riskEngine)).commitSpend(ow, notional);

            OrderRequest memory req = OrderRequest({
                marketId: marketKey,
                outcome: outcome,
                price: price,
                size: size,
                expireTimestampNs: expireNs,
                ioc: true // IOC by default: no resting escrow lock (§1.7 #4)
            });
            // placeOrderFor settles fills to the OWNER's wallet, never here (§1.6).
            try module.placeOrderFor(ow, req) {
                emit OrderPlaced(ow, marketKey, outcome, size, price);
            } catch {
                // Fills can fail benignly (e.g. crossed away). Don't brick others.
                emit SkippedNotWritable(marketKey, "place-failed");
            }
        }
    }

    /**
     * @dev Decision function. Reactive baseline is a mean-reversion-lite lean off
     *      the delivered mark price vs strike; AiAssisted mode blends in a valid
     *      attested signal, else falls back and LOGS it (§4.2, §5).
     * @return outcome 0=Up, 1=Down. @return rawPrice desired probability in base units.
     */
    function _decide(bytes32 marketKey, bytes calldata data, uint32 intervalSec, uint64 expiryTime)
        internal
        returns (uint8 outcome, uint256 rawPrice)
    {
        // Reactive core: derive a directional lean from the delivered price payload.
        // data layout: [0:32]=marketKey, [32:64]=markPrice, [64:96]=strike (by convention).
        uint256 markPrice;
        uint256 strike;
        if (data.length >= 96) {
            markPrice = uint256(bytes32(data[32:64]));
            strike = uint256(bytes32(data[64:96]));
        }
        // Default lean: price above strike → Up more likely.
        bool leanUp = markPrice >= strike;

        // Base probability ~0.55 toward the lean, expressed in base units.
        uint256 half = priceScale / 2;
        uint256 edge = priceScale / 20; // 0.05

        if (modeValue == VaultMode.AiAssisted && address(signalSource) != address(0)) {
            bytes32 windowKey = _windowKey(marketKey, intervalSec, expiryTime);
            (int32 scoreBps, uint16 confBps, uint64 issuedAt, bool graded,) =
                signalSource.latestSignal(windowKey);
            bool valid = confBps > 0 && issuedAt > 0 && !graded
                && (block.timestamp - issuedAt) <= intervalSec;
            if (valid) {
                emit SignalUsed(marketKey, scoreBps, confBps);
                leanUp = scoreBps >= 0;
                // Confidence widens the edge up to ~0.15.
                edge = (priceScale * uint256(confBps)) / 10_000 / 6 + edge;
            } else {
                // MANDATORY graceful fallback to Reactive-only (§0.3, §4.2).
                emit FellBackToReactive(marketKey, "no-valid-signal");
            }
        }

        if (leanUp) {
            outcome = 0; // Up
            rawPrice = half + edge;
        } else {
            outcome = 1; // Down
            rawPrice = half + edge; // price we pay for the Down side
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
            MarketStatus st = module.marketStatus(mk);
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
                // Realized PnL vs the notional staked is reconciled by the operator
                // loop which knows the stake; here we record the redeemed inflow.
                // Winners: positive; losers redeem 0 → recorded as a loss delta by
                // the operator via recordSettlement in its accounting pass.
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
