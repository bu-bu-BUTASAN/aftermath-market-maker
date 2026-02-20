import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { logger } from "../utils/logger.js";

export type PriceCallback = (price: number, timestamp: number) => void;

/**
 * Hyperps (Hyperliquid-only perps) price feed
 * Uses oraclePx (8-hour EMA) from metaAndAssetCtxs API
 * For pre-market tokens without external spot price
 */
export class HyperpsPriceFeed {
    private transport: HttpTransport | null = null;
    private info: InfoClient | null = null;
    private symbol: string;
    private callback: PriceCallback;
    private isTestnet: boolean;
    private pollInterval: NodeJS.Timeout | null = null;
    private pollMs: number;
    private lastPrice: number | null = null;
    private lastTimestamp: number | null = null;
    private _connected = false;

    /**
     * Create a Hyperps price feed
     * @param symbol - Trading symbol (e.g., "MEGA", "PURR")
     * @param callback - Called on each price update with oracle price (8h EMA)
     * @param isTestnet - Use testnet (default: false)
     * @param pollMs - Polling interval in milliseconds (default: 2000)
     */
    constructor(symbol: string, callback: PriceCallback, isTestnet = false, pollMs = 5000) {
        this.symbol = symbol.toUpperCase();
        this.callback = callback;
        this.isTestnet = isTestnet;
        this.pollMs = pollMs;
    }

    /**
     * Connect and start polling
     */
    async connect(): Promise<void> {
        if (this._connected) {
            return;
        }

        logger.info(
            `Connecting to Hyperps price feed for ${this.symbol} (${this.isTestnet ? "testnet" : "mainnet"})`
        );

        // Initialize HTTP transport and info client
        this.transport = new HttpTransport({ isTestnet: this.isTestnet });
        this.info = new InfoClient({ transport: this.transport });

        // Fetch initial price
        await this.fetchOraclePrice();

        // Start polling
        this.pollInterval = setInterval(() => {
            this.fetchOraclePrice().catch((error) => {
                logger.debug("Failed to fetch Hyperps oracle price:", error);
            });
        }, this.pollMs);

        this._connected = true;
        logger.info(`Hyperps price feed connected for ${this.symbol} (oracle 8h EMA)`);
    }

    /**
     * Fetch oracle price (8h EMA) from metaAndAssetCtxs
     */
    private async fetchOraclePrice(): Promise<void> {
        if (!this.info) {
            return;
        }

        try {
            const [meta, assetCtxs] = await this.info.metaAndAssetCtxs();

            // Find the asset by symbol
            const assetIndex = meta.universe.findIndex(
                (asset) => asset.name.toUpperCase() === this.symbol
            );

            if (assetIndex === -1) {
                logger.debug(`Asset ${this.symbol} not found in Hyperliquid universe`);
                return;
            }

            const ctx = assetCtxs[assetIndex];
            if (!ctx) {
                return;
            }

            // oraclePx is the 8-hour EMA used for funding calculation
            const oraclePrice = Number.parseFloat(ctx.oraclePx);
            const timestamp = Date.now();

            if (!Number.isNaN(oraclePrice) && oraclePrice > 0) {
                this.lastPrice = oraclePrice;
                this.lastTimestamp = timestamp;
                this.callback(oraclePrice, timestamp);
            }
        } catch (error) {
            logger.debug("Error fetching Hyperps oracle price:", error);
            throw error;
        }
    }

    /**
     * Disconnect and stop polling
     */
    disconnect(): void {
        logger.info("Disconnecting from Hyperps price feed");

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.transport = null;
        this.info = null;
        this._connected = false;
    }

    /**
     * Get the last received oracle price
     */
    getLastPrice(): number | null {
        return this.lastPrice;
    }

    /**
     * Get the last price timestamp
     */
    getLastTimestamp(): number | null {
        return this.lastTimestamp;
    }

    /**
     * Check if connected
     */
    get connected(): boolean {
        return this._connected;
    }
}

/**
 * Create a Hyperps price feed and connect
 * @param symbol - Trading symbol
 * @param callback - Price callback
 * @param isTestnet - Use testnet
 */
export async function createHyperpsPriceFeed(
    symbol: string,
    callback: PriceCallback,
    isTestnet = false
): Promise<HyperpsPriceFeed> {
    const feed = new HyperpsPriceFeed(symbol, callback, isTestnet);
    await feed.connect();
    return feed;
}
