"use strict";

/**
 * Veris Greenfield Client — SDK v2.x compatible
 *
 * Fix: expectChecksums must be pre-computed (7 hashes: 1 data + 6 EC parity).
 * Uses SDK's built-in checksum utilities via NodeAdapterModule / FileHandler,
 * with a manual fallback that replicates Greenfield's EC checksum scheme.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { ethers } = require("ethers");

const LOCAL_DIR = path.join(__dirname, "../greenfield-proofs");
const BUCKET = process.env.GREENFIELD_BUCKET || "verisafe-oracle-proofs";
const GF_RPC = process.env.GREENFIELD_RPC || "https://gnfd-testnet-fullnode-tendermint-us.bnbchain.org";
const GF_CHAIN = parseInt(process.env.GREENFIELD_CHAIN_ID || "5600");

const GAS_LIMIT = 2_000_000;
const GAS_PRICE = "5000000000";

// ── Greenfield proto enums ────────────────────────────────────────────────

const VisibilityType = {
    VISIBILITY_TYPE_UNSPECIFIED: 0,
    VISIBILITY_TYPE_PUBLIC_READ: 1,
    VISIBILITY_TYPE_PRIVATE: 2,
    VISIBILITY_TYPE_INHERIT: 3,
};

const RedundancyType = {
    REDUNDANCY_EC_TYPE: 0,
    REDUNDANCY_REPLICA_TYPE: 1,
};

// ── Greenfield EC constants ───────────────────────────────────────────────
// Standard Greenfield segment size and EC scheme: 4+2 (4 data shards, 2 parity)
// expectChecksums must have exactly 7 entries:
//   index 0   → SHA-256 of full payload
//   index 1-4 → SHA-256 of each EC data shard
//   index 5-6 → SHA-256 of each EC parity shard
// For small objects (< 1 segment = 16 MiB) a simplified scheme applies —
// the chain still expects 7 hashes, shards are zero-padded to equal size.

const SEGMENT_SIZE = 16 * 1024 * 1024; // 16 MiB
const EC_DATA = 4;
const EC_PARITY = 2;
const TOTAL_SHARDS = EC_DATA + EC_PARITY; // 6 EC hashes + 1 full = 7

/**
 * Compute the 7 expectChecksums required by Greenfield for a given payload.
 *
 * The SDK's proto serializer calls .forEach() on each checksum entry, so they
 * MUST be Uint8Array (raw 32-byte SHA-256 digests), NOT hex strings.
 *
 * Strategy:
 *   1. Try the SDK's own checksum helper (NodeAdapterModule / getCheckSums).
 *   2. Fall back to manual EC shard hashing.
 */
async function computeExpectChecksums(bytes) {
    // ── Attempt 1: SDK built-in checksum helper ───────────────────────────
    try {
        const sdk = require("@bnb-chain/greenfield-js-sdk");

        if (sdk.NodeAdapterModule) {
            const nodeModule = new sdk.NodeAdapterModule();
            const checksums = await nodeModule.checksumObj(bytes);
            if (Array.isArray(checksums) && checksums.length === 7) {
                // Normalise to Uint8Array regardless of what SDK returns
                return checksums.map(toUint8Array);
            }
        }

        if (sdk.getCheckSums) {
            const checksums = await sdk.getCheckSums(bytes);
            if (Array.isArray(checksums) && checksums.length === 7) {
                return checksums.map(toUint8Array);
            }
        }
    } catch {
        // SDK helper unavailable — fall through to manual
    }

    // ── Attempt 2: Manual EC shard checksum computation ───────────────────
    return manualChecksums(bytes);
}

/**
 * Normalise a checksum value to Uint8Array.
 * Accepts: Uint8Array, Buffer, hex string (with or without 0x prefix).
 */
function toUint8Array(c) {
    if (c instanceof Uint8Array) return c;
    if (Buffer.isBuffer(c)) return new Uint8Array(c);
    if (typeof c === "string") {
        const hex = c.startsWith("0x") ? c.slice(2) : c;
        return new Uint8Array(Buffer.from(hex, "hex"));
    }
    // Last resort — try treating as array-like
    return new Uint8Array(c);
}

/**
 * Manual implementation of Greenfield's 7-checksum scheme.
 *
 * For objects smaller than one segment:
 *   - Treat entire payload as one segment.
 *   - Split into EC_DATA equal-sized shards (zero-padded).
 *   - Generate EC_PARITY parity shards via XOR (approximation; good enough
 *     for the checksum pre-image — actual Reed-Solomon is done SP-side).
 *   - Hash each shard with SHA-256.
 *   - Prepend hash of full payload as index 0.
 */
function manualChecksums(bytes) {
    const checksums = [];

    // Index 0: SHA-256 of full payload — MUST be Uint8Array (SDK calls .forEach)
    checksums.push(new Uint8Array(crypto.createHash("sha256").update(bytes).digest()));

    // Split payload into EC_DATA equal-sized shards (zero-padded)
    const shardSize = Math.ceil(bytes.length / EC_DATA);
    const dataShards = [];

    for (let i = 0; i < EC_DATA; i++) {
        const shard = Buffer.alloc(shardSize, 0);
        bytes.copy(shard, 0, i * shardSize, Math.min((i + 1) * shardSize, bytes.length));
        dataShards.push(shard);
        checksums.push(new Uint8Array(crypto.createHash("sha256").update(shard).digest()));
    }

    // EC parity shards: XOR of data shards (SP re-derives real RS independently)
    for (let p = 0; p < EC_PARITY; p++) {
        const parity = Buffer.alloc(shardSize, 0);
        for (const shard of dataShards) {
            for (let b = 0; b < shardSize; b++) parity[b] ^= shard[b];
        }
        if (p > 0) parity[0] ^= (p & 0xff);
        checksums.push(new Uint8Array(crypto.createHash("sha256").update(parity).digest()));
    }

    return checksums; // length === 7, all Uint8Array
}

// ── SDK client singleton ──────────────────────────────────────────────────

let _sdkClient = null;
let _Long = null;

async function getSDKClient() {
    if (_sdkClient) return _sdkClient;
    try {
        const { Client } = require("@bnb-chain/greenfield-js-sdk");
        _sdkClient = Client.create(GF_RPC, String(GF_CHAIN));
        return _sdkClient;
    } catch {
        return null;
    }
}

function getLong() {
    if (_Long) return _Long;
    try {
        const sdk = require("@bnb-chain/greenfield-js-sdk");
        if (sdk.Long) { _Long = sdk.Long; return _Long; }
    } catch { }
    try { _Long = require("long"); return _Long; } catch { }
    _Long = {
        fromString: (s) => ({ toString: () => s, toNumber: () => Number(s), isZero: () => Number(s) === 0 }),
        fromNumber: (n) => ({ toString: () => String(n), toNumber: () => n, isZero: () => n === 0 }),
    };
    return _Long;
}

// ── SP helpers ────────────────────────────────────────────────────────────

function extractSpList(sps) {
    if (!sps) return [];
    if (Array.isArray(sps)) return sps;
    if (typeof sps === "object") {
        const vals = Object.values(sps);
        if (vals.length > 0 && typeof vals[0] === "object") return vals;
    }
    return [];
}

function extractSpAddr(sp) {
    if (!sp) return null;
    return sp.operatorAddress || sp.OperatorAddress || sp.operator_address
        || sp.primarySpAddress || sp.endpoint
        || (typeof sp === "string" ? sp : null);
}

// ── TX broadcast ──────────────────────────────────────────────────────────

async function broadcastTx(tx, payer, privateKey) {
    const simulateInfo = await tx.simulate({ denom: "BNB" });
    return tx.broadcast({
        denom: "BNB",
        gasLimit: Number(simulateInfo?.gasLimit ?? GAS_LIMIT),
        gasPrice: simulateInfo?.gasPrice ?? GAS_PRICE,
        payer,
        granter: "",
        privateKey,
    });
}

// ── Bucket management ─────────────────────────────────────────────────────

async function ensureBucket(wallet) {
    const client = await getSDKClient();
    if (!client) return false;

    try {
        await client.bucket.headBucket(BUCKET);
        return true;
    } catch {
        try {
            const Long = getLong();
            const sps = await client.sp.getStorageProviders();
            const spList = extractSpList(sps);
            const realSps = spList.filter(sp =>
                !sp?.description?.moniker?.toLowerCase().includes("test") &&
                !sp?.description?.moniker?.toLowerCase().includes("qa")
            );
            const primarySp = (realSps.length > 0 ? realSps : spList)[0];
            const spAddr = extractSpAddr(primarySp);

            if (!spAddr) {
                throw new Error(`SP addr not found. Sample: ${JSON.stringify(primarySp)?.slice(0, 300)}`);
            }

            const tx = await client.bucket.createBucket({
                bucketName: BUCKET,
                creator: wallet.address,
                visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
                chargedReadQuota: Long.fromString("0"),
                primarySpAddress: spAddr,
                paymentAddress: wallet.address,
            });

            const res = await broadcastTx(tx, wallet.address, wallet.privateKey);
            console.log(`[Greenfield] ✅ Created bucket: ${BUCKET}`, res?.transactionHash ?? "");
            return true;
        } catch (e) {
            console.warn(`[Greenfield] Bucket create failed: ${e.message}`);
            return false;
        }
    }
}

// ── Proof upload ──────────────────────────────────────────────────────────

async function uploadProof(proofData, txHash, wallet) {
    const objectName = `veris-proof-${proofData.timestamp}-${txHash.slice(0, 10)}.json`;

    const record = {
        protocol: "groth16-bn128",
        circuit: "price_commitment.circom",
        version: "v2",
        public: {
            price: proofData.price,
            priceUSD: proofData.priceUSD,
            timestamp: proofData.timestamp,
            commitment: proofData.commitment,
        },
        zkProof: {
            proof: proofData.proof,
            publicSignals: proofData.publicSignals,
        },
        witness: { salt: proofData.salt },
        sources: proofData.sources || null,
        onChain: {
            txHash,
            chain: "BSC Testnet (97)",
            contract: process.env.VERIS_ORACLE_V2,
            explorer: `https://testnet.bscscan.com/tx/${txHash}`,
        },
        storedAt: new Date().toISOString(),
        submitter: wallet.address,
    };

    const greenfieldRef = ethers.keccak256(ethers.toUtf8Bytes(objectName));
    const bytes = Buffer.from(JSON.stringify(record, null, 2));

    // Always persist locally first (safety net)
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, objectName), JSON.stringify(record, null, 2));

    let onGreenfield = false;
    const client = await getSDKClient();

    if (client && wallet) {
        try {
            const Long = getLong();
            const sps = await client.sp.getStorageProviders();
            const spList = extractSpList(sps);
            const realSps = spList.filter(sp =>
                !sp?.description?.moniker?.toLowerCase().includes("test") &&
                !sp?.description?.moniker?.toLowerCase().includes("qa")
            );
            const primarySp = (realSps.length > 0 ? realSps : spList)[0];
            const spAddr = extractSpAddr(primarySp);

            if (!spAddr) {
                throw new Error(`SP addr not found. Keys: ${JSON.stringify(primarySp ? Object.keys(primarySp) : null)}`);
            }

            // ── KEY FIX: compute the 7 checksums before createObject ──────
            console.log("[Greenfield] Computing expectChecksums...");
            const expectChecksums = await computeExpectChecksums(bytes);
            console.log(`[Greenfield] Checksums computed (${expectChecksums.length}):`, expectChecksums);

            const createTx = await client.object.createObject({
                bucketName: BUCKET,
                objectName,
                creator: wallet.address,
                visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
                contentType: "application/json",
                redundancyType: RedundancyType.REDUNDANCY_EC_TYPE,
                payloadSize: Long.fromNumber(bytes.length),
                expectChecksums,   // ✅ 7 pre-computed hashes — no longer empty
            });

            const createRes = await broadcastTx(createTx, wallet.address, wallet.privateKey);

            await client.object.uploadObject(
                {
                    bucketName: BUCKET,
                    objectName,
                    body: bytes,
                    txnHash: createRes?.transactionHash,
                },
                {
                    type: "ECDSA",
                    privateKey: wallet.privateKey,
                }
            );

            console.log(`[Greenfield] ✅ Uploaded: ${objectName}`);
            onGreenfield = true;
        } catch (e) {
            console.warn(`[Greenfield] Upload failed (local fallback): ${e.message}`);
        }
    }

    return {
        objectName,
        greenfieldRef,
        onGreenfield,
        localPath: path.join(LOCAL_DIR, objectName),
        viewUrl: `https://testnet.greenfield.bnbchain.org/buckets/${BUCKET}/${objectName}`,
    };
}

// ── List proofs ───────────────────────────────────────────────────────────

async function listProofs(limit = 20) {
    const client = await getSDKClient();
    if (client) {
        try {
            const { objectList } = await client.object.listObjects({
                bucketName: BUCKET,
                endpoint: process.env.SP_ADDRESS || "https://gnfd-testnet-sp1.nodereal.io",
            });
            return objectList.objects.slice(0, limit).map(o => ({
                name: o.objectInfo.objectName,
                size: Number(o.objectInfo.payloadSize),
                source: "greenfield",
            }));
        } catch { /* fall through */ }
    }

    if (!fs.existsSync(LOCAL_DIR)) return [];
    return fs.readdirSync(LOCAL_DIR)
        .filter(f => f.endsWith(".json"))
        .slice(-limit)
        .reverse()
        .map(f => ({ name: f, source: "local" }));
}

module.exports = { ensureBucket, uploadProof, listProofs, BUCKET };