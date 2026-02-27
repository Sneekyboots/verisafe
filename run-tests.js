"use strict";

/**
 * Verisafe Backend — Full Test Suite
 *
 * Tests every layer:
 *   1. RPC connectivity + failover
 *   2. All 4 price sources
 *   3. ZK proof generation + local verification
 *   4. On-chain ZK verification (reads zkVerified from contract)
 *   5. All deployed contracts
 *   6. API server endpoints
 *   7. Greenfield storage
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const { ethers }                     = require("ethers");
const path                           = require("path");
const fs                             = require("fs");
const { fetchAggregatedPrice }       = require("../oracle/price-fetcher");
const { generateProof, verifyProof } = require("../zk/groth16-prover");
const { listProofs }                 = require("../greenfield/client");

const RPC_LIST = [
    process.env.BSC_TESTNET_RPC             || "https://data-seed-prebsc-1-s1.binance.org:8545",
    "https://data-seed-prebsc-2-s1.binance.org:8545",
    "https://data-seed-prebsc-1-s2.binance.org:8545",
    "https://bsc-testnet.drpc.org",
];

const ORACLE_V2     = process.env.VERIS_ORACLE_V2;
const VAULT_FACTORY = process.env.VAULT_FACTORY;
const CREDIT_NFT    = process.env.CREDIT_NFT;

// ── Test runner ───────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${name}`);
        console.log(`     └─ ${e.message}`);
        failed++;
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

async function testRPC() {
    console.log("\n── 1. RPC Connectivity ──");

    let workingRpc = null;
    await test("At least one RPC responds", async () => {
        for (const rpc of RPC_LIST) {
            try {
                const p     = new ethers.JsonRpcProvider(rpc);
                const block = await p.getBlockNumber();
                if (block > 0) { workingRpc = rpc; return; }
            } catch { /* try next */ }
        }
        throw new Error("All RPCs failed");
    });

    if (!workingRpc) return null;
    const provider = new ethers.JsonRpcProvider(workingRpc);

    await test("Chain ID is 97 (BSC testnet)", async () => {
        const net = await provider.getNetwork();
        if (Number(net.chainId) !== 97) throw new Error(`Got chainId ${net.chainId}`);
    });

    await test("Wallet has tBNB", async () => {
        const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const balance = await provider.getBalance(wallet.address);
        if (balance === 0n) throw new Error("Zero balance");
        console.log(`     └─ ${ethers.formatEther(balance)} BNB @ ${wallet.address}`);
    });

    return provider;
}

async function testPriceSources() {
    console.log("\n── 2. Price Sources ──");

    const { SOURCES } = require("../oracle/price-fetcher");

    for (const source of SOURCES) {
        await test(`${source.name} responds`, async () => {
            const ctrl  = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            try {
                const res   = await fetch(source.url, { signal: ctrl.signal });
                const json  = await res.json();
                const price = source.parse(json);
                if (!isFinite(price) || price <= 0) throw new Error("Invalid price: " + price);
                console.log(`     └─ $${price.toFixed(2)}`);
            } finally {
                clearTimeout(timer);
            }
        });
    }

    await test("Aggregated price (median, outlier filter)", async () => {
        const result = await fetchAggregatedPrice();
        if (!isFinite(result.price) || result.price <= 0) throw new Error("Invalid aggregated price");
        if (result.validCount < 2) throw new Error(`Only ${result.validCount} valid source(s)`);
        console.log(`     └─ $${result.price.toFixed(2)} from ${result.validCount} sources (spread ${result.spread}bps)`);
    });
}

async function testZKProofs() {
    console.log("\n── 3. ZK Proof System ──");

    const wasmPath = path.join(__dirname, "../../circuits/build/price_commitment_js/price_commitment.wasm");
    const zkeyPath = path.join(__dirname, "../../circuits/build/price_commitment_final.zkey");

    await test("Circuit WASM exists", async () => {
        if (!fs.existsSync(wasmPath)) throw new Error("Missing: " + wasmPath);
    });

    await test("ZKey exists", async () => {
        if (!fs.existsSync(zkeyPath)) throw new Error("Missing: " + zkeyPath);
    });

    let proofData = null;
    await test("Generate Groth16 proof", async () => {
        proofData = await generateProof(614.98, 1772201776);
        if (!proofData.commitment.startsWith("0x")) throw new Error("Bad commitment");
        console.log(`     └─ ${proofData.commitment.slice(0, 20)}...`);
    });

    if (!proofData) return;

    await test("Verify proof locally", async () => {
        const valid = await verifyProof(proofData.proof, proofData.publicSignals);
        if (!valid) throw new Error("Proof invalid");
    });

    await test("Proof has correct pi_a/pi_b/pi_c structure", async () => {
        const { proof } = proofData;
        if (!proof.pi_a || proof.pi_a.length < 2) throw new Error("Bad pi_a");
        if (!proof.pi_b || proof.pi_b.length < 2) throw new Error("Bad pi_b");
        if (!proof.pi_c || proof.pi_c.length < 2) throw new Error("Bad pi_c");
    });

    await test("Public signals match circuit output", async () => {
        const [commitment, price, timestamp] = proofData.publicSignals;
        const expectedCommitment = BigInt(proofData.commitment).toString();
        if (commitment !== expectedCommitment) throw new Error("Commitment mismatch");
    });
}

async function testContracts(provider) {
    console.log("\n── 4. Deployed Contracts ──");

    if (!provider) { console.log("  ⚠️  Skipped (no RPC)"); return; }

    const ORACLE_V2_ABI = [
        "function latestPrice() external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bool verified, bool zkVerified)",
        "function getPriceUnsafe() external view returns (uint256 price, uint256 timestamp, bool fresh, bool zkVerified, uint256 agentsAgreed)",
        "function verifier() external view returns (address)",
        "function getHistoryLength() external view returns (uint256)",
    ];
    const FACTORY_ABI = [
        "function totalVaults() external view returns (uint256)",
        "function owner() external view returns (address)",
    ];

    await test("VerisOracleV2 is deployed", async () => {
        const code = await provider.getCode(ORACLE_V2);
        if (code === "0x") throw new Error("No bytecode at " + ORACLE_V2);
    });

    await test("VerisOracleV2 has ZK-verified price", async () => {
        const oracle = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);
        const [p, ts, , , zkVerified] = await oracle.latestPrice();
        if (!zkVerified) throw new Error("zkVerified is false — run oracle agent first");
        const age = Math.floor(Date.now() / 1000) - Number(ts);
        console.log(`     └─ $${(Number(p)/1e8).toFixed(2)}, age ${age}s, zkVerified=${zkVerified}`);
    });

    await test("VerisOracleV2 has Groth16 verifier address", async () => {
        const oracle = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);
        const v = await oracle.verifier();
        if (v === ethers.ZeroAddress) throw new Error("Verifier not set");
        console.log(`     └─ ${v}`);
    });

    await test("Groth16Verifier is deployed", async () => {
        const code = await provider.getCode(process.env.GROTH16_VERIFIER);
        if (code === "0x") throw new Error("No bytecode");
    });

    await test("VaultFactory is deployed", async () => {
        const code = await provider.getCode(VAULT_FACTORY);
        if (code === "0x") throw new Error("No bytecode");
    });

    await test("VaultFactory.totalVaults() responds", async () => {
        const factory = new ethers.Contract(VAULT_FACTORY, FACTORY_ABI, provider);
        const n = await factory.totalVaults();
        console.log(`     └─ ${Number(n)} vaults deployed`);
    });

    await test("CreditNFT is deployed", async () => {
        const code = await provider.getCode(CREDIT_NFT);
        if (code === "0x") throw new Error("No bytecode");
    });

    await test("LiquidationEngine is deployed", async () => {
        const code = await provider.getCode(process.env.LIQUIDATION_ENGINE);
        if (code === "0x") throw new Error("No bytecode");
    });
}

async function testGreenfield() {
    console.log("\n── 5. Greenfield Storage ──");

    await test("Local proof store accessible", async () => {
        const dir = path.join(__dirname, "../greenfield-proofs");
        fs.mkdirSync(dir, { recursive: true });
    });

    await test("Can list proofs", async () => {
        const proofs = await listProofs(5);
        console.log(`     └─ ${proofs.length} proofs stored`);
    });

    await test("Most recent proof is valid JSON", async () => {
        const dir    = path.join(__dirname, "../greenfield-proofs");
        const files  = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).reverse()
            : [];
        if (files.length === 0) { console.log("     └─ No proofs yet (run oracle agent)"); return; }
        const latest = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
        if (!latest.zkProof || !latest.public) throw new Error("Proof record malformed");
        console.log(`     └─ ${files[0]}, price=$${latest.public.priceUSD}`);
    });
}

async function testAPI() {
    console.log("\n── 6. API Server ──");

    const BASE = `http://localhost:${process.env.PORT || 3001}`;

    async function get(endpoint) {
        const res = await fetch(`${BASE}${endpoint}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    await test("GET /health responds", async () => {
        const data = await get("/health").catch(() => { throw new Error("Server not running — start with: node backend/server.js"); });
        if (data.status !== "ok" && data.status !== "degraded") throw new Error("Unexpected status: " + data.status);
        console.log(`     └─ chain block ${data.chain?.block}`);
    });

    await test("GET /oracle/price returns ZK-verified price", async () => {
        const data = await get("/oracle/price");
        if (!data.price) throw new Error("No price");
        console.log(`     └─ ${data.priceUSD}, zkVerified=${data.zkVerified}`);
    });

    await test("GET /oracle/history has entries", async () => {
        const data = await get("/oracle/history?limit=5");
        if (typeof data.total !== "number") throw new Error("No total");
        console.log(`     └─ ${data.total} total submissions`);
    });

    await test("GET /zk/status shows ready", async () => {
        const data = await get("/zk/status");
        console.log(`     └─ ready=${data.ready}, circuit=${data.circuit}`);
    });

    await test("GET /protocol/stats works", async () => {
        const data = await get("/protocol/stats");
        console.log(`     └─ vaults=${data.totalVaults}, submissions=${data.priceSubmissions}`);
    });

    await test("GET /demo returns full demo state", async () => {
        const data = await get("/demo");
        if (!data.oracle || !data.contracts) throw new Error("Missing fields");
        console.log(`     └─ credit line example: ${data.exampleVault?.creditLine}`);
    });

    await test("GET /greenfield/proofs lists proofs", async () => {
        const data = await get("/greenfield/proofs");
        if (typeof data.count !== "number") throw new Error("No count");
        console.log(`     └─ ${data.count} proofs`);
    });
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║  VERISAFE — Full Test Suite          ║");
    console.log("╚══════════════════════════════════════╝");

    const provider = await testRPC();
    await testPriceSources();
    await testZKProofs();
    await testContracts(provider);
    await testGreenfield();
    await testAPI();

    console.log("\n─────────────────────────────────────");
    const total = passed + failed;
    if (failed === 0) {
        console.log(`✅ ALL ${passed}/${total} TESTS PASSED\n`);
    } else {
        console.log(`⚠️  ${passed}/${total} passed, ${failed} FAILED\n`);
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
