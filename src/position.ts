import type { PositionPnlItem, TokenAmount, TokenPairWithTotal, TotalUsd } from './types';

/**
 * Compute the NET amount actually invested in a position by offsetting gross
 * all-time deposits against gross all-time withdrawals.
 *
 * The Meteora `/positions/{pool}/pnl` endpoint reports `allTimeDeposits` and
 * `allTimeWithdrawals` as running GROSS totals — every deposit and every
 * withdrawal is summed independently. So a deposit → withdraw → deposit cycle
 * inflates *both* numbers: e.g. deposit 4.5 SOL, withdraw 3.9 SOL, deposit 3.8
 * SOL shows up as `deposits = 8.3 SOL` / `withdrawals = 3.9 SOL`, making it look
 * like far more is at risk than the real ~4.5 SOL principal.
 *
 * This returns `deposits − withdrawals` (per token and per USD, plus the optional
 * SOL-denominated values when both sides report them), in the same
 * {@link TokenPairWithTotal} shape as `allTimeDeposits` so it's a drop-in.
 *
 * The result is your true **cost basis** — the net capital still committed to the
 * position. It is *not* the current composition of the position: the AMM may have
 * rebalanced your liquidity between tokenX/tokenY as price crossed your bins. For
 * the live token mix, read `position.unrealizedPnl` instead.
 *
 * Arithmetic is exact (string → BigInt decimal subtraction), so no precision is
 * lost vs. the API's high-precision string amounts.
 *
 * **What the USD/SOL totals represent (verified, not assumed):** the API's
 * `allTimeDeposits.total.usd` is NOT `amount × currentPrice`, and it does not
 * correspond to any single price snapshot (the two equations for deposits and
 * withdrawals admit no valid positive price pair). That rules out current-value
 * and single-snapshot valuation, leaving per-event historical pricing: each
 * deposit/withdrawal is valued at its own event-time price and summed. Netting
 * therefore yields net USD invested at historical prices — a real cost basis,
 * but priced by the API's own (oracle/TWAP) source, which this client does not
 * control or independently verify. The per-token AMOUNTS are exact and reliable
 * regardless. To get a true per-event cost basis you would need a transactions
 * endpoint (this one returns only aggregates).
 *
 * @example
 * const pnl = await client.getPositionPnl(pool, { user, status: 'open' });
 * const real = getNetDeposits(pnl.positions[0]);
 * console.log(real.tokenY.amount); // e.g. '4.498975489' SOL actually at risk
 * console.log(real.total.usd);     // net USD cost basis
 *
 * @param position - A single `PositionPnlItem` from `getPositionPnl`.
 * @returns The netted deposit amount, same shape as `position.allTimeDeposits`.
 *   Negative values are possible (e.g. you withdrew more than you put in / took
 *   profits) and are returned as signed decimal strings.
 */
export function getNetDeposits(position: PositionPnlItem): TokenPairWithTotal {
	return subtractTokenPair(position.allTimeDeposits, position.allTimeWithdrawals);
}

/** Net two {@link TokenPairWithTotal} aggregates (a − b), per token and per USD/SOL. */
function subtractTokenPair(a: TokenPairWithTotal, b: TokenPairWithTotal): TokenPairWithTotal {
	return {
		tokenX: subtractTokenAmount(a.tokenX, b.tokenX),
		tokenY: subtractTokenAmount(a.tokenY, b.tokenY),
		total: subtractTotalUsd(a.total, b.total),
	};
}

function subtractTokenAmount(a: TokenAmount, b: TokenAmount): TokenAmount {
	const out: TokenAmount = {
		amount: subtractDecimal(a.amount, b.amount),
		usd: subtractDecimal(a.usd, b.usd),
	};
	// Only net the SOL equivalent when BOTH sides report it, so a missing value on
	// one side doesn't fabricate a number. Leaves `amountSol` undefined otherwise.
	if (a.amountSol != null && b.amountSol != null) {
		out.amountSol = subtractDecimal(a.amountSol, b.amountSol);
	}
	return out;
}

function subtractTotalUsd(a: TotalUsd, b: TotalUsd): TotalUsd {
	const out: TotalUsd = {
		usd: subtractDecimal(a.usd, b.usd),
	};
	if (a.sol != null && b.sol != null) {
		out.sol = subtractDecimal(a.sol, b.sol);
	}
	return out;
}

interface ParsedDecimal {
	/** Magnitude, always non-negative. */
	digits: bigint;
	/** Number of digits after the decimal point. */
	scale: number;
	/** True for negative inputs. */
	negative: boolean;
}

/**
 * Subtract two decimal numbers given as strings, returning a full-precision
 * string (no float rounding). Handles arbitrary decimal places and negative
 * results. Implemented with BigInt integer arithmetic after scaling both operands
 * to a common number of decimal places, so it's exact for the values the Meteora
 * API emits (which can carry 16+ fractional digits).
 */
function subtractDecimal(a: string, b: string): string {
	const pa = parseDecimal(a);
	const pb = parseDecimal(b);
	const scale = Math.max(pa.scale, pb.scale);
	const aInt = pa.digits * 10n ** BigInt(scale - pa.scale);
	const bInt = pb.digits * 10n ** BigInt(scale - pb.scale);
	const aValue = pa.negative ? -aInt : aInt;
	const bValue = pb.negative ? -bInt : bInt;
	return formatDecimal(aValue - bValue, scale);
}

function parseDecimal(s: string): ParsedDecimal {
	const str = s.trim();
	const negative = str.startsWith('-');
	const unsigned = negative ? str.slice(1) : str;
	const dot = unsigned.indexOf('.');
	const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
	const fracPart = dot === -1 ? '' : unsigned.slice(dot + 1);
	const combined = `${intPart || '0'}${fracPart}`;
	// Strip leading zeros (keep one digit) so small magnitudes keep their scale.
	const digits = BigInt(combined.replace(/^0+/, '') || '0');
	return { digits, scale: fracPart.length, negative };
}

function formatDecimal(scaledValue: bigint, scale: number): string {
	const negative = scaledValue < 0n;
	const abs = negative ? -scaledValue : scaledValue;
	if (scale === 0) {
		return negative ? `-${abs}` : `${abs}`;
	}
	const str = abs.toString().padStart(scale + 1, '0');
	const intPart = str.slice(0, str.length - scale);
	const fracPart = str.slice(str.length - scale).replace(/0+$/, '');
	const result = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
	return negative ? `-${result}` : result;
}
