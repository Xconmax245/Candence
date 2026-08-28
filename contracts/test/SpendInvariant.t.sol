// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskEngine} from "../RiskEngine.sol";

/**
 * @title SpendInvariantTest
 * @notice The Phase 6 DoD invariant, as a PROVABLE property (not just a case):
 *
 *           "A handler cannot spend more than its authorized session-key limit."
 *
 *         We drive the RiskEngine's spend path with a fuzzing handler that makes
 *         random commit attempts, then assert — as a Foundry invariant across the
 *         whole random call sequence — that cumulative committed spend NEVER
 *         exceeds the configured cap for any (vault, owner). This is exactly the
 *         "failing-then-passing" enforcement the directive asks to be demonstrated
 *         rather than asserted in prose.
 */
contract SpendInvariantHandler is Test {
    RiskEngine public risk;
    address public vault;
    address public owner;
    uint256 public cap;

    uint256 public totalAttempted;
    uint256 public totalCommitted;

    constructor(RiskEngine _risk, address _vault, address _owner, uint256 _cap) {
        risk = _risk;
        vault = _vault;
        owner = _owner;
        cap = _cap;
    }

    /// @dev Fuzzed spend attempts, always routed as if from the vault (msg.sender).
    function tryCommit(uint256 amount) external {
        amount = bound(amount, 0, cap); // realistic per-order magnitudes
        totalAttempted += amount;
        // The vault is the caller in production; emulate that here.
        vm.prank(vault);
        try risk.commitSpend(owner, amount) {
            totalCommitted += amount;
        } catch {
            // Rejected (would exceed cap / paused) — correct behavior.
        }
    }
}

contract SpendInvariantTest is Test {
    RiskEngine internal risk;
    SpendInvariantHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal factory = makeAddr("factory");
    address internal vault = makeAddr("vault");
    address internal owner = makeAddr("owner");

    uint256 internal constant CAP = 1_000_000_000; // 1,000 USDso base
    uint256 internal constant BASE_POS = 1_000_000_000; // allow large per-call sizes

    function setUp() public {
        vm.startPrank(admin);
        risk = new RiskEngine(admin, 1 hours);
        risk.setFactory(factory);
        vm.stopPrank();

        // Register the vault + set a generous per-order position cap so the SPEND
        // cap (not the position cap) is the binding constraint under test.
        vm.startPrank(factory);
        risk.registerVault(vault, 10_000_000_000, BASE_POS);
        risk.setSpendCap(vault, owner, CAP);
        vm.stopPrank();

        handler = new SpendInvariantHandler(risk, vault, owner, CAP);
        targetContract(address(handler));
    }

    /// @notice INVARIANT: committed spend can never exceed the authorized cap.
    function invariant_SpendNeverExceedsCap() public view {
        assertLe(risk.spentBase(vault, owner), CAP, "spend exceeded authorized cap");
    }

    /// @notice INVARIANT: the RiskEngine's own ledger equals the handler's tally.
    function invariant_LedgerMatchesCommitted() public view {
        assertEq(risk.spentBase(vault, owner), handler.totalCommitted(), "ledger drift");
    }

    // ── The explicit failing-then-passing demonstration (§9 Phase 6) ──

    /// @notice A single over-cap commit MUST revert (the "failing" side).
    function test_OverCapCommitReverts() public {
        vm.prank(vault);
        vm.expectRevert(bytes("spend-cap"));
        risk.commitSpend(owner, CAP + 1);
    }

    /// @notice An at-cap commit succeeds; a subsequent 1-unit commit then reverts
    ///         (the "passing then failing at the boundary" demonstration).
    function test_ExactlyAtCapThenBlocked() public {
        vm.prank(vault);
        risk.commitSpend(owner, CAP);
        assertEq(risk.spentBase(vault, owner), CAP);

        vm.prank(vault);
        vm.expectRevert(bytes("spend-cap"));
        risk.commitSpend(owner, 1);
    }
}
