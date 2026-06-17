# Plan 002: Add `getPositionPnl` — Meteora DLMM `GET /positions/{pool_address}/pnl` (Zod-validated)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a53470b..HEAD -- src test`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M (the `request<T>(url, schema)` / `buildUrl(path, query)` helpers from plan 001 are reused unchanged; this is purely additive: types + one method + tests)
- **Risk**: LOW (additive only — no edits to existing client logic; existing tests untouched)
- **Depends on**: plan 001 (DONE — `MeteoraDlmmClient`, the `request<T>`/`buildUrl` helpers, and the Zod-pattern conventions all exist)
- **Category**: direction (feature)
- **Planned at**: commit `a53470b`, 2026-06-17
- **Revised**: 2026-06-17 — post-approval live verification against a real
  position-bearing wallet (`87bdc…zjkA`, pool `4NTkK…Lbii`) revealed the OpenAPI
  spec is WRONG about `PositionPnlItem.pnlSol` and `pnlSolPctChange`: spec says
  `number`, but the live API returns them as **string**. The first execution
  (commit `4eda5a2`, in worktree `feat/position-pnl`) typed them as `number`
  per the spec and was BLOCKED on review. This revision changes both to
  `string` and adds a regression test pinning the real captured payload. See
  "Verified during planning" for the corrected story.

## Why this matters

Plan 001 shipped `getOpenPortfolio` (a user's positions aggregated *across all
pools*). This plan adds the natural complement: per-position PnL for a **single
pool** — `GET /positions/{pool_address}/pnl`. It returns each position's
realized PnL, all-time deposits/withdrawals/fees (per-token + USD/SOL totals),
and live `unrealizedPnl` for open positions. Together the two endpoints cover
"what do I hold, and how is each position doing."

This is the second endpoint, deliberately scoped to one. The point of the plan
is to prove the plan-001 architecture extends cleanly: **no new infrastructure**
— one new method that calls the existing `request<T>(url, schema)` helper, plus
types/schemas appended to `src/types.ts`. Every nested object shape below was
**compile-checked and runtime-parsed** during planning (see "Verified during
planning").

## Current state

Repo at commit `a53470b` (master). Plan 001 landed: `src/{constants,types,errors,client,index}.ts` + `test/client.test.ts`. Verified during planning: `bun run type-check`, `bun run lint`, `bun run test`, `bun run build` all exit 0; `zod@4.4.3` is the sole runtime dependency.

The executor will edit these files. Excerpts (exact, for drift check):

**`src/client.ts`** — the class the new method joins. The two helpers below are the extension points and are **reused unchanged**:
```ts
import type { ZodType } from 'zod';
import type {
	GetOpenPortfolioParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
} from './types';
import type { MeteoraApiError as MeteoraApiErrorType } from './errors';
import { MeteoraApiError as MeteoraApiErrorClass } from './errors';
import {
	DEFAULT_TIMEOUT_MS,
	METEORA_DLMM_MAINNET_URL,
} from './constants';
import { OpenPortfolioSchema } from './types';

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
	 * ...JSDoc...
	 */
	async getOpenPortfolio(params: GetOpenPortfolioParams): Promise<OpenPortfolio> {
		if (typeof params?.user !== 'string' || params.user.length === 0) {
			throw new TypeError('getOpenPortfolio requires a non-empty "user" wallet address.');
		}

		const url = this.buildUrl('/portfolio/open', toPortfolioQuery(params));
		return this.request(url, OpenPortfolioSchema);
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
```
Note: `getOpenPortfolio` ends, then `buildUrl`, then `request`, then the module-level `toPortfolioQuery` / `parseBody` / `extractMessage` helpers, then `export type { MeteoraApiErrorType };`. You will add a second method **right after `getOpenPortfolio`** (before `buildUrl`) and a second query-serializer **right after `toPortfolioQuery`**.

**`src/types.ts`** — currently contains the plan-001 types (`SortDirection`, `OpenPortfolioSortBy`, `OpenPortfolioTotal`, `OpenPortfolioPoolItem`, `OpenPortfolio`, `GetOpenPortfolioParams`, `MeteoraDlmmClientOptions`) each as an `interface` (or type alias) **plus** a `z.ZodType<T>`-annotated schema. It starts with `import { z } from 'zod';`. You will **append** new types/schemas to the end of this file (do not modify existing ones).

**`src/index.ts`** — barrel; you will add new export lines.

**`test/client.test.ts`** — one `describe('MeteoraDlmmClient.getOpenPortfolio', ...)` block; you will **append** a second `describe` block for `getPositionPnl` at the end of the file.

## Repo constraints (unchanged from plan 001 — will break the build if violated)

From `tsconfig.json`:

1. **`verbatimModuleSyntax: true`** → type-only imports MUST use `import type { ... }`.
2. **`isolatedDeclarations: true`** → every exported const/function must have an explicit type annotation.
3. **`strict: true` + `noUncheckedIndexedAccess: true`**.

Indentation is **tabs**, quotes are **single**. Code blocks below already use tabs.

### ⚠️ The Zod pattern (same as plan 001 — verified for these new types too)

Under `isolatedDeclarations`, the idiomatic `export const S = z.object(...)` / `z.infer<typeof S>` pattern does NOT compile. The only pattern that compiles is **hand-written interface + annotated schema**:

```ts
export interface Foo { a: string }
export const FooSchema: z.ZodType<Foo> = z.object({ a: z.string() });
```

The duplication (interface + `z.object`) is **intentional and required**. The `z.ZodType<T>` annotation makes tsc verify schema ↔ interface agree at compile time. **All 8 new types in this plan were compile-checked and runtime-parsed during planning** (against the real live empty-wallet response AND a spec-derived populated fixture with full nesting) — see "Verified during planning". Do NOT collapse to `z.infer`; do NOT relax `tsconfig.json`.

## The API contract (authoritative — from the OpenAPI spec at `https://dlmm.datapi.meteora.ag/api-docs/openapi.json`, operation `get_pool_position_pnl`, verified live during planning)

- **Base URL (mainnet):** `https://dlmm.datapi.meteora.ag` (same as plan 001)
- **Method + path:** `GET /positions/{pool_address}/pnl`
- **Rate limit:** 30 req/s (informational; not throttled)
- **Parameters:**

  | Param           | In    | Required | Type    | Notes |
  |-----------------|-------|----------|---------|-------|
  | `pool_address`  | path  | yes      | string  | Pool (LB pair) address. **NOT pubkey-validated by the API** (see "Live-verified behavior" below). URL-encode it defensively. |
  | `user`          | query | yes      | string  | Solana wallet address (base58). **API validates pubkey format → 400 on invalid.** |
  | `status`        | query | no       | enum    | `open` \| `closed` \| `all` (default `all`) |
  | `page`          | query | no       | integer | default 1 |
  | `page_size`     | query | no       | integer | default 20, max 100 |

- **Response `200`** — JSON, camelCase. Top-level (`GetPoolPositionPnLResponse`):
  - Required: `totalCount: number`, `page: number`, `pageSize: number`, `hasNext: boolean`, `positions: PositionPnlItem[]`, `tokenXPrice: string`, `tokenYPrice: string`, `rewardTokenXPrice: string`, `rewardTokenYPrice: string`.
  - Optional + nullable (`[string, null]`, may be absent OR null): `tokenX`, `tokenY`, `rewardTokenX`, `rewardTokenY` (pool token symbols/mints), `solPrice`.
- **Response `400`** — JSON `{"message": "..."}`. Example live body for a bad user: `{"message":"user: Validation error: invalid_pubkey [{\"value\": String(\"badaddress\")}]"}`. **Identical to `/portfolio/open` → the existing `MeteoraApiError`/`extractMessage` handles it with no changes.**
- **Verified live empty-wallet response** (pool `ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq`, user `11111111111111111111111111111112`):
  ```json
  {"tokenX":null,"tokenY":null,"totalCount":0,"page":1,"pageSize":20,"hasNext":false,"positions":[],"tokenXPrice":"0","tokenYPrice":"0","rewardTokenX":null,"rewardTokenY":null,"rewardTokenXPrice":"0","rewardTokenYPrice":"0"}
  ```
  (Note: `solPrice` is ABSENT here — confirms optional fields may be omitted, not just null. `tokenX`/`rewardToken*` arrive as `null`.)

### Live-verified behavior (do not "fix")

- **An invalid `pool_address` does NOT 400** — the API returns 200 with `positions:[]` and `"0"` prices. Only `user` is pubkey-validated. Therefore: the client guards `user` (non-empty, like plan 001) but **does NOT validate `poolAddress` format** — let the API return its empty result. (Guarding `poolAddress` non-empty is fine and recommended, since an empty path segment is never a valid call.)
- **`unrealizedPnl` is only present for OPEN positions** — for closed positions it is absent. The schema handles both (`.nullish()`).
- **Number precision**: most USD/SOL amounts are strings; keep them `string`. **EXCEPTION confirmed live**: the OpenAPI spec claims `PositionPnlItem.pnlSol` and `pnlSolPctChange` are `number`, but a real populated response returns them as **string** (e.g. `"pnlSol": "0.004720482401372017"`). Type them as `string` (the spec is wrong). The one genuinely-`number` field is `UnrealizedPnl.balances` (a JSON number, e.g. `331.14401628988475`) — keep that as `number`. Trust the wire over the spec for any amount field.

### Naming convention chosen (parallel to plan 001)

| Spec name                 | Exported as            | Why |
|---------------------------|------------------------|-----|
| `GetPoolPositionPnLResponse` | `PositionPnl`       | Parallel to `getOpenPortfolio` → `OpenPortfolio`. The whole response object named after the resource. |
| `PositionPnLData`         | `PositionPnlItem`      | Parallel to `OpenPortfolioPoolItem`. One entry in `positions[]`. |
| `TokenAmount`             | `TokenAmount`          | Spec name is clear; reused verbatim. |
| `TotalUsd`                | `TotalUsd`             | Spec name is clear; reused verbatim. |
| `TokenPairWithTotal`      | `TokenPairWithTotal`   | Spec name is clear; reused verbatim. |
| `UnrealizedPnL`           | `UnrealizedPnl`        | Reused (lowercase `l` for consistency with `PositionPnl`). |
| `PositionStatus`          | `PositionStatus`       | Spec name is clear; reused verbatim. |

**Method name:** `getPositionPnl(poolAddress, params)` — the path param (`poolAddress`) is positional-first to mirror the REST path-vs-query distinction (resource identity first, filters second). `params` carries the query params (`user` required, rest optional).

## Commands you will need

| Purpose    | Command                          | Expected on success |
|------------|----------------------------------|---------------------|
| Install    | `bun install`                    | exit 0              |
| Typecheck  | `bun run type-check`             | exit 0, no errors   |
| Lint       | `bun run lint`                   | exit 0              |
| Tests      | `bun test`                       | all pass            |
| Build      | `bun run build`                  | exit 0              |
| Live smoke | `curl -sS "https://dlmm.datapi.meteora.ag/positions/ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq/pnl?user=11111111111111111111111111111112"` | `{"tokenX":null,...,"positions":[],...}` (HTTP 200) |

All verified during planning.

## Scope

**In scope** (the only files you should modify):
- `src/types.ts` — **append** the new types/schemas (do not edit existing ones)
- `src/client.ts` — **add** the `getPositionPnl` method + `toPositionPnlQuery` serializer (do not edit existing methods/helpers)
- `src/index.ts` — **add** export lines for the new types/schemas
- `test/client.test.ts` — **append** a `describe('MeteoraDlmmClient.getPositionPnl', ...)` block
- `README.md` — **add** a short `getPositionPnl` example in the Usage section

**Out of scope** (do NOT touch):
- `src/constants.ts`, `src/errors.ts` — unchanged. The base URLs, timeout, and `MeteoraApiError` already cover this endpoint.
- The existing `getOpenPortfolio` method, `request<T>` helper, `buildUrl`, `parseBody`, `extractMessage` — **reuse as-is**. This is the whole point: no new infrastructure.
- Any other endpoint. `/portfolio/total`, `/pools`, `/pools/{address}`, limit-orders endpoints, etc. remain deferred.
- `tsconfig.json`, `bunfig.toml`, `.editorconfig`, `.git*`, `.github/`, `CONTRIBUTING.md`, `LICENSE`.
- Adding any runtime dependency. (`zod` already present from plan 001.)
- A params Zod schema for `GetPositionPnlParams` (consistent with plan 001's decision — params are caller-constructed, validated server-side; the client guards `user` non-empty and `poolAddress` non-empty).

## Git workflow

- Branch: `feat/position-pnl`
- Conventional Commits (see `CONTRIBUTING.md`). Suggested: one commit `feat: add getPositionPnl for /positions/{pool_address}/pnl` (or split feat/test/docs if you prefer). 
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Append the new types/schemas to `src/types.ts`

Open `src/types.ts`. **Do not modify any existing type or schema.** Append the following block to the **end** of the file (after the existing `MeteoraDlmmClientOptions` interface). The `import { z } from 'zod';` at the top already covers these — do not add a second import.

```ts

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
```

**Verify**: `bun run type-check` → exit 0. (If it fails with TS9010 on any new schema, you forgot the `z.ZodType<T>` annotation. If TS2322, the schema fields don't match the interface — fix the schema. Every block above was compile-verified during planning, so a failure here means you deviated from the text.)

### Step 2: Add the `getPositionPnl` method + query serializer to `src/client.ts`

Two edits to `src/client.ts`. Do not touch any existing code.

**Edit 2a — extend the type imports from `./types`.** Change the existing `import type { ... } from './types';` block so it ALSO imports the two new symbols it needs. The current block is:
```ts
import type {
	GetOpenPortfolioParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
} from './types';
```
Change it to:
```ts
import type {
	GetOpenPortfolioParams,
	GetPositionPnlParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
	PositionPnl,
} from './types';
```
And the existing value import `import { OpenPortfolioSchema } from './types';` — add `PositionPnlSchema` next to it:
```ts
import { OpenPortfolioSchema, PositionPnlSchema } from './types';
```

**Edit 2b — add the method.** Insert this method **immediately after the closing brace of `getOpenPortfolio`** (i.e. after `getOpenPortfolio`'s final `}` and before `private buildUrl(...)`):

```ts
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
```

**Edit 2c — add the query serializer.** Insert this module-level function **immediately after the existing `toPortfolioQuery` function** (after `toPortfolioQuery`'s closing `}` and before `async function parseBody`):

```ts
/** Maps camelCase client params to the API's snake_case query parameters for /positions/{pool}/pnl. */
function toPositionPnlQuery(params: GetPositionPnlParams): URLSearchParams {
	const query = new URLSearchParams();
	query.set('user', params.user);
	if (params.status !== undefined) query.set('status', params.status);
	if (params.page !== undefined) query.set('page', String(params.page));
	if (params.pageSize !== undefined) query.set('page_size', String(params.pageSize));
	return query;
}
```

> Notes:
> - `encodeURIComponent(poolAddress)` is defensive — base58 chars are URL-safe so it's a no-op for valid addresses, but it prevents a malformed input from corrupting the path.
> - The method guards **both** `poolAddress` and `user` non-empty. It does NOT validate their pubkey format (the API validates `user`; `poolAddress` isn't validated at all — see "Live-verified behavior").
> - It reuses `this.buildUrl` and `this.request` unchanged. **Do not modify those helpers.**

**Verify**: `bun run type-check` → exit 0.

### Step 3: Extend the barrel in `src/index.ts`

Add the new types to the existing `export type { ... } from './types';` block, and the new schemas to the existing `export { ... } from './types';` block.

The current barrel's type-export block is:
```ts
export type {
	GetOpenPortfolioParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
	OpenPortfolioPoolItem,
	OpenPortfolioSortBy,
	OpenPortfolioTotal,
	SortDirection,
} from './types';
```
Change it to (new entries inserted alphabetically — keep it tidy):
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

The current schema-export block is:
```ts
export {
	OpenPortfolioSchema,
	OpenPortfolioPoolItemSchema,
	OpenPortfolioTotalSchema,
	OpenPortfolioSortBySchema,
	SortDirectionSchema,
} from './types';
```
Change it to:
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
(`MeteoraDlmmClient` and `MeteoraApiError` exports at the top of the barrel stay exactly as-is — no new method class to export; it's the same class.)

**Verify**:
- `bun run type-check` → exit 0.
- `bun -e "import { MeteoraDlmmClient, PositionPnlSchema, type PositionPnl } from './src/index'; console.log(typeof MeteoraDlmmClient, typeof PositionPnlSchema, typeof MeteoraDlmmClient.prototype.getPositionPnl)"` → prints `function object function`.

### Step 4: Append a `describe` block for `getPositionPnl` to `test/client.test.ts`

Open `test/client.test.ts`. **Do not modify the existing `getOpenPortfolio` describe block or its imports.** Append the block below to the **end of the file** (after the existing `describe('MeteoraDlmmClient.getOpenPortfolio', ...)` block's closing `});`).

Because the new tests use `PositionStatus`, `PositionPnl`, and `ZodError`, add these imports if not already present:
- `ZodError` is already imported at the top of the file (`import { ZodError } from 'zod';`). Leave it.
- Add `import type { PositionPnl } from '../src/types';` near the existing `import type { OpenPortfolio } from '../src/types';`.

Then append this describe block:

```ts
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
```

> Notes:
> - The fixture `POPULATED` is built from the spec's `required` arrays and exercises every nested type (`TokenPairWithTotal` → `TokenAmount`/`TotalUsd`, and `UnrealizedPnl` → `TokenAmount`). The happy-path test asserts deep equality (`toEqual`) **and** reaches into the nesting (`unrealizedPnl?.balances`, `allTimeDeposits.total.usd`) so a wrong nested type can't pass silently.
> - The empty-result fixture is the **actual live-verified** empty response (see "Current state"); `tokenXPrice: '0'` etc. are required and present.
> - The `closed position` test confirms `unrealizedPnl` is genuinely optional (absent → `undefined`).
> - `mockResponse` and `realFetch`/`afterEach` are already defined at the top of the file (from plan 001) — reuse them, do not redeclare.
> - Do NOT enable the live test by default; it self-skips without `RUN_LIVE=1`.

**Verify**: `bun test` → all tests pass (the existing 7 plan-001 tests + the new `getPositionPnl` tests). Expect **6 deterministic new tests** running (the live test self-skips).

### Step 5: Add a `getPositionPnl` example to `README.md`

In `README.md`, the Usage section currently shows only the `getOpenPortfolio` example (from plan 001). Add a second short example after it (before the "Responses are validated..." sentence). Insert:

```typescript
// Per-position PnL for one pool:
const pnl = await client.getPositionPnl(
  'DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf', // pool address
  { user: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq', status: 'open' },
);

for (const pos of pnl.positions) {
  console.log(pos.positionAddress, pos.pnlUsd, pos.allTimeFees.total.usd);
  if (pos.unrealizedPnl) console.log('  live:', pos.unrealizedPnl.balances);
}
```

Leave everything else in the README as-is.

**Verify**: `bun run lint` → exit 0; the snippet is valid TypeScript by eye.

### Step 6: Final full verification

Run, in order, and confirm each:

1. `bun run type-check` → exit 0.
2. `bun run lint` → exit 0.
3. `bun test` → all pass: the existing 7 plan-001 tests **plus** the new `getPositionPnl` tests (6 deterministic + live self-skip).
4. `bun run build` → exit 0, and:
   - `grep -c "getPositionPnl" dist/index.js` → ≥ 1.
   - `grep -c "getOpenPortfolio" dist/index.js` → ≥ 1 (plan-001 method still present).
   - `grep -c "PositionPnlItemSchema\|PositionPnlSchema" dist/index.d.ts` → ≥ 1.
   - `grep -c 'from "zod"' dist/index.js` → ≥ 1 (zod still externalized).
5. Confirm no existing exports broke: `bun -e "import { MeteoraDlmmClient, OpenPortfolioSchema, PositionPnlSchema, MeteoraApiError } from './src/index'; console.log(typeof MeteoraDlmmClient, typeof OpenPortfolioSchema, typeof PositionPnlSchema, typeof MeteoraApiError)"` → `function object object function`.
6. Confirm only in-scope files changed: `git status --short` lists only `src/types.ts`, `src/client.ts`, `src/index.ts`, `test/client.test.ts`, `README.md`.
7. Optional one-time live confirmation (by hand, not CI): `RUN_LIVE=1 bun test` → the new live smoke passes against the real pool+empty wallet.

## Test plan

Covered by Step 4. Test intent:

- **Happy path** — deep-equal of the nested Zod round-trip (`toEqual(POPULATED)`) **plus** nested-field assertions (`unrealizedPnl?.balances`, `allTimeDeposits.total.usd`) **plus** path-construction (`/positions/{POOL}/pnl`) **plus** snake_case query (`status=open`, `page_size=50`). Highest-value test.
- **Empty result** — the real live-verified empty shape; confirms `tokenX:null`, absent `solPrice`, required `tokenXPrice:'0'` all handled.
- **Malformed 2xx** — Zod guards the boundary (missing required `tokenXPrice` → `ZodError`).
- **400 error** — `MeteoraApiError` with `status` + API `message` (the invalid-user path, which is the API's real validation surface).
- **Empty poolAddress/user guards** — both fire before network (`called === false`).
- **Closed position** — `unrealizedPnl` is genuinely optional.
- **Live smoke (opt-in)** — real wire contract against a real pool + empty wallet.

Structural pattern: the existing `describe('MeteoraDlmmClient.getOpenPortfolio', ...)` block in the same file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run type-check` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun test` exits 0; the new `getPositionPnl` tests pass and the existing 7 plan-001 tests still pass.
- [ ] `bun run build` exits 0; `grep -c "getPositionPnl" dist/index.js` ≥ 1; `grep -c "getOpenPortfolio" dist/index.js` ≥ 1; `grep -c 'from "zod"' dist/index.js` ≥ 1.
- [ ] Existing plan-001 exports still resolve (the smoke in Step 6.5 prints `function object object function`).
- [ ] No runtime dependency added (`bun -e "console.log(require('./package.json').dependencies)"` → still `{ zod: '^4.4.3' }`).
- [ ] `git status --short` shows only in-scope paths (`src/types.ts`, `src/client.ts`, `src/index.ts`, `test/client.test.ts`, `README.md`).
- [ ] `plans/README.md` status row for plan 002 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/client.ts` or `src/types.ts` does not match the "Current state" excerpts (drift since this plan was written — re-read before proceeding).
- `bun run type-check` fails on a new schema with `TS9010` — you deviated from the `z.ZodType<T>` pattern; re-read "Repo constraints". Do NOT edit `tsconfig.json`.
- `bun run type-check` fails with `TS2502`/`TS2456` (circular) — you tried `z.infer<typeof Schema>`; use the hand-written-interface + annotated-schema pattern shown in Step 1.
- The existing plan-001 tests (`getOpenPortfolio`) start failing — you accidentally modified `getOpenPortfolio`, `request<T>`, `buildUrl`, or an existing type. Revert that change; this plan is purely additive.
- A live `curl` to `https://dlmm.datapi.meteora.ag/positions/ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq/pnl?user=11111111111111111111111111111112` no longer returns the documented empty response (API contract changed — types/schemas may need revisiting; do not silently adjust).
- `bun run build` bundles zod instead of externalizing it (`grep -c 'from "zod"' dist/index.js` is 0) — report; do not add a `bunup.config.ts` speculatively.

## Verified during planning (so the plan's done-criteria are real, not guesses)

To de-risk the load-bearing part (nested Zod schemas under `isolatedDeclarations`), during planning I:

1. **Compile-checked** the full new `types.ts` block under the repo's exact `tsconfig` (strict + `isolatedDeclarations` + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`) → `tsc --noEmit` exit 0.
2. **Runtime-parsed** `PositionPnlSchema` against:
   - the **real live empty-wallet response** (captured via curl) → parses, preserves `null`s, treats absent `solPrice` as `undefined`, keeps required `tokenXPrice:'0'`, strips unknown keys;
   - a **spec-derived populated fixture** with full nesting (`TokenPairWithTotal` → `TokenAmount`/`TotalUsd`, `UnrealizedPnl` → `TokenAmount`) → parses, nested values reachable;
   - a **closed-position variant** (`unrealizedPnl` absent) → parses to `undefined`;
   - a **malformed input** (required `tokenXPrice` missing) → throws `ZodError` with `issue.path === ["tokenXPrice"]`.

So the executor should get green checks on the first run.

**Post-approval update (the honest story):** the planning-time verification
above was insufficient for the populated shape — I validated only against the
empty response + a *spec-built* fixture, never a real position. After the first
execution passed review, live verification against wallet `87bdc…zjkA` (pool
`4NTkK…Lbii`, SPCX/SOL) revealed the OpenAPI spec is wrong about
`PositionPnlItem.pnlSol` and `pnlSolPctChange` (spec: `number`; live: `string`).
The shipped schema rejected the real payload. This revision:
3. **Re-validated** the corrected `PositionPnlSchema` (both fields → `string`)
   against the real captured populated payload → parses clean; and confirmed
   `UnrealizedPnl.balances` is genuinely a `number` (left as-is).
The real payload is now pinned by a regression test so the drift can't recur.
Lesson for future endpoints: capture a real populated payload *during* planning,
not after — the Meteora OpenAPI spec is not reliable on scalar types.

## Maintenance notes

For whoever owns this code after it lands:

- **The populated nested shape is now LIVE-CONFIRMED.** Verified post-approval against wallet `87bdc…zjkA` in pool `4NTkK…Lbii` (SPCX/SOL): the full `PositionPnlItem`/`TokenPairWithTotal`/`UnrealizedPnl` structure parses through the schema, AND that check caught the `pnlSol`/`pnlSolPctChange` spec-vs-wire drift (spec said `number`; live is `string`) — fixed in this revision and pinned by the `regression: real captured live payload` test. If a future API change alters a field's optionality/nullability/type, adjust the interface AND the schema together (the `z.ZodType<T>` annotation forces them to stay in sync) and re-capture the regression payload.
- **Adding the next endpoint**: same recipe — append `interface` + `z.ZodType<T>`-annotated schema to `src/types.ts`, add a method to `MeteoraDlmmClient` that calls `this.request(url, XSchema)`, extend the barrel, add a `describe` block. The `request<T>(url, schema: ZodType<T>)` helper remains the single chokepoint.
- **`pool_address` is not API-validated** — a typo'd pool returns 200 empty, not 400. Don't promise callers a 400 for bad pools (only bad `user`). The client guards non-empty only.
- **One genuinely-`number` field**: `UnrealizedPnl.balances` (a JSON number, confirmed live). `PositionPnlItem.pnlSol` and `pnlSolPctChange` are **string** despite the OpenAPI spec saying `number` (confirmed live — see the regression test). Everything else USD/SOL stays `string` for precision. Lesson: the Meteora OpenAPI spec is not fully trustworthy on scalar types — trust the wire.
- **Reviewer scrutiny points**: (1) the path construction `/positions/${encodeURIComponent(poolAddress)}/pnl`; (2) the snake_case query mapping in `toPositionPnlQuery` (`page_size`, but `status` is single-word so stays as-is); (3) that `request<T>`/`buildUrl`/`getOpenPortfolio` are byte-identical to before (this plan is additive); (4) every new schema's `z.ZodType<T>` annotation.
- **Follow-up deferred**: pagination iterator (response exposes `hasNext`/`page`/`pageSize`/`totalCount`), throttling, a params Zod schema, and the remaining 17 endpoints.
