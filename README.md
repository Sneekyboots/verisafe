# Verisafe Protocol

Non-custodial smart collateral for Web3 credit & BNPL on BNB Chain.
Powered by Veris — our proprietary ZK event oracle.

---

## Contracts

| Contract | Chain | Purpose |
|----------|-------|---------|
| `VerisOracle.sol` | BSC | ZK-style price oracle |
| `CreditNFT.sol` | opBNB | Portable credit guarantee NFT |
| `VaultFactory.sol` | BSC | Deploys one vault per user |
| `CollateralVault.sol` | BSC | Per-user isolated collateral vault |
| `LiquidationEngine.sol` | BSC | Auto-liquidation via PancakeSwap |

---

## Setup

```bash
# 1. Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# 2. Clone and install
git clone <your-repo>
cd verisafe
forge install OpenZeppelin/openzeppelin-contracts

# 3. Environment
cp .env.example .env
# Fill in PRIVATE_KEY and BSCSCAN_API_KEY

# 4. Get testnet BNB
# BSC:   https://testnet.bnbchain.org/faucet-smart
# opBNB: https://opbnb-testnet-faucet.bnbchain.org
```

---

## Deploy

```bash
# Compile
forge build

# Deploy to BSC testnet
forge script script/Deploy.s.sol \
  --rpc-url bsc_testnet \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify

# Copy the printed addresses into your .env
```

---

## Oracle Agent

```bash
cd agent
npm install ethers

# Submit live BNB price to oracle
node oracle-agent.js

# DEMO: Simulate price crash to $210 (triggers liquidation)
node oracle-agent.js --price 210

# Continuous mode (60s updates)
node oracle-agent.js --continuous
```

---

## Demo Flow (60 seconds)

```
1. forge script Deploy.s.sol --broadcast          # Deploy all contracts
2. node agent/oracle-agent.js                     # Seed price ($350)
3. [Frontend] Connect wallet → deployVault()      # Personal vault deployed
4. [Frontend] deposit(0.5 BNB)                    # BNB into vault
5. [Frontend] requestCredit(12250)                # $122.50 credit → NFT minted
6. [Frontend] creditNFT.spend(tokenId, 6000, merchant)  # Pay $60
7. node agent/oracle-agent.js --price 210         # Simulate crash
8. [Frontend] liquidationEngine.checkAndLiquidate(vault) # Auto-liquidation fires
```

---

## Key Numbers

- LTV ratio: **70%** (credit issued at 70% of collateral value)
- Liquidation threshold: **85%** (auto-liquidates when LTV hits 85%)
- BNB deposit: 0.5 BNB @ $350 = $175 collateral → $122.50 max credit
- Liquidation trigger: BNB drops to ~$294 (35% crash)
- opBNB gas per merchant check: **$0.001**
- Protocol fee: **0.5%** of credit lines + **0.1%** of liquidations

---

## Architecture

```
User Wallet
    │
    │ deployVault()
    ▼
VaultFactory ──deploys──► CollateralVault (per user)
                                │
                    deposit()   │   requestCredit()
                                │
                          VerisOracle
                          (ZK price proof)
                                │
                          CreditNFT minted
                          (on opBNB, $0.001)
                                │
                    [IF DEFAULT]│
                                ▼
                        LiquidationEngine
                        PancakeSwap swap
                        Lender made whole
                        Surplus → user
```
