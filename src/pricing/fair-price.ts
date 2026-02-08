import { logger } from "../utils/logger.js";
import { BinancePriceFeed, type PriceCallback } from "./binance.js";
import { HyperliquidPriceFeed } from "./hyperliquid.js";
import { HyperpsPriceFeed } from "./hyperps.js";

export type PriceSource = "binance" | "hyperliquid" | "hyperps";

/**
 * Configuration for fair price calculator
 */
export interface FairPriceConfig {
    /** Price source ("binance" or "hyperliquid") */
    priceSource?: PriceSource;
    /** EMA window in milliseconds (default: 5 minutes) */
    windowMs?: number;
    /** EMA smoothing factor alpha (default: calculated from window) */
    alpha?: number;
    /** Minimum prices needed before returning fair price */
    minPrices?: number;
    /** Warmup period in milliseconds */
    warmupMs?: number;
    /** Use testnet (for Hyperliquid) */
    isTestnet?: boolean;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MIN_PRICES = 10;
const DEFAULT_WARMUP_MS = 10 * 1000; // 10 seconds

/**
 * Common interface for price feeds
 */
interface IPriceFeed {
    connect(): Promise<void>;
    disconnect(): void;
    getLastPrice(): number | null;
    getLastTimestamp(): number | null;
    readonly connected: boolean;
}

/**
 * Fair price calculator using EMA of prices from configurable source
 * Supports Binance (spot) and Hyperliquid (perps) as price oracles
 */
export class FairPriceCalculator {
    private priceFeed: IPriceFeed;
    private priceSource: PriceSource;
    private ema: number | null = null;
    private alpha: number;
    private priceCount = 0;
    private minPrices: number;
    private warmupMs: number;
    private startTime: number;
    private lastUpdateTime: number | null = null;
    private priceCallbacks: PriceCallback[] = [];

    /**
     * Create a fair price calculator
     * @param symbol - Trading symbol (e.g., "BTC")
     * @param config - Configuration options
     */
    constructor(symbol: string, config?: FairPriceConfig) {
        const windowMs = config?.windowMs || DEFAULT_WINDOW_MS;
        // Calculate alpha for EMA: alpha = 2 / (N + 1) where N is number of periods
        // For time-based EMA, we estimate ~1 trade per second
        const estimatedPeriods = windowMs / 1000;
        this.alpha = config?.alpha || 2 / (estimatedPeriods + 1);
        this.minPrices = config?.minPrices || DEFAULT_MIN_PRICES;
        this.warmupMs = config?.warmupMs || DEFAULT_WARMUP_MS;
        this.startTime = Date.now();
        this.priceSource = config?.priceSource || "binance";

        // Create price feed based on source
        const priceHandler = (price: number, timestamp: number) => {
            this.updateEMA(price, timestamp);
        };

        if (this.priceSource === "hyperps") {
            this.priceFeed = new HyperpsPriceFeed(symbol, priceHandler, config?.isTestnet ?? false);
        } else if (this.priceSource === "hyperliquid") {
            this.priceFeed = new HyperliquidPriceFeed(symbol, priceHandler, config?.isTestnet ?? false);
        } else {
            this.priceFeed = new BinancePriceFeed(symbol, priceHandler);
        }

        logger.info(
            `FairPriceCalculator created for ${symbol} using ${this.priceSource}, alpha=${this.alpha.toFixed(6)}, warmup=${this.warmupMs}ms`
        );
    }

    /**
     * Update EMA with new price
     */
    private updateEMA(price: number, timestamp: number): void {
        if (this.ema === null) {
            // First price - initialize EMA
            this.ema = price;
        } else {
            // Update EMA: EMA = alpha * price + (1 - alpha) * EMA
            this.ema = this.alpha * price + (1 - this.alpha) * this.ema;
        }

        this.priceCount++;
        this.lastUpdateTime = timestamp;

        // Notify callbacks
        for (const callback of this.priceCallbacks) {
            callback(this.ema, timestamp);
        }
    }

    /**
     * Connect to price feed
     */
    async connect(): Promise<void> {
        await this.priceFeed.connect();
    }

    /**
     * Disconnect from price feed
     */
    disconnect(): void {
        this.priceFeed.disconnect();
    }

    /**
     * Get the current fair price (EMA)
     * @returns Fair price or null if not ready
     */
    getFairPrice(): number | null {
        if (!this.isReady()) {
            return null;
        }
        return this.ema;
    }

    /**
     * Check if the calculator has warmed up
     */
    isWarmedUp(): boolean {
        const elapsed = Date.now() - this.startTime;
        return elapsed >= this.warmupMs && this.priceCount >= this.minPrices;
    }

    /**
     * Check if the calculator is ready to provide fair prices
     */
    isReady(): boolean {
        return this.ema !== null && this.isWarmedUp();
    }

    /**
     * Get the number of prices received
     */
    getPriceCount(): number {
        return this.priceCount;
    }

    /**
     * Get time elapsed since start
     */
    getElapsedMs(): number {
        return Date.now() - this.startTime;
    }

    /**
     * Get time remaining in warmup
     */
    getWarmupRemainingMs(): number {
        const remaining = this.warmupMs - this.getElapsedMs();
        return Math.max(0, remaining);
    }

    /**
     * Get the last raw price from the feed
     */
    getLastRawPrice(): number | null {
        return this.priceFeed.getLastPrice();
    }

    /**
     * Get the last update timestamp
     */
    getLastUpdateTime(): number | null {
        return this.lastUpdateTime;
    }

    /**
     * Get the price source being used
     */
    getPriceSource(): PriceSource {
        return this.priceSource;
    }

    /**
     * Get a display label for the price source
     */
    getPriceSourceLabel(): string {
        switch (this.priceSource) {
            case "hyperps":
                return "Hyperps Oracle (8h EMA)";
            case "hyperliquid":
                return "Hyperliquid Mid";
            case "binance":
            default:
                return "Binance Spot";
        }
    }

    /**
     * Subscribe to price updates
     * @param callback - Called with (ema, timestamp) on each update
     */
    onPriceUpdate(callback: PriceCallback): void {
        this.priceCallbacks.push(callback);
    }

    /**
     * Remove a price update callback
     */
    offPriceUpdate(callback: PriceCallback): void {
        const index = this.priceCallbacks.indexOf(callback);
        if (index >= 0) {
            this.priceCallbacks.splice(index, 1);
        }
    }

    /**
     * Check if connected to price feed
     */
    get connected(): boolean {
        return this.priceFeed.connected;
    }
}

/**
 * Create and connect a fair price calculator
 */
export async function createFairPriceCalculator(
    symbol: string,
    config?: FairPriceConfig
): Promise<FairPriceCalculator> {
    const calculator = new FairPriceCalculator(symbol, config);
    await calculator.connect();
    return calculator;
}
