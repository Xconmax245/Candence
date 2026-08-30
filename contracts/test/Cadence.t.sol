// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CandenceBaseTest} from "./Base.t.sol";
import {AgentVault} from "../AgentVault.sol";
import {ReactivitySubscriber} from "../ReactivitySubscriber.sol";
import {StrategyNFT} from "../StrategyNFT.sol";
import {CopilotAttestor} from "../CopilotAttestor.sol";
import {VaultMode} from "../interfaces/ICandence.sol";
import {MarketStatus} from "../interfaces/IDreamDEX.sol";

/**
 * @title CandenceTest
 * @notice Unit coverage for the Phase 6 DoD: reactive cycle, operator/non-custody
 *         model, spend-cap enforcement, circuit breaker, claim/void logic,
 *         soulbound gating, timelock, and per-vault reactive isolation.
 */
contract CandenceTest is CandenceBaseTest {
    function setUp() public {
        _deploySystem();
        _configureMarket(MK, 60_000 * SCALE);
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 1: full reactive cycle — order lands UNDER THE OWNER (§1.6)
    // ─────────────────────────────────────────────────────────────

    function test_ReactiveCycle_PlacesOrderUnderOwnerWallet() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);

        // Mark price above strike → lean Up (outcome 0).
        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);

        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);

        assertEq(module.placedCount(), 1, "one order placed");
        (address owner, bytes32 mid, uint256 price, uint256 size) = module.lastPlaced();
        // The fill is attributed to the OWNER wallet, never the vault (§1.6).
        assertEq(owner, deployer, "order placed under owner");
        assertEq(mid, MK, "correct market");
        // Price is tick-aligned and a valid probability (§1.7 #3).
        assertEq(price % TICK, 0, "price on tick grid");
        assertTrue(price > 0 && price < SCALE, "price is a valid probability");
        // Size is lot-quantized (§1.7 #6).
        assertEq(size % LOT, 0, "size on lot grid");
    }

    function test_GateOnLiveStatus_SkipsWhenNotTrading() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        module.setStatus(MK, MarketStatus.Locked); // §1.2 — not writable

        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);
        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);

        assertEq(module.placedCount(), 0, "no order when not Trading");
    }

    function test_SkipsWhenInsufficientHeadroom() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        // Window expires in 10s on a 900s interval → below the 15% buffer (§1.7 #9).
        module.setInfo(
            MK, keccak256("BTC"), 900, 60_000 * SCALE, uint64(block.timestamp), uint64(block.timestamp + 10), keccak256("venue")
        );
        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);
        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);
        assertEq(module.placedCount(), 0, "no order without headroom");
    }

    function test_OnlySubscriberCanTrigger() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);
        vm.expectRevert(AgentVault.NotSubscriber.selector);
        v.handleReactiveEvent(MK, data);
    }

    // ─────────────────────────────────────────────────────────────
    // Spend cap enforcement (the §4.4 / Phase 6 property, unit form)
    // ─────────────────────────────────────────────────────────────

    function test_SpendCap_BlocksOnceExceeded() public {
        // Cap only allows a couple of orders' notional.
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 1_100_000);
        // Each order notional = price(~0.55)*size(5) ≈ 2.75 USDso = 2_750_000 base.
        // Cap 1.1 USDso < one order → the very first order is blocked by the cap.
        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);
        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);
        assertEq(module.placedCount(), 0, "cap blocks first oversized order");

        // Track spent stays zero because no commit happened.
        assertEq(risk.spentBase(address(v), deployer), 0, "no spend committed");
    }

    function test_SpendCap_AccumulatesAndStops() public {
        // Generous cap that permits exactly 2 orders, not a 3rd.
        // notional per order = 0.55 * 5 = 2.75 USDso → 2_750_000 base.
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 6_000_000);
        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);

        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);
        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);
        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data); // this one should be capped

        assertEq(module.placedCount(), 2, "cap permits 2, blocks the 3rd");
        assertLe(risk.spentBase(address(v), deployer), 6_000_000, "spend never exceeds cap");
    }

    // ─────────────────────────────────────────────────────────────
    // Circuit breaker (§4.4)
    // ─────────────────────────────────────────────────────────────

    function test_CircuitBreaker_TripsAndPausesVault() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);

        // Simulate realized losses crossing the drawdown threshold via the vault.
        vm.startPrank(address(v));
        risk.recordSettlement(address(v), -30_000_000, false);
        assertFalse(risk.isVaultPaused(address(v)), "not yet tripped");
        risk.recordSettlement(address(v), -25_000_000, false); // cumulative -55 > 50 cap
        vm.stopPrank();

        assertTrue(risk.isVaultPaused(address(v)), "breaker tripped");

        // A trigger now reverts inside the vault (caught upstream as HandlerFailed).
        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);
        vm.prank(address(subscriber));
        vm.expectRevert(AgentVault.VaultPaused.selector);
        v.handleReactiveEvent(MK, data);
    }

    function test_Void_IsBreakEven_NotLoss() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        vm.startPrank(address(v));
        // Many voids must never trip the breaker (they are break-even, §1.2).
        for (uint256 i = 0; i < 20; i++) {
            risk.recordSettlement(address(v), 0, true);
        }
        vm.stopPrank();
        assertFalse(risk.isVaultPaused(address(v)), "voids never trip breaker");
        (uint256 w, uint256 l) = risk.winLoss(address(v));
        assertEq(w, 0, "voids not counted as win");
        assertEq(l, 0, "voids not counted as loss");
    }

    // ─────────────────────────────────────────────────────────────
    // Claim sweeper (§1.3, §4.6)
    // ─────────────────────────────────────────────────────────────

    function test_SweepClaims_RedeemsWinnerToOwner() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        module.setStatus(MK, MarketStatus.Resolved);
        settlement.setClaimable(deployer, MK, 0, 5_000_000); // 5 USDso winning Up

        bytes32[] memory keys = new bytes32[](1);
        uint8[] memory outs = new uint8[](1);
        keys[0] = MK;
        outs[0] = 0;

        v.sweepClaims(deployer, keys, outs);
        assertEq(settlement.paidTo(deployer), 5_000_000, "winnings paid to owner");
        assertEq(settlement.claimable(deployer, MK, 0), 0, "claim cleared");
    }

    function test_SweepClaims_VoidRedeemsBothSides() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        module.setStatus(MK, MarketStatus.Voided);
        settlement.setClaimable(deployer, MK, 0, 500_000); // 0.5 each side (§1.3)
        settlement.setClaimable(deployer, MK, 1, 500_000);

        bytes32[] memory keys = new bytes32[](1);
        uint8[] memory outs = new uint8[](1);
        keys[0] = MK;
        outs[0] = 0;

        v.sweepClaims(deployer, keys, outs);
        assertEq(settlement.paidTo(deployer), 1_000_000, "both sides redeemed on void");
    }

    // ─────────────────────────────────────────────────────────────
    // StrategyNFT soulbound gating (§4.4, §8)
    // ─────────────────────────────────────────────────────────────

    function test_StrategyNFT_MintedToDeployer_NotPerClone() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        assertEq(nft.ownerOf(1), deployer, "NFT minted to deployer");

        // Cloning does NOT mint a new NFT (§4.2).
        vm.prank(cloner);
        factory.cloneAgent(address(v), 10_000_000);
        assertEq(nft.nextId(), 2, "no new NFT minted on clone");
    }

    function test_StrategyNFT_TransferBlockedUnlessAllowlisted() public {
        _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        vm.prank(deployer);
        vm.expectRevert(StrategyNFT.SoulboundGated.selector);
        nft.transferFrom(deployer, cloner, 1);

        // Curated flow: allowlist both parties, then transfer succeeds (§4.4).
        vm.startPrank(admin);
        nft.setTransferAllowed(deployer, true);
        nft.setTransferAllowed(cloner, true);
        vm.stopPrank();
        vm.prank(deployer);
        nft.transferFrom(deployer, cloner, 1);
        assertEq(nft.ownerOf(1), cloner, "curated transfer allowed");
    }

    // ─────────────────────────────────────────────────────────────
    // Non-custodial clone: order lands under the CLONER's wallet (§1.6, §4.2)
    // ─────────────────────────────────────────────────────────────

    function test_Clone_OrdersPlacedUnderClonerWallet() public {
        AgentVault v = _deployVault(deployer, VaultMode.Reactive, 100_000_000);
        vm.prank(cloner);
        factory.cloneAgent(address(v), 100_000_000);

        bytes memory data = _vaultPayload(MK, 61_000 * SCALE, 60_000 * SCALE);
        vm.prank(address(subscriber));
        v.handleReactiveEvent(MK, data);

        // Two owners now: deployer + cloner → two orders, each under its own wallet.
        assertEq(module.placedCount(), 2, "one order per granted owner");
    }

    // ─────────────────────────────────────────────────────────────
    // Timelock (§4.1)
    // ─────────────────────────────────────────────────────────────

    function test_Timelock_UnpauseWaitsButFreezeIsInstant() public {
        vm.prank(admin);
        subscriber.pause();
        assertTrue(subscriber.paused(), "freeze is instant");

        vm.prank(admin);
        subscriber.queueUnpause();
        // Immediate execute must revert — delay not elapsed.
        vm.prank(admin);
        vm.expectRevert();
        subscriber.executeUnpause();

        // After the delay, it succeeds.
        vm.warp(block.timestamp + TIMELOCK + 1);
        vm.prank(admin);
        subscriber.executeUnpause();
        assertFalse(subscriber.paused(), "unpause after timelock");
    }
}
