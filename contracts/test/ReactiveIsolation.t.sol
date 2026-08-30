// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CandenceBaseTest} from "./Base.t.sol";
import {AgentVault} from "../AgentVault.sol";
import {ReactivitySubscriber} from "../ReactivitySubscriber.sol";
import {VaultMode, IAgentVault} from "../interfaces/ICandence.sol";

/// @dev A vault that always reverts on trigger — stands in for a crashed/buggy
///      or SOMI-starved handler to prove per-trigger isolation (§4.1).
contract RevertingVault is IAgentVault {
    function handleReactiveEvent(bytes32, bytes calldata) external pure override {
        revert("boom");
    }

    function handleFallbackEvent(bytes32, bytes calldata) external pure override {
        revert("boom");
    }

    function mode() external pure override returns (VaultMode) {
        return VaultMode.Reactive;
    }
}

/**
 * @title ReactiveIsolationTest
 * @notice Proves the §4.1 guarantee: the subscriber's per-trigger try/catch means
 *         one failing vault emits HandlerFailed but NEVER blocks the healthy vaults
 *         dispatched in the same block. This is a core reliability claim behind the
 *         dashboard (§6) and the fallback story (§4.5).
 */
contract ReactiveIsolationTest is CandenceBaseTest {
    function setUp() public {
        _deploySystem();
        // Wire the price source FIRST (it advances time past the timelock), then
        // configure the market so its window still has full headroom afterwards.
        _wirePriceSource();
        _configureMarket(MK, 60_000 * SCALE);
    }


    function test_OneFailingVaultDoesNotBlockOthers() public {
        // Healthy real vault.
        _deployVault(deployer, VaultMode.Reactive, 100_000_000);

        // Broken vault registered alongside it.
        RevertingVault bad = new RevertingVault();
        vm.prank(admin);
        subscriber.registerVault(address(bad));

        // Deliver via the real precompile path. Must not revert as a whole.
        _fireReactive(61_000 * SCALE, 60_000 * SCALE);

        // The healthy vault still placed its order despite the sibling reverting.
        assertEq(module.placedCount(), 1, "healthy vault unaffected by failing sibling");

        // Telemetry: at least one HandlerFailed and one HandlerSucceeded recorded.
        (uint256 succeeded, uint256 failed,) = subscriber.counters();
        assertGe(succeeded, 1, "one success recorded");
        assertGe(failed, 1, "one failure recorded");
    }

    function test_FallbackTriggerCountedSeparately() public {
        _deployVault(deployer, VaultMode.Reactive, 100_000_000);

        // A fallback-path dispatch increments the distinct fallback counter (§4.5).
        _fireFallback(MK, 61_000 * SCALE, 60_000 * SCALE);

        assertEq(subscriber.fallbackActivations(), 1, "fallback counted separately");
        assertEq(module.placedCount(), 1, "fallback still results in a real order");
    }

    function test_UnauthorizedFallbackRejected() public {
        vm.prank(cloner); // not an authorized watcher
        vm.expectRevert(ReactivitySubscriber.OnlyFallbackWatcher.selector);
        subscriber.submitFallbackTrigger(MK, _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE));
    }

    function test_PausedSubscriberRejectsReactive() public {
        _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        vm.prank(admin);
        subscriber.pause();

        bytes32[] memory topics = new bytes32[](2);
        topics[0] = TOPIC;
        topics[1] = keccak256("BTC");

        vm.prank(PRECOMPILE);
        vm.expectRevert(ReactivitySubscriber.IsPaused.selector);
        subscriber.onEvent(priceSrc, topics, _rawPriceData(61_000 * SCALE, 60_000 * SCALE));
    }
}
