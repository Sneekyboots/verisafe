"use strict";

/**
 * Verisafe Backend — Production API Server
 *
 * Endpoints:
 *   GET  /health                    system health
 *   GET  /oracle/price              latest ZK-verified price
 *   GET  /oracle/history            last N price submissions
 *   POST /oracle/submit             trigger oracle agent (auth required)
 *   GET  /vault/:address            vault state + LTV
 *   POST /vault/deploy              deploy vault for user
 *   GET  /credit/:tokenId           credit NFT details
 *   POST /liquidate/check           check if vault is liquidatable
 *   POST /liquidate/simulate        simulate crash for demo
 *   GET  /greenfield/proofs         list stored ZK proofs
 *   GET  /greenfield/proof/:name    fetch specific proof
 *   GET  /zk/status                 circuit status
 *   GET  /protocol/stats            total vaults, volume, etc.
 *   GET  /demo                      full demo state for frontend
 */

require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const { ethers } = require("ethers");
const path       = require("path");
const fs         = require("fs");

const { fetchAggregatedPrice }       = require("./oracle/price-fetcher");
const { generateProof, verifyProof } = require("./zk/groth16-prover");
const { listProofs }                 = require("./greenfield/client");

// ── Config ────────────────────────────────────────────────────────────────

const PORT           = process.env.PORT           || 3001;
const ORACLE_V1      = process.env.VERIS_ORACLE;
const ORACLE_V2      = process.env.VERIS_ORACLE_V2;
const VAULT_FACTORY  = process.env.VAULT_FACTORY;
const CREDIT_NFT     = process.env.CREDIT_NFT;
const LIQUIDATION    = process.env.LIQUIDATION_ENGINE;
const PK             = process.env.PRIVATE_KEY;
const ADMIN_KEY      = process.env.ADMIN_API_KEY  || "verisafe-demo-2024";

const RPC_LIST = [
    process.env.BSC_TESTNET_RPC             || "https://data-seed-prebsc-1-s1.binance.org:8545",
    "https://data-seed-prebsc-2-s1.binance.org:8545",
    "https://data-seed-prebsc-1-s2.binance.org:8545",
    "https://bsc-testnet.drpc.org",
];

// ── ABIs ──────────────────────────────────────────────────────────────────

const ORACLE_V2_ABI = [
    "function latestPrice() external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bool verified, bool zkVerified)",
    "function getPriceUnsafe() external view returns (uint256 price, uint256 timestamp, bool fresh, bool zkVerified, uint256 agentsAgreed)",
    "function getHistoryLength() external view returns (uint256)",
    "function priceHistory(uint256 i) external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bytes32 greenfieldObjectId)",
    "function authorizedSubmitter() external view returns (address)",
    "function verifier() external view returns (address)",
];

const FACTORY_ABI = [
    "function deployVault() external returns (address)",
    "function getVault(address user) external view returns (address)",
    "function hasVault(address user) external view returns (bool)",
    "function totalVaults() external view returns (uint256)",
    "function allVaults(uint256) external view returns (address)",
    "function getVaultsPaginated(uint256 start, uint256 end) external view returns (address[])",
    "event VaultDeployed(address indexed user, address vault, uint256 vaultIndex)",
];

const VAULT_ABI = [
    "function owner() external view returns (address)",
    "function collateralBalance() external view returns (uint256)",
    "function creditNFTId() external view returns (uint256)",
    "function getLTV() external view returns (uint256 ltv, uint256 collateralUSD, uint256 debtUSD)",
    "function isLiquidatable() external view returns (bool)",
    "function status() external view returns (uint8)",
    "function deposit() external payable",
    "function requestCredit() external returns (uint256 tokenId)",
];

const CREDIT_NFT_ABI = [
    "function ownerOf(uint256 tokenId) external view returns (address)",
    "function creditLimit(uint256 tokenId) external view returns (uint256)",
    "function usedCredit(uint256 tokenId) external view returns (uint256)",
    "function isActive(uint256 tokenId) external view returns (bool)",
    "function vaultOf(uint256 tokenId) external view returns (address)",
];

const LIQUIDATION_ABI = [
    "function checkAndLiquidate(address vault) external",
    "function totalLiquidations() external view returns (uint256)",
    "function totalValueLiquidated() external view returns (uint256)",
];

// ── Provider with failover ────────────────────────────────────────────────

let _provider = null;

async function getProvider() {
    if (_provider) {
        try { await _provider.getBlockNumber(); return _provider; }
        catch { _provider = null; }
    }
    for (const rpc of RPC_LIST) {
        try {
            const p = new ethers.JsonRpcProvider(rpc);
            await p.getBlockNumber();
            _provider = p;
            return p;
        } catch { /* try next */ }
    }
    throw new Error("All RPCs down");
}

function getSigner(provider) {
    return new ethers.Wallet(PK, provider);
}

// ── App ───────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// Auth middleware for sensitive endpoints
function requireAdmin(req, res, next) {
    const key = req.headers["x-admin-key"] || req.query.adminKey;
    if (key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
    next();
}

// ── /health ───────────────────────────────────────────────────────────────

app.get("/health", async (req, res) => {
    try {
        const provider   = await getProvider();
        const block      = await provider.getBlockNumber();
        const network    = await provider.getNetwork();

        let oracleStatus = null;
        try {
            const oracle  = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);
            const latest  = await oracle.getPriceUnsafe();
            const age     = Math.floor(Date.now() / 1000) - Number(latest.timestamp);
            oracleStatus  = {
                price:      "$" + (Number(latest.price) / 1e8).toFixed(2),
                fresh:      latest.fresh,
                age:        age + "s",
                zkVerified: latest.zkVerified,
            };
        } catch (e) {
            oracleStatus = { error: e.message };
        }

        const wasmOk = fs.existsSync(path.join(__dirname, "../circuits/build/price_commitment_js/price_commitment.wasm"));
        const zkeyOk = fs.existsSync(path.join(__dirname, "../circuits/build/price_commitment_final.zkey"));

        res.json({
            status:   "ok",
            chain:    { id: Number(network.chainId), block },
            oracle:   oracleStatus,
            circuits: { wasm: wasmOk, zkey: zkeyOk },
            contracts: {
                oracleV1:          ORACLE_V1,
                oracleV2:          ORACLE_V2,
                vaultFactory:      VAULT_FACTORY,
                creditNFT:         CREDIT_NFT,
                liquidationEngine: LIQUIDATION,
            },
            ts: new Date().toISOString(),
        });
    } catch (e) {
        res.status(503).json({ status: "degraded", error: e.message });
    }
});

// ── /oracle/price ─────────────────────────────────────────────────────────

app.get("/oracle/price", async (req, res) => {
    try {
        const provider = await getProvider();
        const oracle   = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);
        const [p, ts, commitment, verified, zkVerified] = await oracle.latestPrice();

        res.json({
            price:      Number(p) / 1e8,
            priceRaw:   p.toString(),
            priceUSD:   "$" + (Number(p) / 1e8).toFixed(2),
            timestamp:  Number(ts),
            age:        Math.floor(Date.now() / 1000) - Number(ts),
            commitment,
            verified,
            zkVerified,
            explorer:   `https://testnet.bscscan.com/address/${ORACLE_V2}`,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /oracle/history ───────────────────────────────────────────────────────

app.get("/oracle/history", async (req, res) => {
    try {
        const provider = await getProvider();
        const oracle   = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);
        const len      = Number(await oracle.getHistoryLength());
        const limit    = Math.min(parseInt(req.query.limit || "20"), 50);
        const start    = Math.max(0, len - limit);

        const entries = [];
        for (let i = len - 1; i >= start; i--) {
            try {
                const h = await oracle.priceHistory(i);
                entries.push({
                    index:        i,
                    price:        Number(h.price) / 1e8,
                    priceUSD:     "$" + (Number(h.price) / 1e8).toFixed(2),
                    timestamp:    Number(h.timestamp),
                    commitment:   h.commitment,
                    greenfieldRef: h.greenfieldObjectId,
                });
            } catch { break; }
        }

        res.json({ total: len, entries });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /oracle/submit ────────────────────────────────────────────────────────

app.post("/oracle/submit", requireAdmin, async (req, res) => {
    try {
        const override = req.body.price || null;
        // Spawn agent as child process to avoid blocking server
        const { spawn } = require("child_process");
        const args = ["backend/oracle/agent.js"];
        if (override) args.push("--price", String(override));

        const child  = spawn("node", args, {
            cwd:   path.join(__dirname, ".."),
            env:   process.env,
            stdio: "pipe",
        });

        let output = "";
        child.stdout.on("data", d => { output += d.toString(); });
        child.stderr.on("data", d => { output += d.toString(); });

        child.on("close", code => {
            res.json({ success: code === 0, output, exitCode: code });
        });

        // Don't wait more than 60s
        setTimeout(() => {
            if (!child.killed) { child.kill(); res.json({ success: false, error: "timeout", output }); }
        }, 60_000);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /vault/:address ───────────────────────────────────────────────────────

app.get("/vault/:address", async (req, res) => {
    try {
        const vaultAddr = req.params.address;
        if (!ethers.isAddress(vaultAddr)) return res.status(400).json({ error: "Invalid address" });

        const provider = await getProvider();
        const vault    = new ethers.Contract(vaultAddr, VAULT_ABI, provider);

        const [owner, balance, nftId, ltvData, liquidatable, status] = await Promise.all([
            vault.owner(),
            vault.collateralBalance(),
            vault.creditNFTId().catch(() => null),
            vault.getLTV().catch(() => null),
            vault.isLiquidatable().catch(() => false),
            vault.status().catch(() => null),
        ]);

        const statuses = ["EMPTY", "ACTIVE", "DEFAULTED", "LIQUIDATED"];

        res.json({
            address:      vaultAddr,
            owner,
            balance:      ethers.formatEther(balance),
            balanceBNB:   parseFloat(ethers.formatEther(balance)).toFixed(4),
            creditNFTId:  nftId ? Number(nftId) : null,
            ltv:          ltvData ? {
                ltv:          Number(ltvData.ltv),
                collateralUSD: Number(ltvData.collateralUSD) / 1e8,
                debtUSD:       Number(ltvData.debtUSD) / 1e8,
            } : null,
            isLiquidatable: liquidatable,
            status:        status !== null ? (statuses[Number(status)] || Number(status)) : null,
            explorer:      `https://testnet.bscscan.com/address/${vaultAddr}`,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /vault/deploy ─────────────────────────────────────────────────────────

app.post("/vault/deploy", async (req, res) => {
    try {
        const { userAddress } = req.body;
        if (!ethers.isAddress(userAddress)) return res.status(400).json({ error: "Invalid address" });

        const provider = await getProvider();
        const signer   = getSigner(provider);
        const factory  = new ethers.Contract(VAULT_FACTORY, FACTORY_ABI, signer);

        // Check if vault already exists
        const existing = await factory.getVault(userAddress);
        if (existing !== ethers.ZeroAddress) {
            return res.json({ vaultAddress: existing, alreadyExisted: true });
        }

        const tx = await factory.deployVault({ from: userAddress }).catch(() =>
            // fallback: deploy on behalf from server signer
            factory.deployVault()
        );
        const receipt  = await tx.wait();
        const event    = receipt.logs.find(l => l.fragment?.name === "VaultDeployed");
        const vault    = event?.args?.vault || await factory.getVault(userAddress);

        res.json({
            vaultAddress:  vault,
            txHash:        tx.hash,
            blockNumber:   receipt.blockNumber,
            explorer:      `https://testnet.bscscan.com/tx/${tx.hash}`,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /credit/:tokenId ──────────────────────────────────────────────────────

app.get("/credit/:tokenId", async (req, res) => {
    try {
        const tokenId = parseInt(req.params.tokenId);
        const provider = await getProvider();
        const nft      = new ethers.Contract(CREDIT_NFT, CREDIT_NFT_ABI, provider);

        const [owner, limit, used, active, vault] = await Promise.all([
            nft.ownerOf(tokenId),
            nft.creditLimit(tokenId),
            nft.usedCredit(tokenId),
            nft.isActive(tokenId),
            nft.vaultOf(tokenId),
        ]);

        res.json({
            tokenId,
            owner,
            vault,
            creditLimit:  Number(limit) / 1e6, // assuming USDC-style 6 decimals
            usedCredit:   Number(used)  / 1e6,
            available:    (Number(limit) - Number(used)) / 1e6,
            isActive:     active,
            utilization:  limit > 0 ? ((Number(used) / Number(limit)) * 100).toFixed(1) + "%" : "0%",
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /liquidate/check ──────────────────────────────────────────────────────

app.post("/liquidate/check", async (req, res) => {
    try {
        const { vaultAddress } = req.body;
        if (!ethers.isAddress(vaultAddress)) return res.status(400).json({ error: "Invalid address" });

        const provider = await getProvider();
        const vault    = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
        const oracle   = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);

        const [liquidatable, ltvData, priceData] = await Promise.all([
            vault.isLiquidatable().catch(() => null),
            vault.getLTV().catch(() => null),
            oracle.getPriceUnsafe(),
        ]);

        const ltv = ltvData ? Number(ltvData.ltv) / 100 : null;

        res.json({
            vaultAddress,
            isLiquidatable: liquidatable,
            ltv:           ltv ? ltv.toFixed(2) + "%" : null,
            currentPrice:  "$" + (Number(priceData.price) / 1e8).toFixed(2),
            zkVerified:    priceData.zkVerified,
            recommendation: liquidatable
                ? "⚠️  Vault is at risk — liquidation threshold breached"
                : "✅  Vault is healthy",
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /liquidate/simulate ───────────────────────────────────────────────────

app.post("/liquidate/simulate", requireAdmin, async (req, res) => {
    try {
        const crashPrice = req.body.price || 200;
        // Submit crash price through oracle agent
        const { spawn } = require("child_process");
        const child = spawn("node", ["backend/oracle/agent.js", "--price", String(crashPrice)], {
            cwd:   path.join(__dirname, ".."),
            env:   process.env,
            stdio: "pipe",
        });

        let output = "";
        child.stdout.on("data", d => { output += d.toString(); });
        child.stderr.on("data", d => { output += d.toString(); });

        child.on("close", code => {
            res.json({
                success:    code === 0,
                crashPrice: "$" + crashPrice,
                note:       "If any vault has LTV > 85% at this price, LiquidationEngine can execute",
                output,
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /greenfield/proofs ────────────────────────────────────────────────────

app.get("/greenfield/proofs", async (req, res) => {
    try {
        const limit  = parseInt(req.query.limit || "20");
        const proofs = await listProofs(limit);
        res.json({ count: proofs.length, proofs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get("/greenfield/proof/:name", async (req, res) => {
    try {
        const name = req.params.name;
        // Sanitize filename
        if (name.includes("..") || name.includes("/")) return res.status(400).json({ error: "Invalid name" });

        const localPath = path.join(__dirname, "greenfield-proofs", name);
        if (!fs.existsSync(localPath)) return res.status(404).json({ error: "Proof not found" });

        const proof = JSON.parse(fs.readFileSync(localPath, "utf8"));
        res.json(proof);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /zk/status ────────────────────────────────────────────────────────────

app.get("/zk/status", async (req, res) => {
    const base     = path.join(__dirname, "../circuits/build");
    const wasmPath = path.join(base, "price_commitment_js/price_commitment.wasm");
    const zkeyPath = path.join(base, "price_commitment_final.zkey");
    const vkeyPath = path.join(base, "verification_key.json");

    const wasmOk = fs.existsSync(wasmPath);
    const zkeyOk = fs.existsSync(zkeyPath);
    const vkeyOk = fs.existsSync(vkeyPath);

    let vkey = null;
    if (vkeyOk) {
        try { vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8")); } catch { }
    }

    res.json({
        ready:     wasmOk && zkeyOk && vkeyOk,
        circuit:   "price_commitment.circom",
        protocol:  "groth16",
        curve:     "bn128",
        hashFunc:  "poseidon(3)",
        constraints: 261,
        files: {
            wasm:        wasmOk,
            zkey:        zkeyOk,
            vkey:        vkeyOk,
            verifierContract: process.env.GROTH16_VERIFIER,
        },
        vkeyAlpha1: vkey?.vk_alpha_1?.[0]?.slice(0, 16) + "..." || null,
        explanation: "Proves: Poseidon(price, timestamp, salt) = commitment without revealing salt",
    });
});

// ── /protocol/stats ───────────────────────────────────────────────────────

app.get("/protocol/stats", async (req, res) => {
    try {
        const provider  = await getProvider();
        const factory   = new ethers.Contract(VAULT_FACTORY, FACTORY_ABI, provider);
        const oracle    = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);

        const [totalVaults, histLen, priceData] = await Promise.all([
            factory.totalVaults().catch(() => 0n),
            oracle.getHistoryLength().catch(() => 0n),
            oracle.getPriceUnsafe().catch(() => null),
        ]);

        // Count local greenfield proofs
        const gfDir    = path.join(__dirname, "greenfield-proofs");
        const proofCount = fs.existsSync(gfDir)
            ? fs.readdirSync(gfDir).filter(f => f.endsWith(".json")).length
            : 0;

        res.json({
            totalVaults:     Number(totalVaults),
            priceSubmissions: Number(histLen),
            proofsAnchored:  proofCount,
            currentPrice:    priceData ? "$" + (Number(priceData.price) / 1e8).toFixed(2) : null,
            zkVerified:      priceData?.zkVerified || false,
            contracts: {
                oracleV2:          ORACLE_V2,
                groth16Verifier:   process.env.GROTH16_VERIFIER,
                vaultFactory:      VAULT_FACTORY,
                creditNFT:         CREDIT_NFT,
                liquidationEngine: LIQUIDATION,
            },
            network: "BSC Testnet (Chain 97)",
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── /demo ─────────────────────────────────────────────────────────────────

app.get("/demo", async (req, res) => {
    try {
        const provider = await getProvider();
        const oracle   = new ethers.Contract(ORACLE_V2, ORACLE_V2_ABI, provider);
        const factory  = new ethers.Contract(VAULT_FACTORY, FACTORY_ABI, provider);

        const [priceData, totalVaults, histLen] = await Promise.all([
            oracle.getPriceUnsafe().catch(() => null),
            factory.totalVaults().catch(() => 0n),
            oracle.getHistoryLength().catch(() => 0n),
        ]);

        const price    = priceData ? Number(priceData.price) / 1e8 : 614.98;
        const collateral = 0.5;
        const ltv      = 0.70;
        const credit   = collateral * price * ltv;

        res.json({
            title: "Verisafe Protocol Demo",
            oracle: {
                price:      "$" + price.toFixed(2),
                zkVerified: priceData?.zkVerified ?? false,
                protocol:   "Groth16 BN128",
                circuit:    "Poseidon(3) — 261 constraints",
                verifier:   process.env.GROTH16_VERIFIER,
            },
            exampleVault: {
                deposit:    "0.5 BNB",
                valueUSD:   "$" + (collateral * price).toFixed(2),
                ltv:        "70%",
                creditLine: "$" + credit.toFixed(2),
                note:       "BNB stays in YOUR contract — Verisafe never holds it",
            },
            liquidationTrigger: {
                threshold:  "85% LTV",
                crashPrice: "$" + ((credit / 0.85 / collateral).toFixed(2)),
                note:       "If BNB drops below this price, auto-liquidation executes",
            },
            protocol: {
                totalVaults:      Number(totalVaults),
                priceSubmissions: Number(histLen),
                network:          "BSC Testnet",
            },
            contracts: {
                oracleV1:         ORACLE_V1,
                oracleV2:         ORACLE_V2,
                groth16Verifier:  process.env.GROTH16_VERIFIER,
                vaultFactory:     VAULT_FACTORY,
                creditNFT:        CREDIT_NFT,
                liquidation:      LIQUIDATION,
            },
            explorers: {
                oracleV2:   `https://testnet.bscscan.com/address/${ORACLE_V2}`,
                factory:    `https://testnet.bscscan.com/address/${VAULT_FACTORY}`,
            },
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🛡️  Verisafe Backend running on http://localhost:${PORT}`);
    console.log(`\n   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     GET  /oracle/price`);
    console.log(`     GET  /oracle/history`);
    console.log(`     POST /oracle/submit         (x-admin-key required)`);
    console.log(`     GET  /vault/:address`);
    console.log(`     POST /vault/deploy`);
    console.log(`     GET  /credit/:tokenId`);
    console.log(`     POST /liquidate/check`);
    console.log(`     POST /liquidate/simulate    (x-admin-key required)`);
    console.log(`     GET  /greenfield/proofs`);
    console.log(`     GET  /greenfield/proof/:name`);
    console.log(`     GET  /zk/status`);
    console.log(`     GET  /protocol/stats`);
    console.log(`     GET  /demo\n`);
});

module.exports = app;
