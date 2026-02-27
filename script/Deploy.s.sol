// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/VerisOracle.sol";
import "../src/CreditNFT.sol";
import "../src/VaultFactory.sol";
import "../src/LiquidationEngine.sol";

/**
 * @notice Deploy all Verisafe contracts in correct order.
 *
 * BSC Testnet addresses (pre-filled):
 *   PancakeSwap V2 Router: 0xD99D1c33F9fC3444f8101754aBC46c52416550D1
 *   WBNB:                  0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd
 *   USDT (testnet):        0x337610d27C682e347c9CD60bd4b3b107c9D34Def
 *
 * Run:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url bsc_testnet \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify
 */
contract DeployVerisafe is Script {
    // ── BSC Testnet Constants ─────────────────────────────────────────────
    address constant PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant USDT_TESTNET = 0x337610d27C682e347c9CD60bd4b3b107c9D34Def;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Verisafe Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // ── Step 1: VerisOracle ───────────────────────────────────────────
        // Submitter = deployer for hackathon (in prod: separate hot wallet)
        VerisOracle verisOracle = new VerisOracle(deployer);
        console.log("VerisOracle:      ", address(verisOracle));

        // ── Step 2: CreditNFT (deploy on BSC testnet for hackathon) ───────
        // NOTE: For production, deploy CreditNFT on opBNB separately.
        // For hackathon demo, same chain is fine — judges see it work.
        CreditNFT creditNFT = new CreditNFT();
        console.log("CreditNFT:        ", address(creditNFT));

        // ── Step 3: VaultFactory ──────────────────────────────────────────
        VaultFactory factory = new VaultFactory(address(verisOracle), address(creditNFT));
        console.log("VaultFactory:     ", address(factory));

        // ── Step 4: LiquidationEngine ─────────────────────────────────────
        LiquidationEngine liquidationEngine =
            new LiquidationEngine(address(verisOracle), address(factory), PANCAKE_ROUTER, WBNB, USDT_TESTNET);
        console.log("LiquidationEngine:", address(liquidationEngine));

        // ── Step 5: Wire up dependencies ─────────────────────────────────
        // Tell factory where liquidation engine is
        factory.setLiquidationEngine(address(liquidationEngine));
        console.log("Factory wired to LiquidationEngine");

        // Transfer CreditNFT ownership to factory
        // (factory will authorize each vault on deployVault())
        creditNFT.transferOwnership(address(factory));
        console.log("CreditNFT ownership -> VaultFactory");

        // Add factory as free caller on oracle
        verisOracle.addFreeCaller(address(factory));
        console.log("Factory whitelisted on VerisOracle");

        vm.stopBroadcast();

        // ── Print summary ─────────────────────────────────────────────────
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("Save these addresses in your .env:\n");
        console.log("VERIS_ORACLE=     ", address(verisOracle));
        console.log("CREDIT_NFT=       ", address(creditNFT));
        console.log("VAULT_FACTORY=    ", address(factory));
        console.log("LIQUIDATION_ENGINE=", address(liquidationEngine));
        console.log("\nNext: fund VerisOracle submitter wallet with 0.1 tBNB");
        console.log("Next: call verisOracle.submitPrice() to seed first price");
        console.log("Next: frontend deploy -> connect wallet -> deployVault()");
    }
}
