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
