// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Timelocked} from "./base/Auth.sol";
import {IRiskEngine} from "./interfaces/ICandence.sol";

/**
 * @title RiskEngine
 * @notice Onchain, contract-enforced risk controls for every AgentVault
 *         (DIRECTIVE §4.4). The OperatorPermissionsRegistry does NOT enforce
 *         spend caps (§1.6) — this contract does, and it is the single source of
 *         truth for:
 *
 *           1. Per-vault, per-owner spend caps (the Phase 6 invariant:
 *              "handler cannot spend more than its authorized session-key limit").
 *           2. Max-drawdown circuit breaker — auto-pause a vault once realized
 *              losses cross a configured threshold (§4.4).
 *           3. Position-size caps derived ONCHAIN from realized win-rate — no
 *              offchain risk scoring (§4.4).
 *           4. A global, timelocked emergency pause (§4.4).
 *
 *         Void settlements are recorded as BREAK-EVEN, never a loss (§1.2) — this
 *         is what keeps the dashboard's win-rate/drawdown math honest.
 *
 *         Spend caps and settlement recording are written by the vault itself
 *         (msg.sender == vault). A vault only ever affects its own accounting.
 */
contract RiskEngine is Timelocked, IRiskEngine {
    struct VaultRisk {
        bool registered;
        uint256 drawdownThresholdBase; // auto-pause once realized loss exceeds this
        uint256 basePositionBase; // baseline per-order size before win-rate scaling
        int256 realizedPnlBase; // running realized PnL (voids are break-even)
        int256 realizedDrawdownBase; // most-negative excursion of realizedPnlBase
        uint256 wins;
        uint256 losses; // voids excluded entirely (§1.2)
        bool autoPaused; // tripped by the drawdown breaker
    }

    /// @dev vault => risk state.
    mapping(address => VaultRisk) public risk;
    /// @dev vault => owner => cumulative spent (base units).
    mapping(address => mapping(address => uint256)) public spentBase;
    /// @dev vault => owner => spend cap (base units). 0 == no grant.
    mapping(address => mapping(address => uint256)) public capBase;

    bool public globalPaused;
    /// @dev The factory is authorised to register vaults + set caps on deploy/clone.
    address public factory;

    error NotRegistered();
    error NotFactoryOrOwner();
    error CapBelowSpent();

    event VaultRegistered(address indexed vault, uint256 drawdownThresholdBase, uint256 basePositionBase);
    event SpendCapSet(address indexed vault, address indexed owner, uint256 capBase);
    event Spent(address indexed vault, address indexed owner, uint256 amountBase, uint256 totalBase);
    event CircuitBreakerTripped(address indexed vault, int256 drawdownBase, uint256 threshold);
    event VaultPaused(address indexed vault, bool paused);
    event GlobalPauseSet(bool paused);
    event SettlementRecorded(address indexed vault, int256 pnlBase, bool voided);
    event FactorySet(address indexed factory);

    constructor(address initialOwner, uint256 delay) Timelocked(initialOwner, delay) {}

    // ─────────────────────────────────────────────────────────────
    // Wiring
    // ─────────────────────────────────────────────────────────────

    function setFactory(address f) external onlyOwner {
        factory = f;
        emit FactorySet(f);
    }

    modifier onlyFactoryOrOwner() {
        if (msg.sender != factory && msg.sender != owner) revert NotFactoryOrOwner();
        _;
    }

    /// @inheritdoc IRiskEngine
    function registerVault(address vault, uint256 drawdownThresholdBase, uint256 basePositionBase)
        external
        onlyFactoryOrOwner
    {
        VaultRisk storage r = risk[vault];
        r.registered = true;
        r.drawdownThresholdBase = drawdownThresholdBase;
        r.basePositionBase = basePositionBase;
        emit VaultRegistered(vault, drawdownThresholdBase, basePositionBase);
    }

    /// @notice Set an owner's spend cap for a vault. Only the factory (on clone)
    ///         or the RiskEngine owner may set caps; a cap can never be set below
    ///         what's already spent (prevents accounting underflow / silent bypass).
    function setSpendCap(address vault, address owner_, uint256 newCapBase)
        external
        onlyFactoryOrOwner
    {
        if (newCapBase < spentBase[vault][owner_]) revert CapBelowSpent();
        capBase[vault][owner_] = newCapBase;
        emit SpendCapSet(vault, owner_, newCapBase);
    }

    // ─────────────────────────────────────────────────────────────
    // Spend enforcement — THE Phase 6 invariant
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IRiskEngine
    function checkSpend(address vault, address owner_, uint256 amountBase)
        public
        view
        returns (bool ok, string memory reason)
    {
        if (globalPaused) return (false, "global-paused");
        VaultRisk storage r = risk[vault];
        if (!r.registered) return (false, "vault-unregistered");
        if (r.autoPaused) return (false, "circuit-breaker");
        uint256 cap = capBase[vault][owner_];
        if (cap == 0) return (false, "no-grant");
        uint256 wouldBe = spentBase[vault][owner_] + amountBase;
        if (wouldBe > cap) return (false, "spend-cap");
        if (amountBase > positionCapBase(vault)) return (false, "position-cap");
        return (true, "");
    }

    /**
     * @notice Commit spend for an order. MUST be called by the vault immediately
     *         before it routes `placeOrderFor`. Reverts if the spend is not
     *         allowed — this is the enforcement point the invariant test proves.
     *         `msg.sender` is the vault; a vault can only spend against itself.
     */
    function commitSpend(address owner_, uint256 amountBase) external {
        address vault = msg.sender;
        (bool ok, string memory reason) = checkSpend(vault, owner_, amountBase);
        require(ok, reason);
        uint256 total = spentBase[vault][owner_] + amountBase;
        spentBase[vault][owner_] = total;
        emit Spent(vault, owner_, amountBase, total);
    }

    // ─────────────────────────────────────────────────────────────
    // Settlement accounting + drawdown breaker
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IRiskEngine
    function recordSettlement(address vault, int256 pnlBase, bool voided) external {
        // Only the vault records its own settlements.
        require(msg.sender == vault, "only-self");
        VaultRisk storage r = risk[vault];
        require(r.registered, "vault-unregistered");

        if (voided) {
            // A void is BREAK-EVEN (§1.2): do not touch win/loss counters and do
            // not treat a rounding of the 0.5/0.5 refund as loss. PnL delta ~ 0.
            emit SettlementRecorded(vault, 0, true);
            return;
        }

        r.realizedPnlBase += pnlBase;
        if (pnlBase > 0) r.wins += 1;
        else if (pnlBase < 0) r.losses += 1;

        if (r.realizedPnlBase < r.realizedDrawdownBase) {
            r.realizedDrawdownBase = r.realizedPnlBase;
        }

        emit SettlementRecorded(vault, pnlBase, false);

        // Circuit breaker: trip once realized loss magnitude crosses the threshold.
        if (
            !r.autoPaused && r.realizedDrawdownBase < 0
                && uint256(-r.realizedDrawdownBase) >= r.drawdownThresholdBase
                && r.drawdownThresholdBase > 0
        ) {
            r.autoPaused = true;
            emit CircuitBreakerTripped(vault, r.realizedDrawdownBase, r.drawdownThresholdBase);
            emit VaultPaused(vault, true);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Position sizing from realized win-rate (onchain, §4.4)
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IRiskEngine
    function positionCapBase(address vault) public view returns (uint256) {
        VaultRisk storage r = risk[vault];
        uint256 base = r.basePositionBase;
        uint256 settled = r.wins + r.losses;
        if (settled < 5) return base; // insufficient history — use baseline
        // Kelly-lite: scale between 0.5x and 1.5x of baseline by win-rate.
        // winRateBps in [0, 10000]; multiplier = 50% + winRate% (capped 150%).
        uint256 winRateBps = (r.wins * 10_000) / settled;
        uint256 multiplierBps = 5_000 + winRateBps; // 5000..15000
        if (multiplierBps > 15_000) multiplierBps = 15_000;
        return (base * multiplierBps) / 10_000;
    }

    // ─────────────────────────────────────────────────────────────
    // Pause controls
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IRiskEngine
    function isVaultPaused(address vault) external view returns (bool) {
        return globalPaused || risk[vault].autoPaused;
    }

    /// @notice Emergency freeze is INSTANT (not timelocked) — see Timelocked docs.
    function setGlobalPause(bool paused) external onlyOwner {
        globalPaused = paused;
        emit GlobalPauseSet(paused);
    }

    /// @notice Manually pausing a single vault is instant.
    function pauseVault(address vault, bool paused) external onlyOwner {
        risk[vault].autoPaused = paused;
        emit VaultPaused(vault, paused);
    }

    /// @notice Resetting a tripped breaker is timelocked (un-pause waits, §4.1).
    function queueResetBreaker(address vault) external onlyOwner {
        _queue(keccak256(abi.encode("resetBreaker", vault)));
    }

    function executeResetBreaker(address vault) external onlyOwner {
        _consume(keccak256(abi.encode("resetBreaker", vault)));
        risk[vault].autoPaused = false;
        emit VaultPaused(vault, false);
    }

    // ── Views for the dashboard (§6) ──

    function realizedDrawdownBase(address vault) external view returns (int256) {
        return risk[vault].realizedDrawdownBase;
    }

    function winLoss(address vault) external view returns (uint256 wins, uint256 losses) {
        return (risk[vault].wins, risk[vault].losses);
    }
}
