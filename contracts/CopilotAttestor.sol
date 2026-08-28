// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "./base/Auth.sol";
import {ICopilotAttestor} from "./interfaces/ICadence.sol";

/**
 * @title CopilotAttestor
 * @notice Onchain registry of the AI copilot's attested directional signals and,
 *         post-resolution, their correctness (DIRECTIVE §5, §6). This is what an
 *         AI-assisted AgentVault reads, and it is the source for the dashboard's
 *         "signal quality" metric (§5, §6).
 *
 *         Design constraints from the directive:
 *           - The AI NEVER gates order timing (§0.3, §5). This contract only
 *             STORES an offered signal; the vault decides whether to use it and
 *             always has a Reactive fallback.
 *           - Signals are attested: posted with an EIP-191 signature from a
 *             dedicated signer key (distinct from any trading key, §5). The
 *             contract verifies the signature so a vault can trust `latestSignal`.
 *           - Correctness is graded after the window resolves — publishing signal
 *             quality is a first-class dashboard metric, not a footnote (§5).
 */
contract CopilotAttestor is Ownable2Step, ICopilotAttestor {
    struct Signal {
        int32 scoreBps; // [-10000, 10000]
        uint16 confidenceBps; // [0, 10000]
        uint64 issuedAt;
        bool graded;
        bool correct;
        bool exists;
    }

    /// @dev windowKey => latest attested signal.
    mapping(bytes32 => Signal) internal _signals;

    /// @dev The dedicated attestation signer (§5). Not a trading key.
    address public signer;

    error BadSignature();
    error UnknownWindow();
    error AlreadyGraded();

    event SignalPosted(bytes32 indexed windowKey, int32 scoreBps, uint16 confidenceBps, uint64 issuedAt);
    event SignalGraded(bytes32 indexed windowKey, bool correct);
    event SignerSet(address indexed signer);

    constructor(address initialOwner, address _signer) Ownable2Step(initialOwner) {
        signer = _signer;
        emit SignerSet(_signer);
    }

    function setSigner(address s) external onlyOwner {
        signer = s;
        emit SignerSet(s);
    }

    /**
     * @notice Post an attested signal for a window. The digest MUST match the
     *         offchain `attest.ts` construction exactly (CADENCE_SIGNAL_V1). The
     *         signature is verified against `signer`; anyone may relay it.
     */
    function postSignal(
        bytes32 windowKey,
        int32 scoreBps,
        uint16 confidenceBps,
        uint64 issuedAt,
        bytes calldata signature
    ) external {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "CADENCE_SIGNAL_V1", windowKey, scoreBps, confidenceBps, issuedAt
            )
        );
        bytes32 ethSigned =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (_recover(ethSigned, signature) != signer) revert BadSignature();

        _signals[windowKey] = Signal({
            scoreBps: scoreBps,
            confidenceBps: confidenceBps,
            issuedAt: issuedAt,
            graded: false,
            correct: false,
            exists: true
        });
        emit SignalPosted(windowKey, scoreBps, confidenceBps, issuedAt);
    }

    /// @notice Grade a signal after its window resolves (§5, §6). Owner/oracle role.
    function gradeSignal(bytes32 windowKey, bool correct) external onlyOwner {
        Signal storage s = _signals[windowKey];
        if (!s.exists) revert UnknownWindow();
        if (s.graded) revert AlreadyGraded();
        s.graded = true;
        s.correct = correct;
        emit SignalGraded(windowKey, correct);
    }

    /// @inheritdoc ICopilotAttestor
    function latestSignal(bytes32 windowKey)
        external
        view
        returns (int32 scoreBps, uint16 confidenceBps, uint64 issuedAt, bool graded, bool correct)
    {
        Signal storage s = _signals[windowKey];
        return (s.scoreBps, s.confidenceBps, s.issuedAt, s.graded, s.correct);
    }

    // ── EIP-191 recovery (no external lib) ──
    function _recover(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        // Reject high-s malleability.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert BadSignature();
        }
        address a = ecrecover(hash, v, r, s);
        if (a == address(0)) revert BadSignature();
        return a;
    }
}
