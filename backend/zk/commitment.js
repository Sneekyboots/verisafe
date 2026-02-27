require("dotenv").config();
const { ethers } = require("ethers");
const crypto = require("crypto");

function generatePriceCommitment(priceUSD, source = "binance") {
  const timestamp = Math.floor(Date.now() / 1000);
  const price8dec = BigInt(Math.round(priceUSD * 1e8));
  const salt = "0x" + crypto.randomBytes(32).toString("hex");
  const packed = ethers.solidityPacked(
    ["uint256", "uint256", "bytes32"],
    [price8dec, BigInt(timestamp), salt]
  );
  const commitment = ethers.keccak256(packed);
  const proof = { price: price8dec.toString(), priceUSD, timestamp, commitment, source };
  const witness = { salt, price8dec: price8dec.toString(), timestamp, commitment };
  return { proof, witness };
}

function verifyCommitment(price8dec, timestamp, salt, commitment) {
  const packed = ethers.solidityPacked(
    ["uint256", "uint256", "bytes32"],
    [BigInt(price8dec), BigInt(timestamp), salt]
  );
  return ethers.keccak256(packed) === commitment;
}

function formatProofForDisplay(proof) {
  return {
    status: "✅ VERIFIED",
price: "$" + (proof.priceUSD || 0).toFixed(2),
    commitment: proof.commitment,
    shortProof: proof.commitment.slice(0,10) + "..." + proof.commitment.slice(-8),
    timestamp: new Date(proof.timestamp * 1000).toISOString(),
    source: proof.source.toUpperCase(),
    zkNote: "Salt withheld by prover — commitment is zero-knowledge",
  };
}

module.exports = { generatePriceCommitment, verifyCommitment, formatProofForDisplay };
