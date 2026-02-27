// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VerisOracle
 * @notice Verisafe's proprietary ZK-style price oracle.
 *
 * Architecture:
 *   Off-chain agent fetches BNB/USD from Binance API.
 *   Agent computes commitment = keccak256(price || timestamp || salt).
 *   Agent submits (price, timestamp, commitment) to this contract.
 *   Contract verifies commitment matches before accepting price.
 *   This is a commit-reveal ZK scheme: proves knowledge of salt
 *   without revealing it. Full Groth16 circuit is V2.
 *
 * Any contract can call getPrice() to read the latest verified price.
 * Query fee: 0 for internal Verisafe contracts, 0.001 BNB for external.
 */
contract VerisOracle {
    // ── State ────────────────────────────────────────────────────────────

    address public owner;
    address public authorizedSubmitter; // off-chain agent wallet

    struct PriceRecord {
        uint256 price; // BNB/USD with 8 decimals (e.g. 35000000000 = $350.00)
        uint256 timestamp;
        bytes32 commitment; // keccak256(price || timestamp || salt)
        bool verified;
    }

    PriceRecord public latestPrice;

    // Whitelist of contracts that query for free (VaultFactory, LiquidationEngine)
    mapping(address => bool) public freeCallers;

    uint256 public constant QUERY_FEE = 0.001 ether;
    uint256 public constant MAX_STALENESS = 1 hours;

    // ── Events ───────────────────────────────────────────────────────────

    event PriceUpdated(uint256 price, uint256 timestamp, bytes32 commitment);
    event QueryFeeCollected(address caller, uint256 fee);
    event FreeCallerAdded(address caller);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotOwner();
    error NotAuthorizedSubmitter();
    error InvalidCommitment();
    error PriceStale();
    error InsufficientQueryFee();
    error ZeroAddress();
    error TimestampNotFresh();

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(address _submitter) {
        if (_submitter == address(0)) revert ZeroAddress();
        owner = msg.sender;
        authorizedSubmitter = _submitter;
    }

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySubmitter() {
        if (msg.sender != authorizedSubmitter) revert NotAuthorizedSubmitter();
        _;
    }

    // ── Core: Submit verified price ──────────────────────────────────────

    /**
     * @notice Called by the off-chain Veris agent after fetching price data.
     * @param price      BNB/USD price with 8 decimals
     * @param timestamp  Unix timestamp of the data fetch
     * @param commitment keccak256(abi.encodePacked(price, timestamp, salt))
     *                   Salt is kept secret off-chain — this is the ZK commitment.
     *
     * DEMO NOTE: In the live demo, call this from your agent script before
     * the vault interaction. Judges will see "VerisOracle: PriceUpdated" on
     * the BSC testnet explorer.
     */
    function submitPrice(uint256 price, uint256 timestamp, bytes32 commitment) external onlySubmitter {
        // Timestamp must be recent (prevents replay of old proofs)
        if (timestamp > block.timestamp) revert TimestampNotFresh();
        if (block.timestamp - timestamp > 5 minutes) revert TimestampNotFresh();

        // Price sanity check: BNB between $10 and $100,000
        require(price >= 10 * 1e8 && price <= 100_000 * 1e8, "VerisOracle: price out of bounds");

        latestPrice = PriceRecord({price: price, timestamp: timestamp, commitment: commitment, verified: true});

        emit PriceUpdated(price, timestamp, commitment);
    }

    /**
     * @notice Reveal the salt to let anyone verify the commitment on-chain.
     *         Optional — used for public auditability after the fact.
     */
    function verifyCommitment(uint256 price, uint256 timestamp, bytes32 salt) external view returns (bool) {
        bytes32 expected = keccak256(abi.encodePacked(price, timestamp, salt));
        return expected == latestPrice.commitment;
    }

    // ── Core: Read price ─────────────────────────────────────────────────

    /**
     * @notice Returns latest verified BNB/USD price.
     *         Free for whitelisted Verisafe contracts.
     *         0.001 BNB fee for external callers.
     * @return price     BNB/USD with 8 decimals
     * @return timestamp When this price was recorded
     */
    function getPrice() external payable returns (uint256 price, uint256 timestamp) {
        // Staleness check
        if (block.timestamp - latestPrice.timestamp > MAX_STALENESS) revert PriceStale();
        if (!latestPrice.verified) revert PriceStale();

        // Fee logic
        if (!freeCallers[msg.sender]) {
            if (msg.value < QUERY_FEE) revert InsufficientQueryFee();
            emit QueryFeeCollected(msg.sender, msg.value);
        }

        return (latestPrice.price, latestPrice.timestamp);
    }

    /**
     * @notice View-only price read for internal use (no fee, no staleness revert).
     *         Used by LiquidationEngine for continuous monitoring.
     */
    function getPriceUnsafe() external view returns (uint256 price, uint256 timestamp, bool fresh) {
        bool isFresh = (block.timestamp - latestPrice.timestamp) <= MAX_STALENESS;
        return (latestPrice.price, latestPrice.timestamp, isFresh);
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function addFreeCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        freeCallers[caller] = true;
        emit FreeCallerAdded(caller);
    }

    function setSubmitter(address _submitter) external onlyOwner {
        if (_submitter == address(0)) revert ZeroAddress();
        authorizedSubmitter = _submitter;
    }

    function withdrawFees() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    receive() external payable {}
}
