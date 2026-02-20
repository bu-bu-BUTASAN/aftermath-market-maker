import { logger } from "../../utils/logger.js";

/**
 * Aftermath API Client
 * HTTP client for Aftermath CCXT REST API
 */
export class AftermathClient {
  private baseUrl: string;

  /**
   * Create a new Aftermath API client
   * @param baseUrl - Base URL for Aftermath API (e.g., https://mainnet-perpetuals-preview.aftermath.finance)
   */
  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl || process.env.AF_BASE_URL || "https://aftermath.finance";
    logger.info(`AftermathClient initialized with base URL: ${this.baseUrl}`);
  }

  /**
   * Make a GET request to the Aftermath API
   * @param endpoint - API endpoint path (e.g., /api/ccxt/markets)
   * @param params - Optional query parameters
   * @returns Response data
   */
  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    // Add query parameters if provided
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value);
      }
    }

    logger.debug(`GET ${url.toString()}`);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Aftermath API GET ${endpoint} failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as T;
      logger.debug(`GET ${endpoint} response`, data);
      return data;
    } catch (error) {
      logger.error(`Aftermath API GET ${endpoint} error:`, error);
      throw error;
    }
  }

  /**
   * Make a POST request to the Aftermath API
   * @param endpoint - API endpoint path (e.g., /api/ccxt/orderbook)
   * @param body - Request body (will be JSON stringified)
   * @returns Response data
   */
  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    logger.debug(`POST ${url.toString()}`, body);

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Aftermath API POST ${endpoint} failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as T;
      logger.debug(`POST ${endpoint} response`, data);
      return data;
    } catch (error) {
      logger.error(`Aftermath API POST ${endpoint} error:`, error);
      throw error;
    }
  }

  /**
   * Get the base URL of the client
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
