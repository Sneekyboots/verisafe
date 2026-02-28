// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VerisOracleV2.sol";
import "./CollateralVault.sol";
import "./VaultFactory.sol";

interface IPancakeRouter {
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract LiquidationEngine {
    address public owner;
    VerisOracleV2 public verisOracle;
    VaultFactory public vaultFactory;
    address public pancakeRouter;
    address public WBNB;
    address public USDT;

    uint256 public constant LIQUIDATION_FEE_BPS = 10;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SLIPPAGE_BPS = 200;

    struct LiquidationRecord {
        address vault;
        address vaultOwner;
        uint256 bnbLiquidated;
        uint256 usdtRecovered;
        uint256 timestamp;
    }

    LiquidationRecord[] public liquidationHistory;
    mapping(address => bool) public authorizedKeepers;

    event LiquidationExecuted(
        address indexed vault, address indexed vaultOwner, uint256 bnbAmount, uint256 usdtRecovered, uint256 protocolFee
    );
    event KeeperAuthorized(address keeper);
    event SurplusReturned(address indexed vaultOwner, uint256 amount);

    error NotOwner();
    error NotKeeper();
    error LiquidationNotNeeded();
    error ZeroAddress();
    error VaultNotFromFactory();

    constructor(address _verisOracle, address _vaultFactory, address _pancakeRouter, address _wbnb, address _usdt) {
        if (_verisOracle == address(0)) revert ZeroAddress();
        if (_vaultFactory == address(0)) revert ZeroAddress();
        if (_pancakeRouter == address(0)) revert ZeroAddress();
        owner = msg.sender;
        verisOracle = VerisOracleV2(payable(_verisOracle));
        vaultFactory = VaultFactory(_vaultFactory);
        pancakeRouter = _pancakeRouter;
        WBNB = _wbnb;
        USDT = _usdt;
        authorizedKeepers[msg.sender] = true;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyKeeper() {
        if (!authorizedKeepers[msg.sender] && msg.sender != owner) revert NotKeeper();
        _;
    }

    function checkAndLiquidate(address vaultAddress) external onlyKeeper {
        CollateralVault vault = CollateralVault(payable(vaultAddress));
        address vaultOwner = vault.owner();
        if (vaultFactory.vaultOf(vaultOwner) != vaultAddress) revert VaultNotFromFactory();
        (, bool shouldLiquidate) = vault.getCurrentLTV();
        if (!shouldLiquidate) revert LiquidationNotNeeded();
        (,, uint256 debtUSD,,,) = vault.getVaultInfo();
        uint256 bnbBefore = address(this).balance;
        vault.liquidate();
        uint256 bnbReceived = address(this).balance - bnbBefore;
        uint256 usdtReceived = _swapBNBtoUSDT(bnbReceived, debtUSD, vaultOwner);
        uint256 fee = (usdtReceived * LIQUIDATION_FEE_BPS) / BPS_DENOMINATOR;
        liquidationHistory.push(
            LiquidationRecord({
                vault: vaultAddress,
                vaultOwner: vaultOwner,
                bnbLiquidated: bnbReceived,
                usdtRecovered: usdtReceived,
                timestamp: block.timestamp
            })
        );
        emit LiquidationExecuted(vaultAddress, vaultOwner, bnbReceived, usdtReceived, fee);
    }

    function sweepLiquidations(uint256 start, uint256 end) external onlyKeeper {
        address[] memory vaults = vaultFactory.getVaultsPaginated(start, end);
        for (uint256 i = 0; i < vaults.length; i++) {
            try CollateralVault(payable(vaults[i])).getCurrentLTV() returns (uint256, bool shouldLiquidate) {
                if (shouldLiquidate) try this.checkAndLiquidate(vaults[i]) {} catch {}
            } catch {}
        }
    }

    function _swapBNBtoUSDT(uint256 bnbAmount, uint256 debtUSDCents, address vaultOwner)
        internal
        returns (uint256 usdtReceived)
    {
        uint256 minUSDTOut = (debtUSDCents * 1e6 / 100);
        minUSDTOut = (minUSDTOut * (BPS_DENOMINATOR - SLIPPAGE_BPS)) / BPS_DENOMINATOR;
        address[] memory path = new address[](2);
        path[0] = WBNB;
        path[1] = USDT;
        uint256[] memory swapAmounts = IPancakeRouter(pancakeRouter).swapExactETHForTokens{value: bnbAmount}(
            minUSDTOut, path, address(this), block.timestamp + 15 minutes
        );
        usdtReceived = swapAmounts[1];
        uint256 debtInUSDT = debtUSDCents * 1e6 / 100;
        if (debtInUSDT > usdtReceived) debtInUSDT = usdtReceived;
        IERC20(USDT).transfer(owner, debtInUSDT);
        uint256 surplus = usdtReceived - debtInUSDT;
        if (surplus > 0) IERC20(USDT).transfer(vaultOwner, surplus);
        emit SurplusReturned(vaultOwner, surplus);
    }

    function authorizeKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = true;
        emit KeeperAuthorized(keeper);
    }

    function withdrawProtocolFees() external onlyOwner {
        uint256 b = IERC20(USDT).balanceOf(address(this));
        if (b > 0) IERC20(USDT).transfer(owner, b);
        if (address(this).balance > 0) payable(owner).transfer(address(this).balance);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function getLiquidationCount() external view returns (uint256) {
        return liquidationHistory.length;
    }
    receive() external payable {}
}
