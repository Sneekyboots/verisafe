#!/bin/bash
# Verisafe Backend Setup
# Run from ~/verisafe: bash setup-backend.sh

set -e
cd ~/verisafe

echo "── Installing dependencies ──"
npm install express cors ethers dotenv snarkjs @bnb-chain/greenfield-js-sdk 2>/dev/null || \
npm install express cors ethers dotenv snarkjs 2>/dev/null
echo "  ✅ npm packages installed"

echo ""
echo "── Creating directory structure ──"
mkdir -p backend/oracle
mkdir -p backend/greenfield
mkdir -p backend/zk
mkdir -p backend/greenfield-proofs
mkdir -p backend/test
mkdir -p agent/logs

echo "  ✅ Directories created"

echo ""
echo "── Copying new backend files ──"

# Copy price fetcher
if [ -f ~/verisafe-backend/backend/oracle/price-fetcher.js ]; then
  cp ~/verisafe-backend/backend/oracle/price-fetcher.js backend/oracle/price-fetcher.js
  echo "  ✅ price-fetcher.js"
fi

# Copy agent
if [ -f ~/verisafe-backend/backend/oracle/agent.js ]; then
  cp ~/verisafe-backend/backend/oracle/agent.js backend/oracle/agent.js
  echo "  ✅ oracle agent.js"
fi

# Copy greenfield client
if [ -f ~/verisafe-backend/backend/greenfield/client.js ]; then
  cp ~/verisafe-backend/backend/greenfield/client.js backend/greenfield/client.js
  echo "  ✅ greenfield client.js"
fi

# Copy server
if [ -f ~/verisafe-backend/backend/server.js ]; then
  cp ~/verisafe-backend/backend/server.js backend/server.js
  echo "  ✅ server.js"
fi

# Copy test suite
if [ -f ~/verisafe-backend/backend/test/run-tests.js ]; then
  cp ~/verisafe-backend/backend/test/run-tests.js backend/test/run-tests.js
  echo "  ✅ run-tests.js"
fi

echo ""
echo "── Checking .env ──"
source .env

check_var() {
  if [ -z "${!1}" ]; then
    echo "  ❌ $1 not set"
  else
    echo "  ✅ $1 = ${!1:0:20}..."
  fi
}

check_var PRIVATE_KEY
check_var VERIS_ORACLE
check_var VERIS_ORACLE_V2
check_var GROTH16_VERIFIER
check_var VAULT_FACTORY
check_var CREDIT_NFT
check_var LIQUIDATION_ENGINE
check_var BSC_TESTNET_RPC

echo ""
echo "── Checking circuit files ──"
WASM="circuits/build/price_commitment_js/price_commitment.wasm"
ZKEY="circuits/build/price_commitment_final.zkey"

[ -f "$WASM" ] && echo "  ✅ WASM exists" || echo "  ❌ WASM missing — run: bash circuits/setup.sh"
[ -f "$ZKEY" ] && echo "  ✅ ZKey exists" || echo "  ❌ ZKey missing — run: bash circuits/setup.sh"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Setup complete. Run commands:           ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Start server:                           ║"
echo "║    node backend/server.js                ║"
echo "║                                          ║"
echo "║  Submit ZK proof (single):               ║"
echo "║    node backend/oracle/agent.js          ║"
echo "║                                          ║"
echo "║  Continuous feed (every 60s):            ║"
echo "║    node backend/oracle/agent.js \\        ║"
echo "║      --continuous                        ║"
echo "║                                          ║"
echo "║  Simulate crash ($200):                  ║"
echo "║    node backend/oracle/agent.js \\        ║"
echo "║      --price 200                         ║"
echo "║                                          ║"
echo "║  Run all tests:                          ║"
echo "║    node backend/test/run-tests.js        ║"
echo "║                                          ║"
echo "║  Health check:                           ║"
echo "║    node backend/oracle/agent.js --health ║"
echo "╚══════════════════════════════════════════╝"
