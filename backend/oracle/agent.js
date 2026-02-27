"use strict";

/**
 * Veris Oracle Agent — Production
 *
 * Features:
 *   - Multi-source price aggregation (4 exchanges, median)
 *   - Groth16 ZK proof — local verify before on-chain submit
 *   - RPC failover across 4 BSC testnet endpoints
 *   - Exponential backoff retry (3 attempts)
 *   - Real Greenfield proof anchoring (local fallback)
 *   - Structured JSON logging to agent/logs/
 *   - Continuous mode with health monitoring
 *
 * CLI:
 *   node backend/oracle/agent.js                  single submission
 *   node backend/oracle/agent.js --continuous      runs every 60s
 *   node backend/oracle/agent.js --interval 30     every 30s
 *   node backend/oracle/agent.js --price 200       override (demo)
 *   node backend/oracle/agent.js --health          health check
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");
const { generateProof, verifyProof } = require("../zk/groth16-prover");
const { fetchAggregatedPrice } = require("./price-fetcher");
const { ensureBucket, uploadProof } = require("../greenfield/client");

// ── Config ────────────────────────────────────────────────────────────────

const ORACLE_ADDRESS = process.env.VERIS_ORACLE_V2;
const PK = process.env.PRIVATE_KEY;
const DEFAULT_INTERVAL_MS = 60_000;

const RPC_LIST = [
    process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
    "https://data-seed-prebsc-2-s1.binance.org:8545",
    "https://data-seed-prebsc-1-s2.binance.org:8545",
    "https://bsc-testnet.drpc.org",
];

const ORACLE_ABI = [
    "function submitPriceWithProof(uint256 price, uint256 timestamp, bytes32 commitment, uint[2] calldata proof_a, uint[2][2] calldata proof_b, uint[2] calldata proof_c, bytes32 greenfieldRef) external",
    "function latestPrice() external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bool verified, bool zkVerified)",
    "function getPriceUnsafe() external view returns (uint256 price, uint256 timestamp, bool fresh, bool zkVerified, uint256 agentsAgreed)",
];

// ── Logging ───────────────────────────────────────────────────────────────

const LOG_DIR = path.join(__dirname, "../../agent/logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

function log(level, msg, data = {}) {
    const ts = new Date().toISOString();
    const extra = Object.keys(data).length ? " " + JSON.stringify(data) : "";
    const line = `[${ts}] [${level.toUpperCase()}] ${msg}${extra}`;
    console.log(line);
    const file = path.join(LOG_DIR, `oracle-${ts.slice(0, 10)}.log`);
    fs.appendFileSync(file, JSON.stringify({ ts, level, msg, ...data }) + "\n");
}

// ── RPC failover ──────────────────────────────────────────────────────────

async function getProvider() {
    for (const rpc of RPC_LIST) {
        try {
            const p = new ethers.JsonRpcProvider(rpc);
            await p.getBlockNumber();
            return p;
        } catch {
            log("warn", `RPC down: ${rpc}`);
        }
    }
    throw new Error("All RPC endpoints unreachable");
}

// ── Retry ─────────────────────────────────────────────────────────────────

async function retry(fn, attempts = 3, label = "") {
    for (let i = 1; i <= attempts; i++) {
        try { return await fn(); }
        catch (e) {
            if (i === attempts) throw e;
            const delay = 1000 * Math.pow(2, i);
            log("warn", `${label} failed (${i}/${attempts}), retry in ${delay}ms`, { error: e.message });
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ── Health check ──────────────────────────────────────────────────────────

async function healthCheck() {
    log("info", "── Health Check ──");
    const provider = await getProvider();
    const wallet = new ethers.Wallet(PK, provider);
    const balance = await provider.getBalance(wallet.address);
    log("info", "Wallet", { address: wallet.address, balance: ethers.formatEther(balance) + " BNB" });

    const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
    try {
        const p = await oracle.latestPrice();
        const age = Math.floor(Date.now() / 1000) - Number(p.timestamp);
        log("info", "Oracle", { price: "$" + (Number(p.price) / 1e8).toFixed(2), age: age + "s", zkVerified: p.zkVerified });
    } catch (e) {
        log("warn", "Oracle read failed", { error: e.message });
    }

    const wasmOk = fs.existsSync(path.join(__dirname, "../../circuits/build/price_commitment_js/price_commitment.wasm"));
    const zkeyOk = fs.existsSync(path.join(__dirname, "../../circuits/build/price_commitment_final.zkey"));
    log("info", "Circuit files", { wasm: wasmOk, zkey: zkeyOk });
    log("info", "── Health OK ──");
}

// ── One full submission cycle ─────────────────────────────────────────────

async function submitOnce(overridePrice = null) {
    const t0 = Date.now();
    log("info", "── Submission cycle start ──");

    // 1. Provider + wallet
    const provider = await retry(getProvider, 3, "RPC");
    const wallet = new ethers.Wallet(PK, provider);
    const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);

    // 2. Fetch aggregated price
    log("info", "Fetching price from 4 sources...");
    const priceResult = await retry(() => fetchAggregatedPrice(overridePrice), 3, "price fetch");
    log("info", "Price", {
        value: "$" + priceResult.price.toFixed(2),
        sources: priceResult.validCount,
        spreadBps: priceResult.spread,
        override: priceResult.override,
    });

    // 3. Generate ZK proof
    log("info", "Generating Groth16 ZK proof...");
    const proofData = await retry(() => generateProof(priceResult.price), 2, "proof");
    log("info", "Proof generated", { commitment: proofData.commitment });

    // Attach source metadata for Greenfield storage
    proofData.sources = priceResult.sources?.map(s =>
        s.ok ? `${s.name}:$${s.price.toFixed(2)}` : `${s.name}:fail`
    );

    // 4. Local verify — never submit if local check fails
    const localOk = await verifyProof(proofData.proof, proofData.publicSignals);
    if (!localOk) throw new Error("Local proof verification FAILED — aborting submission");
    log("info", "✅ Proof verified locally");

    // 5. Parse proof components for Solidity
    const proof_a = [BigInt(proofData.proof.pi_a[0]), BigInt(proofData.proof.pi_a[1])];
    const proof_b = [
        [BigInt(proofData.proof.pi_b[0][1]), BigInt(proofData.proof.pi_b[0][0])],
        [BigInt(proofData.proof.pi_b[1][1]), BigInt(proofData.proof.pi_b[1][0])],
    ];
    const proof_c = [BigInt(proofData.proof.pi_c[0]), BigInt(proofData.proof.pi_c[1])];

    // 6. Upload to Greenfield first, get reference for on-chain anchoring
    log("info", "Uploading to Greenfield...");
    let gfResult;
    try {
        await ensureBucket(wallet);
        gfResult = await uploadProof(proofData, "pending-" + proofData.timestamp, wallet);
        log("info", "Greenfield", { ref: gfResult.greenfieldRef, onGreenfield: gfResult.onGreenfield });
    } catch (e) {
        log("warn", "Greenfield failed, using hash fallback", { error: e.message });
        const greenfieldRef = ethers.keccak256(ethers.toUtf8Bytes(`veris-proof-${proofData.timestamp}`));
        gfResult = { greenfieldRef, onGreenfield: false };
    }

    // 7. Submit on-chain
    log("info", "Submitting on-chain...");
    const tx = await retry(() =>
        oracle.submitPriceWithProof(
            BigInt(proofData.price),
            BigInt(proofData.timestamp),
            proofData.commitment,
            proof_a,
            proof_b,
            proof_c,
            gfResult.greenfieldRef
        ),
        3,
        "on-chain submit"
    );

    log("info", "TX sent", { hash: tx.hash, explorer: `https://testnet.bscscan.com/tx/${tx.hash}` });
    const receipt = await tx.wait();
    log("info", "✅ ZK PROOF VERIFIED ON-CHAIN", {
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        elapsed: ((Date.now() - t0) / 1000).toFixed(1) + "s",
    });

    // 8. Re-save Greenfield record with real TX hash
    try {
        await uploadProof(proofData, tx.hash, wallet);
    } catch { /* non-fatal */ }

    const result = {
        priceUSD: priceResult.price,
        commitment: proofData.commitment,
        txHash: tx.hash,
        block: receipt.blockNumber,
        zkVerified: true,
        greenfieldRef: gfResult.greenfieldRef,
        onGreenfield: gfResult.onGreenfield,
        sources: proofData.sources,
        elapsedMs: Date.now() - t0,
    };

    // Save submission record
    fs.writeFileSync(
        path.join(LOG_DIR, `submission-${proofData.timestamp}.json`),
        JSON.stringify(result, null, 2)
    );

    console.log(`
╔══════════════════════════════════════════════╗
║   ✅  REAL ZK PROOF VERIFIED ON-CHAIN        ║
╠══════════════════════════════════════════════╣
║  Price:       $${priceResult.price.toFixed(2).padEnd(29)}║
║  Sources:     ${String(priceResult.validCount + " exchanges (median)").padEnd(29)}║
║  Protocol:    Groth16 BN128                  ║
║  Commitment:  ${proofData.commitment.slice(0, 16)}...          ║
║  TX:          ${tx.hash.slice(0, 16)}...          ║
║  Block:       ${String(receipt.blockNumber).padEnd(29)}║
║  Greenfield:  ${gfResult.onGreenfield ? "✅ on-chain storage" : "📁 local fallback  "}           ║
║  Elapsed:     ${((result.elapsedMs) / 1000).toFixed(1) + "s".padEnd(29)}║
╚══════════════════════════════════════════════╝
`);

    return result;
}

// ── Continuous mode ───────────────────────────────────────────────────────

async function runContinuous(intervalMs, overridePrice = null) {
    log("info", "Continuous oracle agent started", {
        interval: intervalMs / 1000 + "s",
        oracle: ORACLE_ADDRESS,
    });

    let ok = 0, fail = 0;

    while (true) {
        try {
            await submitOnce(overridePrice);
            ok++;
        } catch (e) {
            fail++;
            log("error", "Submission failed", { error: e.message, ok, fail });
        }
        log("info", `Next in ${intervalMs / 1000}s`, { ok, fail, uptime: process.uptime().toFixed(0) + "s" });
        await new Promise(r => setTimeout(r, intervalMs));
    }
}

// ── Entry point ───────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const continuous = args.includes("--continuous");
    const health = args.includes("--health");
    const priceIdx = args.indexOf("--price");
    const intervalIdx = args.indexOf("--interval");
    const override = priceIdx !== -1 ? args[priceIdx + 1] : null;
    const interval = intervalIdx !== -1
        ? parseInt(args[intervalIdx + 1]) * 1000
        : DEFAULT_INTERVAL_MS;

    if (!PK) { console.error("PRIVATE_KEY not set in .env"); process.exit(1); }
    if (!ORACLE_ADDRESS) { console.error("VERIS_ORACLE_V2 not set in .env"); process.exit(1); }

    console.log(`\n🔮 VERIS ORACLE AGENT — Production`);
    console.log(`   Oracle:  ${ORACLE_ADDRESS}`);
    console.log(`   Mode:    ${health ? "health" : continuous ? "continuous" : "single"}\n`);

    if (health) return healthCheck();
    if (continuous) return runContinuous(interval, override);
    return submitOnce(override);
}

main().catch(e => {
    log("error", "Fatal", { error: e.message, stack: e.stack });
    process.exit(1);
});

module.exports = { submitOnce, healthCheck };
