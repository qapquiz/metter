# Plan 004: Pin Bun version in CI + release workflows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 369b609..HEAD -- .github/workflows/ci.yml .github/workflows/release.yml`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `369b609`, 2026-06-21

## Why this matters

Both `.github/workflows/ci.yml` and `.github/workflows/release.yml` run
`oven-sh/setup-bun@v2` with `bun-version: latest`. A breaking Bun release (or a
transient change in what `latest` resolves to) would fail CI for every
contributor and break the `v*`-tag release with no code change on our side.
Pinning to the version actually used in development makes builds reproducible
and turns Bun upgrades into deliberate, reviewable changes. This is a carried-
over finding from the prior audit run (recorded in the old `plans/README.md`
under "Carried-over findings").

## Current state

- `.github/workflows/ci.yml` — the `Setup Bun` step under the `test` job.
- `.github/workflows/release.yml` — the `Setup Bun` step under the `release` job.

Both currently read identically:

```yaml
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
```

**Conventions**: 2-space YAML indentation (match the surrounding steps exactly).
There are no other version-pinning files in the repo (no `.bun-version`, no
`package.json#packageManager`) — keep the change in-workflow to match the repo's
existing style. The version to pin is the one currently in use: `bun --version`
prints `1.3.14` (confirmed during recon; this also matches `@types/bun@^1.3.14`
in `package.json`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm local Bun version | `bun --version` | prints `1.3.14` |
| Confirm pin applied | `rg -n "bun-version" .github/workflows` | both files show `1.3.14`, no `latest` |
| Confirm no `latest` remains | `rg -n "latest" .github/workflows` | no matches |
| YAML validity (if python3 present) | `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/workflows/release.yml` | exit 0 |
| Smoke gate (behavior unchanged) | `bun run type-check && bun run lint && bun test` | all exit 0; 15 tests pass |

(`rg` is ripgrep; the `grep -rn` equivalent works too.)

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

**Out of scope** (do NOT touch, even though they look related):
- `src/`, `test/`, `package.json`, `tsconfig.json` — this plan does not change runtime code.
- The `setup-bun@v2` action version (pin Bun's *version*, not the action's).
- Introducing a `.bun-version` file or a `package.json#packageManager` field. That is a valid alternative approach but is **not** this plan; see Maintenance notes. If you find yourself reaching for it, STOP.

## Git workflow

- Branch: `advisor/004-pin-bun-version`
- Commit message (Conventional Commits, matching the repo — see `git log`):
  `ci: pin bun-version to 1.3.14 in ci and release workflows`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pin Bun in `ci.yml`

In `.github/workflows/ci.yml`, change the `bun-version` value under the
`Setup Bun` step from `latest` to `1.3.14`:

```yaml
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
```

**Verify**: `rg -n "bun-version" .github/workflows/ci.yml` → `          bun-version: 1.3.14`

### Step 2: Pin Bun in `release.yml`

Apply the identical change to `.github/workflows/release.yml`:

```yaml
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
```

**Verify**: `rg -n "bun-version" .github/workflows/release.yml` → `          bun-version: 1.3.14`

### Step 3: Confirm no `latest` remains

**Verify**: `rg -n "latest" .github/workflows` → no output (exit 1 from rg means
"no matches", which is the desired result).

### Step 4: Smoke gate

Run the repo's verification commands to confirm no accidental breakage (none is
expected — this plan touches no source):

**Verify**: `bun run type-check && bun run lint && bun test` → all exit 0; the
test run reports `15 pass`.

### Step 5 (optional, if python3 available): YAML validity

**Verify**: the python3 YAML command from the table exits 0.

## Test plan

No new tests — CI/release config is not covered by the unit suite. The real
end-to-end verification is the next CI run on the PR (it will use `1.3.14`
instead of resolving `latest`). The Done criteria cover everything locally
checkable.

## Done criteria

ALL must hold:

- [ ] `rg -n "bun-version" .github/workflows` shows `1.3.14` in both files
- [ ] `rg -n "latest" .github/workflows` returns no matches
- [ ] (if python3 available) YAML validity check exits 0 for both files
- [ ] `bun run type-check && bun run lint && bun test` all exit 0 (15 tests pass)
- [ ] `git status` shows only `.github/workflows/ci.yml` and `.github/workflows/release.yml` modified
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bun --version` does not print `1.3.14` — pin to whatever `bun --version`
  actually reports and report the discrepancy (don't assume).
- The `Setup Bun` step in either file looks materially different from the
  excerpt above (the codebase has drifted since this plan was written).
- You are tempted to add a `.bun-version` file or a `packageManager` field —
  that is out of scope; stop and note it for the operator.

## Maintenance notes

- **Future Bun upgrades** are now a deliberate act: bump both `bun-version`
  values together. Consider wiring Dependabot/Renovate to `oven-sh/setup-bun`
  version bumps, or bumping per release.
- **Alternative not done here**: a `.bun-version` file (auto-read by
  `setup-bun@v2`) or `package.json#packageManager` would centralize the pin.
  Worth revisiting if a third workflow is added, so the version lives in one
  place rather than two.
- **Reviewer**: confirm both workflows are pinned identically and that the
  `setup-bun@v2` action version is unchanged.
