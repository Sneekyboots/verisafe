// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CollateralVault.sol";
import "./VerisOracleV2.sol";
import "./CreditNFT.sol";

/**
 * @title VaultFactory
 * @notice Deploys an isolated CollateralVault for each user.
 *
 * Key design: NO shared pools. Ever.
 * Each vault is a separate deployed contract.
 * If one vault is somehow compromised, zero others are affected.
 *
 * This is the entry point for the demo:
 *   User calls deployVault() → their personal vault is created
 *   User calls vault.deposit() → BNB goes into THEIR contract
 *   User calls vault.requestCredit() → Veris prices it, NFT minted
 */
contract VaultFactory {
    // ── State ────────────────────────────────────────────────────────────

    address public owner;
    address public verisOracle;
    address public creditNFT;
    address public liquidationEngine;

    mapping(address => address) public vaultOf; // user → their vault
    address[] public allVaults; // for protocol-wide tracking

    bool public paused;

    // ── Events ───────────────────────────────────────────────────────────

    event VaultDeployed(address indexed user, address vault, uint256 vaultIndex);
    event LiquidationEngineSet(address engine);
    event FactoryPaused(bool paused);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotOwner();
    error VaultAlreadyExists();
    error FactoryIsPaused();
    error ZeroAddress();
    error LiquidationEngineNotSet();

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _verisOracle, address _creditNFT) {
        if (_verisOracle == address(0)) revert ZeroAddress();
        if (_creditNFT == address(0)) revert ZeroAddress();

        owner = msg.sender;
        verisOracle = _verisOracle;
        creditNFT = _creditNFT;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ── Core: Deploy Vault ────────────────────────────────────────────────

    /**
     * @notice Deploy a personal CollateralVault for msg.sender.
     *         One vault per address. Reverts if vault already exists.
     *
     * DEMO: This is the first transaction in the demo flow.
     * Watch for VaultDeployed event on BSC testnet explorer.
     * The vault address is the user's personal non-custodial bank.
     */
    function deployVault() external returns (address vault) {
        if (paused) revert FactoryIsPaused();
        if (vaultOf[msg.sender] != address(0)) revert VaultAlreadyExists();
        if (liquidationEngine == address(0)) revert LiquidationEngineNotSet();

        // Deploy fresh vault contract owned by msg.sender
        CollateralVault newVault =
            new CollateralVault(msg.sender, address(this), verisOracle, creditNFT, liquidationEngine);

        vault = address(newVault);
        vaultOf[msg.sender] = vault;
        allVaults.push(vault);

        // Whitelist the new vault in VerisOracle (free price queries)
        VerisOracleV2(payable(verisOracle)).addFreeCaller(vault);

        // Authorize vault to mint/revoke CreditNFTs
        CreditNFT(creditNFT).authorizeVault(vault);

        emit VaultDeployed(msg.sender, vault, allVaults.length - 1);

        return vault;
    }

    // ── View ─────────────────────────────────────────────────────────────

    function getVault(address user) external view returns (address) {
        return vaultOf[user];
    }

    function totalVaults() external view returns (uint256) {
        return allVaults.length;
    }

    function hasVault(address user) external view returns (bool) {
        return vaultOf[user] != address(0);
    }

    /**
     * @notice Get all vaults with their LTV status — used by LiquidationEngine
     *         to scan for vaults that need liquidation.
     */
    function getVaultsPaginated(uint256 start, uint256 end) external view returns (address[] memory) {
        if (end > allVaults.length) end = allVaults.length;
        address[] memory result = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = allVaults[i];
        }
        return result;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /**
     * @notice Set AFTER deploying LiquidationEngine (circular dependency).
     *         Step 6 in deployment order.
     */
    function setLiquidationEngine(address _engine) external onlyOwner {
        if (_engine == address(0)) revert ZeroAddress();
        liquidationEngine = _engine;
        emit LiquidationEngineSet(_engine);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit FactoryPaused(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
