/**
 * Veris Oracle Agent V2 — Real Groth16 ZK Proofs
 *
 * This replaces the commit-reveal oracle agent with genuine ZK proofs.
 * Uses snarkjs to generate Groth16 proofs from the price_commitment circuit.
 *
 * Run: node oracle-agent-zk.js                    (live BNB price)
 * Run: node oracle-agent-zk.js --price 200        (demo crash simulation)
 * Run: node oracle-agent-zk.js --legacy           (use old V1 oracle)
 */

"use strict";
require("dotenv").config();

const { ethers } = require("ethers");
const path       = require("path");
const fs         = require("fs");
const { generateProof, verifyProof, saveToGreenfield } = require("./backend/zk/groth16-prover");

// ── Config ────────────────────────────────────────────────────────────────

const RPC = process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com";
const PK  = process.env.PRIVATE_KEY;

// V1 oracle (current deployed contract — still works for legacy submit)
const ORACLE_V1_ADDRESS = process.env.VERIS_ORACLE;

// V2 oracle (deploy after running circuits/setup.sh + DeployVerifier.s.sol)
const ORACLE_V2_ADDRESS = process.env.VERIS_ORACLE_V2 || ORACLE_V1_ADDRESS;

// ABI includes both legacy submitPrice and new submitPriceWithProof
const ORACLE_ABI = [
    // Legacy (still available)
    "function submitPrice(uint256 price, uint256 timestamp, bytes32 commitment) external",
    "function latestPrice() external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bool verified)",

    // V2: Real ZK
    "function submitPriceWithProof(uint256 price, uint256 timestamp, bytes32 commitment, uint[2] calldata proof_a, uint[2][2] calldata proof_b, uint[2] calldata proof_c, bytes32 greenfieldRef) external",
    "function latestPrice() external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bool verified, bool zkVerified)",

    "event PriceUpdatedZK(uint256 price, uint256 timestamp, bytes32 commitment, bool zkVerified, bytes32 greenfieldRef)"
];

// ── Fetch price ───────────────────────────────────────────────────────────

async function fetchBNBPrice(override = null) {
    if (override) {
        console.log(`[Veris V2] Using override price: $${override}`);
        return parseFloat(override);
    }
    const r     = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
    const data  = await r.json();
    const price = parseFloat(data.price);
    console.log(`[Veris V2] Live BNB/USD from Binance: $${price}`);
    return price;
}

// ── Submit with real ZK proof ─────────────────────────────────────────────

async function submitWithZKProof(priceUSD) {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet   = new ethers.Wallet(PK, provider);
    const oracle   = new ethers.Contract(ORACLE_V2_ADDRESS, ORACLE_ABI, wallet);

    console.log(`[Veris V2] Submitter: ${wallet.address}`);

    // ── 1. Generate real Groth16 proof ────────────────────────────────
    console.log("\n[Veris V2] Step 1: Generating Groth16 ZK proof...");
    const proofData = await generateProof(priceUSD);

    // ── 2. Verify locally before submitting ───────────────────────────
    console.log("[Veris V2] Step 2: Verifying proof locally...");
    const valid = await verifyProof(proofData.proof, proofData.publicSignals);
    if (!valid) throw new Error("Local proof verification failed!");
    console.log("[Veris V2] ✅ Proof verified locally");

    // ── 3. Parse calldata for Solidity ────────────────────────────────
    const cd = proofData.calldata;
    if (!cd.a || !cd.b || !cd.c) {
        throw new Error("Failed to parse Groth16 calldata. Run --legacy mode.");
    }

// Parse proof directly from snarkjs proof object (bypasses calldata parser)
const proof_a = [
  BigInt(proofData.proof.pi_a[0]),
  BigInt(proofData.proof.pi_a[1])
];
const proof_b = [
  [BigInt(proofData.proof.pi_b[0][1]), BigInt(proofData.proof.pi_b[0][0])],
  [BigInt(proofData.proof.pi_b[1][1]), BigInt(proofData.proof.pi_b[1][0])]
];
const proof_c = [
  BigInt(proofData.proof.pi_c[0]),
  BigInt(proofData.proof.pi_c[1])
];
    // ── 4. Prepare Greenfield reference ───────────────────────────────
    // We'll set this AFTER we have the TX hash, but we need a placeholder
    // In production: upload to Greenfield first, then submit with the object ID
    const greenfieldRef = ethers.keccak256(
        ethers.toUtf8Bytes(`veris-proof-${proofData.timestamp}`)
    );

    // ── 5. Submit on-chain ─────────────────────────────────────────────
    console.log("[Veris V2] Step 3: Submitting proof on-chain...");
    const tx = await oracle.submitPriceWithProof(
        BigInt(proofData.price),
        BigInt(proofData.timestamp),
        proofData.commitment,
        proof_a,
        proof_b,
        proof_c,
        greenfieldRef
    );

    console.log(`[Veris V2] TX hash: ${tx.hash}`);
    console.log(`[Veris V2] Explorer: https://testnet.bscscan.com/tx/${tx.hash}`);

    await tx.wait();
    console.log("[Veris V2] ✅ Groth16 proof verified ON-CHAIN");
    console.log("[Veris V2] 🔐 ZK proof: agent proved knowledge of secret salt without revealing it");

    // ── 6. Save full proof + witness to Greenfield ────────────────────
    console.log("[Veris V2] Step 4: Anchoring proof to BNB Greenfield...");
    const gf = await saveToGreenfield(proofData, tx.hash);
    console.log(`[Veris V2] Greenfield: ${gf.filename}`);
    console.log(`[Veris V2] Protocol: ${gf.protocol}`);

    return {
        priceUSD,
        commitment: proofData.commitment,
        txHash:     tx.hash,
        zkVerified: true,
        greenfield: gf,
    };
}

// ── Submit legacy (no ZK, for V1 oracle) ─────────────────────────────────

async function submitLegacy(priceUSD) {
    const crypto   = require("crypto");
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet   = new ethers.Wallet(PK, provider);
    const oracle   = new ethers.Contract(ORACLE_V1_ADDRESS, ORACLE_ABI, wallet);

    const price8dec = BigInt(Math.round(priceUSD * 1e8));
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const salt      = "0x" + crypto.randomBytes(32).toString("hex");
    const packed    = ethers.solidityPacked(["uint256","uint256","bytes32"], [price8dec, timestamp, salt]);
    const commitment = ethers.keccak256(packed);

    const tx = await oracle.submitPrice(price8dec, timestamp, commitment);
    await tx.wait();

    console.log(`[Veris V1] TX: ${tx.hash}`);
    console.log(`[Veris V1] Price: $${priceUSD} (commit-reveal, no ZK)`);
    return { txHash: tx.hash, commitment, zkVerified: false };
}

// ── Entry point ───────────────────────────────────────────────────────────

async function main() {
    const args          = process.argv.slice(2);
    const useLegacy     = args.includes("--legacy");
    const priceIdx      = args.indexOf("--price");
    const overridePrice = priceIdx !== -1 ? args[priceIdx + 1] : null;

    console.log("\n🔮 VERIS ORACLE AGENT V2 — Real ZK Proofs\n");

    const priceUSD = await fetchBNBPrice(overridePrice);

    if (useLegacy) {
        console.log("⚠️  Legacy mode — using V1 commit-reveal (no ZK)");
        const result = await submitLegacy(priceUSD);
        console.log("\nResult:", result);
    } else {
        // Check if circuit files exist
        const wasmPath = path.join(__dirname, "circuits/build/price_commitment_js/price_commitment.wasm");
        if (!fs.existsSync(wasmPath)) {
            console.log("⚠️  Circuit files not found. Run setup first:");
            console.log("   bash circuits/setup.sh");
            console.log("\nFalling back to legacy mode for now...\n");
            const result = await submitLegacy(priceUSD);
            console.log("Result:", result);
            return;
        }

        const result = await submitWithZKProof(priceUSD);

        console.log("\n╔═══════════════════════════════════════╗");
        console.log("║  ✅ REAL ZK PROOF SUBMITTED ON-CHAIN  ║");
        console.log("╠═══════════════════════════════════════╣");
        console.log(`║  Price:      $${result.priceUSD}`);
        console.log(`║  Commitment: ${result.commitment.slice(0,20)}...`);
        console.log(`║  TX:         ${result.txHash.slice(0,20)}...`);
        console.log(`║  Greenfield: ${result.greenfield.filename}`);
        console.log(`║  Protocol:   Groth16 BN128`);
        console.log("╚═══════════════════════════════════════╝\n");
    }
}

main().catch(e => {
    console.error("Fatal:", e.message);
    process.exit(1);
});
