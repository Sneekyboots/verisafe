require("dotenv").config();
const { ethers } = require("ethers");
const { generatePriceCommitment, verifyCommitment } = require("../zk/commitment");
const fs = require("fs");
const path = require("path");

const RPC = "https://data-seed-prebsc-1-s1.binance.org:8545";
const PK  = process.env.PRIVATE_KEY;
const ADDRS = {
  oracle:   process.env.VERIS_ORACLE,
  factory:  process.env.VAULT_FACTORY,
  creditNFT: process.env.CREDIT_NFT,
};

const provider = new ethers.JsonRpcProvider(RPC);
const wallet   = new ethers.Wallet(PK, provider);

function loadABI(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../abis", name + ".json")));
}

let passed = 0, failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log("✅ PASS");
    passed++;
  } catch(e) {
    console.log("❌ FAIL —", e.message);
    failed++;
  }
}

async function runTests() {
  console.log("\n🧪 VERISAFE TEST SUITE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("1. NETWORK");
  await test("BSC testnet connects", async () => {
    const block = await provider.getBlockNumber();
    if(block <= 0) throw new Error("No block");
  });

  await test("Wallet has balance", async () => {
    const bal = await provider.getBalance(wallet.address);
    if(bal <= 0n) throw new Error("No BNB");
    console.log(`\n     Balance: ${ethers.formatEther(bal)} BNB`);
  });

  console.log("\n2. ZK SYSTEM");
  await test("Generate commitment", async () => {
    const { proof, witness } = generatePriceCommitment(626.58);
    if(!proof.commitment.startsWith("0x")) throw new Error("Bad commitment");
  });

  await test("Verify with correct salt", async () => {
    const { proof, witness } = generatePriceCommitment(626.58);
    const ok = verifyCommitment(proof.price, proof.timestamp, witness.salt, proof.commitment);
    if(!ok) throw new Error("Verification failed");
  });

  await test("Reject wrong salt", async () => {
    const { proof } = generatePriceCommitment(626.58);
    const ok = verifyCommitment(proof.price, proof.timestamp, "0x"+"00".repeat(32), proof.commitment);
    if(ok) throw new Error("Should have failed");
  });

  console.log("\n3. CONTRACTS");
  await test("Oracle deployed + verified", async () => {
    const oracle = new ethers.Contract(ADDRS.oracle, loadABI("VerisOracle"), provider);
    const latest = await oracle.latestPrice();
    if(!latest.verified) throw new Error("Not verified");
    console.log(`\n     Price: $${(Number(latest.price)/1e8).toFixed(2)}`);
  });

  await test("Factory deployed", async () => {
    const factory = new ethers.Contract(ADDRS.factory, loadABI("VaultFactory"), provider);
    const total = await factory.totalVaults();
    console.log(`\n     Total vaults: ${total.toString()}`);
  });

  await test("Check vault for wallet", async () => {
    const factory = new ethers.Contract(ADDRS.factory, loadABI("VaultFactory"), provider);
    const has = await factory.hasVault(wallet.address);
    console.log(`\n     Has vault: ${has}`);
    if(has) {
      const addr = await factory.getVault(wallet.address);
      console.log(`\n     Vault: ${addr}`);
    }
  });

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ PASSED: ${passed}  ❌ FAILED: ${failed}`);
  if(failed === 0) console.log("\n🎉 ALL TESTS PASSED — DEMO READY\n");
}

runTests().catch(console.error);
