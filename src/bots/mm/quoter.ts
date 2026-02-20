import type { Market, OrderRequest, Side } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { MarketMakerConfig } from "./config.js";

/**
 * Quote with bid and ask prices
 */
export interface Quote {
    bidPrice: number;
    askPrice: number;
    bidSize: number;
    askSize: number;
    fairPrice: number;
    spreadBps: number;
    isCloseMode: boolean;
}

/**
 * Quote generator for market making
 */
export class Quoter {
    private config: MarketMakerConfig;
    private market: Market | null = null;

    constructor(config: MarketMakerConfig) {
        this.config = config;
    }

    /**
     * Set the market for price rounding
     */
    setMarket(market: Market): void {
        this.market = market;
        logger.debug(`Quoter market set: ${market.symbol}, tickSize=${market.tickSize}`);
    }

    /**
     * Generate bid/ask quotes around fair price
     * @param fairPrice - Current fair price from Binance
     * @param positionNotional - Current position notional value (positive = long, negative = short)
     * @param orderbook - Current orderbook (optional, for post-only check)
     */
    generateQuotes(fairPrice: number, positionNotional: number, orderbook?: { bids: [number, number][]; asks: [number, number][] }): Quote {
        // Determine if we're in close mode
        const isCloseMode = Math.abs(positionNotional) > this.config.closeThresholdUsd;

        // Use tighter spread in close mode
        const spreadBps = isCloseMode ? this.config.takeProfitBps : this.config.spreadBps;

        // Calculate spread multiplier
        const spreadMultiplier = spreadBps / 10000;

        // Calculate bid and ask prices
        let bidPrice = fairPrice * (1 - spreadMultiplier);
        let askPrice = fairPrice * (1 + spreadMultiplier);

        // Filter out invalid prices
        if (bidPrice <= 0) bidPrice = 0;
        if (askPrice <= 0) askPrice = 0;

        // Round to tick size
        if (this.market) {
            bidPrice = this.roundToTick(bidPrice, "down");
            askPrice = this.roundToTick(askPrice, "up");

            // Post-only check using orderbook
            if (orderbook) {
                // If we have asks, ensure bid is at least 1 tick below best ask
                if (orderbook.asks.length > 0) {
                    const bestAsk = orderbook.asks[0][0];
                    const maxBid = bestAsk - this.market.tickSize;
                    if (bidPrice >= bestAsk) {
                        logger.debug(`Adjusting bid from ${bidPrice} to ${maxBid} to avoid taking liquidity (Best Ask: ${bestAsk})`);
                        bidPrice = Math.min(bidPrice, maxBid);
                    }
                }

                // If we have bids, ensure ask is at least 1 tick above best bid
                if (orderbook.bids.length > 0) {
                    const bestBid = orderbook.bids[0][0];
                    const minAsk = bestBid + this.market.tickSize;
                    if (askPrice <= bestBid) {
                        logger.debug(`Adjusting ask from ${askPrice} to ${minAsk} to avoid taking liquidity (Best Bid: ${bestBid})`);
                        askPrice = Math.max(askPrice, minAsk);
                    }
                }
            }
        }

        // Calculate order sizes using actual order prices to ensure minimum notional is met
        // Using fairPrice would result in bid notional < orderSizeUsd due to spread
        let bidSize = bidPrice > 0 ? this.config.orderSizeUsd / bidPrice : 0;
        let askSize = askPrice > 0 ? this.config.orderSizeUsd / askPrice : 0;

        // In close mode, only quote on the reducing side
        if (isCloseMode) {
            if (positionNotional > 0) {
                // Long position - only quote asks to reduce
                bidSize = 0;
                logger.debug("Close mode: long position, only asking");
            } else {
                // Short position - only quote bids to reduce
                askSize = 0;
                logger.debug("Close mode: short position, only bidding");
            }
        }

        // Round sizes to precision
        if (this.market) {
            bidSize = this.roundSize(bidSize);
            askSize = this.roundSize(askSize);
        }

        return {
            bidPrice,
            askPrice,
            bidSize,
            askSize,
            fairPrice,
            spreadBps,
            isCloseMode,
        };
    }

    /**
     * Convert quote to order requests
     */
    quoteToOrders(quote: Quote, reduceOnly = false): OrderRequest[] {
        const orders: OrderRequest[] = [];

        if (quote.bidSize > 0) {
            orders.push({
                symbol: this.config.symbol,
                side: "buy",
                type: "limit",
                price: quote.bidPrice,
                size: quote.bidSize,
                postOnly: true,
                reduceOnly: reduceOnly || quote.isCloseMode,
            });
        }

        if (quote.askSize > 0) {
            orders.push({
                symbol: this.config.symbol,
                side: "sell",
                type: "limit",
                price: quote.askPrice,
                size: quote.askSize,
                postOnly: true,
                reduceOnly: reduceOnly || quote.isCloseMode,
            });
        }

        return orders;
    }

    /**
     * Round price to tick size
     */
    private roundToTick(price: number, direction: "up" | "down"): number {
        if (!this.market) return price;

        const tickSize = this.market.tickSize;
        if (direction === "down") {
            return Math.floor(price / tickSize) * tickSize;
        }
        return Math.ceil(price / tickSize) * tickSize;
    }

    /**
     * Round size up to precision (ceil to ensure minimum order value is met)
     */
    private roundSize(size: number): number {
        if (!this.market) return size;

        const precision = this.market.sizePrecision;
        const multiplier = 10 ** precision;
        return Math.ceil(size * multiplier) / multiplier;
    }

    /**
     * Check if an order price is stale (too far from fair price)
     * @param orderPrice - Current order price
     * @param orderSide - Order side
     * @param fairPrice - Current fair price
     * @param maxDeviationBps - Maximum allowed deviation in bps
     */
    isOrderStale(
        orderPrice: number,
        _orderSide: Side,
        fairPrice: number,
        maxDeviationBps = 50
    ): boolean {
        const deviation = Math.abs(orderPrice - fairPrice) / fairPrice;
        const deviationBps = deviation * 10000;
        return deviationBps > maxDeviationBps;
    }
}
