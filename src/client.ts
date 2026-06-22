import type { ZodType } from 'zod';
import type {
	GetOhlcvParams,
	GetOpenPortfolioParams,
	GetPositionPnlParams,
	MeteoraDlmmClientOptions,
	Ohlcv,
	OpenPortfolio,
	PositionPnl,
} from './types';
import type { MeteoraApiError as MeteoraApiErrorType } from './errors';
import { MeteoraApiError as MeteoraApiErrorClass } from './errors';
import {
	DEFAULT_TIMEOUT_MS,
	METEORA_DLMM_MAINNET_URL,
} from './constants';
import { OhlcvSchema, OpenPortfolioSchema, PositionPnlSchema } from './types';

/** Client for the Meteora DLMM REST API. */
export class MeteoraDlmmClient {
	private readonly baseUrl: string;
	private readonly timeout: number;
	private readonly fetchFn: typeof fetch;

	constructor(options: MeteoraDlmmClientOptions = {}) {
		this.baseUrl = (options.baseUrl ?? METEORA_DLMM_MAINNET_URL).replace(/\/+$/, '');
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
		this.fetchFn = options.fetch ?? fetch;
	}

	/**
	 * Get a user's portfolio across all pools that contain open positions.
	 *
	 * @throws {MeteoraApiError} on a non-2xx HTTP response (carries `.status` and parsed `.body`).
	 * @throws {ZodError} (from `zod`) when a 2xx response body does not match the expected schema.
	 * @throws {TypeError} when `params.user` is missing or empty (before any network call).
	 */
	async getOpenPortfolio(params: GetOpenPortfolioParams): Promise<OpenPortfolio> {
		if (typeof params?.user !== 'string' || params.user.length === 0) {
			throw new TypeError('getOpenPortfolio requires a non-empty "user" wallet address.');
		}

		const url = this.buildUrl('/portfolio/open', toPortfolioQuery(params));
		return this.request(url, OpenPortfolioSchema);
	}

	/**
	 * Get a user's positions in a specific pool with calculated PnL (open and/or closed).
	 *
	 * @param poolAddress - The pool (LB pair) address. URL-encoded automatically.
	 * @param params - Query params; `user` is required.
	 * @throws {MeteoraApiError} on a non-2xx HTTP response (e.g. invalid `user` → 400).
	 * @throws {ZodError} (from `zod`) when a 2xx response body does not match the expected schema.
	 * @throws {TypeError} when `poolAddress` or `params.user` is missing/empty (before any network call).
	 */
	async getPositionPnl(poolAddress: string, params: GetPositionPnlParams): Promise<PositionPnl> {
		if (typeof poolAddress !== 'string' || poolAddress.length === 0) {
			throw new TypeError('getPositionPnl requires a non-empty "poolAddress".');
		}
		if (typeof params?.user !== 'string' || params.user.length === 0) {
			throw new TypeError('getPositionPnl requires a non-empty "user" wallet address.');
		}

		const path = `/positions/${encodeURIComponent(poolAddress)}/pnl`;
		const url = this.buildUrl(path, toPositionPnlQuery(params));
		return this.request(url, PositionPnlSchema);
	}

	/**
	 * Get OHLCV candles for a pool over a time window (price history for charting).
	 *
	 * @param address - The pool (LB pair) address. URL-encoded automatically.
	 * @param params - Optional query params: `timeframe` (candle interval, default `24h`),
	 *   `start_time`/`end_time` (unix seconds, inclusive). Omit the window to use the
	 *   API's default range for the chosen timeframe.
	 * @throws {MeteoraApiError} on a non-2xx response (invalid `address` → 400; invalid `timeframe` → 400).
	 * @throws {ZodError} (from `zod`) when a 2xx response body does not match the expected schema.
	 * @throws {TypeError} when `address` is missing/empty (before any network call).
	 */
	async getOhlcv(address: string, params?: GetOhlcvParams): Promise<Ohlcv> {
		if (typeof address !== 'string' || address.length === 0) {
			throw new TypeError('getOhlcv requires a non-empty "address".');
		}

		const path = `/pools/${encodeURIComponent(address)}/ohlcv`;
		const url = this.buildUrl(path, toOhlcvQuery(params));
		return this.request(url, OhlcvSchema);
	}

	private buildUrl(path: string, query: URLSearchParams): string {
		const qs = query.toString();
		return qs.length > 0 ? `${this.baseUrl}${path}?${qs}` : `${this.baseUrl}${path}`;
	}

	private async request<T>(url: string, schema: ZodType<T>): Promise<T> {
		const response = await this.fetchFn(url, {
			method: 'GET',
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(this.timeout),
		});

		if (!response.ok) {
			const body = await parseBody(response);
			const message = extractMessage(body) ?? `Meteora API request failed with status ${response.status}`;
			throw new MeteoraApiErrorClass(response.status, message, body);
		}

		return schema.parse(await response.json());
	}
}

/** Maps camelCase client params to the API's snake_case query parameters. */
function toPortfolioQuery(params: GetOpenPortfolioParams): URLSearchParams {
	const query = new URLSearchParams();
	query.set('user', params.user);
	if (params.page !== undefined) query.set('page', String(params.page));
	if (params.pageSize !== undefined) query.set('page_size', String(params.pageSize));
	if (params.sortBy !== undefined) query.set('sort_by', params.sortBy);
	if (params.sortDirection !== undefined) query.set('sort_direction', params.sortDirection);
	return query;
}

/** Maps camelCase client params to the API's snake_case query parameters for /positions/{pool}/pnl. */
function toPositionPnlQuery(params: GetPositionPnlParams): URLSearchParams {
	const query = new URLSearchParams();
	query.set('user', params.user);
	if (params.status !== undefined) query.set('status', params.status);
	if (params.page !== undefined) query.set('page', String(params.page));
	if (params.pageSize !== undefined) query.set('page_size', String(params.pageSize));
	return query;
}

/** Maps camelCase client params to the API's snake_case query parameters for /pools/{address}/ohlcv. */
function toOhlcvQuery(params: GetOhlcvParams | undefined): URLSearchParams {
	const query = new URLSearchParams();
	if (params === undefined) return query;
	if (params.timeframe !== undefined) query.set('timeframe', params.timeframe);
	if (params.start_time !== undefined) query.set('start_time', String(params.start_time));
	if (params.end_time !== undefined) query.set('end_time', String(params.end_time));
	return query;
}

async function parseBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text.length === 0) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function extractMessage(body: unknown): string | undefined {
	if (body !== null && typeof body === 'object' && 'message' in body) {
		const message = (body as { message?: unknown }).message;
		if (typeof message === 'string') return message;
	}
	return undefined;
}

// Re-export the error type so consumers can `import { MeteoraApiError } from 'metter'`.
export type { MeteoraApiErrorType };
