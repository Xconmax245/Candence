// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskEngine} from "../RiskEngine.sol";
import {ReactivitySubscriber} from "../ReactivitySubscriber.sol";
import {AgentVault} from "../AgentVault.sol";
import {AgentVaultFactory} from "../AgentVaultFactory.sol";
import {StrategyNFT} from "../StrategyNFT.sol";
import {CopilotAttestor} from "../CopilotAttestor.sol";
import {VaultMode} from "../interfaces/ICandence.sol";
import {MarketStatus} from "../interfaces/IDreamDEX.sol";
import {MockBinaryMarketsModule, MockBinarySettlement} from "./mocks/MockDreamDEX.sol";

/**
 * @title CandenceBaseTest
 * @notice Shared deployment + helpers for the Candence Foundry suite. Wires the
 *         full system exactly as `deploy.ts` does, against the mock venue.
 */
contract CandenceBaseTest is Test {
    // Actors
    address internal admin = makeAddr("admin");
    address internal deployer = makeAddr("deployer"); // house-agent operator wallet
    address internal cloner = makeAddr("cloner"); // a copy-trading user

    // System
    RiskEngine internal risk;
    StrategyNFT internal nft;
    CopilotAttestor internal attestor;
    AgentVaultFactory internal factory;
    ReactivitySubscriber internal subscriber;
    MockBinaryMarketsModule internal module;
    MockBinarySettlement internal settlement;

    // Constants
    uint256 internal constant SCALE = 1_000_000; // testnet 6-decimals
    uint256 internal constant TICK = 10_000; // 0.01
    uint256 internal constant LOT = 1_000_000; // 1.0 contract
    uint256 internal constant BASE_POS = 5_000_000; // 5 contracts baseline
    uint256 internal constant DRAWDOWN = 50_000_000; // 50 USDso drawdown cap
    uint256 internal constant TIMELOCK = 1 hours;

    // A canonical live market
    bytes32 internal constant MK = keccak256("BTC-UP-15m-0001");
    bytes32 internal signerPk = keccak256("signer");
    address internal signer;

    // Reactive wiring
    address internal constant PRECOMPILE = address(0x0100);
    address internal priceSrc = makeAddr("priceSource");
    bytes32 internal constant TOPIC = keccak256("MarkPriceUpdated(bytes32,uint256)");
    address internal watcher = makeAddr("fallbackWatcher");


    function _deploySystem() internal {
        vm.startPrank(admin);
        risk = new RiskEngine(admin, TIMELOCK);
        nft = new StrategyNFT(admin);
        signer = vm.addr(uint256(signerPk));
        attestor = new CopilotAttestor(admin, signer);
        module = new MockBinaryMarketsModule();
        settlement = new MockBinarySettlement();

        factory = new AgentVaultFactory(
            admin,
            address(risk),
            address(nft),
            address(module),
            address(settlement),
            SCALE,
            DRAWDOWN,
            BASE_POS
        );

        subscriber = new ReactivitySubscriber(admin, TIMELOCK);

        // Wire permissions
        risk.setFactory(address(factory));
        nft.setMinter(address(factory));
        factory.setSubscriber(address(subscriber));
        vm.stopPrank();
    }

    /// @dev Configure a canonical Trading market with full headroom on a 15m window.
    function _configureMarket(bytes32 marketId, uint256 strike) internal {
        module.setStatus(marketId, MarketStatus.Trading);
        module.setInfo(
            marketId,
            keccak256("BTC"),
            900, // 15m
            strike,
            uint64(block.timestamp),
            uint64(block.timestamp + 900),
            keccak256("venue")
        );
        module.setGrid(TICK, SCALE, LOT);
    }

    /// @dev Deploy a vault via the factory as `who`, returning the vault address.
    function _deployVault(address who, VaultMode mode, uint256 cap) internal returns (AgentVault v) {
        vm.prank(who);
        (address vault,) = factory.deployVault("Agent", mode, cap, "ipfs://strategy");
        v = AgentVault(payable(vault));
        // Register the vault with the subscriber so it can be triggered.
        vm.prank(admin);
        subscriber.registerVault(vault);
    }

    /// @dev Price event payload: [markPrice][rawMidpoint]. (Simulates the raw data
    ///      from MarkPriceUpdated which lacks marketId).
    function _rawPriceData(uint256 markPrice, uint256 rawMidpoint)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(markPrice, rawMidpoint);
    }

    /// @dev Re-encoded payload exactly as the handler delivers to the vault.
    function _vaultPayload(bytes32 marketId, uint256 markPrice, uint256 strike)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(marketId, markPrice, strike);
    }

    /// @dev Configure the subscriber's watched price source + topic (timelocked).
    function _wirePriceSource() internal {
        vm.startPrank(admin);
        subscriber.queueSetPriceSource(priceSrc, TOPIC);
        vm.warp(block.timestamp + TIMELOCK + 1);
        subscriber.executeSetPriceSource(priceSrc, TOPIC);
        subscriber.setFallbackWatcher(watcher, true);
        vm.stopPrank();
    }

    /// @dev Fire a reactive event exactly as the 0x0100 precompile would.
    function _fireReactive(uint256 markPrice, uint256 strike) internal {
        // Option A: watcher pushes the live market before the event
        bytes32 assetId = keccak256("BTC");
        uint32 interval = subscriber.trackedIntervalSec();
        vm.prank(watcher);
        subscriber.setCurrentMarket(assetId, interval, MK);

        bytes32[] memory topics = new bytes32[](2);
        topics[0] = TOPIC;
        topics[1] = assetId;

        bytes memory data = _rawPriceData(markPrice, strike);

        vm.prank(PRECOMPILE);
        subscriber.onEvent(priceSrc, topics, data);
    }

    /// @dev Fire the fallback path as an authorized watcher (§4.5).
    function _fireFallback(bytes32 marketKey, uint256 markPrice, uint256 strike) internal {
        vm.prank(watcher);
        subscriber.submitFallbackTrigger(marketKey, _vaultPayload(marketKey, markPrice, strike));
    }
}
