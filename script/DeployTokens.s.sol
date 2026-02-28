// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockERC20.sol";

contract DeployTokens is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        MockERC20 mockUSDC = new MockERC20("Verisafe USD", "vUSDC");
        MockERC20 mockBNB = new MockERC20("Verisafe vBNB", "vBNB");

        console.log("Mock USDC Address:", address(mockUSDC));
        console.log("Mock vBNB Address:", address(mockBNB));

        vm.stopBroadcast();
    }
}
