/**
 * Veris Oracle Agent
 * 
 * Fetches BNB/USD price from Binance API.
 * Generates commitment hash (the ZK-style proof).
 * Submits to VerisOracle contract on BSC testnet.
 * 
 * Run:  node agent/oracle-agent.js
 * Demo: node agent/oracle-agent.js --price 200  (simulate price crash)
 */

const { ethers } = require("ethers");
const crypto = require("crypto");

// ── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  rpc:           "https://data-seed-prebsc-1-s1.binance.org:8545",
  privateKey:    process.env.PRIVATE_KEY,
  oracleAddress: process.env.VERIS_ORACLE,
  binanceApi:    "https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
};

// Minimal ABI — only what we need
const ORACLE_ABI = [
  "function submitPrice(uint256 price, uint256 timestamp, bytes32 commitment) external",
  "function latestPrice() external view returns (uint256 price, uint256 timestamp, bytes32 commitment, bool verified)",
  "event PriceUpdated(uint256 price, uint256 timestamp, bytes32 commitment)",
];

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Fetch BNB/USD from Binance public API.
 * No API key required.
 */
async function fetchBNBPrice(overridePrice = null) {
  if (overridePrice) {
    console.log(`[Veris Agent] Using override price: $${overridePrice}`);
    return parseFloat(overridePrice);
  }

  const response = await fetch(CONFIG.binanceApi);
  const data     = await response.json();
  const price    = parseFloat(data.price);

  console.log(`[Veris Agent] Fetched BNB/USD from Binance: $${price}`);
  return price;
}

/**
 * Generate ZK-style commitment.
 * commitment = keccak256(price || timestamp || salt)
 * Salt stays secret off-chain — proves knowledge without revealing source.
 */
function generateCommitment(price8dec, timestamp) {
  // Random salt — kept off-chain (this IS the "zero knowledge" part)
  const salt = "0x" + crypto.randomBytes(32).toString("hex");

  // Pack and hash — same as Solidity's abi.encodePacked
  const packed = ethers.solidityPacked(
    ["uint256", "uint256", "bytes32"],
    [price8dec, timestamp, salt]
  );
  const commitment = ethers.keccak256(packed);

  return { commitment, salt };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function submitPrice(overridePrice = null) {
  // Setup
  const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
  const wallet   = new ethers.Wallet(CONFIG.privateKey, provider);
  const oracle   = new ethers.Contract(CONFIG.oracleAddress, ORACLE_ABI, wallet);

  console.log("[Veris Agent] Submitter wallet:", wallet.address);

  // Fetch price
  const priceUSD  = await fetchBNBPrice(overridePrice);
  const price8dec = BigInt(Math.round(priceUSD * 1e8));
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  console.log(`[Veris Agent] Price (8 dec): ${price8dec}`);
  console.log(`[Veris Agent] Timestamp:     ${timestamp}`);

  // Generate commitment
  const { commitment, salt } = generateCommitment(price8dec, timestamp);
  console.log(`[Veris Agent] Commitment:    ${commitment}`);
  console.log(`[Veris Agent] Salt (secret): ${salt}`);

  // Submit to contract
  console.log("[Veris Agent] Submitting to VerisOracle...");
  const tx = await oracle.submitPrice(price8dec, timestamp, commitment);
  console.log(`[Veris Agent] TX hash: ${tx.hash}`);
  console.log(`[Veris Agent] BSC Explorer: https://testnet.bscscan.com/tx/${tx.hash}`);

  await tx.wait();
  console.log("[Veris Agent] ✅ Price verified on-chain");

  // Verify it was stored
  const latest = await oracle.latestPrice();
  console.log(`[Veris Agent] On-chain price: $${Number(latest.price) / 1e8}`);

  // Save salt locally for audit trail (in prod: store in Greenfield)
  const record = {
    price:      priceUSD,
    price8dec:  price8dec.toString(),
    timestamp:  timestamp.toString(),
    commitment,
    salt,
    txHash:     tx.hash,
    savedAt:    new Date().toISOString(),
  };

  const fs = require("fs");
  fs.mkdirSync("./agent/logs", { recursive: true });
  fs.writeFileSync(
    `./agent/logs/proof-${Date.now()}.json`,
    JSON.stringify(record, null, 2)
  );
  console.log("[Veris Agent] Proof log saved to ./agent/logs/");
}

/**
 * DEMO MODE: Simulate a price crash to trigger liquidation.
 * 
 * Usage: node oracle-agent.js --price 210
 * This submits $210 BNB price.
 * If vault was funded at $350 with 70% LTV, $210 = 85%+ LTV → liquidation.
 */
async function runDemo() {
  const args          = process.argv.slice(2);
  const priceFlag     = args.indexOf("--price");
  const overridePrice = priceFlag !== -1 ? args[priceFlag + 1] : null;

  if (overridePrice) {
    console.log("\n🚨 DEMO MODE: Simulating price drop to trigger liquidation\n");
  } else {
    console.log("\n🔮 VERIS ORACLE AGENT: Fetching live BNB price\n");
  }

  await submitPrice(overridePrice);
}

// ── Continuous mode: update every 60 seconds ─────────────────────────────

async function runContinuous() {
  console.log("[Veris Agent] Starting continuous price feed (60s interval)");
  while (true) {
    try {
      await submitPrice();
    } catch (err) {
      console.error("[Veris Agent] Error:", err.message);
    }
    await new Promise(r => setTimeout(r, 60_000));
  }
}

// ── Entry point ───────────────────────────────────────────────────────────

const isContinuous = process.argv.includes("--continuous");
if (isContinuous) {
  runContinuous();
} else {
  runDemo().catch(console.error);
}
