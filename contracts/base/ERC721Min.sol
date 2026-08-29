// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ERC721Min
 * @notice A compact, correct ERC-721 base (metadata + safeTransfer receiver
 *         check) so Candence builds with zero external installs. Transfer hooks
 *         are exposed so StrategyNFT can enforce its soulbound-by-default gate
 *         (DIRECTIVE §4.4) without pulling a full library.
 */
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

abstract contract ERC721Min {
    string public name;
    string public symbol;

    mapping(uint256 => address) internal _ownerOf;
    mapping(address => uint256) internal _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error NotMinted();
    error ZeroAddress();
    error NotAuthorized();
    error WrongFrom();
    error UnsafeRecipient();
    error AlreadyMinted();

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function ownerOf(uint256 id) public view returns (address owner) {
        if ((owner = _ownerOf[id]) == address(0)) revert NotMinted();
    }

    function balanceOf(address owner) public view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balanceOf[owner];
    }

    function approve(address spender, uint256 id) external {
        address owner = _ownerOf[id];
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) revert NotAuthorized();
        getApproved[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public virtual {
        if (from != _ownerOf[id]) revert WrongFrom();
        if (to == address(0)) revert ZeroAddress();
        if (
            msg.sender != from && !isApprovedForAll[from][msg.sender]
                && msg.sender != getApproved[id]
        ) revert NotAuthorized();

        _beforeTokenTransfer(from, to, id);

        unchecked {
            _balanceOf[from]--;
            _balanceOf[to]++;
        }
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, data);
    }

    function supportsInterface(bytes4 interfaceId) public pure virtual returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x80ac58cd // ERC721
            || interfaceId == 0x5b5e139f; // ERC721Metadata
    }

    function _mint(address to, uint256 id) internal {
        if (to == address(0)) revert ZeroAddress();
        if (_ownerOf[id] != address(0)) revert AlreadyMinted();
        _beforeTokenTransfer(address(0), to, id);
        unchecked {
            _balanceOf[to]++;
        }
        _ownerOf[id] = to;
        emit Transfer(address(0), to, id);
    }

    function _checkReceiver(address from, address to, uint256 id, bytes memory data) internal {
        if (to.code.length != 0) {
            if (
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, data)
                    != IERC721Receiver.onERC721Received.selector
            ) revert UnsafeRecipient();
        }
    }

    /// @dev Override to gate transfers (StrategyNFT soulbound logic, §4.4).
    function _beforeTokenTransfer(address from, address to, uint256 id) internal virtual {}

    function tokenURI(uint256 id) external view virtual returns (string memory);
}
