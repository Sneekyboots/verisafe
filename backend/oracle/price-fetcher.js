"use strict";

/**
 * Veris Price Fetcher — 4-source median aggregation
 *
 * Sources: Binance, Coinbase, Kraken, CoinGecko
 * Logic:
 *   1. Fetch all 4 in parallel (5s timeout each)
 *   2. Drop any that return error or invalid data
 *   3. Reject outliers > MAX_DEVIATION_BPS from median
 *   4. Require MIN_SOURCES to agree — else throw (refuse to submit)
 *   5. Return median of valid sources
 *
 * This means a single compromised or stale API cannot move the price.
 */

const MAX_DEVIATION_BPS = 200;  // 2% — sources outside this are outliers
const MIN_SOURCES       = 2;    // minimum valid sources required
const FETCH_TIMEOUT_MS  = 5000;

const SOURCES = [
    {
        name:  "Binance",
        url:   "https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
        parse: j => parseFloat(j.price),
    },
    {
        name:  "Coinbase",
        url:   "https://api.coinbase.com/v2/prices/BNB-USD/spot",
        parse: j => parseFloat(j.data.amount),
    },
    {
        name:  "Kraken",
        url:   "https://api.kraken.com/0/public/Ticker?pair=BNBUSD",
        parse: j => parseFloat(Object.values(j.result)[0].c[0]),
    },
    {
        name:  "CoinGecko",
        url:   "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
        parse: j => parseFloat(j.binancecoin.usd),
    },
];

async function fetchOne(source) {
    const ctrl    = new AbortController();
    const timer   = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res   = await fetch(source.url, { signal: ctrl.signal });
        const json  = await res.json();
        const price = source.parse(json);
        if (!isFinite(price) || price <= 0) throw new Error("invalid value");
        return { name: source.name, price, ok: true };
    } catch (e) {
        return { name: source.name, price: null, ok: false, error: e.message };
    } finally {
        clearTimeout(timer);
    }
}

function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function devBps(a, b) {
    return Math.round(Math.abs(a - b) / b * 10_000);
}

async function fetchAggregatedPrice(overridePrice = null) {
    if (overridePrice !== null) {
        const p = parseFloat(overridePrice);
        return { price: p, sources: [{ name: "OVERRIDE", price: p, ok: true }],
                 spread: 0, validCount: 1, override: true };
    }

    const results    = await Promise.all(SOURCES.map(fetchOne));
    const successful = results.filter(r => r.ok);

    for (const r of results) {
        if (r.ok) process.stdout.write(`  ✅ ${r.name.padEnd(10)} $${r.price.toFixed(2)}\n`);
        else       process.stdout.write(`  ❌ ${r.name.padEnd(10)} ${r.error}\n`);
    }

    if (successful.length < MIN_SOURCES)
        throw new Error(`Only ${successful.length} sources responded — refusing to submit`);

    const med1     = median(successful.map(r => r.price));
    const valid    = successful.filter(r => devBps(r.price, med1) <= MAX_DEVIATION_BPS);
    const outliers = successful.filter(r => devBps(r.price, med1) >  MAX_DEVIATION_BPS);

    for (const o of outliers)
        console.warn(`  ⚠️  OUTLIER ${o.name}: $${o.price.toFixed(2)} (${devBps(o.price, med1)}bps off)`);

    if (valid.length < MIN_SOURCES)
        throw new Error(`Only ${valid.length} valid sources after outlier filter — possible manipulation`);

    const finalPrices = valid.map(r => r.price);
    const finalMedian = median(finalPrices);
    const spread      = Math.max(...finalPrices.map(p => devBps(p, finalMedian)));

    console.log(`  Median: $${finalMedian.toFixed(2)} (${valid.length} sources, spread ${spread}bps)`);

    return {
        price:       finalMedian,
        sources:     results,
        validSources: valid,
        spread,
        validCount:  valid.length,
        override:    false,
    };
}

module.exports = { fetchAggregatedPrice, SOURCES };
