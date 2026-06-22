import { z } from 'zod';

/** Sort direction for list endpoints. */
export type SortDirection = 'asc' | 'desc';
export const SortDirectionSchema: z.ZodType<SortDirection> = z.enum(['asc', 'desc']);

/** Fields you can sort the open-portfolio pool list by. */
export type OpenPortfolioSortBy =
	| 'current_balances'
	| 'unclaimed_fee'
	| 'fee_per_tvl24h';
export const OpenPortfolioSortBySchema: z.ZodType<OpenPortfolioSortBy> = z.enum([
	'current_balances',
	'unclaimed_fee',
	'fee_per_tvl24h',
]);

/** Aggregated total metrics across all pools in the open portfolio. */
export interface OpenPortfolioTotal {
	totalPositions: number;
	balances: string;
	balancesSol?: string | null;
	unclaimedFees: string;
	unclaimedFeesSol?: string | null;
	pnl: string;
	pnlPctChange: string;
	pnlSol?: string | null;
	pnlSolPctChange?: string | null;
}
export const OpenPortfolioTotalSchema: z.ZodType<OpenPortfolioTotal> = z.object({
	totalPositions: z.number(),
	balances: z.string(),
	balancesSol: z.string().nullish(),
	unclaimedFees: z.string(),
	unclaimedFeesSol: z.string().nullish(),
	pnl: z.string(),
	pnlPctChange: z.string(),
	pnlSol: z.string().nullish(),
	pnlSolPctChange: z.string().nullish(),
});

/** One pool's worth of the user's open-position portfolio data. */
export interface OpenPortfolioPoolItem {
	poolAddress: string;
	binStep: number;
	baseFee: number;
	collectFeeMode: number;
	tokenXMint: string;
	tokenYMint: string;
	tokenXIcon: string;
	tokenYIcon: string;
	tokenX: string;
	tokenY: string;
	rewardX: string;
	rewardY: string;
	balances: string;
	balancesSol?: string | null;
	unclaimedFees: string;
	unclaimedFeesSol?: string | null;
	feePerTvl24h: string;
	pnl: string;
	pnlSol?: string | null;
	pnlPctChange: string;
	pnlSolPctChange?: string | null;
	totalDeposit: string;
	totalDepositSol?: string | null;
	openPositionCount: number;
	listPositions: string[];
	positionsOutOfRange: string[];
	outOfRange?: boolean | null;
	poolPrice?: number | null;
	poolStateUpdatedAtBlockTime?: number | null;
	poolStateUpdatedAtSlot?: number | null;
}
export const OpenPortfolioPoolItemSchema: z.ZodType<OpenPortfolioPoolItem> = z.object({
	poolAddress: z.string(),
	binStep: z.number(),
	baseFee: z.number(),
	collectFeeMode: z.number(),
	tokenXMint: z.string(),
	tokenYMint: z.string(),
	tokenXIcon: z.string(),
	tokenYIcon: z.string(),
	tokenX: z.string(),
	tokenY: z.string(),
	rewardX: z.string(),
	rewardY: z.string(),
	balances: z.string(),
	balancesSol: z.string().nullish(),
	unclaimedFees: z.string(),
	unclaimedFeesSol: z.string().nullish(),
	feePerTvl24h: z.string(),
	pnl: z.string(),
	pnlSol: z.string().nullish(),
	pnlPctChange: z.string(),
	pnlSolPctChange: z.string().nullish(),
	totalDeposit: z.string(),
	totalDepositSol: z.string().nullish(),
	openPositionCount: z.number(),
	listPositions: z.array(z.string()),
	positionsOutOfRange: z.array(z.string()),
	outOfRange: z.boolean().nullish(),
	poolPrice: z.number().nullish(),
	poolStateUpdatedAtBlockTime: z.number().nullish(),
	poolStateUpdatedAtSlot: z.number().nullish(),
});

/** Top-level response of `GET /portfolio/open`. */
export interface OpenPortfolio {
	page: number;
	pageSize: number;
	hasNext: boolean;
	totalCount: number;
	totalPositions: number;
	pools: OpenPortfolioPoolItem[];
	solPrice?: string | null;
	total?: OpenPortfolioTotal | null;
}
export const OpenPortfolioSchema: z.ZodType<OpenPortfolio> = z.object({
	page: z.number(),
	pageSize: z.number(),
	hasNext: z.boolean(),
	totalCount: z.number(),
	totalPositions: z.number(),
	pools: z.array(OpenPortfolioPoolItemSchema),
	solPrice: z.string().nullish(),
	total: OpenPortfolioTotalSchema.nullish(),
});

/** Parameters accepted by `MeteoraDlmmClient.getOpenPortfolio`. */
export interface GetOpenPortfolioParams {
	/** Solana wallet address (base58). Required. */
	user: string;
	page?: number;
	pageSize?: number;
	sortBy?: OpenPortfolioSortBy;
	sortDirection?: SortDirection;
}

/** Options for constructing a {@link MeteoraDlmmClient}. */
export interface MeteoraDlmmClientOptions {
	/** Override the API base URL (e.g. the devnet URL). Defaults to mainnet. */
	baseUrl?: string;
	/** Request timeout in milliseconds. Defaults to 30000. */
	timeout?: number;
	/** Custom `fetch` implementation (mainly for testing). Defaults to global `fetch`. */
	fetch?: typeof fetch;
}

// ===== GET /positions/{pool_address}/pnl =====

/** Filter for which positions to return. Default is "all". */
export type PositionStatus = 'open' | 'closed' | 'all';
export const PositionStatusSchema: z.ZodType<PositionStatus> = z.enum(['open', 'closed', 'all']);

/** A token amount with USD value (and optional SOL value). */
export interface TokenAmount {
	amount: string;
	usd: string;
	amountSol?: string | null;
}
export const TokenAmountSchema: z.ZodType<TokenAmount> = z.object({
	amount: z.string(),
	usd: z.string(),
	amountSol: z.string().nullish(),
});

/** A USD total with optional SOL equivalent. */
export interface TotalUsd {
	usd: string;
	sol?: string | null;
}
export const TotalUsdSchema: z.ZodType<TotalUsd> = z.object({
	usd: z.string(),
	sol: z.string().nullish(),
});

/** A pair of token amounts (X/Y) plus a combined USD total. Used for deposits/withdrawals/fees. */
export interface TokenPairWithTotal {
	tokenX: TokenAmount;
	tokenY: TokenAmount;
	total: TotalUsd;
}
export const TokenPairWithTotalSchema: z.ZodType<TokenPairWithTotal> = z.object({
	tokenX: TokenAmountSchema,
	tokenY: TokenAmountSchema,
	total: TotalUsdSchema,
});

/** Live unrealized PnL detail — present only for open positions. */
export interface UnrealizedPnl {
	balances: number;
	balanceTokenX: TokenAmount;
	balanceTokenY: TokenAmount;
	unclaimedFeeTokenX: TokenAmount;
	unclaimedFeeTokenY: TokenAmount;
	unclaimedRewardTokenX: TokenAmount;
	unclaimedRewardTokenY: TokenAmount;
	balancesSol?: string | null;
}
export const UnrealizedPnlSchema: z.ZodType<UnrealizedPnl> = z.object({
	balances: z.number(),
	balanceTokenX: TokenAmountSchema,
	balanceTokenY: TokenAmountSchema,
	unclaimedFeeTokenX: TokenAmountSchema,
	unclaimedFeeTokenY: TokenAmountSchema,
	unclaimedRewardTokenX: TokenAmountSchema,
	unclaimedRewardTokenY: TokenAmountSchema,
	balancesSol: z.string().nullish(),
});

/** One position with calculated PnL data. */
export interface PositionPnlItem {
	positionAddress: string;
	minPrice: string;
	maxPrice: string;
	lowerBinId: number;
	upperBinId: number;
	feePerTvl24h: string;
	isClosed: boolean;
	pnlUsd: string;
	pnlPctChange: string;
	allTimeDeposits: TokenPairWithTotal;
	allTimeWithdrawals: TokenPairWithTotal;
	allTimeFees: TokenPairWithTotal;
	isOutOfRange?: boolean | null;
	pnlSol?: string | null;
	pnlSolPctChange?: string | null;
	poolActiveBinId?: number | null;
	poolActivePrice?: string | null;
	createdAt?: number | null;
	closedAt?: number | null;
	unrealizedPnl?: UnrealizedPnl | null;
}
export const PositionPnlItemSchema: z.ZodType<PositionPnlItem> = z.object({
	positionAddress: z.string(),
	minPrice: z.string(),
	maxPrice: z.string(),
	lowerBinId: z.number(),
	upperBinId: z.number(),
	feePerTvl24h: z.string(),
	isClosed: z.boolean(),
	pnlUsd: z.string(),
	pnlPctChange: z.string(),
	allTimeDeposits: TokenPairWithTotalSchema,
	allTimeWithdrawals: TokenPairWithTotalSchema,
	allTimeFees: TokenPairWithTotalSchema,
	isOutOfRange: z.boolean().nullish(),
	pnlSol: z.string().nullish(),
	pnlSolPctChange: z.string().nullish(),
	poolActiveBinId: z.number().nullish(),
	poolActivePrice: z.string().nullish(),
	createdAt: z.number().nullish(),
	closedAt: z.number().nullish(),
	unrealizedPnl: UnrealizedPnlSchema.nullish(),
});

/**
 * Top-level response of `GET /positions/{pool_address}/pnl`.
 *
 * `tokenX`/`tokenY`/`rewardToken*` are the pool's token identities (nullable);
 * `tokenXPrice`/`tokenYPrice`/`rewardToken*Price` are always present (required).
 */
export interface PositionPnl {
	totalCount: number;
	page: number;
	pageSize: number;
	hasNext: boolean;
	positions: PositionPnlItem[];
	tokenXPrice: string;
	tokenYPrice: string;
	rewardTokenXPrice: string;
	rewardTokenYPrice: string;
	tokenX?: string | null;
	tokenY?: string | null;
	rewardTokenX?: string | null;
	rewardTokenY?: string | null;
	solPrice?: string | null;
}
export const PositionPnlSchema: z.ZodType<PositionPnl> = z.object({
	totalCount: z.number(),
	page: z.number(),
	pageSize: z.number(),
	hasNext: z.boolean(),
	positions: z.array(PositionPnlItemSchema),
	tokenXPrice: z.string(),
	tokenYPrice: z.string(),
	rewardTokenXPrice: z.string(),
	rewardTokenYPrice: z.string(),
	tokenX: z.string().nullish(),
	tokenY: z.string().nullish(),
	rewardTokenX: z.string().nullish(),
	rewardTokenY: z.string().nullish(),
	solPrice: z.string().nullish(),
});

/** Parameters for `MeteoraDlmmClient.getPositionPnl` (the `poolAddress` path param is a separate argument). */
export interface GetPositionPnlParams {
	/** Solana wallet address (base58). Required. */
	user: string;
	status?: PositionStatus;
	page?: number;
	pageSize?: number;
}

// ===== GET /pools/{address}/ohlcv =====

/** Candle interval for OHLCV. Invalid values are rejected by the API (400). */
export type OhlcvTimeframe = '5m' | '30m' | '1h' | '2h' | '4h' | '12h' | '24h';
export const OhlcvTimeframeSchema: z.ZodType<OhlcvTimeframe> = z.enum([
	'5m',
	'30m',
	'1h',
	'2h',
	'4h',
	'12h',
	'24h',
]);

/** A single OHLCV candle. */
export interface OhlcvCandle {
	/** Unix seconds, candle bucket start. */
	timestamp: number;
	/** ISO 8601, e.g. "2026-06-22T09:00:00+00:00". */
	timestamp_str: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}
export const OhlcvCandleSchema: z.ZodType<OhlcvCandle> = z.object({
	timestamp: z.number(),
	timestamp_str: z.string(),
	open: z.number(),
	high: z.number(),
	low: z.number(),
	close: z.number(),
	volume: z.number(),
});

/**
 * Top-level response of `GET /pools/{address}/ohlcv`.
 *
 * `timeframe` is the echoed candle interval (always present in practice, but
 * nullable per the OpenAPI spec). `data` may be empty for a window with no trades.
 */
export interface Ohlcv {
	start_time: number;
	end_time: number;
	timeframe?: OhlcvTimeframe | null;
	data: OhlcvCandle[];
}
export const OhlcvSchema: z.ZodType<Ohlcv> = z.object({
	start_time: z.number(),
	end_time: z.number(),
	timeframe: OhlcvTimeframeSchema.nullish(),
	data: z.array(OhlcvCandleSchema),
});

/** Parameters for `MeteoraDlmmClient.getOhlcv` (the `address` path param is a separate argument). */
export interface GetOhlcvParams {
	/** Candle interval. Defaults to `24h` server-side. */
	timeframe?: OhlcvTimeframe;
	/** Inclusive lower bound, unix seconds. */
	start_time?: number;
	/** Inclusive upper bound, unix seconds. Defaults to "now" server-side. */
	end_time?: number;
}
