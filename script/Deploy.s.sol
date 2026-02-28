// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/VerisOracleV2.sol";
import "../src/CreditNFT.sol";
import "../src/VaultFactory.sol";
import "../src/LiquidationEngine.sol";

/**
 * @notice Deploy Verisafe contracts using the EXISTING VerisOracleV2.
 *
 * The Groth16Verifier + VerisOracleV2 are already deployed via DeployVerifier.s.sol.
 * This script deploys CreditNFT, VaultFactory, and LiquidationEngine,
 * then wires them to the existing V2 oracle.
 *
 * Run:
 *   source .env
 *   forge script script/Deploy.s.sol \
 *     --rpc-url bsc_testnet \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 */
contract DeployVerisafe is Script {
    // ── BSC Testnet Constants ─────────────────────────────────────────────
    address constant PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant USDT_TESTNET = 0x337610d27C682e347c9CD60bd4b3b107c9D34Def;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Use the existing deployed VerisOracleV2
        address verisOracleV2 = vm.envAddress("VERIS_ORACLE_V2");
        require(verisOracleV2 != address(0), "VERIS_ORACLE_V2 not set in .env");

        console.log("=== Verisafe Deployment (V2 Oracle) ===");
        console.log("Deployer:       ", deployer);
        console.log("Chain ID:       ", block.chainid);
        console.log("VerisOracleV2:  ", verisOracleV2);

        vm.startBroadcast(deployerKey);

        // ── Step 1: CreditNFT ─────────────────────────────────────────────
        CreditNFT creditNFT = new CreditNFT();
        console.log("CreditNFT:        ", address(creditNFT));

        // ── Step 2: VaultFactory (uses V2 oracle) ─────────────────────────
        VaultFactory factory = new VaultFactory(verisOracleV2, address(creditNFT));
        console.log("VaultFactory:     ", address(factory));

        // ── Step 3: LiquidationEngine (uses V2 oracle) ────────────────────
        LiquidationEngine liquidationEngine =
            new LiquidationEngine(verisOracleV2, address(factory), PANCAKE_ROUTER, WBNB, USDT_TESTNET);
        console.log("LiquidationEngine:", address(liquidationEngine));

        // ── Step 4: Wire up dependencies ──────────────────────────────────
        factory.setLiquidationEngine(address(liquidationEngine));
        console.log("Factory wired to LiquidationEngine");

        creditNFT.transferOwnership(address(factory));
        console.log("CreditNFT ownership -> VaultFactory");

        // Whitelist factory on V2 oracle for free price queries
        VerisOracleV2(payable(verisOracleV2)).addFreeCaller(address(factory));
        console.log("Factory whitelisted on VerisOracleV2");

        // Transfer oracle ownership to factory so deployVault() can whitelist each new vault
        VerisOracleV2(payable(verisOracleV2)).transferOwnership(address(factory));
        console.log("VerisOracleV2 ownership -> VaultFactory");

        vm.stopBroadcast();

        // ── Print summary ─────────────────────────────────────────────────
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("Save these addresses in your .env:\n");
        console.log("CREDIT_NFT=       ", address(creditNFT));
        console.log("VAULT_FACTORY=    ", address(factory));
        console.log("LIQUIDATION_ENGINE=", address(liquidationEngine));
        console.log("\nVerisOracleV2 (unchanged):", verisOracleV2);
        console.log("Next: frontend deploy -> connect wallet -> deployVault()");
    }
}

