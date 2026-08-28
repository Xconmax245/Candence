// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICadence
 * @notice Internal interfaces between Cadence's own contracts. Keeps the vault,
 *         risk engine, attestor, and subscriber loosely coupled.
 */

/// @notice Vault decision mode, immutable per instance (DIRECTIVE §4.2).
enum VaultMode {
    Reactive, // 0 — decision from onchain-readable state only
    AiAssisted // 1 — reads an attested signal as an extra weighted input, with
        // mandatory fallback to Reactive rules if no valid signal (§4.2)

}

/// @notice A vault the subscriber can dispatch reactive events to (§4.1, §4.2).
interface IAgentVault {
    /// @notice Called by the ReactivitySubscriber on a matched price event.
    ///         MUST be defensively coded; the subscriber try/catches it (§4.1).
    function handleReactiveEvent(bytes32 marketKey, bytes calldata data) external;

    /// @notice Called by the fallback watcher path (§4.5) — same handler, flagged.
    function handleFallbackEvent(bytes32 marketKey, bytes calldata data) external;

    function mode() external view returns (VaultMode);
}

/// @notice RiskEngine surface consumed by the vault (DIRECTIVE §4.4).
interface IRiskEngine {
    /// @notice Onchain, contract-enforced spend check for one owner-grant (§1.6, §4.2).
    ///         The registry does NOT enforce caps — this does.
    function checkSpend(address vault, address owner, uint256 amountBase)
        external
        view
        returns (bool ok, string memory reason);

    /// @notice Record a settled position's PnL. Void MUST be break-even (§1.2).
    function recordSettlement(address vault, int256 pnlBase, bool voided) external;

    /// @notice True if the vault is auto-paused (drawdown breaker) or globally paused.
    function isVaultPaused(address vault) external view returns (bool);

    /// @notice Position-size cap derived onchain from realized win-rate (§4.4).
    function positionCapBase(address vault) external view returns (uint256);

    /// @notice Register a vault so the engine tracks its drawdown state.
    function registerVault(address vault, uint256 drawdownThresholdBase, uint256 basePositionBase)
        external;
}

/// @notice CopilotAttestor surface read by AI-assisted vaults (DIRECTIVE §5).
interface ICopilotAttestor {
    /// @notice Latest attested signal for a window key. `graded` and `correct`
    ///         are meaningful only post-resolution (§5, §6).
    function latestSignal(bytes32 windowKey)
        external
        view
        returns (int32 scoreBps, uint16 confidenceBps, uint64 issuedAt, bool graded, bool correct);

    function signer() external view returns (address);
}

/// @notice StrategyNFT surface used by the factory (DIRECTIVE §4.2, §4.4).
interface IStrategyNFT {
    function mint(address to, address vault, string calldata uri)
        external
        returns (uint256 tokenId);
}
