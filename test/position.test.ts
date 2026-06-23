import { describe, expect, test } from 'bun:test';
import type { PositionPnlItem, TokenPairWithTotal } from '../src/types';
import { getNetDeposits } from '../src/position';

/** Minimal builder so tests read as the data they care about. */
function makePosition(deposits: TokenPairWithTotal, withdrawals: TokenPairWithTotal): PositionPnlItem {
	return {
		positionAddress: 'Pos111111111111111111111111111111111111',
		minPrice: '1',
		maxPrice: '2',
		lowerBinId: 0,
		upperBinId: 10,
		feePerTvl24h: '0',
		isClosed: false,
		pnlUsd: '0',
		pnlPctChange: '0',
		allTimeDeposits: deposits,
		allTimeWithdrawals: withdrawals,
		allTimeFees: {
			tokenX: { amount: '0', usd: '0' },
			tokenY: { amount: '0', usd: '0' },
			total: { usd: '0' },
		},
	};
}

describe('getNetDeposits', () => {
	test('the real bug: deposit → withdraw → deposit is netted, not doubled', () => {
		// Captured 2026-06-23 from the ZERO/SOL position CsbyuDUGJk... for wallet
		// 87bdcSg4zvjExbvsUSbGifYUp75JdLhLafjgwvCjzjkA. The user deposited 4.5 SOL,
		// later withdrew ~3.9 SOL, then deposited again (~3.8 SOL + a little ZERO),
		// so the gross "8.4 SOL deposited" is meaningless. Net should be ~4.499 SOL.
		const position = makePosition(
			{
				tokenX: { amount: '6759.103196', usd: '39.83207180152861' },
				tokenY: { amount: '8.399991293', usd: '619.5476036133646' },
				total: { usd: '659.3796754148932' },
			},
			{
				tokenX: { amount: '6270.7949929999995', usd: '36.91158979117322' },
				tokenY: { amount: '3.901015804', usd: '289.37903792267184' },
				total: { usd: '326.2906277138451' },
			},
		);

		const net = getNetDeposits(position);

		// SOL actually at risk: 8.399991293 − 3.901015804 = 4.498975489 (exact).
		expect(net.tokenY.amount).toBe('4.498975489');
		// ZERO net: 6759.103196 − 6270.7949929999995.
		expect(net.tokenX.amount).toBe('488.3082030000005');
		// USD cost basis: 659.3796754148932 − 326.2906277138451.
		expect(net.total.usd).toBe('333.0890477010481');
	});

	test('no withdrawals: net equals deposits (passthrough)', () => {
		const position = makePosition(
			{
				tokenX: { amount: '100', usd: '50' },
				tokenY: { amount: '2', usd: '200' },
				total: { usd: '250' },
			},
			{
				tokenX: { amount: '0', usd: '0' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '0' },
			},
		);
		expect(getNetDeposits(position)).toEqual({
			tokenX: { amount: '100', usd: '50' },
			tokenY: { amount: '2', usd: '200' },
			total: { usd: '250' },
		});
	});

	test('withdraw more than deposited: returns a signed negative string (took profits)', () => {
		const position = makePosition(
			{
				tokenX: { amount: '1.5', usd: '150' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '150' },
			},
			{
				tokenX: { amount: '2.0', usd: '200' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '200' },
			},
		);
		const net = getNetDeposits(position);
		expect(net.tokenX.amount).toBe('-0.5');
		expect(net.total.usd).toBe('-50');
	});

	test('precision: high fractional digits are preserved, not float-rounded', () => {
		// 16 fractional digits (the precision the API actually emits). Subtracting
		// via Number() would give something like 0.12345678901234549; BigInt keeps it exact.
		const position = makePosition(
			{
				tokenX: { amount: '0.1234567890123457', usd: '0' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '0' },
			},
			{
				tokenX: { amount: '0.0000000000000002', usd: '0' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '0' },
			},
		);
		expect(getNetDeposits(position).tokenX.amount).toBe('0.1234567890123455');
	});

	test('trailing zeros are trimmed; integers stay integers', () => {
		const position = makePosition(
			{
				tokenX: { amount: '1.500', usd: '10.00' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '10.00' },
			},
			{
				tokenX: { amount: '0.500', usd: '4.00' },
				tokenY: { amount: '0', usd: '0' },
				total: { usd: '4.00' },
			},
		);
		const net = getNetDeposits(position);
		expect(net.tokenX.amount).toBe('1');
		expect(net.total.usd).toBe('6');
	});

	test('SOL-denominated values are netted when BOTH sides report them', () => {
		const position = makePosition(
			{
				tokenX: { amount: '100', usd: '50', amountSol: '0.3' },
				tokenY: { amount: '2', usd: '200', amountSol: '1.5' },
				total: { usd: '250', sol: '1.8' },
			},
			{
				tokenX: { amount: '40', usd: '20', amountSol: '0.1' },
				tokenY: { amount: '0.5', usd: '50', amountSol: '0.4' },
				total: { usd: '70', sol: '0.5' },
			},
		);
		const net = getNetDeposits(position);
		expect(net.tokenX.amountSol).toBe('0.2');
		expect(net.tokenY.amountSol).toBe('1.1');
		expect(net.total.sol).toBe('1.3');
	});

	test('SOL-denominated values are omitted when only one side reports them (no fabrication)', () => {
		const position = makePosition(
			{
				tokenX: { amount: '100', usd: '50', amountSol: '0.3' },
				tokenY: { amount: '2', usd: '200' },
				total: { usd: '250', sol: '1.8' },
			},
			{
				tokenX: { amount: '40', usd: '20' }, // no amountSol here
				tokenY: { amount: '0.5', usd: '50' },
				total: { usd: '70' }, // no sol here
			},
		);
		const net = getNetDeposits(position);
		expect(net.tokenX.amountSol).toBeUndefined();
		expect(net.tokenY.amountSol).toBeUndefined();
		expect(net.total.sol).toBeUndefined();
		// Core amounts still netted fine.
		expect(net.tokenX.amount).toBe('60');
		expect(net.tokenY.amount).toBe('1.5');
	});
});
