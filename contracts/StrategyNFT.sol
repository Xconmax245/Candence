// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721Min} from "./base/ERC721Min.sol";
import {Ownable2Step} from "./base/Auth.sol";
import {IStrategyNFT} from "./interfaces/ICadence.sol";

/**
 * @title StrategyNFT
 * @notice ERC-721 representing a STRATEGY CONFIGURATION, not capital
 *         (DIRECTIVE §4.4). Minted to the strategy's ORIGINAL DEPLOYER — cloning
 *         grants operator access to the strategy, it does NOT mint a new NFT per
 *         clone (§4.2).
 *
 *         SOULBOUND-BY-DEFAULT, gated transfer (§4.4, §8): there is deliberately
 *         NO open/permissionless secondary market. Transfers are allowed only
 *         between allowlisted addresses via a curated flow controlled by Cadence
 *         during the hackathon window. Mint (from == address(0)) is always
 *         permitted; every other move requires both parties allowlisted.
 */
contract StrategyNFT is ERC721Min, Ownable2Step, IStrategyNFT {
    uint256 public nextId = 1;

    /// @dev Only the factory may mint (on vault deploy).
    address public minter;

    mapping(uint256 => address) public vaultOf;
    mapping(uint256 => string) internal _tokenURI;
    /// @dev Curated allowlist for the gated transfer flow (§4.4).
    mapping(address => bool) public isTransferAllowed;

    error OnlyMinter();
    error SoulboundGated();

    event StrategyMinted(uint256 indexed tokenId, address indexed to, address indexed vault);
    event TransferAllowlisted(address indexed account, bool allowed);
    event MinterSet(address indexed minter);

    constructor(address initialOwner)
        ERC721Min("Cadence Strategy", "CADSTR")
        Ownable2Step(initialOwner)
    {}

    function setMinter(address m) external onlyOwner {
        minter = m;
        emit MinterSet(m);
    }

    /// @inheritdoc IStrategyNFT
    function mint(address to, address vault, string calldata uri)
        external
        returns (uint256 tokenId)
    {
        if (msg.sender != minter && msg.sender != owner) revert OnlyMinter();
        tokenId = nextId++;
        vaultOf[tokenId] = vault;
        _tokenURI[tokenId] = uri;
        _mint(to, tokenId);
        emit StrategyMinted(tokenId, to, vault);
    }

    /// @notice Curate the transfer allowlist (§4.4). Owner-controlled.
    function setTransferAllowed(address account, bool allowed) external onlyOwner {
        isTransferAllowed[account] = allowed;
        emit TransferAllowlisted(account, allowed);
    }

    /**
     * @dev The soulbound gate. Mint is always allowed; any transfer between two
     *      real accounts requires BOTH allowlisted (curated flow only, §4.4, §8).
     */
    function _beforeTokenTransfer(address from, address to, uint256) internal view override {
        if (from == address(0)) return; // mint
        if (!(isTransferAllowed[from] && isTransferAllowed[to])) revert SoulboundGated();
    }

    function tokenURI(uint256 id) external view override returns (string memory) {
        ownerOf(id); // reverts if not minted
        return _tokenURI[id];
    }
}
