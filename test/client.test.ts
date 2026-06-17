import { afterEach, describe, expect, mock, test } from 'bun:test';
import { ZodError } from 'zod';
import type { OpenPortfolio } from '../src/types';
import { METEORA_DLMM_DEVNET_URL } from '../src/constants';
import { MeteoraDlmmClient } from '../src/client';

const POPULATED: OpenPortfolio = {
	page: 1,
	pageSize: 20,
	hasNext: false,
	totalCount: 1,
	totalPositions: 2,
	solPrice: '150.0',
	total: {
		totalPositions: 2,
		balances: '1000.50',
		unclaimedFees: '12.34',
		pnl: '120.00',
		pnlPctChange: '13.7',
	},
	pools: [
		{
			poolAddress: 'PoLAddr111111111111111111111111111111111',
			binStep: 25,
			baseFee: 25,
			collectFeeMode: 0,
			tokenXMint: 'MintX111111111111111111111111111111111111',
			tokenYMint: 'MintY111111111111111111111111111111111111',
			tokenXIcon: 'https://example.com/x.png',
			tokenYIcon: 'https://example.com/y.png',
			tokenX: 'SOL',
			tokenY: 'USDC',
			rewardX: '0',
			rewardY: '0',
			balances: '1000.50',
			unclaimedFees: '12.34',
			feePerTvl24h: '0.05',
			pnl: '120.00',
			pnlPctChange: '13.7',
			totalDeposit: '880.50',
			openPositionCount: 2,
			listPositions: ['PosA111111111111111111111111111111111111', 'PosB111111111111111111111111111111111111'],
			positionsOutOfRange: ['PosB111111111111111111111111111111111111'],
			outOfRange: true,
			poolPrice: 150.0,
		},
	],
};

function mockResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('MeteoraDlmmClient.getOpenPortfolio', () => {
	test('happy path: parses and validates the response; serializes query params', async () => {
		let capturedUrl = '';
		globalThis.fetch = mock((url: string | URL | Request) => {
			capturedUrl = String(url);
			return Promise.resolve(mockResponse(200, POPULATED));
		}) as unknown as typeof fetch;

		const client = new MeteoraDlmmClient();
		const result = await client.getOpenPortfolio({
			user: 'UserWallet1111111111111111111111111111111111',
			page: 2,
			pageSize: 50,
			sortBy: 'unclaimed_fee',
			sortDirection: 'asc',
		});

		expect(result).toEqual(POPULATED);
		expect(capturedUrl).toContain('https://dlmm.datapi.meteora.ag/portfolio/open');
		expect(capturedUrl).toContain('user=UserWallet1111111111111111111111111111111111');
		expect(capturedUrl).toContain('page=2');
		expect(capturedUrl).toContain('page_size=50');
		expect(capturedUrl).toContain('sort_by=unclaimed_fee');
		expect(capturedUrl).toContain('sort_direction=asc');
	});

	test('empty portfolio: returns zeroed response with empty pools', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(200, {
				page: 0,
				pageSize: 0,
				hasNext: false,
				totalCount: 0,
				totalPositions: 0,
				pools: [],
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		const result = await client.getOpenPortfolio({ user: 'SomeWallet1111111111111111111111111111111111' });
		expect(result.pools).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(result.total).toBeUndefined();
		expect(result.solPrice).toBeUndefined();
	});

	test('malformed 2xx body: throws ZodError (API shape drift surfaces loudly)', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(200, {
				page: 'not-a-number', // wrong type for a required field
				pageSize: 0,
				hasNext: false,
				totalCount: 0,
				totalPositions: 0,
				pools: [],
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getOpenPortfolio({ user: 'SomeWallet1111111111111111111111111111111111' }),
		).rejects.toBeInstanceOf(ZodError);
	});

	test('400 error: throws MeteoraApiError with API message and status', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(400, { message: 'user: Validation error: invalid_pubkey' })),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getOpenPortfolio({ user: 'bad' }),
		).rejects.toMatchObject({ name: 'MeteoraApiError', status: 400, message: 'user: Validation error: invalid_pubkey' });
	});

	test('uses custom baseUrl (devnet) and custom fetch', async () => {
		let capturedUrl = '';
		const customFetch = mock((url: string | URL | Request) => {
			capturedUrl = String(url);
			return Promise.resolve(mockResponse(200, { ...POPULATED, pools: [] }));
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient({ baseUrl: METEORA_DLMM_DEVNET_URL, fetch: customFetch });
		await client.getOpenPortfolio({ user: 'UserWallet1111111111111111111111111111111111' });
		expect(capturedUrl.startsWith(METEORA_DLMM_DEVNET_URL)).toBe(true);
	});

	test('throws TypeError when user is missing or empty (before any network call)', async () => {
		let called = false;
		globalThis.fetch = mock(() => {
			called = true;
			return Promise.resolve(mockResponse(200, {}));
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		// @ts-expect-error exercising runtime guard with missing required param
		await expect(client.getOpenPortfolio({})).rejects.toBeInstanceOf(TypeError);
		await expect(client.getOpenPortfolio({ user: '' })).rejects.toBeInstanceOf(TypeError);
		expect(called).toBe(false);
	});

	test('live smoke (only runs when RUN_LIVE=1): real empty-wallet call', async () => {
		// Deterministic, public, safe. Skipped in normal CI to avoid network flakes.
		if (process.env.RUN_LIVE !== '1') return;
		const client = new MeteoraDlmmClient();
		const result = await client.getOpenPortfolio({ user: '11111111111111111111111111111112' });
		expect(result.pools).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(result.totalPositions).toBe(0);
	});
});
