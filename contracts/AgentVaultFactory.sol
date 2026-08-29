// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "./base/Auth.sol";
import {AgentVault} from "./AgentVault.sol";
import {VaultMode, IRiskEngine, IStrategyNFT} from "./interfaces/ICandence.sol";

/**
 * @title AgentVaultFactory
 * @notice Deploys AgentVaults, registers them with the RiskEngine + subscriber,
 *         mints the StrategyNFT to the ORIGINAL DEPLOYER, and wires the
 *         "Clone this agent" onboarding (DIRECTIVE §4.2).
 *
 *         Cloning (§4.2): a user grants the vault operator rights on THEIR OWN
 *         wallet (via the DreamDEX OperatorPermissionsRegistry, done client-side
 *         following operator-setup.ts, §1.6) and then calls `cloneAgent`, which
 *         registers them as an owner of the vault with an onchain spend cap in
 *         the RiskEngine. Cloning does NOT mint a new NFT — the NFT represents the
 *         strategy config and stays with the deployer (§4.2).
 */
contract AgentVaultFactory is Ownable2Step {
    IRiskEngine public immutable riskEngine;
    IStrategyNFT public immutable strategyNft;
    address public immutable module;
    address public immutable settlement;
    address public subscriber;
    uint256 public immutable priceScale;

    /// @dev Default drawdown threshold + base position for new vaults (base units).
    uint256 public defaultDrawdownThresholdBase;
    uint256 public defaultBasePositionBase;

    address[] public allVaults;
    mapping(address => address[]) public vaultsOf; // deployer => vaults
    mapping(address => uint256) public strategyIdOf; // vault => tokenId
    uint256 public nextStrategyId = 1;

    event VaultDeployed(address indexed vault, uint256 indexed strategyId, address indexed deployer, uint8 mode);
    event StrategyCloned(address indexed vault, address indexed newOwner, uint256 spendCapBase);
    event SubscriberSet(address indexed subscriber);
    event DefaultsSet(uint256 drawdownThresholdBase, uint256 basePositionBase);

    constructor(
        address initialOwner,
        address _riskEngine,
        address _strategyNft,
        address _module,
        address _settlement,
        uint256 _priceScale,
        uint256 _defaultDrawdownThresholdBase,
        uint256 _defaultBasePositionBase
    ) Ownable2Step(initialOwner) {
        riskEngine = IRiskEngine(_riskEngine);
        strategyNft = IStrategyNFT(_strategyNft);
        module = _module;
        settlement = _settlement;
        priceScale = _priceScale;
        defaultDrawdownThresholdBase = _defaultDrawdownThresholdBase;
        defaultBasePositionBase = _defaultBasePositionBase;
    }

    function setSubscriber(address _subscriber) external onlyOwner {
        subscriber = _subscriber;
        emit SubscriberSet(_subscriber);
    }

    function setDefaults(uint256 drawdownThresholdBase, uint256 basePositionBase) external onlyOwner {
        defaultDrawdownThresholdBase = drawdownThresholdBase;
        defaultBasePositionBase = basePositionBase;
        emit DefaultsSet(drawdownThresholdBase, basePositionBase);
    }

    /**
     * @notice Deploy a new strategy vault. Mints the StrategyNFT to the deployer.
     *         The deployer is auto-granted as an owner with `deployerSpendCapBase`
     *         (house agents trade the deployer's own wallet).
     */
    function deployVault(
        string calldata name,
        VaultMode mode,
        uint256 deployerSpendCapBase,
        string calldata tokenUri
    ) external returns (address vault, uint256 strategyId) {
        strategyId = nextStrategyId++;

        AgentVault v = new AgentVault(
            msg.sender,
            strategyId,
            mode,
            module,
            settlement,
            address(riskEngine),
            priceScale,
            defaultBasePositionBase
        );
        vault = address(v);

        // Register with RiskEngine (onchain drawdown + sizing state, §4.4).
        riskEngine.registerVault(vault, defaultDrawdownThresholdBase, defaultBasePositionBase);

        // Wire the subscriber so only it can trigger the vault (§4.1, §4.2).
        v.setSubscriber(subscriber);

        // Auto-grant the deployer as an owner + set their spend cap onchain.
        v.grantOwner(msg.sender, deployerSpendCapBase);
        _setCap(vault, msg.sender, deployerSpendCapBase);

        // Mint the strategy-config NFT to the deployer (NOT per clone, §4.2).
        strategyNft.mint(msg.sender, vault, tokenUri);

        allVaults.push(vault);
        vaultsOf[msg.sender].push(vault);
        strategyIdOf[vault] = strategyId;

        emit VaultDeployed(vault, strategyId, msg.sender, uint8(mode));
    }

    /**
     * @notice Clone an existing agent: register `msg.sender` as an owner of the
     *         vault with an onchain spend cap. The caller MUST have already
     *         granted the vault operator rights on their own wallet client-side
     *         (§1.6). No NFT is minted (§4.2). Non-custodial throughout — the
     *         vault only ever places orders under the caller's own wallet.
     */
    function cloneAgent(address vault, uint256 spendCapBase) external {
        require(strategyIdOf[vault] != 0, "unknown-vault");
        AgentVault(payable(vault)).grantOwner(msg.sender, spendCapBase);
        _setCap(vault, msg.sender, spendCapBase);
        emit StrategyCloned(vault, msg.sender, spendCapBase);
    }

    function _setCap(address vault, address owner_, uint256 capBase) internal {
        // RiskEngine.setSpendCap is gated to factory-or-owner (§4.4).
        IRiskEngineCaps(address(riskEngine)).setSpendCap(vault, owner_, capBase);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function getAllVaults() external view returns (address[] memory) {
        return allVaults;
    }
}

/// @dev Minimal view of RiskEngine.setSpendCap.
interface IRiskEngineCaps {
    function setSpendCap(address vault, address owner_, uint256 capBase) external;
}
