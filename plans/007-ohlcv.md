# Plan 007: Add `getOhlcv` — Meteora DLMM `GET /pools/{address}/ohlcv` (Zod-validated)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 369b609..HEAD -- src test`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (flat response type — no deep nesting like plan 002's `TokenPairWithTotal`/`UnrealizedPnl`. Purely additive: types + one method + tests.)
- **Risk**: LOW (additive only — no edits to existing client logic; existing tests untouched)
- **Depends on**: plan 001 (DONE — `MeteoraDlmmClient`, the `request<T>`/`buildUrl` helpers, and the Zod-pattern conventions all exist). Independent of plan 002's types.
- **Category**: direction (feature)
- **Planned at**: commit `369b609`, 2026-06-17

## Why this matters

Plan 002 shipped per-position PnL (`getPositionPnl`) including each position's
`minPrice`/`maxPrice`/`poolActivePrice` — the data needed to overlay an LP
range on a price chart. What was missing for "price chart + position range
overlay" was the **price history** itself. This plan adds it:
`GET /pools/{address}/ohlcv` returns OHLCV candles for a pool over a window,
which a consumer renders as the chart that the position min/max band sits on.

This is the third endpoint, deliberately scoped to one. Same additive recipe as
plan 002: one new method calling the existing `request<T>(url, schema)` helper,
plus types/schemas appended to `src/types.ts`. Every type below was
**compile-checked and runtime-parsed against a real captured payload** during
planning (the lesson from plan 002's `pnlSol` miss — see "Verified during
planning").

## Current state

Repo at commit `369b609` (main). Plans 001 and 002 landed: `src/{constants,types,errors,client,index}.ts` + `test/client.test.ts`. Verified during planning: `bun run type-check`, `bun run lint`, `bun run test` (15 pass), `bun run build` all exit 0; `zod@4.4.3` is the sole runtime dependency.

The executor will edit these files. Excerpts (exact, for drift check):

**`src/client.ts`** — the two existing methods + helpers (extension points, reused unchanged):
```ts
export class MeteoraDlmmClient {
	// ... constructor ...

	async getOpenPortfolio(params: GetOpenPortfolioParams): Promise<OpenPortfolio> { ... }

	async getPositionPnl(poolAddress: string, params: GetPositionPnlParams): Promise<PositionPnl> { ... }

	private buildUrl(path: string, query: URLSearchParams): string { ... }

	private async request<T>(url: string, schema: ZodType<T>): Promise<T> { ... }
}
```
You will add a third method **immediately after `getPositionPnl`** (before `buildUrl`) and a third query-serializer **immediately after `toPositionPnlQuery`**. The imports at the top of `client.ts` already pull `ZodType`, `MeteoraApiErrorClass`, the constants, and a value import of schemas from `./types`; you will extend the type import and the schema value import.

**`src/types.ts`** — currently ends with the plan-002 block (`GetPositionPnlParams` is the last interface). Starts with `import { z } from 'zod';`. You will **append** new types/schemas to the end (do not modify existing ones).

**`src/index.ts`** — barrel (current contents shown in "Current state" of drift check); you will add export lines.

**`test/client.test.ts`** — has two describe blocks (`getOpenPortfolio`, `getPositionPnl`); you will **append** a third `describe` block for `getOhlcv` at the end of the file.

## Repo constraints (unchanged from plan 001/002 — will break the build if violated)

From `tsconfig.json`:

1. **`verbatimModuleSyntax: true`** → type-only imports MUST use `import type { ... }`.
2. **`isolatedDeclarations: true`** → every exported const/function must have an explicit type annotation.
3. **`strict: true` + `noUncheckedIndexedAccess: true`**.

Indentation is **tabs**, quotes are **single** for `.ts`. Code blocks below already use tabs.

### ⚠️ The Zod pattern (same as plan 001/002)

Under `isolatedDeclarations`, the idiomatic `z.infer<typeof S>` single-source pattern does NOT compile. Use **hand-written interface + annotated schema**:

```ts
export interface Foo { a: string }
export const FooSchema: z.ZodType<Foo> = z.object({ a: z.string() });
```

The duplication is **intentional and required**; the `z.ZodType<T>` annotation makes tsc verify schema ↔ interface agree at compile time. **All new types in this plan were compile-checked AND runtime-parsed against a real captured payload** during planning (see "Verified during planning"). Do NOT collapse to `z.infer`; do NOT relax `tsconfig.json`.

## The API contract (authoritative — from the OpenAPI spec, operation `Get OHLCV`, verified live during planning)

- **Base URL (mainnet):** `https://dlmm.datapi.meteora.ag`
- **Method + path:** `GET /pools/{address}/ohlcv`
- **Rate limit:** 30 req/s (informational; not throttled)
- **Parameters:**

  | Param        | In    | Required | Type              | Notes |
  |--------------|-------|----------|-------------------|-------|
  | `address`    | path  | yes      | string            | Base58 pool address. **API validates pubkey → 400 on invalid** (live-confirmed: bad address returns `{"message":"address: Validation error: invalid_pubkey ..."}` HTTP 400 — handled by the existing `MeteoraApiError`/`extractMessage` with NO change). |
  | `timeframe`  | query | no       | enum              | One of `5m` \| `30m` \| `1h` \| `2h` \| `4h` \| `12h` \| `24h` (default `24h`). **Invalid value → 400** (live-confirmed `7d`/`1d`/`1m` all return 400). The timeframe is BOTH the candle bucket size AND, when no window is given, the default span. |
  | `start_time` | query | no       | integer (unix s)  | Inclusive lower bound. If omitted, derived from `timeframe`. |
  | `end_time`   | query | no       | integer (unix s)  | Inclusive upper bound. If omitted, defaults to "now". |

- **Response `200`** — JSON. Top-level `Ohlcv`:
  - Required: `start_time: number`, `end_time: number`, `data: OhlcvCandle[]`.
  - Optional + nullable (`[string, null]` per spec): `timeframe?: OhlcvTimeframe | null`. **In practice always present as one of the 7 valid strings** (live-confirmed for `1h` and default `24h`); typed optional+nullable for spec fidelity.
  - Each `OhlcvCandle` has exactly: `timestamp: number` (unix seconds), `timestamp_str: string` (ISO 8601, e.g. `"2026-06-22T09:00:00+00:00"`), `open/high/low/close: number`, `volume: number`. **All numbers are JSON numbers on the wire** (live-confirmed — no string-encoded amounts here, unlike plan 002's `pnlSol`).
- **Response `400`** — JSON `{"message": "..."}`. Same shape as the other endpoints → existing `MeteoraApiError` handles it, **`request<T>` needs no change**.

### Live-verified behavior (do not "fix")

- **Bad `address` returns 400** (unlike `/positions/{pool}/pnl`, where a bad pool returned 200-empty). So for OHLCV the API genuinely validates the address — the client guards non-empty (defensive) but does NOT need to soft-handle empty results from a bad address; a bad address surfaces as `MeteoraApiError(400)`.
- **Invalid `timeframe` returns 400.** The client type `OhlcvTimeframe` constrains the 7 valid values at compile time, so a caller can't construct an invalid one without `as`/`any`. (A raw string still hits the API and 400s.)
- **Candle bucket = the `timeframe` you request.** Over a 6-hour window with `timeframe=1h` you get ~6 hourly candles; `5m` → 5-minute candles; etc.
- **Empty data array is possible** for a window with no trades (e.g. a brand-new pool) — the schema handles it (`z.array(...)` with zero elements is valid). Treat `data.length === 0` as a normal "no candles in window" result, not an error.

### Naming convention chosen (parallel to plan 001/002)

| Spec name | Exported as | Why |
|---|---|---|
| `OHLCVResponse` (the item, inline in the array) | `OhlcvCandle` | Clear, conventional; one entry in `data[]`. |
| `TimeseriesResponse_OHLCVResponse` (top-level) | `Ohlcv` | Parallel to `OpenPortfolio`/`PositionPnl` (resource-named top-level type). |
| `timeframe` enum | `OhlcvTimeframe` | Parallel to `PositionStatus`. |
| params | `GetOhlcvParams` | Parallel to `GetOpenPortfolioParams`/`GetPositionPnlParams`. |

**Method name:** `getOhlcv(address, params)` — `address` (the path param) positional-first, mirroring `getPositionPnl(poolAddress, params)`. `params` carries the optional query params.

## Commands you will need

| Purpose    | Command                          | Expected on success |
|------------|----------------------------------|---------------------|
| Install    | `bun install`                    | exit 0              |
| Typecheck  | `bun run type-check`             | exit 0, no errors   |
| Lint       | `bun run lint`                   | exit 0              |
| Tests      | `bun test`                       | all pass            |
| Build      | `bun run build`                  | exit 0              |
| Live smoke | `curl -sS "https://dlmm.datapi.meteora.ag/pools/DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf/ohlcv?timeframe=1h"` | HTTP 200, JSON with `data: [...]` |

All verified during planning.

## Scope

**In scope** (the only files you should modify):
- `src/types.ts` — **append** the new types/schemas (do not edit existing ones)
- `src/client.ts` — **add** the `getOhlcv` method + `toOhlcvQuery` serializer (do not edit existing methods/helpers)
- `src/index.ts` — **add** export lines for the new types/schemas
- `test/client.test.ts` — **append** a `describe('MeteoraDlmmClient.getOhlcv', ...)` block
- `README.md` — **add** a short `getOhlcv` example (a one-liner showing candle access; mention the chart-overlay use case in one sentence)

**Out of scope** (do NOT touch):
- `src/constants.ts`, `src/errors.ts` — unchanged.
- The existing `getOpenPortfolio`/`getPositionPnl` methods, `request<T>`, `buildUrl`, `parseBody`, `extractMessage`, `toPortfolioQuery`, `toPositionPnlQuery` — **reuse as-is**.
- Any other endpoint (limit-orders, `/portfolio/total`, `/pools/groups`, etc.).
- `tsconfig.json`, `bunfig.toml`, `.editorconfig`, `.git*`, `.github/`, `CONTRIBUTING.md`, `LICENSE`.
- Adding any runtime dependency. (`zod` already present.)
- A params Zod schema for `GetOhlcvParams` (consistent with plans 001/002 — params are caller-constructed, validated server-side; the client guards `address` non-empty).
- Chart rendering / any visualization. (The lib returns data; the consumer draws. The README one-liner mentions the overlay use case but the lib itself does no rendering.)

## Git workflow

- Branch: `feat/ohlcv`
- Conventional Commits (see `CONTRIBUTING.md`). Suggested single commit: `feat: add getOhlcv for /pools/{address}/ohlcv`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Append the new types/schemas to `src/types.ts`

Open `src/types.ts`. **Do not modify any existing type or schema.** Append the following block to the **end** of the file (after the existing `GetPositionPnlParams` interface). The `import { z } from 'zod';` at the top already covers these — do not add a second import.

```ts

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
```

**Verify**: `bun run type-check` → exit 0. (If it fails with TS9010 on any new schema, you forgot the `z.ZodType<T>` annotation. If TS2322, the schema fields don't match the interface — fix the schema.)

### Step 2: Add the `getOhlcv` method + query serializer to `src/client.ts`

Two edits to `src/client.ts`. Do not touch any existing code.

**Edit 2a — extend the type imports from `./types`.** Change the existing `import type { ... } from './types';` block so it ALSO imports the two new symbols it needs. The current block is:
```ts
import type {
	GetOpenPortfolioParams,
	GetPositionPnlParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
	PositionPnl,
} from './types';
```
Change it to (insert `GetOhlcvParams` and `Ohlcv` alphabetically):
```ts
import type {
	GetOhlcvParams,
	GetOpenPortfolioParams,
	GetPositionPnlParams,
	MeteoraDlmmClientOptions,
	Ohlcv,
	OpenPortfolio,
	PositionPnl,
} from './types';
```
And the existing value import `import { OpenPortfolioSchema, PositionPnlSchema } from './types';` — add `OhlcvSchema`:
```ts
import { OhlcvSchema, OpenPortfolioSchema, PositionPnlSchema } from './types';
```

**Edit 2b — add the method.** Insert this method **immediately after the closing brace of `getPositionPnl`** (i.e. after `getPositionPnl`'s final `}` and before `private buildUrl(...)`):

```ts
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
```

**Edit 2c — add the query serializer.** Insert this module-level function **immediately after the existing `toPositionPnlQuery` function** (after `toPositionPnlQuery`'s closing `}` and before `async function parseBody`):

```ts
/** Maps camelCase client params to the API's snake_case query parameters for /pools/{address}/ohlcv. */
function toOhlcvQuery(params: GetOhlcvParams | undefined): URLSearchParams {
	const query = new URLSearchParams();
	if (params === undefined) return query;
	if (params.timeframe !== undefined) query.set('timeframe', params.timeframe);
	if (params.start_time !== undefined) query.set('start_time', String(params.start_time));
	if (params.end_time !== undefined) query.set('end_time', String(params.end_time));
	return query;
}
```

> Notes:
> - `params` is **optional** here (unlike `getPositionPnl`, where `user` is required) — calling `getOhlcv(address)` with no params is valid and uses API defaults (`timeframe=24h`, end=now). The guard only checks `address`.
> - The response field names `start_time`/`end_time`/`timestamp`/`timestamp_str` are **snake_case on the wire and in the type** (matching the spec). Unlike `pageSize`/`sortBy` (camelCase client → snake_case query in plans 001/002), these query params are *already* snake_case, so `toOhlcvQuery` passes them through verbatim. Do not rename them to camelCase — the type intentionally mirrors the API.
> - `encodeURIComponent(address)` is defensive (base58 is URL-safe, so a no-op for valid addresses).

**Verify**: `bun run type-check` → exit 0.

### Step 3: Extend the barrel in `src/index.ts`

Add the new types to the existing `export type { ... } from './types';` block, and the new schemas to the existing `export { ... } from './types';` block.

The current barrel's type-export block is:
```ts
export type {
	GetOpenPortfolioParams,
	GetPositionPnlParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
	OpenPortfolioPoolItem,
	OpenPortfolioSortBy,
	OpenPortfolioTotal,
	PositionPnl,
	PositionPnlItem,
	PositionStatus,
	SortDirection,
	TokenAmount,
	TokenPairWithTotal,
	TotalUsd,
	UnrealizedPnl,
} from './types';
```
Change it to (new entries inserted alphabetically):
```ts
export type {
	GetOhlcvParams,
	GetOpenPortfolioParams,
	GetPositionPnlParams,
	MeteoraDlmmClientOptions,
	Ohlcv,
	OhlcvCandle,
	OhlcvTimeframe,
	OpenPortfolio,
	OpenPortfolioPoolItem,
	OpenPortfolioSortBy,
	OpenPortfolioTotal,
	PositionPnl,
	PositionPnlItem,
	PositionStatus,
	SortDirection,
	TokenAmount,
	TokenPairWithTotal,
	TotalUsd,
	UnrealizedPnl,
} from './types';
```

The current schema-export block is:
```ts
export {
	OpenPortfolioSchema,
	OpenPortfolioPoolItemSchema,
	OpenPortfolioTotalSchema,
	OpenPortfolioSortBySchema,
	PositionPnlSchema,
	PositionPnlItemSchema,
	PositionStatusSchema,
	SortDirectionSchema,
	TokenAmountSchema,
	TokenPairWithTotalSchema,
	TotalUsdSchema,
	UnrealizedPnlSchema,
} from './types';
```
Change it to (prepend the three new `Ohlcv*` schemas to the existing block — match the existing order for the rest):
```ts
export {
	OhlcvSchema,
	OhlcvCandleSchema,
	OhlcvTimeframeSchema,
	OpenPortfolioSchema,
	OpenPortfolioPoolItemSchema,
	OpenPortfolioTotalSchema,
	OpenPortfolioSortBySchema,
	PositionPnlSchema,
	PositionPnlItemSchema,
	PositionStatusSchema,
	SortDirectionSchema,
	TokenAmountSchema,
	TokenPairWithTotalSchema,
	TotalUsdSchema,
	UnrealizedPnlSchema,
} from './types';
```
(The `MeteoraDlmmClient` and `MeteoraApiError` exports at the top of the barrel stay exactly as-is. The existing block is grouped logically, not strictly alphabetical — preserve its order for the pre-existing entries and just prepend the three new ones.)

**Verify**:
- `bun run type-check` → exit 0.
- `bun -e "import { MeteoraDlmmClient, OhlcvSchema, type Ohlcv } from './src/index'; console.log(typeof MeteoraDlmmClient, typeof OhlcvSchema, typeof MeteoraDlmmClient.prototype.getOhlcv)"` → prints `function object function`.

### Step 4: Append a `describe` block for `getOhlcv` to `test/client.test.ts`

Open `test/client.test.ts`. **Do not modify the existing `getOpenPortfolio` or `getPositionPnl` describe blocks or their imports.** Add an import for the new type and append a new describe block at the **end of the file**.

Add `import type { Ohlcv } from '../src/types';` near the existing `import type { OpenPortfolio, PositionPnl } from '../src/types';` line (so it reads `import type { Ohlcv, OpenPortfolio, PositionPnl } from '../src/types';`).

Then append this describe block:

```ts
describe('MeteoraDlmmClient.getOhlcv', () => {
	// A real captured 7-candle payload (pool DQ9weJhfi.../YZY-USDC, timeframe=1h, 2026-06-22).
	// Pinned so the wire shape (numbers, not strings; snake_case fields) can't silently regress —
	// the same class of drift plan 002 caught on pnlSol.
	const REAL: Ohlcv = {
		start_time: 1782118800,
		end_time: 1782140400,
		timeframe: '1h',
		data: [
			{
				timestamp: 1782118800,
				timestamp_str: '2026-06-22T09:00:00+00:00',
				open: 0.2970245855171326,
				high: 0.2970245855171326,
				low: 0.2970245855171326,
				close: 0.2970245855171326,
				volume: 11.01723427984364,
			},
			{
				timestamp: 1782122400,
				timestamp_str: '2026-06-22T10:00:00+00:00',
				open: 0.2970245855171326,
				high: 0.2970245855171326,
				low: 0.2970245855171326,
				close: 0.2970245855171326,
				volume: 0,
			},
			{
				timestamp: 1782126000,
				timestamp_str: '2026-06-22T11:00:00+00:00',
				open: 0.2970245855171326,
				high: 0.2970245855171326,
				low: 0.2970245855171326,
				close: 0.2970245855171326,
				volume: 0,
			},
		],
	};

	test('happy path: parses candles; serializes path + snake_case query (no camelCase renames)', async () => {
		let capturedUrl = '';
		globalThis.fetch = mock((url: string | URL | Request) => {
			capturedUrl = String(url);
			return Promise.resolve(mockResponse(200, REAL));
		}) as unknown as typeof fetch;

		const client = new MeteoraDlmmClient();
		const result = await client.getOhlcv('DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf', {
			timeframe: '1h',
			start_time: 1782118800,
			end_time: 1782140400,
		});

		expect(result).toEqual(REAL);
		expect(result.data[0].close).toBe(0.2970245855171326);
		expect(typeof result.data[0].volume).toBe('number');
		expect(capturedUrl).toContain('https://dlmm.datapi.meteora.ag/pools/');
		expect(capturedUrl).toContain('/pools/DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf/ohlcv?');
		expect(capturedUrl).toContain('timeframe=1h');
		expect(capturedUrl).toContain('start_time=1782118800');
		expect(capturedUrl).toContain('end_time=1782140400');
	});

	test('no-params call: builds URL with just the path (server uses defaults)', async () => {
		let capturedUrl = '';
		globalThis.fetch = mock((url: string | URL | Request) => {
			capturedUrl = String(url);
			return Promise.resolve(mockResponse(200, REAL));
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await client.getOhlcv('SomePool11111111111111111111111111111111111');
		// No query string at all when params omitted.
		expect(capturedUrl).toBe('https://dlmm.datapi.meteora.ag/pools/SomePool11111111111111111111111111111111111/ohlcv');
	});

	test('empty data array (window with no trades) parses cleanly', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(200, {
				start_time: 1782118800,
				end_time: 1782140400,
				timeframe: '1h',
				data: [],
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		const result = await client.getOhlcv('SomePool11111111111111111111111111111111111');
		expect(result.data).toEqual([]);
		expect(result.timeframe).toBe('1h');
	});

	test('malformed 2xx body: throws ZodError (required data field missing)', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(200, {
				start_time: 1,
				end_time: 2,
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getOhlcv('SomePool11111111111111111111111111111111111'),
		).rejects.toBeInstanceOf(ZodError);
	});

	test('400 error: throws MeteoraApiError with status + API message (bad address)', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(mockResponse(400, { message: 'address: Validation error: invalid_pubkey' })),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getOhlcv('bad'),
		).rejects.toMatchObject({ name: 'MeteoraApiError', status: 400, message: 'address: Validation error: invalid_pubkey' });
	});

	test('throws TypeError when address is empty (before any network call)', async () => {
		let called = false;
		globalThis.fetch = mock(() => {
			called = true;
			return Promise.resolve(mockResponse(200, {}));
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(client.getOhlcv('')).rejects.toBeInstanceOf(TypeError);
		expect(called).toBe(false);
	});

	test('live smoke (only runs when RUN_LIVE=1): real OHLCV against a real pool', async () => {
		// Deterministic, public, safe. Skipped in normal CI to avoid network flakes.
		if (process.env.RUN_LIVE !== '1') return;
		const client = new MeteoraDlmmClient();
		const result = await client.getOhlcv('DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf', { timeframe: '1h' });
		expect(Array.isArray(result.data)).toBe(true);
		expect(typeof result.start_time).toBe('number');
	});
});
```

> Notes:
> - The fixture `REAL` is captured from a real response (3 of the 7 candles, trimmed) — pins the wire shape so a future spec/wire drift on any field (the `pnlSol` class of bug) is caught. Note `volume: 0` is a legitimate number for a no-trade candle — don't change it.
> - The `no-params call` test asserts the URL has **no** `?` when params are omitted — this is the load-bearing assertion for Edit 2c's `if (params === undefined) return query;` early-return (otherwise an empty `URLSearchParams().toString()` is `""` and `buildUrl` still omits the `?`, but assert it explicitly).
> - `mockResponse`, `realFetch`/`afterEach`, `mock`, `ZodError`, `MeteoraDlmmClient` are all already in scope at the top of the file (from plans 001/002) — reuse them, do not redeclare.
> - Do NOT enable the live test by default; it self-skips without `RUN_LIVE=1`.

**Verify**: `bun test` → all pass (the existing 15 tests + the new `getOhlcv` tests). Expect **6 deterministic new tests** running (the live test self-skips).

### Step 5: Add a `getOhlcv` example to `README.md`

In `README.md`, after the `getPositionPnl` example (added by plan 002), append a short OHLCV example. Insert before the "Responses are validated..." sentence (or at the end of the Usage code-block region):

```typescript
// OHLCV price history for a pool (use with getPositionPnl's minPrice/maxPrice
// to overlay an LP position's range on a price chart):
const ohlcv = await client.getOhlcv('DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf', {
  timeframe: '1h',
  start_time: Math.floor(Date.now() / 1000) - 24 * 60 * 60, // last 24h
});

for (const candle of ohlcv.data) {
  console.log(candle.timestamp_str, candle.open, candle.high, candle.low, candle.close);
}
```

Leave everything else in the README as-is.

**Verify**: `bun run lint` → exit 0; snippet is valid TypeScript by eye.

### Step 6: Final full verification

Run, in order, and confirm each:

1. `bun run type-check` → exit 0.
2. `bun run lint` → exit 0.
3. `bun test` → all pass: the existing 15 tests **plus** the new `getOhlcv` tests (6 deterministic + live self-skip). Expect 21 total passing.
4. `bun run build` → exit 0, and:
   - `grep -c "getOhlcv" dist/index.js` → ≥ 1.
   - `grep -c "getOpenPortfolio\|getPositionPnl" dist/index.js` → ≥ 2 (plan-001/002 methods still present).
   - `grep -c "OhlcvCandleSchema\|OhlcvSchema" dist/index.d.ts` → ≥ 1.
   - `grep -c 'from "zod"' dist/index.js` → ≥ 1 (zod still externalized).
5. Confirm no existing exports broke: `bun -e "import { MeteoraDlmmClient, OpenPortfolioSchema, PositionPnlSchema, OhlcvSchema, MeteoraApiError } from './src/index'; console.log(typeof MeteoraDlmmClient, typeof OpenPortfolioSchema, typeof PositionPnlSchema, typeof OhlcvSchema, typeof MeteoraApiError)"` → `function object object object function`.
6. Confirm only in-scope files changed: `git status --short` lists only `src/types.ts`, `src/client.ts`, `src/index.ts`, `test/client.test.ts`, `README.md`.
7. Optional one-time live confirmation (by hand, not CI): `RUN_LIVE=1 bun test` → the new live smoke passes against the real pool.

## Test plan

Covered by Step 4. Test intent:

- **Happy path** — deep-equal (`toEqual(REAL)`) of the Zod round-trip **plus** `typeof volume === 'number'` (the load-bearing scalar-type assertion, guarding the `pnlSol` class of bug) **plus** path construction (`/pools/{addr}/ohlcv?`) **plus** the snake_case-passthrough query (`start_time=`, `end_time=`, `timeframe=`).
- **No-params call** — verifies `getOhlcv(address)` with no params builds a bare URL (no `?`); tests the `toOhlcvQuery` early-return.
- **Empty data array** — confirms a no-trade window parses (not an error).
- **Malformed 2xx** — Zod guards the boundary (missing required `data` → `ZodError`).
- **400 error** — `MeteoraApiError` with `status` + API `message` (the bad-address path, which IS a real 400 here, unlike `/positions`).
- **Empty address guard** — fires before network (`called === false`).
- **Live smoke (opt-in)** — real OHLCV against a real pool.

Structural pattern: the existing `describe` blocks in the same file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run type-check` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun test` exits 0; the new `getOhlcv` tests pass and the existing 15 tests still pass (21 total).
- [ ] `bun run build` exits 0; `grep -c "getOhlcv" dist/index.js` ≥ 1; `grep -c "getPositionPnl\|getOpenPortfolio" dist/index.js` ≥ 2; `grep -c 'from "zod"' dist/index.js` ≥ 1.
- [ ] Existing plan-001/002 exports still resolve (the smoke in Step 6.5 prints `function object object object function`).
- [ ] No runtime dependency added (`bun -e "console.log(require('./package.json').dependencies)"` → still `{ zod: '^4.4.3' }`).
- [ ] `git status --short` shows only in-scope paths (`src/types.ts`, `src/client.ts`, `src/index.ts`, `test/client.test.ts`, `README.md`).
- [ ] `plans/README.md` status row for plan 007 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/client.ts` or `src/types.ts` does not match the "Current state" excerpts (drift since this plan was written — re-read before proceeding).
- `bun run type-check` fails on a new schema with `TS9010` — you deviated from the `z.ZodType<T>` pattern; re-read "Repo constraints". Do NOT edit `tsconfig.json`.
- The existing plan-001/002 tests (`getOpenPortfolio`, `getPositionPnl`) start failing — you accidentally modified an existing method/helper/type. Revert that change; this plan is purely additive.
- A live `curl` to `https://dlmm.datapi.meteora.ag/pools/DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf/ohlcv?timeframe=1h` no longer returns HTTP 200 with a `data: [...]` array (API contract changed — types/schemas may need revisiting; do not silently adjust).
- You find yourself renaming `start_time`/`end_time`/`timestamp`/`timestamp_str` to camelCase — STOP. These are snake_case on the wire and the type intentionally mirrors them (unlike plans 001/002's query-param mapping). Do not rename.
- `bun run build` bundles zod instead of externalizing it (`grep -c 'from "zod"' dist/index.js` is 0) — report; do not add a `bunup.config.ts` speculatively.

## Verified during planning (so the plan's done-criteria are real, not guesses)

To de-risk and to apply the lesson from plan 002's `pnlSol` miss, during planning I:

1. **Captured a real OHLCV payload** (pool `DQ9weJhfi…`, `timeframe=1h`, 6h window) via curl and **inspected every scalar's `typeof` on the wire**: all numbers are JSON numbers (`open/high/low/close/volume/timestamp/start_time/end_time`), `timestamp_str` is a string, `timeframe` is a string. **No string-encoded-amount trap here.** (Plan 002's `pnlSol` was a string-per-spec-says-number inversion; OHLCV has no such inversion.)
2. **Compile-checked** the full new `types.ts` block under the repo's exact `tsconfig` (strict + `isolatedDeclarations` + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`) → `tsc --noEmit` exit 0.
3. **Runtime-parsed** the candidate `OhlcvSchema` against the real captured payload → parses clean; and against a malformed input (an `open` as string) → throws `ZodError`.
4. **Live-confirmed the valid `timeframe` set** (`5m 30m 1h 2h 4h 12h 24h` → 200; `7d`/`1d`/`1m` → 400) and **bad-address behavior** (→ 400 with the standard `{"message":...}` body, unlike `/positions/{pool}/pnl` which returns 200-empty for a bad pool).

The real payload is pinned in the test fixture (`REAL` in Step 4) so any future spec-vs-wire drift is caught by CI.

## Maintenance notes

For whoever owns this code after it lands:

- **The price-chart + LP-range-overlay use case** is now fully served by data: `getOhlcv` (candles) + `getPositionPnl` (each position's `minPrice`/`maxPrice`/`poolActivePrice`). The **rendering** (drawing candles + the min/max band + the active-price line) is the consumer's job — the library correctly does no rendering.
- **OHLCV fields are snake_case on the wire and in the type** (`start_time`, `end_time`, `timestamp`, `timestamp_str`). This deliberately diverges from plans 001/002, where the API returned camelCase and the client mapped to snake_case *query* params. Here the API's response itself is snake_case, so the type mirrors it 1:1. Do not "normalize" to camelCase — it would break the round-trip equality the tests assert and confuse consumers comparing to the raw API.
- **`timeframe` is both bucket size and default span.** A request with no window returns ~10 candles of the given interval (covering ~10 buckets back from now). For a controlled window, pass both `start_time` and `end_time` (unix seconds).
- **Bad address → 400** (live-confirmed). Unlike `/positions/{pool}/pnl` (bad pool → 200-empty), so don't promise callers an empty-result fallback for OHLCV; a bad address surfaces as `MeteoraApiError(400)`.
- **Adding the next endpoint**: same recipe — `interface` + `z.ZodType<T>` schema appended to `src/types.ts`, method calling `this.request(url, XSchema)`, barrel exports, describe block. The `request<T>(url, schema: ZodType<T>)` helper remains the single chokepoint.
- **Reviewer scrutiny points**: (1) the snake_case field names in `Ohlcv`/`OhlcvCandle` (intentional — don't camelCase them); (2) `params` being *optional* for `getOhlcv` (unlike the other methods); (3) `toOhlcvQuery`'s early-return on `undefined` params; (4) every new schema's `z.ZodType<T>` annotation; (5) that `request<T>`/`buildUrl`/`getOpenPortfolio`/`getPositionPnl` are byte-identical to before.
- **Follow-up deferred**: pagination (OHLCV uses a time window, not page tokens), throttling, a params Zod schema, and the remaining endpoints (limit-orders, `/portfolio/total`, `/pools/groups`, etc.).
