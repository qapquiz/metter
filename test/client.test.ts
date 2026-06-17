import { afterEach, describe, expect, mock, test } from 'bun:test';
import { ZodError } from 'zod';
import type { OpenPortfolio, PositionPnl } from '../src/types';
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

describe('MeteoraDlmmClient.getPositionPnl', () => {
	const POOL = 'DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf';

	const POPULATED: PositionPnl = {
		totalCount: 1,
		page: 1,
		pageSize: 20,
		hasNext: false,
		positions: [
			{
				positionAddress: 'Pos111111111111111111111111111111111111',
				minPrice: '0.99',
				maxPrice: '1.01',
				lowerBinId: 8388600,
				upperBinId: 8388620,
				feePerTvl24h: '0.05',
				isClosed: false,
				pnlUsd: '120.50',
				pnlPctChange: '13.7',
				isOutOfRange: false,
				pnlSol: '0.8',
				pnlSolPctChange: '13.7',
				poolActiveBinId: 8388610,
				poolActivePrice: '1.0',
				createdAt: 1700000000,
				closedAt: null,
				allTimeDeposits: {
					tokenX: { amount: '1.0', usd: '150', amountSol: '1' },
					tokenY: { amount: '150', usd: '150' },
					total: { usd: '300', sol: '2' },
				},
				allTimeWithdrawals: {
					tokenX: { amount: '0', usd: '0' },
					tokenY: { amount: '0', usd: '0' },
					total: { usd: '0' },
				},
				allTimeFees: {
					tokenX: { amount: '0.01', usd: '1.5' },
					tokenY: { amount: '1.5', usd: '1.5' },
					total: { usd: '3' },
				},
				unrealizedPnl: {
					balances: 300,
					balancesSol: '2',
					balanceTokenX: { amount: '0.5', usd: '75' },
					balanceTokenY: { amount: '75', usd: '75' },
					unclaimedFeeTokenX: { amount: '0.01', usd: '1.5' },
					unclaimedFeeTokenY: { amount: '0', usd: '0' },
					unclaimedRewardTokenX: { amount: '0', usd: '0' },
					unclaimedRewardTokenY: { amount: '0', usd: '0' },
				},
			},
		],
		tokenX: 'SOL',
		tokenY: 'USDC',
		tokenXPrice: '150',
		tokenYPrice: '1',
		rewardTokenX: null,
		rewardTokenY: null,
		rewardTokenXPrice: '0',
		rewardTokenYPrice: '0',
		solPrice: '150',
	};

	test('happy path: parses nested response; serializes path + snake_case query', async () => {
		let capturedUrl = '';
		globalThis.fetch = mock((url: string | URL | Request) => {
			capturedUrl = String(url);
			return Promise.resolve(mockResponse(200, POPULATED));
		}) as unknown as typeof fetch;

		const client = new MeteoraDlmmClient();
		const result = await client.getPositionPnl(POOL, {
			user: 'UserWallet1111111111111111111111111111111111',
			status: 'open',
			page: 2,
			pageSize: 50,
		});

		expect(result).toEqual(POPULATED);
		expect(result.positions[0].unrealizedPnl?.balances).toBe(300);
		expect(result.positions[0].allTimeDeposits.total.usd).toBe('300');
		expect(capturedUrl).toContain('https://dlmm.datapi.meteora.ag/positions/');
		expect(capturedUrl).toContain(`/positions/${POOL}/pnl?`);
		expect(capturedUrl).toContain('user=UserWallet1111111111111111111111111111111111');
		expect(capturedUrl).toContain('status=open');
		expect(capturedUrl).toContain('page=2');
		expect(capturedUrl).toContain('page_size=50');
	});

	test('empty result: parses zeroed response (tokenX null, solPrice absent)', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(200, {
				tokenX: null,
				tokenY: null,
				totalCount: 0,
				page: 1,
				pageSize: 20,
				hasNext: false,
				positions: [],
				tokenXPrice: '0',
				tokenYPrice: '0',
				rewardTokenX: null,
				rewardTokenY: null,
				rewardTokenXPrice: '0',
				rewardTokenYPrice: '0',
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		const result = await client.getPositionPnl(POOL, { user: 'SomeWallet1111111111111111111111111111111111' });
		expect(result.positions).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(result.tokenX).toBeNull();
		expect(result.solPrice).toBeUndefined();
		expect(result.tokenXPrice).toBe('0');
	});

	test('malformed 2xx body: throws ZodError (required tokenXPrice missing)', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(200, {
				totalCount: 0,
				page: 1,
				pageSize: 20,
				hasNext: false,
				positions: [],
				tokenYPrice: '0',
				rewardTokenXPrice: '0',
				rewardTokenYPrice: '0',
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getPositionPnl(POOL, { user: 'SomeWallet1111111111111111111111111111111111' }),
		).rejects.toBeInstanceOf(ZodError);
	});

	test('400 error: throws MeteoraApiError with status + API message (invalid user)', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(400, { message: 'user: Validation error: invalid_pubkey' })),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getPositionPnl(POOL, { user: 'bad' }),
		).rejects.toMatchObject({ name: 'MeteoraApiError', status: 400, message: 'user: Validation error: invalid_pubkey' });
	});

	test('throws TypeError when poolAddress or user is empty (before any network call)', async () => {
		let called = false;
		globalThis.fetch = mock(() => {
			called = true;
			return Promise.resolve(mockResponse(200, {}));
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(client.getPositionPnl('', { user: 'SomeWallet1111111111111111111111111111111111' })).rejects.toBeInstanceOf(TypeError);
		await expect(client.getPositionPnl(POOL, { user: '' })).rejects.toBeInstanceOf(TypeError);
		expect(called).toBe(false);
	});

	test('closed position: unrealizedPnl may be absent (parsed as undefined)', async () => {
		const closed = {
			...POPULATED,
			positions: [{ ...POPULATED.positions[0], isClosed: true, unrealizedPnl: undefined }],
		};
		globalThis.fetch = mock(() => Promise.resolve(mockResponse(200, closed))) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		const result = await client.getPositionPnl(POOL, { user: 'SomeWallet1111111111111111111111111111111111' });
		expect(result.positions[0].isClosed).toBe(true);
		expect(result.positions[0].unrealizedPnl).toBeUndefined();
	});

	test('regression: real captured live payload parses (spec said pnlSol was number; live is string)', async () => {
		// Captured 2026-06-17 from GET /positions/4NTkKwwtWB6Q8DvwNCkJMtVTF8XutSz22qAsRaFxLbii/pnl
		// for wallet 87bdcSg4zvjExbvsUSbGifYUp75JdLhLafjgwvCjzjkA (SPCX/SOL, one open position).
		// Pins the real wire shape so the spec-vs-reality drift on pnlSol/pnlSolPctChange
		// (and the whole nested structure) can't silently regress.
		const REAL: PositionPnl = {
			totalCount: 1,
			page: 1,
			pageSize: 5,
			hasNext: false,
			positions: [{
				positionAddress: 'HSqmC7JcAkfcgVsGcyC5yZiuMwY2PGHxXrpc8mJSp6UB',
				minPrice: '1.4668539686714341',
				maxPrice: '2.462189456832593',
				lowerBinId: 915,
				upperBinId: 980,
				feePerTvl24h: '0.02687357050865781',
				isClosed: false,
				pnlUsd: '26.371648584300203',
				pnlPctChange: '8.643057867004272',
				isOutOfRange: true,
				pnlSol: '0.004720482401372017',
				pnlSolPctChange: '0.10489960966533095',
				poolActiveBinId: 990,
				poolActivePrice: '2.666409134279774',
				createdAt: 1781350962,
				closedAt: null,
				allTimeDeposits: {
					tokenX: { amount: '0', usd: '0', amountSol: '0' },
					tokenY: { amount: '4.499999968', usd: '305.11942636617744', amountSol: '4.499999968000001' },
					total: { usd: '305.1194263661774', sol: '4.499999968' },
				},
				allTimeWithdrawals: {
					tokenX: { amount: '0', usd: '0', amountSol: '0' },
					tokenY: { amount: '0', usd: '0', amountSol: '0' },
					total: { usd: '0', sol: '0' },
				},
				allTimeFees: {
					tokenX: { amount: '0', usd: '0', amountSol: '0' },
					tokenY: { amount: '0', usd: '0', amountSol: '0' },
					total: { usd: '0', sol: '0' },
				},
				unrealizedPnl: {
					balances: 331.14401628988475,
					balancesSol: '4.4998031338656945',
					balanceTokenX: { amount: '0', usd: '0', amountSol: '0' },
					balanceTokenY: { amount: '4.500004289', usd: '331.14401628988475', amountSol: '4.500004289' },
					unclaimedFeeTokenX: { amount: '0.000929', usd: '0.18310882568963663', amountSol: '0.0024882034013726582' },
					unclaimedFeeTokenY: { amount: '0.002227958', usd: '0.16394983490318604', amountSol: '0.002227958' },
					unclaimedRewardTokenX: { amount: '0', usd: '0', amountSol: '0' },
					unclaimedRewardTokenY: { amount: '0', usd: '0', amountSol: '0' },
				},
			}],
			tokenX: 'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb',
			tokenY: 'So11111111111111111111111111111111111111112',
			tokenXPrice: '196.79685446928883',
			tokenYPrice: '73.59077862710969',
			rewardTokenX: '11111111111111111111111111111111',
			rewardTokenY: '11111111111111111111111111111111',
			rewardTokenXPrice: '0',
			rewardTokenYPrice: '0',
			solPrice: '73.59077862710969',
		};

		globalThis.fetch = mock(() => Promise.resolve(mockResponse(200, REAL))) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		const result = await client.getPositionPnl('4NTkKwwtWB6Q8DvwNCkJMtVTF8XutSz22qAsRaFxLbii', {
			user: '87bdcSg4zvjExbvsUSbGifYUp75JdLhLafjgwvCjzjkA',
		});

		expect(result).toEqual(REAL);
		// The load-bearing assertions: these two arrive as STRINGS (spec wrongly says number).
		expect(result.positions[0].pnlSol).toBe('0.004720482401372017');
		expect(result.positions[0].pnlSolPctChange).toBe('0.10489960966533095');
		// balances is genuinely a number.
		expect(result.positions[0].unrealizedPnl?.balances).toBe(331.14401628988475);
		expect(result.positions[0].allTimeDeposits.tokenY.amountSol).toBe('4.499999968000001');
	});

	test('live smoke (only runs when RUN_LIVE=1): real empty-wallet call against a real pool', async () => {
		// Deterministic, public, safe. Skipped in normal CI to avoid network flakes.
		if (process.env.RUN_LIVE !== '1') return;
		const client = new MeteoraDlmmClient();
		const result = await client.getPositionPnl(POOL, { user: '11111111111111111111111111111112' });
		expect(result.positions).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(result.tokenX).toBeNull();
	});
});
