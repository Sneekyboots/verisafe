/**
 * Veris Groth16 Prover
 *
 * Generates REAL zero-knowledge proofs for price submissions.
 * Replaces the keccak256 commit-reveal with a Groth16 proof.
 *
 * Proof proves: "I know a secret salt such that
 *                Poseidon(price, timestamp, salt) = commitment"
 *
 * Usage:
 *   node backend/zk/groth16-prover.js --test      (test with sample data)
 *   node backend/zk/groth16-prover.js --price 616.51  (generate real proof)
 *
 * Import in oracle-agent or server:
 *   const { generateProof, verifyProof } = require('./backend/zk/groth16-prover');
 */

"use strict";
require("dotenv").config();

const snarkjs = require("snarkjs");
const crypto  = require("crypto");
const path    = require("path");
const fs      = require("fs");
const { ethers } = require("ethers");

// ── Paths ────────────────────────────────────────────────────────────────

const CIRCUITS_DIR = path.join(__dirname, "../../circuits/build");
const WASM_PATH    = path.join(CIRCUITS_DIR, "price_commitment_js/price_commitment.wasm");
const ZKEY_PATH    = path.join(CIRCUITS_DIR, "price_commitment_final.zkey");
const VKEY_PATH    = path.join(CIRCUITS_DIR, "verification_key.json");

// BN128 field modulus — salt must be smaller than this
const FIELD_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// ── Core functions ────────────────────────────────────────────────────────

/**
 * Generate a Groth16 ZK proof for a price update.
 *
 * @param {number} priceUSD  - BNB/USD price (e.g. 616.51)
 * @param {number} [ts]      - Unix timestamp (defaults to now)
 * @returns {Object} { proof, publicSignals, commitment, salt, calldata }
 */
async function generateProof(priceUSD, ts = null) {
    checkCircuitFiles();

    const price     = BigInt(Math.round(priceUSD * 1e8));
    const timestamp = BigInt(ts || Math.floor(Date.now() / 1000));

    // Generate random salt in BN128 field
    // Use 31 bytes (248 bits) to safely stay below field modulus
    let salt;
    do {
        salt = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
    } while (salt >= FIELD_MODULUS);

    console.log(`[ZK Prover] Generating Groth16 proof...`);
    console.log(`[ZK Prover] Price:     $${priceUSD} (${price} raw)`);
    console.log(`[ZK Prover] Timestamp: ${timestamp}`);
    console.log(`[ZK Prover] Salt:      (private — not shown)`);

    const input = {
        price:     price.toString(),
        timestamp: timestamp.toString(),
        salt:      salt.toString(),
    };

    const startTime = Date.now();

    // Generate witness + proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WASM_PATH,
        ZKEY_PATH
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ZK Prover] ✅ Proof generated in ${elapsed}s`);

    // publicSignals = [commitment, price, timestamp]
    // (output first, then public inputs in circom convention)
    const commitment = "0x" + BigInt(publicSignals[0]).toString(16).padStart(64, "0");

    console.log(`[ZK Prover] Commitment: ${commitment}`);

    // Format proof for Solidity verifier
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const calldataParsed = parseCalldata(calldata);

    return {
        proof,
        publicSignals,
        commitment,
        salt:           salt.toString(),
        price:          price.toString(),
        timestamp:      timestamp.toString(),
        priceUSD,
        calldataRaw:    calldata,
        calldata:       calldataParsed,
        proofJson:      JSON.stringify(proof, null, 2),
        generatedAt:    new Date().toISOString(),
    };
}

/**
 * Verify a Groth16 proof locally (off-chain check before submitting).
 *
 * @param {Object} proof         - Proof from generateProof()
 * @param {Array}  publicSignals - Public signals from generateProof()
 * @returns {boolean}
 */
async function verifyProof(proof, publicSignals) {
    checkCircuitFiles();
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    return valid;
}

/**
 * Save proof + witness to BNB Greenfield (or local store for testnet).
 * On mainnet: replace with real @bnb-chain/greenfield-js-sdk calls.
 *
 * @param {Object} proofData - From generateProof()
 * @param {string} txHash    - On-chain transaction hash
 * @returns {Object} Greenfield record
 */
async function saveToGreenfield(proofData, txHash) {
    const GF_DIR = path.join(__dirname, "../../backend/greenfield-proofs");
    fs.mkdirSync(GF_DIR, { recursive: true });

    const record = {
        // Greenfield object metadata (real SDK would use these)
        objectId:   `veris-zk-proof-${proofData.timestamp}`,
        bucketName: "verisafe-oracle-proofs",
        creator:    process.env.DEPLOYER_ADDRESS || "unknown",

        // The ZK proof itself (this is what gets stored)
        zkProof: {
            protocol:      "groth16",
            curve:         "bn128",
            circuit:       "price_commitment",
            proof:         proofData.proof,
            publicSignals: proofData.publicSignals,
            commitment:    proofData.commitment,
        },

        // Witness — contains the secret salt
        // On mainnet: encrypt this with the submitter's key before storing
        witness: {
            price:      proofData.price,
            timestamp:  proofData.timestamp,
            salt:       proofData.salt,  // SECRET — in prod: encrypt before storing
            priceUSD:   proofData.priceUSD,
        },

        // Chain anchoring
        onChain: {
            txHash,
            chain:    "BSC Testnet (97)",
            contract: process.env.VERIS_ORACLE,
        },

        storedAt: new Date().toISOString(),
        note: "Testnet: local storage. Mainnet: BNB Greenfield SDK.",
    };

    const filename = `zk-proof-${proofData.timestamp}.json`;
    fs.writeFileSync(path.join(GF_DIR, filename), JSON.stringify(record, null, 2));

    console.log(`[Greenfield] Proof saved: ${filename}`);
    return {
        objectId:   record.objectId,
        filename,
        bucketName: record.bucketName,
        protocol:   "groth16",
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function checkCircuitFiles() {
    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(
            `Circuit WASM not found at ${WASM_PATH}\n` +
            `Run setup first: bash circuits/setup.sh`
        );
    }
    if (!fs.existsSync(ZKEY_PATH)) {
        throw new Error(
            `ZKey not found at ${ZKEY_PATH}\n` +
            `Run setup first: bash circuits/setup.sh`
        );
    }
}

/**
 * Parse snarkjs calldata string into structured object for Solidity call.
 * snarkjs exports: "proof_a, proof_b, proof_c, pubSignals"
 */
function parseCalldata(calldata) {
    try {
        const cleaned = calldata.replace(/\n/g, "");
        const parts   = cleaned.split("],[");

        // Extract proof_a (2 elements)
        const a_str = parts[0].replace("[", "").replace("]", "");
        const a     = a_str.split(",").map(x => x.trim().replace(/"/g, ""));

        // Extract proof_b (2x2 elements)
        const b_str  = parts[1].replace("[", "").replace("]", "");
        const b_flat = b_str.split(",").map(x => x.trim().replace(/"/g, ""));
        const b      = [[b_flat[0], b_flat[1]], [b_flat[2], b_flat[3]]];

        // Extract proof_c (2 elements)
        const c_str = parts[2].replace("[", "").replace("]", "");
        const c     = c_str.split(",").map(x => x.trim().replace(/"/g, ""));

        // Extract public signals
        const pub_str = parts[3] ? parts[3].replace("[", "").replace("]", "") : "";
        const pub     = pub_str.split(",").map(x => x.trim().replace(/"/g, ""));

        return { a, b, c, publicSignals: pub };
    } catch (e) {
        return { raw: calldata };
    }
}

// ── Test / CLI ─────────────────────────────────────────────────────────────

async function runTest() {
    console.log("\n╔════════════════════════════════════╗");
    console.log("║   VERIS ZK PROVER — SELF-TEST      ║");
    console.log("╚════════════════════════════════════╝\n");

    const testPrice = 616.51;

    // 1. Generate proof
    console.log("1. Generating proof for $" + testPrice + "...");
    const proofData = await generateProof(testPrice, 1772197104);

    // 2. Verify locally
    console.log("\n2. Verifying proof locally...");
    const valid = await verifyProof(proofData.proof, proofData.publicSignals);
    console.log(`   Valid: ${valid ? "✅ YES" : "❌ NO"}`);

    if (!valid) throw new Error("Proof verification failed!");

    // 3. Show what goes on-chain
    console.log("\n3. What gets published on-chain:");
    console.log(`   Price (public):      $${testPrice}`);
    console.log(`   Timestamp (public):  ${proofData.timestamp}`);
    console.log(`   Commitment (output): ${proofData.commitment}`);
    console.log(`   Proof size:          ~256 bytes (Groth16)`);

    // 4. Show Solidity calldata
    console.log("\n4. Solidity call structure:");
    console.log(`   submitPriceWithProof(`);
    console.log(`     price:      ${proofData.price}`);
    console.log(`     timestamp:  ${proofData.timestamp}`);
    console.log(`     commitment: ${proofData.commitment}`);
    console.log(`     proof_a:    [${proofData.calldata.a?.slice(0,1)}...]`);
    console.log(`     proof_b:    [[...]]`);
    console.log(`     proof_c:    [...]`);
    console.log(`   )`);

    // 5. Save to Greenfield store
    console.log("\n5. Saving to Greenfield...");
    const gf = await saveToGreenfield(proofData, "0xTEST_TX_HASH");
    console.log(`   Saved: ${gf.filename}`);

    console.log("\n✅ ALL TESTS PASSED — Real ZK proofs working!\n");
    console.log("Next step: forge build → deploy Groth16Verifier.sol → update VerisOracle\n");

    return proofData;
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = { generateProof, verifyProof, saveToGreenfield };

// CLI entry
if (require.main === module) {
    const args  = process.argv.slice(2);
    const isTest = args.includes("--test");
    const priceFlag = args.indexOf("--price");
    const overridePrice = priceFlag !== -1 ? parseFloat(args[priceFlag + 1]) : null;

    if (isTest) {
        runTest().catch(e => { console.error("❌ Test failed:", e.message); process.exit(1); });
    } else if (overridePrice) {
        generateProof(overridePrice)
            .then(d => console.log("\nProof generated:\n", JSON.stringify({ commitment: d.commitment, proof: d.proof }, null, 2)))
            .catch(console.error);
    } else {
        // Fetch live price and prove
        fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT")
            .then(r => r.json())
            .then(j => generateProof(parseFloat(j.price)))
            .then(d => console.log("Commitment:", d.commitment))
            .catch(console.error);
    }
}
