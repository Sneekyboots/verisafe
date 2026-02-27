#!/bin/bash
# ============================================================
# Veris ZK Setup Script
# Compiles circuit, runs trusted setup, exports Solidity verifier
# Run from your ~/verisafe directory: bash circuits/setup.sh
# Takes about 5-10 minutes on first run.
# ============================================================

set -e  # Exit on any error

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   VERIS ZK SETUP — Groth16 Circuit   ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Step 1: Install tools ────────────────────────────────────────────────
echo "📦 Step 1: Installing circom + snarkjs + circomlib..."

npm install --save-dev snarkjs circomlib 2>/dev/null | tail -3

# Install circom binary if not present
if ! command -v circom &> /dev/null; then
    echo "   Installing circom compiler..."
    if command -v cargo &> /dev/null; then
        cargo install circom
    else
        # Fallback: download prebuilt binary
        curl -L https://github.com/iden3/circom/releases/download/v2.1.8/circom-linux-amd64 -o circom
        chmod +x circom
        sudo mv circom /usr/local/bin/circom || mv circom ./circom
        export PATH="$PATH:$(pwd)"
    fi
fi

echo "   circom: $(circom --version 2>/dev/null || echo 'installed')"
echo "   snarkjs: $(npx snarkjs --version 2>/dev/null | head -1)"
echo ""

# ── Step 2: Compile circuit ──────────────────────────────────────────────
echo "🔧 Step 2: Compiling price_commitment.circom..."

mkdir -p circuits/build

circom circuits/price_commitment.circom --r1cs --wasm --sym -o circuits/build --O2

echo "   ✅ Compiled: price_commitment.r1cs"
echo "   ✅ Compiled: price_commitment_js/price_commitment.wasm"

# Show constraint count
npx snarkjs r1cs info circuits/build/price_commitment.r1cs 2>/dev/null | grep -E "Constraints|Wires" || true
echo ""

# ── Step 3: Powers of Tau (trusted setup phase 1) ────────────────────────
echo "🔑 Step 3: Powers of Tau ceremony (phase 1)..."
echo "   Using pot12 — supports up to 4096 constraints (Poseidon needs ~240)"

if [ ! -f "circuits/build/pot12_final.ptau" ]; then
    # Download pre-existing ptau from Hermez (trusted, used in production)
    echo "   Downloading trusted powers of tau from Hermez ceremony..."
    echo "   (This avoids running a local ceremony — same security for demo)"
    
    curl -L "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau" \
         -o circuits/build/pot12_final.ptau \
         --progress-bar
    
    echo "   ✅ pot12_final.ptau downloaded (Hermez trusted ceremony)"
else
    echo "   ✅ pot12_final.ptau already exists, skipping download"
fi
echo ""

# ── Step 4: Circuit-specific setup (phase 2) ─────────────────────────────
echo "🔐 Step 4: Circuit-specific setup (Groth16 phase 2)..."

npx snarkjs groth16 setup \
    circuits/build/price_commitment.r1cs \
    circuits/build/pot12_final.ptau \
    circuits/build/price_commitment_0000.zkey

echo "   Contributing entropy..."
echo "verisafe-oracle-entropy-$(date +%s)-hackathon" | \
npx snarkjs zkey contribute \
    circuits/build/price_commitment_0000.zkey \
    circuits/build/price_commitment_final.zkey \
    --name="Verisafe Oracle Setup" \
    -v 2>/dev/null

echo "   ✅ price_commitment_final.zkey"
echo ""

# ── Step 5: Export verification key ──────────────────────────────────────
echo "📋 Step 5: Exporting verification key..."

npx snarkjs zkey export verificationkey \
    circuits/build/price_commitment_final.zkey \
    circuits/build/verification_key.json

echo "   ✅ verification_key.json"
echo ""

# ── Step 6: Export Solidity verifier ─────────────────────────────────────
echo "📝 Step 6: Generating Solidity verifier contract..."

npx snarkjs zkey export solidityverifier \
    circuits/build/price_commitment_final.zkey \
    src/Groth16Verifier.sol

echo "   ✅ src/Groth16Verifier.sol"
echo ""

# ── Step 7: Test with sample proof ───────────────────────────────────────
echo "🧪 Step 7: Testing proof generation..."

# Sample input
cat > circuits/build/test_input.json << 'JSON'
{
  "price": "61651000000",
  "timestamp": "1772197104",
  "salt": "12345678901234567890123456789012345678901234567890"
}
JSON

# Generate witness
node circuits/build/price_commitment_js/generate_witness.js \
    circuits/build/price_commitment_js/price_commitment.wasm \
    circuits/build/test_input.json \
    circuits/build/test_witness.wtns

# Generate proof
npx snarkjs groth16 prove \
    circuits/build/price_commitment_final.zkey \
    circuits/build/test_witness.wtns \
    circuits/build/test_proof.json \
    circuits/build/test_public.json

# Verify proof
npx snarkjs groth16 verify \
    circuits/build/verification_key.json \
    circuits/build/test_public.json \
    circuits/build/test_proof.json

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅  SETUP COMPLETE — ZK CIRCUIT READY               ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  circuits/build/price_commitment_final.zkey          ║"
echo "║  circuits/build/price_commitment_js/*.wasm           ║"
echo "║  circuits/build/verification_key.json                ║"
echo "║  src/Groth16Verifier.sol  ← deploy this next        ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Next step:"
echo "  node backend/zk/groth16-prover.js --test"
echo "  Then: forge build && forge script script/DeployVerifier.s.sol --broadcast"
echo ""
