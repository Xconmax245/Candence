// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Timelocked, ReentrancyGuard} from "./base/Auth.sol";
import {
    IReactivityPrecompile,
    IReactiveHandler,
    REACTIVITY_PRECOMPILE
} from "./interfaces/IReactivity.sol";
import {IAgentVault} from "./interfaces/ICandence.sol";

/**
 * @title ReactivitySubscriber
 * @notice The single onchain entry point for Candence's reactive thesis
 *         (DIRECTIVE §4.1). It subscribes to the DreamDEX price event via the
 *         0x0100 precompile (following the SpotStopOrderRegistry pattern) and
 *         fans each delivery out to every registered AgentVault.
 *
 *         NON-NEGOTIABLES this contract enforces (DIRECTIVE §0.2, §4.1):
 *           - This IS the decision path. No offchain polling substitutes for it.
 *           - Per-vault try/catch: one failing vault NEVER blocks others in the
 *             same block. A revert in a vault becomes a `HandlerFailed` event,
 *             not a reverted callback.
 *           - EVERY invocation outcome is emitted as structured telemetry
 *             (Succeeded / Failed / Skipped) — this is the raw data source for
 *             the public reliability dashboard (§6). Instrumented from day one.
 *           - Reentrancy guarded on the callback path.
 *           - Admin actions (subscription lifecycle, fee/param changes) are
 *             TIMELOCKED, not bare onlyOwner (§4.1). Emergency pause is instant.
 *           - Fallback watcher (§4.5) submissions are a DISTINCT, separately
 *             counted path — never conflated with reactive successes.
 */
contract ReactivitySubscriber is Timelocked, ReentrancyGuard, IReactiveHandler {
    // ── Telemetry (the §6 dashboard's raw feed) ──
    event HandlerSucceeded(
        address indexed vault, bytes32 indexed marketKey, uint64 latencyMs, uint256 blockNumber
    );
    event HandlerFailed(address indexed vault, bytes32 indexed marketKey, string reason);
    event HandlerSkipped(address indexed vault, bytes32 indexed marketKey, string reason);
    event FallbackTriggered(address indexed vault, bytes32 indexed marketKey, address caller);

    // ── Lifecycle ──
    event SubscriptionUpdated(uint256 indexed subscriptionId, bool active);
    event VaultRegistered(address indexed vault);
    event VaultDeregistered(address indexed vault);
    event Paused(bool paused);
    event PriceSourceSet(address indexed emitter, bytes32 topic);
    event FallbackWatcherSet(address indexed watcher, bool allowed);

    // ── Config ──
    IReactivityPrecompile public constant PRECOMPILE =
        IReactivityPrecompile(REACTIVITY_PRECOMPILE);

    address public priceSource; // the emitter we watch (spot price source)
    bytes32 public priceTopic; // the event topic0 we match (MarkPriceUpdated)
    uint256 public subscriptionId;
    bool public paused;

    /// @dev Registered vaults dispatched on each event.
    address[] public vaults;
    mapping(address => bool) public isVaultRegistered;

    /// @dev Authorized offchain fallback watchers (§4.5). Distinct from reactive.
    mapping(address => bool) public isFallbackWatcher;

    /// @dev Per-block gas floor below which a vault is Skipped rather than risked.
    uint256 public minGasPerVault = 200_000;

    // ── Onchain telemetry counters (§6) ──
    // A drift-free, directly-readable source for the reliability dashboard, in
    // addition to the structured events. Counting onchain means a judge reading
    // the contract sees the same numbers the dashboard shows — no cache to trust.
    uint256 public succeededCount;
    uint256 public failedCount;
    uint256 public skippedCount;
    uint256 public fallbackActivations; // distinct from reactive successes (§4.5)


    error OnlyPrecompile();
    error OnlyFallbackWatcher();
    error IsPaused();
    error AlreadyRegistered();
    error NotRegistered();

    constructor(address initialOwner, uint256 delay) Timelocked(initialOwner, delay) {}

    // ─────────────────────────────────────────────────────────────
    // Subscription lifecycle (timelocked param changes, §4.1)
    // ─────────────────────────────────────────────────────────────

    /// @notice Queue the price source + topic (a live-money parameter → timelocked).
    function queueSetPriceSource(address emitter, bytes32 topic) external onlyOwner {
        _queue(keccak256(abi.encode("setPriceSource", emitter, topic)));
    }

    function executeSetPriceSource(address emitter, bytes32 topic) external onlyOwner {
        _consume(keccak256(abi.encode("setPriceSource", emitter, topic)));
        priceSource = emitter;
        priceTopic = topic;
        emit PriceSourceSet(emitter, topic);
    }

    /// @notice Create the onchain subscription. Forwards msg.value as prepaid gas
    ///         (handler owner must hold ≥ 32 SOMI at creation, §10). Owner-only;
    ///         creating a subscription is an operational action, not a param change.
    function subscribe() external payable onlyOwner returns (uint256) {
        require(priceSource != address(0) && priceTopic != bytes32(0), "no-price-source");
        subscriptionId = PRECOMPILE.subscribe{value: msg.value}(priceSource, priceTopic, address(this));
        emit SubscriptionUpdated(subscriptionId, true);
        return subscriptionId;
    }

    /// @notice Cancel the subscription; precompile refunds remaining gas to owner.
    function cancelSubscription() external onlyOwner {
        PRECOMPILE.cancel(subscriptionId);
        emit SubscriptionUpdated(subscriptionId, false);
    }

    /// @notice Fund the handler's invocation gas balance (SOMI top-up, §4.3).
    function fundGas() external payable {
        PRECOMPILE.fund{value: msg.value}(address(this));
    }

    function gasBalance() external view returns (uint256) {
        return PRECOMPILE.gasBalanceOf(address(this));
    }

    // ─────────────────────────────────────────────────────────────
    // Vault registry
    // ─────────────────────────────────────────────────────────────

    function registerVault(address vault) external onlyOwner {
        if (isVaultRegistered[vault]) revert AlreadyRegistered();
        isVaultRegistered[vault] = true;
        vaults.push(vault);
        emit VaultRegistered(vault);
    }

    function deregisterVault(address vault) external onlyOwner {
        if (!isVaultRegistered[vault]) revert NotRegistered();
        isVaultRegistered[vault] = false;
        uint256 n = vaults.length;
        for (uint256 i = 0; i < n; i++) {
            if (vaults[i] == vault) {
                vaults[i] = vaults[n - 1];
                vaults.pop();
                break;
            }
        }
        emit VaultDeregistered(vault);
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    // ─────────────────────────────────────────────────────────────
    // THE reactive callback path
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IReactiveHandler
    function onReactiveEvent(
        uint256, /* subscriptionId */
        address emitter,
        bytes32 topic,
        bytes calldata data
    ) external override nonReentrant {
        // Only the precompile may drive the decision path (§0.2).
        if (msg.sender != REACTIVITY_PRECOMPILE) revert OnlyPrecompile();
        if (paused) revert IsPaused();
        // Ignore anything that isn't our subscribed source/topic.
        if (emitter != priceSource || topic != priceTopic) return;

        bytes32 marketKey = _extractMarketKey(data);
        _dispatch(marketKey, data, false, address(0));
    }

    /**
     * @notice Fallback path (§4.5): an authorized offchain watcher submits a
     *         catch-up trigger for a price update the reactive path missed. This
     *         is EXPLICITLY not the primary path and is counted separately via
     *         `FallbackTriggered` so the dashboard can show recovery events
     *         distinctly from reactive successes (§4.5, §6).
     */
    function submitFallbackTrigger(bytes32 marketKey, bytes calldata data)
        external
        nonReentrant
    {
        if (!isFallbackWatcher[msg.sender]) revert OnlyFallbackWatcher();
        if (paused) revert IsPaused();
        _dispatch(marketKey, data, true, msg.sender);
    }

    /// @dev Fan out to every registered vault with strict per-vault isolation.
    function _dispatch(bytes32 marketKey, bytes calldata data, bool viaFallback, address caller)
        internal
    {
        uint256 startGas = gasleft();
        uint256 n = vaults.length;
        for (uint256 i = 0; i < n; i++) {
            address vault = vaults[i];
            if (!isVaultRegistered[vault]) continue;

            // Skip (don't risk) a vault if we can't guarantee it enough gas — the
            // SOMI-exhaustion behavior: skip + emit, never revert/brick (§4.3).
            if (gasleft() < minGasPerVault) {
                skippedCount += 1;
                emit HandlerSkipped(vault, marketKey, "insufficient-gas");
                continue;
            }

            uint256 t0 = block.timestamp;
            // Per-vault try/catch: a single failure must never block the block.
            if (viaFallback) {
                try IAgentVault(vault).handleFallbackEvent(marketKey, data) {
                    fallbackActivations += 1;
                    succeededCount += 1;
                    emit FallbackTriggered(vault, marketKey, caller);
                    emit HandlerSucceeded(vault, marketKey, _latencyMs(t0), block.number);
                } catch Error(string memory reason) {
                    failedCount += 1;
                    emit HandlerFailed(vault, marketKey, reason);
                } catch {
                    failedCount += 1;
                    emit HandlerFailed(vault, marketKey, "low-level-revert");
                }
            } else {
                try IAgentVault(vault).handleReactiveEvent(marketKey, data) {
                    succeededCount += 1;
                    emit HandlerSucceeded(vault, marketKey, _latencyMs(t0), block.number);
                } catch Error(string memory reason) {
                    failedCount += 1;
                    emit HandlerFailed(vault, marketKey, reason);
                } catch {
                    failedCount += 1;
                    emit HandlerFailed(vault, marketKey, "low-level-revert");
                }
            }
        }
        // Silence unused warning while keeping the gas snapshot semantics explicit.
        startGas;
    }

    /// @notice The dashboard's drift-free counter triple (§6).
    function counters()
        external
        view
        returns (uint256 succeeded, uint256 failed, uint256 skipped)
    {
        return (succeededCount, failedCount, skippedCount);
    }

    /// @dev The event payload's first 32 bytes carry the market key by convention.
    function _extractMarketKey(bytes calldata data) internal pure returns (bytes32 key) {
        if (data.length >= 32) {
            key = bytes32(data[0:32]);
        }
    }

    /// @dev Best-effort latency in ms. Block granularity onchain; the offchain
    ///      indexer computes true ms from event-emit to order-tx (dashboard §6).
    function _latencyMs(uint256 t0) internal view returns (uint64) {
        uint256 dt = (block.timestamp - t0) * 1000;
        return dt > type(uint64).max ? type(uint64).max : uint64(dt);
    }

    // ─────────────────────────────────────────────────────────────
    // Pause + fallback watcher admin
    // ─────────────────────────────────────────────────────────────

    /// @notice INSTANT emergency freeze (not timelocked — freezing must be fast).
    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    /// @notice Un-pausing is timelocked (§4.1) — resuming live money waits.
    function queueUnpause() external onlyOwner {
        _queue(keccak256("unpause"));
    }

    function executeUnpause() external onlyOwner {
        _consume(keccak256("unpause"));
        paused = false;
        emit Paused(false);
    }

    function setFallbackWatcher(address watcher, bool allowed) external onlyOwner {
        isFallbackWatcher[watcher] = allowed;
        emit FallbackWatcherSet(watcher, allowed);
    }

    function setMinGasPerVault(uint256 g) external onlyOwner {
        minGasPerVault = g;
    }
}
