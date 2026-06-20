# Plan 003: Fix the release pipeline so a `v*` tag actually publishes to npm

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c8e45a4..HEAD -- .github/workflows/release.yml package.json`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1 (blocks every future release — a `v*` tag push currently fails)
- **Effort**: S (one workflow file; ~10 lines changed; no source code)
- **Risk**: LOW (CI-only change; gated to tag pushes; no library source touched)
- **Depends on**: none (independent of the endpoint plans)
- **Category**: bug (CI/release)
- **Planned at**: commit `c8e45a4`, 2026-06-17

## Why this matters

The release workflow (`.github/workflows/release.yml`) is configured to fire on
a `v*` tag push and run `npm publish` — but the publish step has **no
authentication**. `actions/setup-node@v6` with `registry-url` writes an npm
token to `~/.npmrc` from the **`NODE_AUTH_TOKEN` environment variable on the
publish step**, and that env var is absent. So every release tag fails with
`npm ERR! code ENEEDAUTH` / 404-after-redirect, and the package never reaches
the npm registry. (Confirmed: `metter` is currently **available** on npm —
HTTP 404 at `https://registry.npmjs.org/metter` — so the first publish won't
collide.)

The fix is small and surgical: add `env: NODE_AUTH_TOKEN` to the publish step.
While here, this plan also (a) drops a redundant `npm install -g npm@latest`
step that adds failure surface for no benefit (`setup-node` already ships a
current npm with Node 24), and (b) wires up **npm provenance** —
`permissions: id-token: write` is *already* granted but never used, so adding
`--provenance` to the publish is free (a public package, which `metter` is,
emits a signed build-provenance attestation on npm). Provenance is optional
but high-leverage at zero ongoing cost.

## Current state

`.github/workflows/release.yml` at commit `c8e45a4` (exact contents):

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  release:
    name: Release Package
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Type check
        run: bun run type-check

      - name: Lint
        run: bun run lint

      - name: Run tests
        run: bun run test

      - name: Build
        run: bun run build

      - name: Generate changelog
        run: bunx changelogithub
        continue-on-error: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Update npm
        run: npm install -g npm@latest

      - name: Publish packages to npm
        run: bun pm pack && npm publish ./*.tgz --access public
```

Relevant `package.json` facts (at `c8e45a4`):
- `"version": "0.1.0"` → first publish would be `metter@0.1.0`.
- `"private"` is **absent** (good — `private: true` would block publishing).
- `"files": ["dist"]` → only built artifacts ship; `package.json` and `README.md` are auto-included by npm.
- `"release": "bumpp --commit --push --tag"` → the local trigger: bumps version, commits, pushes, and creates the `v*` tag that fires this workflow.
- `"dependencies": { "zod": "^4.4.3" }` → published package declares zod; consumers resolve it. Unchanged by this plan.

**The release trigger flow** (so the executor understands the whole loop): locally run `bun run release` → `bumpp` bumps `package.json` version, commits, pushes the commit, and pushes a `vX.Y.Z` tag → GitHub fires this `release.yml` workflow on the tag → build/test/lint → `bun pm pack` (produces `metter-<ver>.tgz` containing only `dist/` + manifest + README) → `npm publish` uploads it. The break is at the last step: no auth.

## How npm publish auth works with setup-node (so the fix is principled, not cargo-cult)

`actions/setup-node@v6` with `registry-url: 'https://registry.npmjs.org'` configures a project-level `~/.npmrc` on the runner containing:

```
//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
```

That `${NODE_AUTH_TOKEN}` is expanded from the **environment variable on the
invoking step**. If `NODE_AUTH_TOKEN` is unset when `npm publish` runs, npm
reads an empty token → `ENEEDAUTH`. So the publish step MUST set:

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`NPM_TOKEN` is the GitHub Actions **secret name** (chosen by you), not a npm
convention — it must be created in the repo's Settings → Secrets and variables
→ Actions, holding a real npm access token (automation-scope or
granular publish token for the `metter` package). The env-var name
(`NODE_AUTH_TOKEN`) is fixed by `setup-node`; only the secret name is yours
to choose. This plan uses `NPM_TOKEN` (the most common convention; matches
setup-node's own README examples).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint the YAML | `bunx actionlint .github/workflows/release.yml` | exit 0 (or warnings only; no errors) |
| YAML parse check | `bunx --bun js-yaml .github/workflows/release.yml >/dev/null` | exit 0 |
| Confirm `metter` still unpublishable-conflict-free | `curl -sS -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/metter` | `404` (available) — informational only |

There is **no way to fully verify this workflow locally** — it only runs on a
real tag push in GitHub Actions. The plan's verification is therefore:
(1) YAML validity + actionlint, (2) a careful read against the auth
mechanism above, and (3) an optional end-to-end dry-run gated behind the
"manual release" step (Step 6). That limitation is inherent to CI changes and
is called out honestly in "Done criteria".

## Scope

**In scope** (the only file you should modify):
- `.github/workflows/release.yml` — add `env: NODE_AUTH_TOKEN` to the publish step; add `--provenance`; remove the redundant `npm install -g npm@latest` step.

**Out of scope** (do NOT touch):
- `package.json` (no version bump, no field changes — `bumpp` handles versioning at release time).
- `src/`, `test/`, `tsconfig.json`, any source.
- `.github/workflows/ci.yml` — separate workflow, build/test only, no publish; leave it.
- `.github/workflows/close-issues.yml`, `.github/ISSUE_TEMPLATE/*`, `CONTRIBUTING.md`, `README.md`, `LICENSE`.
- Adding any dependency. (`actionlint` / `js-yaml` are run via `bunx` for verification only; not added to the project.)
- Changing the publish mechanism itself (`bun pm pack && npm publish ./*.tgz`). It's unusual but works and keeps published contents pinned to `files:["dist"]`; reworking it expands scope for no gain. (See "Maintenance notes" for the rationale to revisit later.)

## Git workflow

- Branch: `fix/release-npm-auth`
- Conventional Commits. Suggested single commit: `fix(ci): authenticate npm publish with NODE_AUTH_TOKEN and enable provenance`.
- Do NOT push or open a PR unless the operator instructed it. Do NOT create or push a `v*` tag — that would fire the release workflow.

## Steps

### Step 1: Re-verify the prereqs (informational; aborts the plan if a hard blocker is found)

Run these read-only checks:

```bash
# 1a. Confirm the package name is still available on npm (404 = available).
curl -sS -o /dev/null -w "npm lookup HTTP %{http_code}\n" https://registry.npmjs.org/metter
# Expected: HTTP 404. (HTTP 200 means the name is taken — see STOP conditions.)

# 1b. Confirm package.json has no "private": true that would block publishing.
bun -e 'const p=require("./package.json"); console.log("private:", p.private ?? "(absent — good)"); console.log("files:", JSON.stringify(p.files));'
# Expected: private: (absent — good); files: ["dist"]
```

**Verify**: HTTP 404 for the npm lookup; `private` absent. If `metter` returns HTTP 200 (name taken) OR `private: true`, STOP and report — the plan can't fix a name collision or a private flag from here, and publishing would fail regardless of auth.

### Step 2: Edit `.github/workflows/release.yml` — remove the redundant `npm install -g npm@latest` step

Delete this entire step block:

```yaml
      - name: Update npm
        run: npm install -g npm@latest
```

(Rationale: `setup-node@v6` with `node-version: '24'` already provides a current npm 10+. Re-installing npm globally adds ~10s and a network failure surface — if the npm registry hiccups during that `npm install -g`, the release fails before publish for no benefit. Node 24's bundled npm is more than sufficient for `npm publish` and provenance.)

**Verify**: `bunx --bun js-yaml .github/workflows/release.yml >/dev/null` → exit 0 (YAML still parses; no indentation breakage from the deletion).

### Step 3: Edit the publish step — add `NODE_AUTH_TOKEN` + `--provenance`

Replace this step block:

```yaml
      - name: Publish packages to npm
        run: bun pm pack && npm publish ./*.tgz --access public
```

with:

```yaml
      - name: Publish packages to npm
        run: bun pm pack && npm publish ./*.tgz --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Two changes:
1. `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` — the actual fix. Without it, `npm publish` fails with `ENEEDAUTH`. The secret `NPM_TOKEN` must be created in the repo's Actions secrets (see Step 5 / the README note).
2. `--provenance` — emits a signed npm build-provenance attestation. Works because: `permissions: id-token: write` is already at the top of the file; `metter` is a public package; Node 24 ships npm 10+ (provenance needs npm ≥ 9.5). Free signal of supply-chain integrity. If provenance ever fails for a transient reason, npm publish still completes (provenance is best-effort on a signed-identity foundation), but in practice it's reliable for public packages.

**Indentation is load-bearing**: `env:` aligns under `run:` (same indent as `run:`), and `NODE_AUTH_TOKEN:` is indented one level under `env:`. Match the existing `Generate changelog` step's `env:` block exactly (lines ~46–47 of the original file use the same shape). Tabs vs spaces: GitHub Actions YAML uses **2-space** indentation (this file uses spaces, not tabs — confirm by eye before editing).

**Verify**:
- `bunx --bun js-yaml .github/workflows/release.yml >/dev/null` → exit 0.
- `grep -n "NODE_AUTH_TOKEN" .github/workflows/release.yml` → exactly one match, on the publish step.
- `grep -n "\-\-provenance" .github/workflows/release.yml` → exactly one match.

### Step 4: Lint the workflow

```bash
bunx actionlint .github/workflows/release.yml
```

**Expected**: exit 0, or exit 0 with warnings (actionlint is strict; a warning about `oven-sh/setup-bun@v2` or `actions/setup-node@v6` pinning is acceptable and pre-existing). **Any ERROR is a STOP** (likely a YAML/indentation mistake from Step 3). If `actionlint` can't be fetched (network), fall back to `bunx --bun js-yaml` parse check + a careful visual review of indentation; note the fallback in your report.

### Step 5: Add a release-setup note to `README.md` (so the `NPM_TOKEN` secret isn't undocumented tribal knowledge)

The `NPM_TOKEN` GitHub Actions secret is now load-bearing — without it, the release still fails. Document it once in the README so a future maintainer (human or agent) knows to create it. Append a new section at the end of `README.md` (after the `## License` section):

```markdown
## Releasing

Releases are triggered by pushing a `v*` tag, which runs the `Release` workflow
([`.github/workflows/release.yml`](./.github/workflows/release.yml)): it builds,
tests, lints, packs, and publishes `metter` to npm with build provenance.

To cut a release locally:

```bash
bun run release   # bumpp: bumps version, commits, pushes, and creates the v* tag
```

Before the first release, create an **Actions secret named `NPM_TOKEN`** in the
repo settings (Settings → Secrets and variables → Actions → New repository
secret) containing an npm access token with publish rights for `metter`
(automation-scope or a granular publish token). Without it, the publish step
fails with `ENEEDAUTH`.
```

(Leave the rest of `README.md` unchanged. The nested fenced code block inside a markdown section is fine — it renders correctly on GitHub.)

**Verify**: `bun run lint` → exit 0 (oxlint doesn't lint `.md`, but confirm no accidental edit to a tracked source file via `git status --short`).

### Step 6: Optional end-to-end dry-run (only if the operator explicitly asked for a real release)

**Do NOT run this unless the operator told you to cut a release.** This step
publishes to the real npm registry and is irreversible.

If instructed to do a real release after the fix lands on `main`:
1. Ensure `NPM_TOKEN` is set as a GitHub Actions secret (the operator does this in the GitHub UI — you cannot).
2. `bun run release` locally (bumpp prompts for the new version; it commits, pushes, tags).
3. Watch the Actions tab: the Release workflow should go green, including the publish step, and `https://www.npmjs.com/package/metter` should show the published version with a "Provenance" badge.

Otherwise, skip Step 6 and report that the pipeline fix is complete but unverified end-to-end (see "Done criteria").

## Test plan

There are no unit tests for a CI workflow (it executes only in GitHub Actions on a tag push). Verification is:

- **YAML validity**: `bunx --bun js-yaml … >/dev/null` → exit 0 (Step 2, 3).
- **actionlint**: exit 0 or warnings-only (Step 4).
- **Static read against the auth mechanism**: confirm by `grep` that `NODE_AUTH_TOKEN` appears exactly once, on the publish step, and `--provenance` appears exactly once (Step 3 verifies).
- **End-to-end** (only via Step 6, if the operator triggers a real release): the publish step goes green and the package appears on npm.

This is honest about the inherent limit: a CI-auth change cannot be fully verified without a real tag push. The plan compensates with layered static checks and a precise description of the auth mechanism so a reviewer can confirm correctness by reading.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bunx --bun js-yaml .github/workflows/release.yml >/dev/null` exits 0 (valid YAML).
- [ ] `bunx actionlint .github/workflows/release.yml` exits 0 (errors; warnings OK). If actionlint was unavailable, note the fallback.
- [ ] `grep -c "NODE_AUTH_TOKEN" .github/workflows/release.yml` → `1`.
- [ ] `grep -c "\-\-provenance" .github/workflows/release.yml` → `1`.
- [ ] `grep -c "npm install -g npm@latest" .github/workflows/release.yml` → `0` (redundant step removed).
- [ ] `bun run type-check && bun run lint && bun test && bun run build` all exit 0 (no source regression — this plan touches only CI + README, but confirm nothing else drifted).
- [ ] `git status --short` shows only `.github/workflows/release.yml` and `README.md`.
- [ ] **Honest limitation recorded**: state in the report that end-to-end publish verification requires a real `v*` tag push in GitHub Actions and was NOT performed (unless Step 6 ran).
- [ ] `plans/README.md` status row for plan 003 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's npm lookup returns **HTTP 200** (`metter` is taken on npm) — the name collision is out of scope; report and let the maintainer decide (rename the package or claim the name).
- `package.json` has `"private": true` — publishing is blocked at the manifest level; don't silently remove it, report it.
- `actionlint` reports an **ERROR** (not a warning) after your edits — almost certainly an indentation mistake in the `env:` block; fix the indentation, don't restructure the step.
- The publish step's `env:`/`NODE_AUTH_TOKEN` indentation doesn't match the existing `Generate changelog` step's `env:` shape (lines ~46–47) — YAML indentation is load-bearing; replicate it exactly.
- You find yourself wanting to change the publish mechanism (`bun pm pack && npm publish ./*.tgz`), `package.json`, `ci.yml`, or any source file — STOP; those are out of scope.
- `actions/setup-node@v6` or `oven-sh/setup-bun@v2` don't resolve on actionlint (network) — note it and proceed with the YAML parse check + visual review; these action versions are pre-existing, not introduced by this plan.

## Maintenance notes

For whoever owns this code after it lands:

- **`NPM_TOKEN` is now a hard dependency for releases.** If the secret is missing or expired, the release fails at publish with `ENEEDAUTH`. The README "Releasing" section (Step 5) documents this; keep that section accurate. Rotate the npm token on any suspicion of leak (it's a credential — never commit its value).
- **Provenance requires the package to stay public.** If `metter` is ever made private on npm (or the GitHub repo goes private), `--provenance` will fail. It's best-effort (a provenance failure doesn't block the publish itself in most cases), but if it becomes noisy, drop `--provenance` rather than the publish.
- **The publish mechanism (`bun pm pack && npm publish ./*.tgz`)** is unusual — most libs run `npm publish` directly against the working tree. The pack-then-publish-tarball approach here works and has one real virtue: the tarball contents are pinned by `files: ["dist"]` at pack time, so you can inspect `metter-<ver>.tgz` before publish to confirm exactly what ships. If you ever want to simplify, `npm publish --access public --provenance` (against the working tree, no `bun pm pack`) is the standard form and behaves identically for this package layout. Either is fine; don't change it without reason.
- **`bumpp` (`bun run release`)** bumps `package.json`, commits, pushes, and tags. The tag push is what fires `release.yml`. If you want a release without the auto-commit, `bumpp` has flags — see `bunx bumpp --help`. Do not hand-edit the version and hand-tag; let `bumpp` keep the version/commit/tag in sync.
- **Reviewer scrutiny points**: (1) the `env:` block indentation on the publish step; (2) that `--provenance` is appended, not replacing `--access public`; (3) that the `npm install -g npm@latest` step is fully gone (not just commented); (4) no other workflow or source file changed.
- **What this plan does NOT fix** (carried over from the original audit, deferred): the `bun-version: latest` unpinned in `ci.yml` and `release.yml` (a future Bun release could break CI silently), and the optional `typescript` peer dependency in `package.json`. Both remain valid follow-up findings; neither blocks releases.
