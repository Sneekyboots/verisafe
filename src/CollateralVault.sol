// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VerisOracle.sol";
import "./CreditNFT.sol";

/**
 * @title CollateralVault
 * @notice One vault per user. Deployed by VaultFactory.
 *
 * Key non-custodial guarantee:
 *   emergencyWithdraw() has ZERO conditions.
 *   The owner can ALWAYS pull their funds. No permission needed.
 *   Verisafe never touches user assets. Ever.
 *
 * Flow:
 *   1. User calls deposit() with BNB
 *   2. User calls requestCredit(amount) — oracle prices vault, NFT minted
 *   3. User repays via repay() — vault unlocks
 *   4. Default → LiquidationEngine calls liquidate()
 */
contract CollateralVault {

    // ── Constants ────────────────────────────────────────────────────────

    uint256 public constant LTV_RATIO           = 70;   // 70% max credit
    uint256 public constant LIQUIDATION_THRESHOLD = 85; // liquidate at 85% LTV
    uint256 public constant PRECISION            = 100;
    uint256 public constant BNB_DECIMALS         = 1e18;
    uint256 public constant PRICE_DECIMALS       = 1e8;  // Chainlink/Veris 8 decimals

    // ── State ────────────────────────────────────────────────────────────

    address public owner;           // The user this vault belongs to
    address public factory;         // VaultFactory that deployed this
    address public liquidationEngine;

    VerisOracle public verisOracle;
    CreditNFT   public creditNFT;

    uint256 public depositedBNB;    // in wei
    uint256 public creditLineUSD;   // in USD cents (e.g. 17500 = $175.00)
    uint256 public debtUSD;         // current outstanding debt in USD cents
    uint256 public creditNFTId;     // token ID of the active Credit NFT

    bool public creditActive;       // true when a credit line is open
    bool public locked;             // true when vault is locked (credit active)

    // ── Events ───────────────────────────────────────────────────────────

    event Deposited(address indexed owner, uint256 amount);
    event CreditRequested(address indexed owner, uint256 creditUSD, uint256 nftId);
    event Repaid(address indexed owner, uint256 amount);
    event VaultUnlocked(address indexed owner);
    event Liquidated(address indexed owner, uint256 bnbLiquidated);
    event EmergencyWithdraw(address indexed owner, uint256 amount);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotOwner();
    error NotFactory();
    error NotLiquidationEngine();
    error VaultLocked();
    error NoCreditActive();
    error CreditAlreadyActive();
    error InsufficientCollateral();
    error RequestExceedsCreditLine();
    error OraclePriceStale();
    error ZeroAmount();

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(
        address _owner,
        address _factory,
        address _verisOracle,
        address _creditNFT,
        address _liquidationEngine
    ) {
        owner             = _owner;
        factory           = _factory;
        verisOracle       = VerisOracle(payable(_verisOracle));
        creditNFT         = CreditNFT(_creditNFT);
        liquidationEngine = _liquidationEngine;
    }

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyLiquidationEngine() {
        if (msg.sender != liquidationEngine) revert NotLiquidationEngine();
        _;
    }

    modifier notLocked() {
        if (locked) revert VaultLocked();
        _;
    }

    // ── Core Functions ───────────────────────────────────────────────────

    /**
     * @notice Deposit BNB into your vault.
     *         Can top up at any time, even with credit active.
     */
    function deposit() external payable onlyOwner {
        if (msg.value == 0) revert ZeroAmount();
        depositedBNB += msg.value;
        emit Deposited(owner, msg.value);
    }

    /**
     * @notice Request a credit line against your deposited BNB.
     * @param requestedUSD Amount of credit requested in USD cents
     *
     * DEMO: After deposit, call this. Watch Veris oracle fire,
     * Credit NFT mint on opBNB. This is the money shot.
     */
    function requestCredit(uint256 requestedUSD) external onlyOwner {
        if (creditActive) revert CreditAlreadyActive();
        if (depositedBNB == 0) revert InsufficientCollateral();

        // Get verified price from Veris oracle (free — vault is whitelisted)
        (uint256 bnbPriceUSD, ) = verisOracle.getPrice{value: 0}();

        // Calculate collateral value in USD cents
        // depositedBNB (wei) * price (8 dec) / 1e18 / 1e8 * 100 (for cents)
        uint256 collateralValueCents = (depositedBNB * bnbPriceUSD * 100)
            / (BNB_DECIMALS * PRICE_DECIMALS);

        // Max credit at 70% LTV
        uint256 maxCreditCents = (collateralValueCents * LTV_RATIO) / PRECISION;

        if (requestedUSD > maxCreditCents) revert RequestExceedsCreditLine();

        creditLineUSD = maxCreditCents;
        debtUSD       = requestedUSD;
        creditActive  = true;
        locked        = true;

        // Mint Credit NFT on opBNB — represents the credit guarantee
        // Expiry: 30 days from now
        creditNFTId = creditNFT.mint(
            owner,
            maxCreditCents,
            requestedUSD,
            block.timestamp + 30 days,
            address(this)
        );

        emit CreditRequested(owner, maxCreditCents, creditNFTId);
    }

    /**
     * @notice Repay outstanding debt.
     *         Full repayment unlocks vault and allows withdrawal.
     */
    function repay() external payable onlyOwner {
        if (!creditActive) revert NoCreditActive();

        // Simple repayment: accepts BNB, converts at current oracle price
        // In production this would accept USDT. For demo BNB repayment works.
        (uint256 bnbPriceUSD, ) = verisOracle.getPrice{value: 0}();

        uint256 repaidCents = (msg.value * bnbPriceUSD * 100)
            / (BNB_DECIMALS * PRICE_DECIMALS);

        if (repaidCents >= debtUSD) {
            // Full repayment
            debtUSD      = 0;
            creditActive = false;
            locked       = false;

            // Revoke Credit NFT
            creditNFT.revoke(creditNFTId);

            emit VaultUnlocked(owner);
        } else {
            // Partial repayment
            debtUSD -= repaidCents;
        }

        emit Repaid(owner, msg.value);
    }

    /**
     * @notice EMERGENCY WITHDRAW — no conditions, no permission needed.
     *         Owner can ALWAYS get their BNB back.
     *         This is the non-custodial guarantee.
     *
     *         NOTE: Calling this while credit is active means you're
     *         defaulting. LiquidationEngine will handle the debt.
     *         But your right to exit is unconditional.
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();

        depositedBNB = 0;
        creditActive = false;
        locked       = false;

        if (creditActive) {
            creditNFT.revoke(creditNFTId);
        }

        payable(owner).transfer(balance);
        emit EmergencyWithdraw(owner, balance);
    }

    /**
     * @notice Called by LiquidationEngine when LTV breaches threshold.
     *         Transfers all BNB to LiquidationEngine for swap + settlement.
     */
    function liquidate() external onlyLiquidationEngine {
        uint256 balance = address(this).balance;

        depositedBNB = 0;
        creditActive = false;
        locked       = false;
        debtUSD      = 0;

        creditNFT.revoke(creditNFTId);

        // Send all BNB to LiquidationEngine — it handles the swap
        payable(liquidationEngine).transfer(balance);

        emit Liquidated(owner, balance);
    }

    // ── View Functions ───────────────────────────────────────────────────

    /**
     * @notice Returns current LTV ratio (0-100+).
     *         Used by LiquidationEngine to check if liquidation is needed.
     */
    function getCurrentLTV() external view returns (uint256 ltv, bool shouldLiquidate) {
        if (debtUSD == 0 || depositedBNB == 0) return (0, false);

        (uint256 bnbPriceUSD, , bool fresh) = verisOracle.getPriceUnsafe();
        if (!fresh) return (0, false);

        uint256 collateralValueCents = (depositedBNB * bnbPriceUSD * 100)
            / (BNB_DECIMALS * PRICE_DECIMALS);

        if (collateralValueCents == 0) return (100, true);

        ltv = (debtUSD * PRECISION) / collateralValueCents;
        shouldLiquidate = ltv >= LIQUIDATION_THRESHOLD;
    }

    function getVaultInfo() external view returns (
        uint256 _depositedBNB,
        uint256 _creditLineUSD,
        uint256 _debtUSD,
        bool    _creditActive,
        bool    _locked,
        uint256 _nftId
    ) {
        return (depositedBNB, creditLineUSD, debtUSD, creditActive, locked, creditNFTId);
    }

    receive() external payable {
        depositedBNB += msg.value;
    }
}
