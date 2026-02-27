pragma circom 2.0.0;

/**
 * Veris Price Commitment Circuit
 *
 * Proves: "I know a secret salt such that Poseidon(price, timestamp, salt) = commitment"
 *
 * Public inputs  : price, timestamp     — everyone sees these on-chain
 * Private inputs : salt                 — NEVER revealed, this is the ZK part
 * Public output  : commitment           — stored on-chain
 *
 * Why Poseidon instead of keccak256?
 *   Poseidon is a ZK-friendly hash. keccak256 requires ~28,000 constraints in circom.
 *   Poseidon requires ~240 constraints. Much faster proof generation.
 *   Poseidon is used by Zcash, Tornado Cash, and most production ZK systems.
 */

include "../node_modules/circomlib/circuits/poseidon.circom";

template PriceCommitment() {

    // ── Inputs ──────────────────────────────────────────────────────────
    // Public: published on-chain with every price update
    signal input price;      // BNB/USD × 1e8 (e.g. 61651000000 = $616.51)
    signal input timestamp;  // Unix timestamp of the price fetch

    // Private: only the Veris agent knows this
    signal input salt;       // Random 251-bit number (fits BN128 field)

    // ── Output ──────────────────────────────────────────────────────────
    // Commitment published on-chain. Can be reproduced by anyone who knows salt.
    signal output commitment;

    // ── Computation ─────────────────────────────────────────────────────
    // Poseidon(price, timestamp, salt) → commitment
    component hasher = Poseidon(3);
    hasher.inputs[0] <== price;
    hasher.inputs[1] <== timestamp;
    hasher.inputs[2] <== salt;

    commitment <== hasher.out;
}

/**
 * main component:
 *   {public [price, timestamp]} means these are public inputs
 *   salt is private by default (not in the public list)
 *   commitment is the public output
 */
component main {public [price, timestamp]} = PriceCommitment();
