# Plan 006: Expand `MeteoraDlmmClient` test coverage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 369b609..HEAD -- test/client.test.ts src/client.ts`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `369b609`, 2026-06-21

## Why this matters

The client has four real behaviors with **zero test coverage today**: the
timeout/abort path, what happens when `fetch` itself rejects (network failure),
how a non-JSON error body (e.g. an HTML 502 from a proxy) is surfaced, and
base-URL trailing-slash normalization. All four are on the request hot path —
every method on `MeteoraDlmmClient` funnels through the private `request<T>`
helper — and all four currently behave correctly. This plan adds
**characterization tests** that pin that current behavior so a future change
(e.g. switching timeout strategy, or refactoring `parseBody`) cannot silently
regress them without a failing test. No production code changes are intended —
these tests must pass against `src/` exactly as it is today.

## Current state

- `test/client.test.ts` — the sole test file (427 lines). One `describe` block
  per method. Each test stubs `globalThis.fetch` with `mock(...)`; an
  `afterEach` resets `globalThis.fetch` to the real one.
- `src/client.ts` — the request path these tests exercise:
  - Constructor (lines 14–21): `this.baseUrl = (options.baseUrl ?? METEORA_DLMM_MAINNET_URL).replace(/\/+$/, '');` and `this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;`
  - Private `request<T>` (lines ~78–94):
    ```ts
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
    ```
  - `parseBody` (lines ~119–127): reads text; returns `null` if empty, `JSON.parse(text)` on success, or the raw `text` string if `JSON.parse` throws.
  - `extractMessage` (lines ~129–135): returns `body.message` only when `body` is an object with a string `message`; otherwise `undefined`.

**Repo conventions to match** (from the existing test file):
- Stub fetch as `globalThis.fetch = mock((url: string | URL | Request) => {...}) as unknown as typeof fetch;`
- The module-scope `POPULATED` constant (the `OpenPortfolio` fixture defined near the top of the file) and the `mockResponse(status, body)` helper are reusable.
- Model new error-body tests after the existing `'400 error: throws MeteoraApiError with API message and status'` test; model new URL-capture tests after `'uses custom baseUrl (devnet) and custom fetch'`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (full) | `bun test` | 19 pass (15 existing + 4 new), 0 fail |
| Tests (filtered) | `bun test --timeout` | the 1 new timeout test passes |
| Typecheck | `bun run type-check` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Confirm no src changes | `git status --porcelain src/` | empty |

## Scope

**In scope** (the only file you should modify):
- `test/client.test.ts` — add four `test(...)` cases.

**Out of scope** (do NOT touch):
- `src/**` — these are characterization tests of *existing* behavior. If a test
  fails against current `src/`, that means this plan's assumption is wrong;
  STOP (see STOP conditions). Do not change `src/` to make a test pass.
- `package.json`, `.github/`, configs, other test files.

## Git workflow

- Branch: `advisor/006-client-test-coverage`
- Commit message (Conventional Commits): `test: cover timeout, fetch failure, non-JSON error, and baseUrl normalization`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Add all four tests **inside the existing**
`describe('MeteoraDlmmClient.getOpenPortfolio', () => { ... })` block (they all
exercise the shared `request<T>` path via `getOpenPortfolio`). Place them after
the existing `'throws TypeError when user is missing or empty'` test and before
the `'live smoke'` test; order does not affect correctness. Use the exact code
below.

### Step 1: Add the "network failure propagates" test

```ts
	test('network failure: a fetch rejection propagates unchanged (not swallowed)', async () => {
		const error = new TypeError('fetch failed');
		globalThis.fetch = mock(() => Promise.reject(error)) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getOpenPortfolio({ user: 'SomeWallet1111111111111111111111111111111111' }),
		).rejects.toBe(error);
	});
```

This asserts the exact same error instance surfaces (no wrapping, no catch-and-log).

**Verify**: `bun test --network` → 1 pass. (Filter string matches the test name
substring "network failure".)

### Step 2: Add the "timeout aborts the request" test

```ts
	test('timeout: request is aborted via AbortSignal after the configured timeout', async () => {
		globalThis.fetch = mock((_url, options) => {
			return new Promise((_resolve, reject) => {
				options.signal?.addEventListener('abort', () => {
					reject(new DOMException('The operation was aborted due to timeout', 'AbortError'));
				});
			});
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient({ timeout: 50 });
		await expect(
			client.getOpenPortfolio({ user: 'SomeWallet1111111111111111111111111111111111' }),
		).rejects.toMatchObject({ name: 'AbortError' });
	});
```

This exercises `AbortSignal.timeout(this.timeout)` plus signal pass-through: the
mock never resolves on its own; it only rejects when the signal aborts, so a
pass proves the client both creates a timed `AbortSignal` AND forwards it as
`options.signal`. 50ms is well under `bun test`'s 5s per-test ceiling.

**Verify**: `bun test --timeout` → 1 pass (resolves in ~50ms).

### Step 3: Add the "non-JSON error body" test

```ts
	test('non-JSON error body (e.g. proxy HTML 502): MeteoraApiError carries status + raw text', async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response('<html><body>502 Bad Gateway</body></html>', {
				status: 502,
				headers: { 'content-type': 'text/html' },
			})),
		) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient();
		await expect(
			client.getOpenPortfolio({ user: 'SomeWallet1111111111111111111111111111111111' }),
		).rejects.toMatchObject({
			name: 'MeteoraApiError',
			status: 502,
			body: '<html><body>502 Bad Gateway</body></html>',
		});
	});
```

This covers `parseBody`'s `JSON.parse` catch branch (raw text returned as
`body`), `extractMessage` returning `undefined` for a non-object body, and the
fallback `Meteora API request failed with status 502` message.

**Verify**: `bun test --non-JSON` → 1 pass.

### Step 4: Add the "baseUrl trailing-slash normalization" test

```ts
	test('baseUrl: trailing slashes are stripped so no double slash appears in the URL', async () => {
		let capturedUrl = '';
		globalThis.fetch = mock((url: string | URL | Request) => {
			capturedUrl = String(url);
			return Promise.resolve(mockResponse(200, { ...POPULATED, pools: [] }));
		}) as unknown as typeof fetch;
		const client = new MeteoraDlmmClient({ baseUrl: 'https://example.test///' });
		await client.getOpenPortfolio({ user: 'UserWallet1111111111111111111111111111111111' });
		expect(capturedUrl.startsWith('https://example.test/portfolio/open')).toBe(true);
		expect(capturedUrl).not.toContain('https://example.test//');
	});
```

This covers the constructor's `.replace(/\/+$/, '')`: three trailing slashes are
stripped, so the URL is `https://example.test/portfolio/open?...` with no `//`
after the host.

**Verify**: `bun test --baseUrl` → 1 pass.

### Step 5: Run the full suite

**Verify**: `bun test` → `19 pass, 0 fail` (15 existing + 4 new).
**Verify**: `bun run type-check` → exit 0.
**Verify**: `bun run lint` → exit 0.

## Test plan

The four new tests ARE this plan's test plan. Each pins one currently-untested
behavior of the shared `request<T>` path. Structural pattern: each mirrors the
existing `globalThis.fetch = mock(...) as unknown as typeof fetch` + `afterEach`
reset idiom already used throughout the file.

## Done criteria

ALL must hold:

- [ ] `bun test` reports `19 pass, 0 fail`
- [ ] `bun run type-check` exits 0
- [ ] `bun run lint` exits 0
- [ ] `git status --porcelain src/` is empty (NO production changes — characterization only)
- [ ] `git status` shows only `test/client.test.ts` modified
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **A new test FAILS against current, unmodified `src/client.ts`.** That means
  this plan's characterization assumption about current behavior is wrong.
  Report which test and what actually happens — do NOT edit `src/` to make it
  pass (that would change this from a test plan into a behavior change).
- `DOMException` or `AbortSignal.timeout` is unavailable in the test runtime
  (a type or runtime error referencing them) — report; do not polyfill `src/`.
- The `request<T>` / `parseBody` / `extractMessage` code in `src/client.ts`
  does not match the excerpts in "Current state" (the codebase has drifted).
- The `POPULATED` constant or `mockResponse` helper no longer exist at module
  scope in `test/client.test.ts` (the test file has been refactored) — report;
  adapt the fixtures to whatever the current shape is rather than redefining
  them inline.

## Maintenance notes

- These tests pin **current** behavior. If the timeout strategy changes (e.g.
  a manual `AbortController` replaces `AbortSignal.timeout`), update Step 2's
  test accordingly. If error-body handling is refactored, update Step 3.
- Step 2 uses real wall-clock time (50ms). It is fast and deterministic, but if
  it ever flakes on a specific runner, bump the `timeout` to `200` — the test
  still proves the same property.
- **Reviewer**: the key thing to check is that `git status --porcelain src/` is
  empty — this plan must add tests only. Any `src/` diff means the executor
  changed scope and the diff should be rejected.
- Follow-up (out of scope): equivalent characterization tests for
  `getPositionPnl`'s error/timeout paths would be redundant since both methods
  share `request<T>` — add only if the methods ever diverge.
