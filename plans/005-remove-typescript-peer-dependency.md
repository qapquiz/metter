# Plan 005: Remove misleading optional `typescript` peer dependency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 369b609..HEAD -- package.json`
> If `package.json` changed since this plan was written, compare the
> "Current state" excerpt against the live file before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `369b609`, 2026-06-21

## Why this matters

`package.json` declares an **optional** `typescript` peer dependency
(`>=4.5.0`). This library ships compiled JS (`dist/index.js`) plus `.d.ts`
types; consumers do not need `typescript` installed to use it at runtime, and
the `.d.ts` files are consumed by *the consumer's own* TypeScript setup if they
have one — not a peer requirement we should declare. An optional peer dep that
is never actually required is misleading metadata: it clutters `npm ls` /
install output and can confuse tooling that scans peer requirements.

Removing it is zero-risk to consumers (an *optional* peer dep produces no
install error when absent) and makes the package's real runtime contract —
`zod` is the sole runtime dependency — accurate.

**Important**: `typescript` STAYS in `devDependencies` (`^6.0.3`) because the
library needs it to build and typecheck itself. Only the two *peer* blocks are
removed.

## Current state

`package.json` (excerpt; note the file uses **tabs** for indentation and has
**no trailing commas**):

```json
	"devDependencies": {
		"@types/bun": "^1.3.14",
		"bumpp": "^11.1.0",
		"bunup": "^0.16.32",
		"oxfmt": "^0.55.0",
		"oxlint": "^1.70.0",
		"simple-git-hooks": "^2.13.1",
		"typescript": "^6.0.3"
	},
	"peerDependencies": {
		"typescript": ">=4.5.0"
	},
	"peerDependenciesMeta": {
		"typescript": {
			"optional": true
		}
	},
	"simple-git-hooks": {
		"pre-commit": "bun run lint && bun run type-check"
	},
	"dependencies": {
		"zod": "^4.4.3"
	}
```

**Target state** — delete the two peer blocks so `devDependencies` is followed
directly by `simple-git-hooks`:

```json
	"devDependencies": {
		"@types/bun": "^1.3.14",
		"bumpp": "^11.1.0",
		"bunup": "^0.16.32",
		"oxfmt": "^0.55.0",
		"oxlint": "^1.70.0",
		"simple-git-hooks": "^2.13.1",
		"typescript": "^6.0.3"
	},
	"simple-git-hooks": {
		"pre-commit": "bun run lint && bun run type-check"
	},
	"dependencies": {
		"zod": "^4.4.3"
	}
```

The exact text to remove (between `devDependencies`'s closing `},` and
`\t"simple-git-hooks"`):

```
	"peerDependencies": {
		"typescript": ">=4.5.0"
	},
	"peerDependenciesMeta": {
		"typescript": {
			"optional": true
		}
	},
```

**Conventions**: tabs (not spaces), no trailing commas, preserve existing key
order. The `devDependencies` closing `},` retains its trailing comma because
`simple-git-hooks` follows it.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Valid JSON | `bun -e 'JSON.parse(Bun.file("package.json").text())'` | exit 0, no output |
| Re-resolve lockfile | `bun install` | exit 0, no peer-dep warnings |
| Typecheck | `bun run type-check` | exit 0 |
| Tests | `bun test` | 15 pass |
| Lint | `bun run lint` | exit 0 |
| Build | `bun run build` | exit 0 |
| Confirm peer blocks gone | `rg -n "peerDependencies" package.json` | no matches |
| Confirm devDep kept | `rg -n '"typescript": "\^6' package.json` | one match (under `devDependencies`) |

## Scope

**In scope** (the only file you should modify):
- `package.json`
- `bun.lock` — may be rewritten by `bun install`; commit that change too if it occurs.

**Out of scope** (do NOT touch):
- `src/`, `test/`, `.github/`, `tsconfig.json`.
- The `typescript` entry **inside `devDependencies`** — KEEP it. Only the two `peerDependencies`/`peerDependenciesMeta` blocks are removed.
- `dependencies` / `zod` — KEEP.

## Git workflow

- Branch: `advisor/005-remove-typescript-peer-dep`
- Commit message (Conventional Commits): `chore: remove misleading optional typescript peer dependency`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the two peer blocks from `package.json`

Delete the `peerDependencies` and `peerDependenciesMeta` objects as shown in
"Current state" / "Target state" above. Ensure the result is valid JSON with
`devDependencies` directly followed by `simple-git-hooks`.

**Verify**:
- `rg -n "peerDependencies" package.json` → no matches.
- `bun -e 'JSON.parse(Bun.file("package.json").text())'` → exit 0 (valid JSON).
- `rg -n '"typescript": "\^6' package.json` → one match (the `devDependencies`
  entry is still present).

### Step 2: Re-resolve and run the full gate

**Verify**: `bun install && bun run type-check && bun run lint && bun test && bun run build`
→ every command exits 0; `bun test` reports `15 pass`; `bun run build`
regenerates `dist/`.

## Test plan

No new tests — this is package-metadata surgery, not runtime behavior. The
existing 15 tests plus type-check / lint / build form the regression gate that
confirms removing the peer dep did not disturb the build graph or the published
artifact.

## Done criteria

ALL must hold:

- [ ] `rg -n "peerDependencies" package.json` returns no matches
- [ ] `package.json` is valid JSON (`bun -e 'JSON.parse(Bun.file("package.json").text())'` exit 0)
- [ ] `devDependencies.typescript` is STILL present (one `"typescript": "^6` match)
- [ ] `bun install` exits 0
- [ ] `bun run type-check && bun run lint && bun test && bun run build` all exit 0 (15 tests pass)
- [ ] `git status` shows only `package.json` (and optionally `bun.lock`) modified — nothing in `src/` or `test/`
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bun install` reports a NEW peer-dependency warning or an unexpected
  resolution change (beyond `bun.lock` being rewritten).
- `devDependencies.typescript` is accidentally removed — restore it; ONLY the
  two peer blocks go.
- The block layout in `package.json` does not match the "Current state" excerpt
  (the file has drifted since this plan was written).
- Removing the blocks leaves the JSON invalid and you cannot see why — report
  rather than guessing at comma placement.

## Maintenance notes

- If a future change ever exports raw `.ts` sources (contradicting the current
  compiled-`dist` distribution model), a TS peer/version constraint might
  become appropriate again — revisit then. Under the current model it is not.
- `bun.lock` may change on `bun install`; that is expected and should be
  committed alongside `package.json`.
- **Reviewer**: confirm `devDependencies` and `dependencies` (`zod`) are
  untouched, and that only the two peer blocks were removed.
