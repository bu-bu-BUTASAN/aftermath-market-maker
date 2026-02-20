import type { ExchangeName } from "../../exchanges/index.js";
import type { PriceSource } from "../../pricing/fair-price.js";
import { logger } from "../../utils/logger.js";

/**
 * Market maker configuration
 */
export interface MarketMakerConfig {
    // Exchange settings
    exchange: ExchangeName;
    symbol: string;

    // Price source
    /** Price oracle source ("binance" or "hyperliquid") */
    priceSource: PriceSource;

    // Spread settings
    /** Spread in basis points from fair price (default: 10 = 0.1%) */
    spreadBps: number;
    /** Tighter spread in close mode (default: 5 = 0.05%) */
    takeProfitBps: number;

    // Position limits
    /** Order size in USD (default: 100) */
    orderSizeUsd: number;
    /** Switch to close mode when position exceeds this (default: 500) */
    closeThresholdUsd: number;
    /** Maximum position size in USD before stopping (default: 2000) */
    maxPositionUsd: number;

    // Timing
    /** Warmup period before quoting in seconds (default: 10) */
    warmupSeconds: number;
    /** Minimum interval between order updates in ms (default: 100) */
    updateThrottleMs: number;
    /** Interval to sync orders with exchange in ms (default: 3000) */
    orderSyncIntervalMs: number;

    // Fair price
    /** Fair price EMA window in ms (default: 300000 = 5 min) */
    fairPriceWindowMs: number;

    // Risk
    /** Minimum margin ratio before pausing (default: 0.1 = 10%) */
    minMarginRatio: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Omit<MarketMakerConfig, "exchange" | "symbol"> = {
    // Price source
    priceSource: "binance",

    // Spread
    spreadBps: 10,
    takeProfitBps: 5,

    // Position limits
    orderSizeUsd: 100,
    closeThresholdUsd: 500,
    maxPositionUsd: 2000,

    // Timing
    warmupSeconds: 10,
    updateThrottleMs: 1000,
    orderSyncIntervalMs: 10000,

    // Fair price
    fairPriceWindowMs: 5 * 60 * 1000,

    // Risk
    minMarginRatio: 0.1,
};

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): Partial<MarketMakerConfig> {
    const config: Partial<MarketMakerConfig> = {};

    // Exchange settings
    if (process.env.EXCHANGE) {
        config.exchange = process.env.EXCHANGE as ExchangeName;
    }
    if (process.env.SYMBOL) {
        config.symbol = process.env.SYMBOL;
    }

    // Price source
    if (process.env.PRICE_SOURCE) {
        config.priceSource = process.env.PRICE_SOURCE as PriceSource;
    }

    // Spread settings
    if (process.env.SPREAD_BPS) {
        config.spreadBps = Number.parseInt(process.env.SPREAD_BPS, 10);
    }
    if (process.env.TAKE_PROFIT_BPS) {
        config.takeProfitBps = Number.parseInt(process.env.TAKE_PROFIT_BPS, 10);
    }

    // Position limits
    if (process.env.ORDER_SIZE_USD) {
        config.orderSizeUsd = Number.parseFloat(process.env.ORDER_SIZE_USD);
    }
    if (process.env.CLOSE_THRESHOLD_USD) {
        config.closeThresholdUsd = Number.parseFloat(process.env.CLOSE_THRESHOLD_USD);
    }
    if (process.env.MAX_POSITION_USD) {
        config.maxPositionUsd = Number.parseFloat(process.env.MAX_POSITION_USD);
    }

    // Timing
    if (process.env.WARMUP_SECONDS) {
        config.warmupSeconds = Number.parseInt(process.env.WARMUP_SECONDS, 10);
    }
    if (process.env.UPDATE_THROTTLE_MS) {
        config.updateThrottleMs = Number.parseInt(process.env.UPDATE_THROTTLE_MS, 10);
    }
    if (process.env.ORDER_SYNC_INTERVAL_MS) {
        config.orderSyncIntervalMs = Number.parseInt(process.env.ORDER_SYNC_INTERVAL_MS, 10);
    }

    // Fair price
    if (process.env.FAIR_PRICE_WINDOW_MS) {
        config.fairPriceWindowMs = Number.parseInt(process.env.FAIR_PRICE_WINDOW_MS, 10);
    }

    // Risk
    if (process.env.MIN_MARGIN_RATIO) {
        config.minMarginRatio = Number.parseFloat(process.env.MIN_MARGIN_RATIO);
    }

    return config;
}

/**
 * Merge configurations with defaults
 */
export function mergeConfig(
    exchange: ExchangeName,
    symbol: string,
    overrides?: Partial<MarketMakerConfig>
): MarketMakerConfig {
    const envConfig = loadConfigFromEnv();

    const config: MarketMakerConfig = {
        ...DEFAULT_CONFIG,
        exchange,
        symbol,
        ...envConfig,
        ...overrides,
    };

    logger.info("Market maker configuration:", config);
    return config;
}

/**
 * Validate configuration
 */
export function validateConfig(config: MarketMakerConfig): void {
    if (!config.exchange) {
        throw new Error("Exchange is required");
    }
    if (!config.symbol) {
        throw new Error("Symbol is required");
    }
    if (config.spreadBps <= 0) {
        throw new Error("spreadBps must be positive");
    }
    if (config.orderSizeUsd <= 0) {
        throw new Error("orderSizeUsd must be positive");
    }
    if (config.closeThresholdUsd <= 0) {
        throw new Error("closeThresholdUsd must be positive");
    }
    if (config.maxPositionUsd <= config.closeThresholdUsd) {
        throw new Error("maxPositionUsd must be greater than closeThresholdUsd");
    }
}
