# Plan 001: Convert `metter` into a Meteora DLMM API wrapper (endpoint: `GET /portfolio/open`) with Zod-validated responses

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c2c6d6f..HEAD -- src test README.md package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (new files; only `src/index.ts`, `test/index.test.ts`, `README.md`, and the `description` field in `package.json` are edits to existing files; adds one runtime dependency `zod`; build/test gate is green and fast)
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `c2c6d6f`, 2026-06-17

## Why this matters

This repo is currently a freshly-scaffolded placeholder library whose only
export is `greet(name)`. The goal is to turn it into a real, published npm
library: a **TypeScript client for the Meteora DLMM REST API**, starting with a
single endpoint — `GET /portfolio/open` (a user's open positions across pools,
with balances/fees/PnL in USD and SOL). Everything in this plan is scoped to
that one endpoint, but the file layout is chosen so adding the other 18
endpoints later is one new method + one schema block.

**Responses are validated at runtime with [Zod](https://zod.dev)**: the client
parses every API response through a Zod schema before returning it, so an API
shape drift surfaces as a clear `ZodError` instead of a silent `undefined` or a
mysteriously-failing downstream call. The Zod schemas are exported alongside the
derived TypeScript types so consumers can re-use them for their own validation.

The wrapper uses the **global Web `fetch`** (Node 18+, Bun, Deno, browsers) and
has exactly **one runtime dependency: `zod`**.

## Current state

The repo at commit `c2c6d6f` is a Bunup scaffold. Verified during planning:
`bun run type-check`, `bun run lint`, `bun run test`, and `bun run build` all
exit 0. Zod 4.4.3 is the current `latest` at planning time; this plan was
verified against Zod 4.x.

Relevant files:

- `src/index.ts` — the ONLY source file today, containing the placeholder:
  ```ts
  export function greet(name: string): string {
  	return `Hello, ${name}!`;
  }
  ```
  (indentation is **tabs**, single quotes — see `.editorconfig`. Match this.)
- `test/index.test.ts` — the only test, exercising `greet`:
  ```ts
  import { expect, test } from 'bun:test';
  import { greet } from '../src';

  test('should greet correctly', () => {
  	expect(greet('World')).toBe('Hello, World!');
  });
  ```
- `package.json` — `"description": "Lightweight and flexible component toolkit"`, `"type": "module"`, `"module": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, `"files": ["dist"]`, **no `dependencies` key** (only `devDependencies`). Scripts: `"build": "bunup"`, `"type-check": "tsc --noEmit"`, `"lint": "oxlint"`, `"test": "bun test"`, `"format": "oxfmt"`.
- `tsconfig.json` — `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`. **Three settings below are load-bearing and will break the build if ignored — see "Repo constraints".**
- `.editorconfig` — `indent_style = tab`, `quote_type = single`, `end_of_line = lf`, `insert_final_newline = true`.
- `README.md` — currently documents `greet`. The Usage section must be updated (see Step 8).
- No `bunup.config.ts` exists. **Verified during planning**: `bunup` (v0.16.32) auto-detects `src/index.ts` as the single entry (it reads `package.json`'s `module`/`types`) and bundles it to a single `dist/index.js` + `dist/index.d.ts`. **It also externalizes everything declared in `dependencies` by default** (empirically confirmed: a probe build kept `import { z } from "zod"` as an external import in `dist/index.js` rather than bundling it). So declaring `zod` in `dependencies` is correct and requires NO `bunup.config.ts`. Do not create one.

## Repo constraints (these WILL break the build if violated)

From `tsconfig.json`, all of these are enforced:

1. **`verbatimModuleSyntax: true`** → every type-only import MUST use `import type { ... }`. Mixing a type into a value import is a hard compile error. (e.g. `import type { ZodType } from 'zod'`, never `import { ZodType }`.)
2. **`isolatedDeclarations: true`** → every exported function/method/const must have an **explicit** type annotation. No inferred return types on anything exported.
3. **`strict: true` + `noUncheckedIndexedAccess: true`** → index access returns `T | undefined`; the client code below already accounts for this.

Indentation is **tabs**, quotes are **single**. The code blocks below already use tabs — preserve them.

### ⚠️ The single most important Zod-specific constraint (verified, would silently break the executor)

`isolatedDeclarations` (constraint #2) **forbids the idiomatic Zod export pattern**:

```ts
// ❌ FAILS under this repo's tsconfig with TS9010:
//   "Variable must have an explicit type annotation with --isolatedDeclarations."
export const FooSchema = z.object({ a: z.string() });
export type Foo = z.infer<typeof FooSchema>;
```

It also forbids the "derive the type, then annotate the schema with it" workaround, because that is circular (`TS2502: referenced directly or indirectly in its own type annotation`):

```ts
// ❌ FAILS with TS2502 / TS2456 (circular):
export const FooSchema: z.ZodType<Foo> = z.object({ a: z.string() });
export type Foo = z.infer<typeof FooSchema>;
```

**The only pattern that compiles** (verified end-to-end against this repo's exact `tsconfig`) is: **hand-write the TypeScript interface, then annotate the schema const with `z.ZodType<ThatInterface>`**:

```ts
// ✅ COMPILES. The annotation is also a free compile-time check that the schema
//    matches the interface — change one without the other and tsc errors.
export interface Foo { a: string }
export const FooSchema: z.ZodType<Foo> = z.object({ a: z.string() });
```

This means there is intentional duplication: each shape exists once as an `interface` and once as a `z.object(...)`. **This is deliberate, not a mistake to "clean up."** The `z.ZodType<T>` annotation makes TypeScript verify the two agree at compile time. Do NOT attempt to collapse them via `z.infer` — it will not compile under this `tsconfig`. (Relaxing `isolatedDeclarations` is out of scope — see STOP conditions.)

## The API contract (authoritative — derived from the OpenAPI spec at `https://dlmm.datapi.meteora.ag/api-docs/openapi.json`, verified live during planning)

- **Base URL (mainnet):** `https://dlmm.datapi.meteora.ag`
- **Method + path:** `GET /portfolio/open`
- **Rate limit:** 30 req/s (informational; the wrapper does not throttle)
- **Query parameters** (sent on the wire as **snake_case**):

  | Param            | Required | Type    | Notes |
  |------------------|----------|---------|-------|
  | `user`           | yes      | string  | Solana wallet address (base58). API validates pubkey format; invalid → 400. |
  | `page`           | no       | integer | default 1 |
  | `page_size`      | no       | integer | default 20, max 50 |
  | `sort_by`        | no       | enum    | one of `current_balances` \| `unclaimed_fee` \| `fee_per_tvl24h` (default `current_balances`) |
  | `sort_direction` | no       | enum    | `asc` \| `desc` (default `desc`) |

- **Response `200`** — JSON, **camelCase** keys (confirmed live). Top-level:
  - `page: number`, `pageSize: number`, `hasNext: boolean`, `totalCount: number`, `totalPositions: number`, `pools: OpenPortfolioPoolItem[]` — always present.
  - `solPrice?: string | null` — **OPTIONAL: may be entirely absent from the JSON** (confirmed: empty-wallet response omits it).
  - `total?: OpenPortfolioTotal | null` — **OPTIONAL: may be entirely absent** (confirmed absent on empty wallets).
- **Response `400`** — JSON body `{"message": "..."}`. Example live body: `{"message":"user: Validation error: invalid_pubkey [...]"}`.
- **Verified live empty-wallet response** (wallet `11111111111111111111111111111112`, expect to reproduce this exactly in a smoke test):
  ```json
  {"page":0,"pageSize":0,"hasNext":false,"totalCount":0,"totalPositions":0,"pools":[]}
  ```

### Spec quirks to honor (do not "fix" these)

- The operation's prose *description* lists sort values `pool_tvl`, `pool_volume_24h`, and spells one as `fee_per_tvl_24h`. **Ignore the prose.** The actual validated enum (schema `GetOpenPortfolioSort`) is exactly `current_balances | unclaimed_fee | fee_per_tvl24h`. Use the enum.
- The schema marks `page`/`page_size` `minimum: 0`, but the prose says default 1. Do not client-side-validate these ranges — let the API validate and surface its 400.
- Many numeric USD/SOL amounts are returned as **strings** (e.g. `"balances": "1234.56"`). Keep them as `string` in the types/schemas — do NOT parse to `number` (precision loss). SOL price is also a string.

### Zod mapping rules used in this plan (verified)

| OpenAPI shape                         | TypeScript            | Zod                           |
|---------------------------------------|-----------------------|-------------------------------|
| required string                       | `a: string`           | `z.string()`                  |
| required number                       | `a: number`           | `z.number()`                  |
| required string array                 | `a: string[]`         | `z.array(z.string())`         |
| optional + nullable (`type: [x,null]`, not in `required`) | `a?: string \| null` | `z.string().nullish()`        |
| nested object (required)              | `a: Child`            | `ChildSchema`                 |
| nested object (optional + nullable)   | `a?: Child \| null`   | `ChildSchema.nullish()`       |
| enum                                  | union of string literals | `z.enum([...])`            |

`.nullish()` = accepts `undefined` (key absent) AND `null`. `.parse()` **strips** unknown keys by default (forward-compatible with new API fields) — this is the intended behavior; do not switch to `.strict()`.

## Commands you will need

| Purpose    | Command                          | Expected on success |
|------------|----------------------------------|---------------------|
| Add dep    | `bun add zod`                    | adds `zod` to `package.json` `dependencies`; installs Zod 4.x |
| Install    | `bun install`                    | exit 0              |
| Typecheck  | `bun run type-check`             | exit 0, no errors   |
| Lint       | `bun run lint`                   | exit 0              |
| Tests      | `bun test`                       | all pass            |
| Build      | `bun run build`                  | exit 0; emits `dist/index.js` + `dist/index.d.ts`; `dist/index.js` keeps `import { ... } from "zod"` external (not bundled) |
| Live smoke | `curl -sS "https://dlmm.datapi.meteora.ag/portfolio/open?user=11111111111111111111111111111112"` | `{"page":0,"pageSize":0,"hasNext":false,"totalCount":0,"totalPositions":0,"pools":[]}` |

All commands and the Zod schema shapes verified during planning.

## Scope

**In scope** (the only files you should create or modify):
- `package.json` — **add `zod` to `dependencies`** (Step 1) and **update the `description` field** (Step 9)
- `src/constants.ts` — **create**
- `src/types.ts` — **create**
- `src/errors.ts` — **create**
- `src/client.ts` — **create**
- `src/index.ts` — **rewrite** (barrel re-exporting from the above)
- `test/client.test.ts` — **create**
- `test/index.test.ts` — **delete**
- `README.md` — **update** the Usage section + one-line tagline (Step 8)
- `bun.lock` — will be updated automatically by `bun add zod`; that's expected

**Out of scope** (do NOT touch, even though they look related):
- Any other Meteora endpoint. `/portfolio/total`, `/portfolio`, `/pools`, `/pools/{address}`, limit-orders endpoints, etc. are explicitly deferred — the whole point is to ship ONE endpoint now.
- `tsconfig.json`, `bunfig.toml`, `.editorconfig`, `.git*`, anything under `.github/`. In particular do NOT relax `isolatedDeclarations` to make `z.infer` work — the plan's schema pattern already compiles under the current strict config.
- Adding any runtime dependency OTHER than `zod`. (No HTTP client, no throttle/retry/cache/auth libs.)
- CI workflows, `CONTRIBUTING.md`, `LICENSE`.
- Pagination helpers / async iterators, throttling, retries, caching, auth. The response already carries `hasNext`/`page`/`pageSize`/`totalCount` so callers can paginate manually; automating it is future work.
- A Zod schema for the client *params* (`GetOpenPortfolioParams`). Params are constructed by the caller and validated server-side (→ 400); a params schema adds little value and expands scope. The client guards `user` non-empty before any request.

## Git workflow

- Branch: `feat/portfolio-open-wrapper`
- Commit per logical step; this repo uses **Conventional Commits** (see `CONTRIBUTING.md`). Example messages: `feat: add Meteora DLMM client with Zod-validated responses`, `test: cover client with mocked fetch`, `docs: update README for portfolio client`.
- Do NOT push or open a PR unless the operator instructed it.

## Target file structure

```
src/
  index.ts        ← barrel: re-exports client, types, schemas, errors, constants
  constants.ts    ← base URLs + default timeout
  types.ts        ← interfaces + z.ZodType<T>-annotated schemas + param/option types
  errors.ts       ← MeteoraApiError
  client.ts       ← MeteoraDlmmClient class (validates responses via Zod)
test/
  client.test.ts  ← deterministic mocked tests (+ one optional live test)
  (index.test.ts deleted)
```

## Steps

### Step 1: Add the `zod` runtime dependency

Run:
```bash
bun add zod
```
This adds `"dependencies": { "zod": "^4.x.x" }` to `package.json` and installs Zod 4.x (latest is 4.4.3 at planning time). Leave the resolved version range as-is.

**Verify**:
- `node -e "console.log(require('./node_modules/zod/package.json').version)"` → prints a `4.x.x` version.
- `bun -e "console.log(require('./package.json').dependencies)"` → shows `{ zod: '^...' }`.

### Step 2: Create `src/constants.ts`

Create with this exact content (tabs for indentation):

```ts
/** Base URL for the Meteora DLMM REST API (mainnet). */
export const METEORA_DLMM_MAINNET_URL = 'https://dlmm.datapi.meteora.ag' as const;

/** Base URL for the Meteora DLMM REST API (devnet). */
export const METEORA_DLMM_DEVNET_URL = 'https://dlmm-devnet.datapi.meteora.ag' as const;

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000 as const;
```

**Verify**: `bun run type-check` → exit 0.

### Step 3: Create `src/types.ts`

Create with this exact content. **Read the "Repo constraints" section above first** — every schema const uses the verified `z.ZodType<Interface>` annotation pattern; the duplication of each shape (interface + `z.object`) is intentional and required by `isolatedDeclarations`. The interfaces mirror the OpenAPI `required` arrays and `[type, null]` unions exactly; the schemas mirror the same shapes via Zod.

```ts
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
```

**Verify**: `bun run type-check` → exit 0. (If it fails with TS9010 on any schema const, you deviated from the `z.ZodType<T>` annotation pattern — re-read "Repo constraints". If it fails with TS2322 assigning `z.object(...)` to `z.ZodType<T>`, the schema fields don't match the interface — fix the schema to match the interface, not the other way around.)

### Step 4: Create `src/errors.ts`

Create with this exact content (explicit annotations required — `isolatedDeclarations`):

```ts
/** Error thrown when the Meteora DLMM API returns a non-2xx response. */
export class MeteoraApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, message: string, body: unknown) {
		super(message);
		this.name = 'MeteoraApiError';
		this.status = status;
		this.body = body;
	}
}
```

**Verify**: `bun run type-check` → exit 0.

### Step 5: Create `src/client.ts`

Create with this exact content. It uses the global `fetch` (runtime-agnostic), serializes camelCase params to the API's snake_case query, **validates every 2xx response through a Zod schema**, throws `MeteoraApiError` on non-2xx (surfacing the API's `{message}` body), and applies a timeout via `AbortSignal.timeout`.

**Two error classes can escape `getOpenPortfolio`:**
- `MeteoraApiError` — non-2xx HTTP response (carries `.status` and the parsed `.body`).
- `ZodError` (re-exported from `zod`) — the API returned 2xx but the body did not match `OpenPortfolioSchema` (API shape drift). Callers can branch with `import { ZodError } from 'zod'`.

Plus a client-side `TypeError` when `user` is missing/empty (before any network call).

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
```

> Notes for the executor:
> - `import type { ZodType } from 'zod'` is type-only on purpose (`verbatimModuleSyntax`). The runtime Zod usage lives in `src/types.ts`; the client only needs the `ZodType<T>` *type* for its generic helper and the `OpenPortfolioSchema` *value* for parsing. Do not import `z` into `client.ts`.
> - The split `import type { MeteoraApiError as MeteoraApiErrorType }` + `import { MeteoraApiError as MeteoraApiErrorClass }` is deliberate: `verbatimModuleSyntax` forbids importing the class as a plain value under the same identifier you also re-export as a type alias. Do not collapse these into one import. (If you find the `MeteoraApiErrorType` re-export at the bottom awkward, you may instead DELETE both the `import type { MeteoraApiError as MeteoraApiErrorType }` line and the final `export type { MeteoraApiErrorType };` line entirely — `MeteoraApiError` is already re-exported from the barrel in Step 6. Either approach is fine; keep it consistent.)
> - Do NOT change `OpenPortfolioSortBy`/`SortDirection` imports — they are not needed in the client; `String()` + `URLSearchParams` handle serialization.

**Verify**: `bun run type-check` → exit 0.

### Step 6: Rewrite `src/index.ts` as the barrel

Replace the entire contents of `src/index.ts` with:

```ts
export { METEORA_DLMM_MAINNET_URL, METEORA_DLMM_DEVNET_URL, DEFAULT_TIMEOUT_MS } from './constants';
export { MeteoraDlmmClient } from './client';
export { MeteoraApiError } from './errors';
export type {
	GetOpenPortfolioParams,
	MeteoraDlmmClientOptions,
	OpenPortfolio,
	OpenPortfolioPoolItem,
	OpenPortfolioSortBy,
	OpenPortfolioTotal,
	SortDirection,
} from './types';
export {
	OpenPortfolioSchema,
	OpenPortfolioPoolItemSchema,
	OpenPortfolioTotalSchema,
	OpenPortfolioSortBySchema,
	SortDirectionSchema,
} from './types';
```

**Verify**:
- `bun run type-check` → exit 0.
- `bun -e "import { MeteoraDlmmClient, METEORA_DLMM_MAINNET_URL, OpenPortfolioSchema, type OpenPortfolio } from './src/index'; console.log(typeof MeteoraDlmmClient, typeof OpenPortfolioSchema, METEORA_DLMM_MAINNET_URL)"` → prints `function object https://dlmm.datapi.meteora.ag`.

### Step 7: Delete `test/index.test.ts` and create `test/client.test.ts`

Delete `test/index.test.ts` (it tested the removed `greet` function). Create `test/client.test.ts` with deterministic tests that mock `fetch` (no network in the default test run). Model the import style on the old test (`import { ... } from 'bun:test'`).

```ts
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { ZodError } from 'zod';
import type { OpenPortfolio } from '../src/types';
import { MeteoraApiError } from '../src/errors';
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
```

> Notes for the executor:
> - The `as unknown as typeof fetch` casts on `mock(...)` are necessary because `bun:test`'s `mock()` returns a `Mock<...>` whose precise type doesn't match `typeof fetch`. This compiles cleanly under `strict`.
> - I switched from the old `.toThrow(async fn)` assertions to the `.rejects.toMatchObject(...)` / `.rejects.toBeInstanceOf(...)` form throughout — that form is authoritative in `bun:test` and avoids the async-fn-in-toThrow ambiguity. Do not reintroduce `.toThrow(async ...)`.
> - Do NOT enable the live test by default. It runs only when `RUN_LIVE=1`.

**Verify**: `bun test` → all tests pass (the live test self-skips without `RUN_LIVE=1`). Expect **6 deterministic tests** running.

### Step 8: Update `README.md`

The current README Usage section advertises `greet`, which no longer exists. Make two edits:

1. Under the `# metter` heading, change the one-line description from:
   ```
   Lightweight and flexible component toolkit
   ```
   to:
   ```
   Lightweight TypeScript client for the Meteora DLMM API, with Zod-validated responses
   ```

2. Replace the **entire** `## Usage` code block (the `import { greet } from 'metter'; console.log(greet('World'));` snippet) with a real usage example of the client:

   ```typescript
   import { MeteoraDlmmClient, METEORA_DLMM_DEVNET_URL } from 'metter';

   const client = new MeteoraDlmmClient();
   // Default: mainnet. To use devnet, pass { baseUrl: METEORA_DLMM_DEVNET_URL }.

   const portfolio = await client.getOpenPortfolio({
     user: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq', // Solana wallet address
     page: 1,
     pageSize: 20,
     sortBy: 'current_balances',
     sortDirection: 'desc',
   });

   console.log(portfolio.totalCount);          // number of pools with open positions
   console.log(portfolio.total?.balances);     // aggregated USD balance (string)
   for (const pool of portfolio.pools) {
     console.log(pool.tokenX, pool.tokenY, pool.balances, pool.unclaimedFees);
   }
   ```

   Optionally add a short sentence after the snippet: "Responses are validated at runtime with Zod; the exported `OpenPortfolioSchema` (and friends) let you re-validate or parse API data yourself."

Leave the rest of the README (Installation, Contributing, License) as-is.

**Verify**: `bun run lint` → exit 0; the README Usage snippet should be valid TypeScript by eye.

### Step 9: Update `package.json` description

Change the single field:
```json
"description": "Lightweight and flexible component toolkit",
```
to:
```json
"description": "Lightweight TypeScript client for the Meteora DLMM API, with Zod-validated responses",
```
(Step 1 already added `zod` to `dependencies`.) Do NOT touch any other field. In particular: do **not** change `files`, `exports`, `module`, or `types` — the existing single-entry export map is already correct for a barrel `src/index.ts`, and `files: ["dist"]` is correct (consumers get the bundled `dist/`; `zod` is resolved from their own `node_modules` via the `dependencies` declaration, which `bunup` externalizes).

**Verify**: `bun run type-check` → exit 0.

### Step 10: Final full verification

Run, in order, and confirm each:

1. `bun run type-check` → exit 0.
2. `bun run lint` → exit 0.
3. `bun test` → all pass, with **6 deterministic tests** in `test/client.test.ts` running (the 7th, live test, self-skips without `RUN_LIVE=1`).
4. `bun run build` → exit 0, and:
   - `dist/index.js` exists and contains `getOpenPortfolio` (`grep -c "getOpenPortfolio" dist/index.js` → ≥ 1).
   - `dist/index.d.ts` exists and contains `class MeteoraDlmmClient` (`grep -c "MeteoraDlmmClient" dist/index.d.ts` → ≥ 1).
   - **`dist/index.js` keeps zod external** (NOT bundled): `grep -c 'from "zod"' dist/index.js` → ≥ 1.
5. Confirm the dependency is declared: `bun -e "console.log(require('./package.json').dependencies)"` → shows `{ zod: '^4...' }` (and nothing else in `dependencies`).
6. Confirm only in-scope files changed: `git status --short` lists only the in-scope create/edit/delete paths (plus `bun.lock`).
7. Optional one-time live confirmation (run once by hand, not in CI): `RUN_LIVE=1 bun test` → the live smoke test passes, proving the real API contract matches the schema.

## Test plan

Covered by Step 7. Summary of test intent:

- **Happy path** — verifies response parsing/validation AND that camelCase client params serialize to the API's snake_case query string (`page_size`, `sort_by`, `sort_direction`) against the correct mainnet base URL. Highest-value test: a wrong query key = wrong data; a wrong schema = silent breakage.
- **Empty portfolio** — verifies the optional `total`/`solPrice` fields are genuinely absent-tolerant (the most common real-world response and the one the spec is quietest about).
- **Malformed 2xx body** — verifies Zod actually guards the boundary: an API shape drift throws `ZodError` instead of returning garbage. (This is the test that justifies the Zod dependency.)
- **400 error** — verifies `MeteoraApiError` carries `status` and the API's `message` (so callers can branch on `e.status`).
- **Custom baseUrl/fetch** — verifies the devnet URL and the injectable-`fetch` seam (the seam the tests themselves rely on).
- **Missing user** — verifies the client-side guard fires before any network call (no wasted requests, clear error).
- **Live smoke (opt-in)** — verifies the real wire contract end-to-end against the known-stable empty-wallet response.

Existing test used as the structural pattern: the old `test/index.test.ts` (`bun:test` imports). The new file uses `describe`/`test` from the same module.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun add zod` ran; `package.json` has `"dependencies": { "zod": "^4..." }` and nothing else in `dependencies`.
- [ ] `bun run type-check` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun test` exits 0; the deterministic tests in `test/client.test.ts` pass (live test self-skips).
- [ ] `bun run build` exits 0; `grep -c "getOpenPortfolio" dist/index.js` ≥ 1; `grep -c "MeteoraDlmmClient" dist/index.d.ts` ≥ 1; `grep -c 'from "zod"' dist/index.js` ≥ 1 (zod externalized, not bundled).
- [ ] `grep -rn "greet" src/ test/` returns **no matches** (placeholder fully removed).
- [ ] `git status --short` shows only in-scope paths (`src/`, `test/`, `README.md`, `package.json`, `bun.lock`, and new plan/index files).
- [ ] `plans/README.md` status row for plan 001 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/index.ts` or `test/index.test.ts` does not match the "Current state" excerpts above (the codebase has drifted since this plan was written — re-read before proceeding).
- `bun run type-check` fails on a schema const with `TS9010` — you deviated from the `z.ZodType<T>` annotation pattern; re-read "Repo constraints". Do NOT "fix" it by editing `tsconfig.json`.
- `bun run type-check` fails with `TS2502`/`TS2456` (circular) — you tried the `z.infer<typeof Schema>` single-source pattern; switch back to the hand-written-interface + annotated-schema pattern shown in Step 3.
- `bun add zod` installs a Zod **major < 4** (e.g. 3.x) — report the version; the schema syntax in this plan is Zod-4-compatible but a 3.x resolution should be flagged (likely a stale registry mirror).
- A live `curl` to `https://dlmm.datapi.meteora.ag/portfolio/open?user=11111111111111111111111111111112` no longer returns the documented empty-wallet JSON (the API contract changed — the types/schemas may need revisiting; do not silently adjust them).
- `bunup` warns that it can no longer auto-resolve the entry point (it may need a `bunup.config.ts`) — report rather than guessing a config.
- `grep -c 'from "zod"' dist/index.js` is `0` after build — bunup bundled zod instead of externalizing it; report (do not add a `bunup.config.ts` speculatively).

## Maintenance notes

For whoever owns this code after it lands:

- **Schema ↔ interface duplication is intentional.** Each shape exists twice in `src/types.ts`: once as an `interface`, once as a `z.ZodType<ThatInterface>`-annotated `z.object(...)`. This is forced by `isolatedDeclarations` (see "Repo constraints"). The annotation makes TS verify they agree at compile time, so changing one without the other is a hard error — treat that error as a feature, not noise.
- **Adding the next endpoint** (e.g. `/portfolio/total` or `/pools`): add its `interface` + annotated `XSchema` to `src/types.ts`, then add a method to `MeteoraDlmmClient` following `getOpenPortfolio` as the template (build query → `this.request(url, XSchema)`). The `request<T>(url, schema: ZodType<T>)` helper is the single chokepoint for base URL, timeout, error handling, AND Zod validation — keep all endpoints going through it.
- **If you add a POST/PATCH endpoint later**, the `request` helper currently hardcodes `method: 'GET'`; refactor it to accept a method + optional body at that point, and update `getOpenPortfolio` to pass `GET` explicitly. A request body would also want its own input Zod schema (unlike params today, which are client-constructed).
- **Two error classes escape the client**: `MeteoraApiError` (HTTP) and `ZodError` (response shape). Documented in the JSDoc. If you later want a single error class for `instanceof` ergonomics, the minimal change is to `.safeParse()` in `request` and rethrow a new `MeteoraApiError(200, 'response validation failed', zodError)` — but you lose direct `instanceof ZodError` and its `.issues`. Current choice (let `ZodError` propagate) is the more idiomatic Zod pattern; revisit only if consumers complain.
- **Number precision**: USD/SOL amounts are intentionally `string` (in both types and schemas). Do not convert to `number` anywhere downstream — JSON numbers lose precision.
- **`AbortSignal.timeout`** is supported in Node 17.3+, Bun, Deno, and modern browsers. If a consumer needs older Node, they can inject `fetch` and accept that the timeout won't apply. Don't polyfill inside the lib.
- **Reviewer scrutiny points**: (1) every `z.ZodType<T>` annotation in `types.ts` (the schema fields must match the interface — tsc enforces it, but eyeball the optional/nullable unions against a real populated response); (2) the query-param camelCase→snake_case mapping in `toPortfolioQuery`; (3) that `zod` is the ONLY entry in `dependencies`; (4) that `dist/index.js` externalizes (not bundles) zod. Run `RUN_LIVE=1 bun test` with a wallet that has positions to eyeball that no expected field is wrongly typed.
- **Follow-up explicitly deferred**: pagination iterator (response exposes `hasNext`/`page`/`pageSize`/`totalCount`), throttling for the 30 RPS limit, a params Zod schema, and the other 18 endpoints. None are needed for "portfolio/open only."
