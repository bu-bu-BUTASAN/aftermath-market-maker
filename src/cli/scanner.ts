#!/usr/bin/env node
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { program } from "commander";
import { config } from "dotenv";
import { logger } from "../utils/logger.js";

// Load environment variables
config();

// Types for market data
interface MarketData {
  symbol: string;
  midPrice: number | null;
  spreadBps: number | null;
  volume24h: number;
  fundingRate: number;
  openInterest: number;
  bestBid: number | null;
  bestAsk: number | null;
}

program
  .name("mm-scanner")
  .description("Scan all Hyperliquid markets for spread and volume opportunities")
  .version("1.0.0")
  .option("--sort <field>", "Sort by field (volume, spread)", "volume")
  .option("--min-volume <usd>", "Minimum 24h volume in USD", "0")
  .option("--min-spread <bps>", "Minimum spread in bps", "0")
  .option("--limit <n>", "Limit number of results", "50")
  .option("--refresh <ms>", "Refresh interval in milliseconds (min 5000)", "10000")
  .option("--testnet", "Use testnet", false)
  .parse(process.argv);

const options = program.opts();

const sortField = options.sort as "volume" | "spread";
const minVolume = Number.parseFloat(options.minVolume);
const minSpread = Number.parseFloat(options.minSpread);
const limit = Number.parseInt(options.limit, 10);
// Minimum 5 seconds to avoid rate limiting
const refreshMs = Math.max(5000, Number.parseInt(options.refresh, 10));
const isTestnet = options.testnet || process.env.HL_TESTNET === "true";

// Clear screen and move cursor to top
function clearScreen(): void {
  process.stdout.write("\x1B[2J\x1B[0f");
}

// Format volume with appropriate suffix
function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) {
    return `$${(volume / 1_000_000_000).toFixed(2)}B`;
  }
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(2)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

// Format price
function formatPrice(price: number | null): string {
  if (price === null) return "-";
  if (price >= 1000) return `$${price.toFixed(2)}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(8)}`;
}

// Format spread
function formatSpread(spread: number | null): string {
  if (spread === null) return "-";
  return `${spread.toFixed(1)}`;
}

// Format funding rate as percentage
function formatFunding(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Render table
function render(markets: MarketData[], isFetching: boolean): void {
  clearScreen();

  const now = new Date().toISOString();
  console.log("=== Hyperliquid Market Scanner ===");
  console.log(`Updated: ${now}${isFetching ? " (refreshing...)" : ""}`);
  console.log(
    `Sorted by: ${sortField} | Min Volume: ${formatVolume(minVolume)} | Min Spread: ${minSpread} bps | Showing: ${Math.min(markets.length, limit)} of ${markets.length}`
  );
  console.log("");

  // Table header
  console.log(
    "Symbol".padEnd(12) +
      "Mid Price".padStart(14) +
      "Spread(bps)".padStart(12) +
      "24h Volume".padStart(14) +
      "Funding".padStart(12) +
      "OI".padStart(14)
  );
  console.log("-".repeat(78));

  // Display limited rows
  const displayMarkets = markets.slice(0, limit);
  for (const m of displayMarkets) {
    const row =
      m.symbol.padEnd(12) +
      formatPrice(m.midPrice).padStart(14) +
      formatSpread(m.spreadBps).padStart(12) +
      formatVolume(m.volume24h).padStart(14) +
      formatFunding(m.fundingRate).padStart(12) +
      formatVolume(m.openInterest).padStart(14);
    console.log(row);
  }

  console.log("");
  console.log(`Refresh: ${refreshMs / 1000}s | Press Ctrl+C to exit`);
}

// Fetch all market data
async function fetchMarketData(info: InfoClient): Promise<MarketData[]> {
  // Fetch metadata and asset contexts
  const [meta, assetCtxs] = await info.metaAndAssetCtxs();

  // Build market list with 24h volume and funding
  const markets: MarketData[] = [];

  for (let i = 0; i < meta.universe.length; i++) {
    const asset = meta.universe[i];
    const ctx = assetCtxs[i];

    if (!ctx || asset.isDelisted) continue;

    const symbol = asset.name;
    const midPrice = ctx.midPx ? Number.parseFloat(ctx.midPx) : null;
    const volume24h = Number.parseFloat(ctx.dayNtlVlm);
    const fundingRate = Number.parseFloat(ctx.funding);
    const openInterest = Number.parseFloat(ctx.openInterest);

    markets.push({
      symbol,
      midPrice,
      spreadBps: null, // Will be calculated from l2Book
      volume24h,
      fundingRate,
      openInterest,
      bestBid: null,
      bestAsk: null,
    });
  }

  // Fetch l2Book for each market to calculate spread (batch with Promise.all)
  // Limit concurrency and add delay between batches to avoid rate limiting
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);
    const l2Books = await Promise.all(
      batch.map((m) => info.l2Book({ coin: m.symbol }).catch(() => null))
    );

    for (let j = 0; j < batch.length; j++) {
      const book = l2Books[j];
      if (book && book.levels[0].length > 0 && book.levels[1].length > 0) {
        const bestBid = Number.parseFloat(book.levels[0][0].px);
        const bestAsk = Number.parseFloat(book.levels[1][0].px);
        const spreadBps = ((bestAsk - bestBid) / bestBid) * 10000;

        batch[j].bestBid = bestBid;
        batch[j].bestAsk = bestAsk;
        batch[j].spreadBps = spreadBps;
      }
    }

    // Add delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < markets.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return markets;
}

// Filter and sort markets
function processMarkets(markets: MarketData[]): MarketData[] {
  // Filter
  let filtered = markets.filter((m) => m.volume24h >= minVolume);
  if (minSpread > 0) {
    filtered = filtered.filter((m) => m.spreadBps !== null && m.spreadBps >= minSpread);
  }

  // Sort
  if (sortField === "spread") {
    filtered.sort((a, b) => {
      if (a.spreadBps === null) return 1;
      if (b.spreadBps === null) return -1;
      return b.spreadBps - a.spreadBps; // Descending (wider spread first)
    });
  } else {
    // Default: volume
    filtered.sort((a, b) => b.volume24h - a.volume24h); // Descending
  }

  return filtered;
}

// Main
async function main(): Promise<void> {
  logger.info(`Starting Hyperliquid market scanner (${isTestnet ? "testnet" : "mainnet"})`);
  logger.info(`Refresh interval: ${refreshMs}ms`);

  // Initialize transport and info client
  const transport = new HttpTransport({ isTestnet });
  const info = new InfoClient({ transport });

  // State
  let markets: MarketData[] = [];
  let processed: MarketData[] = [];
  let isFetching = false;

  // Initial fetch
  markets = await fetchMarketData(info);
  processed = processMarkets(markets);
  render(processed, false);

  // Start refresh interval
  const refreshInterval = setInterval(async () => {
    // Skip if already fetching
    if (isFetching) {
      return;
    }

    isFetching = true;
    render(processed, true); // Show refreshing indicator

    try {
      markets = await fetchMarketData(info);
      processed = processMarkets(markets);
      render(processed, false);
    } catch (error) {
      // Keep showing old data on error, just log
      logger.debug("Failed to fetch market data, will retry:", error);
      render(processed, false);
    } finally {
      isFetching = false;
    }
  }, refreshMs);

  // Handle shutdown
  function shutdown(): void {
    clearInterval(refreshInterval);
    logger.info("Scanner stopped");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("Scanner error:", error);
  process.exit(1);
});
