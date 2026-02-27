// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CreditNFT
 * @notice ERC-721 portable credit guarantee. Deployed on opBNB ($0.001 gas).
 *
 * Each NFT represents an active credit line backed by a CollateralVault on BSC.
 * Merchants call verify() before accepting payment — one RPC call, $0.001 gas.
 *
 * Deliberately minimal ERC-721 (no OZ dependency for hackathon speed).
 * Add OZ ERC721 inheritance for production.
 */
contract CreditNFT {
    // ── ERC-721 Minimal Implementation ───────────────────────────────────

    string public name = "Verisafe Credit";
    string public symbol = "VSCREDIT";

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    // ── Credit Data ───────────────────────────────────────────────────────

    struct CreditLine {
        uint256 creditLimitCents; // max credit in USD cents
        uint256 usedCents; // amount currently used
        uint256 expiry; // unix timestamp
        address vault; // backing CollateralVault on BSC
        bool active;
    }

    mapping(uint256 => CreditLine) public creditLines;

    // ── Access Control ────────────────────────────────────────────────────

    address public owner;
    mapping(address => bool) public authorizedVaults; // CollateralVaults on BSC

    uint256 private _tokenIdCounter;

    // ── Events ───────────────────────────────────────────────────────────

    event CreditMinted(address indexed to, uint256 tokenId, uint256 limitCents, address vault);
    event CreditSpent(uint256 indexed tokenId, uint256 amountCents, address merchant);
    event CreditRevoked(uint256 indexed tokenId);
    event VaultAuthorized(address vault);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotOwner();
    error NotAuthorizedVault();
    error TokenDoesNotExist();
    error CreditExpired();
    error CreditInactive();
    error InsufficientCredit();
    error NotTokenOwner();

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorizedVault() {
        if (!authorizedVaults[msg.sender]) revert NotAuthorizedVault();
        _;
    }

    // ── Core: Mint ────────────────────────────────────────────────────────

    /**
     * @notice Mint a Credit NFT. Called by CollateralVault on BSC via bridge
     *         or directly in demo (same deployer address for hackathon).
     * @param to              The user receiving credit
     * @param limitCents      Total credit limit in USD cents
     * @param initialUsed     Amount immediately used (first purchase)
     * @param expiry          Unix timestamp when credit expires
     * @param vault           Address of the backing CollateralVault
     * @return tokenId        The minted NFT token ID
     */
    function mint(address to, uint256 limitCents, uint256 initialUsed, uint256 expiry, address vault)
        external
        onlyAuthorizedVault
        returns (uint256 tokenId)
    {
        _tokenIdCounter++;
        tokenId = _tokenIdCounter;

        ownerOf[tokenId] = to;
        balanceOf[to] += 1;

        creditLines[tokenId] = CreditLine({
            creditLimitCents: limitCents, usedCents: initialUsed, expiry: expiry, vault: vault, active: true
        });

        emit Transfer(address(0), to, tokenId);
        emit CreditMinted(to, tokenId, limitCents, vault);

        return tokenId;
    }

    // ── Core: Spend ───────────────────────────────────────────────────────

    /**
     * @notice Merchant calls this to deduct from credit line.
     *         In production: called via Binance Pay merchant SDK.
     *         In demo: call directly to show installment scheduling.
     */
    function spend(uint256 tokenId, uint256 amountCents, address merchant) external {
        if (ownerOf[tokenId] == address(0)) revert TokenDoesNotExist();
        if (msg.sender != ownerOf[tokenId]) revert NotTokenOwner();

        CreditLine storage cl = creditLines[tokenId];
        if (!cl.active) revert CreditInactive();
        if (block.timestamp > cl.expiry) revert CreditExpired();
        if (cl.usedCents + amountCents > cl.creditLimitCents) revert InsufficientCredit();

        cl.usedCents += amountCents;

        emit CreditSpent(tokenId, amountCents, merchant);
    }

    // ── Core: Revoke ──────────────────────────────────────────────────────

    /**
     * @notice Revoke credit on repayment or liquidation.
     *         Called by CollateralVault (authorized).
     */
    function revoke(uint256 tokenId) external onlyAuthorizedVault {
        if (ownerOf[tokenId] == address(0)) revert TokenDoesNotExist();

        address tokenOwner = ownerOf[tokenId];
        creditLines[tokenId].active = false;

        balanceOf[tokenOwner] -= 1;
        ownerOf[tokenId] = address(0);

        emit Transfer(tokenOwner, address(0), tokenId);
        emit CreditRevoked(tokenId);
    }

    // ── Core: Verify (Merchant Check) ─────────────────────────────────────

    /**
     * @notice Merchant calls this before accepting payment.
     *         Returns available credit and whether it's valid.
     *         $0.001 gas on opBNB. This is the merchant UX.
     */
    function verify(uint256 tokenId)
        external
        view
        returns (bool valid, uint256 availableCents, uint256 limitCents, uint256 expiry, address vault)
    {
        if (ownerOf[tokenId] == address(0)) return (false, 0, 0, 0, address(0));

        CreditLine storage cl = creditLines[tokenId];

        valid = cl.active && block.timestamp <= cl.expiry;
        availableCents = cl.creditLimitCents - cl.usedCents;
        limitCents = cl.creditLimitCents;
        expiry = cl.expiry;
        vault = cl.vault;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function authorizeVault(address vault) external onlyOwner {
        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ── ERC-721 Transfer (minimal) ────────────────────────────────────────

    function transferFrom(address from, address to, uint256 tokenId) external {
        if (ownerOf[tokenId] != from) revert NotTokenOwner();
        if (msg.sender != from && getApproved[tokenId] != msg.sender && !isApprovedForAll[from][msg.sender]) {
            revert NotTokenOwner();
        }

        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        ownerOf[tokenId] = to;
        delete getApproved[tokenId];

        emit Transfer(from, to, tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        if (ownerOf[tokenId] != msg.sender) revert NotTokenOwner();
        getApproved[tokenId] = to;
        emit Approval(msg.sender, to, tokenId);
    }
}
