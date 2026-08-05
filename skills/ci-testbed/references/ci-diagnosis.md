# CI Testbed — diagnosis technique

Read after the repro setup runs. The `SKILL.md` invariants apply throughout. The
goal: find why a green-local suite is red in CI, in local runs, without pushing.

## The one rule

**Reproduce the CI environment locally; do not iterate on the runner.** Each
hosted-runner cycle costs minutes and hides the failure behind compact output. A
local run with the four CI differences applied (below) names the failure in
seconds.

## The four CI-vs-local differences (apply all when reproducing)

1. **Fresh checkout, not your warm one.** `git worktree add <tmp> <ci-base-ref>`
   (e.g. `origin/main` or the PR base). Your working checkout has months of
   accumulated `node_modules` and local state a runner never has.
2. **Real install.** `bun install --frozen-lockfile` in the repro worktree.
   Skipping it is the #1 false-red: workspace imports fail (`Cannot find module
   @side-quest/...`) and a stale manifest (`Workspace not found "<deleted-dir>"`)
   both only appear here.
3. **`CI=true`.** Prefix the test run. Tests branch on `process.env.CI` — some
   skip, some hard-throw when a machine-local dep is absent.
4. **A failure-naming reporter.** The compact test-runner prints a summary only
   (`failed=1`, no name). Use raw `bun test <path>` (lists every `(fail)` with
   `file:line` and the error) or `test-runner ... --mode triage`.

## Trap catalogue (green local → red CI)

| Symptom in CI | Cause | Fix |
|---|---|---|
| `Cannot find module @side-quest/...`, every CLI-spawning test exits 1 | worktree / runner had no `bun install` | install first (invariant); CI must `bun install` before tests |
| `Workspace not found "<dir>"` on fresh install | a retired dir still listed in root `package.json` workspaces | remove the stale workspace entry + refresh `bun.lock` |
| a fixture-named test "fails" (`multi-fail`, `runtime error fixture`) | bare `bun test` ran intentional-fail fixtures the test-runner isolates | exclude them: `--path-ignore-patterns "**/fixtures/**"`, or run via `test-runner` |
| `<tool> is not on PATH` / `<adapter> is missing at ...` throws, whole file red | a test hard-throws at module load on a missing machine-local binary/adapter | gate it: `if (!present && !IS_CI) throw ...` + `describe.skipIf(IS_CI && !present)` (see below) |
| `SyntaxError: JSON Parse error: Unexpected EOF` | a spawned native probe returns empty on the runner (missing tool / wrong OS) | install the tool on the runner, or CI-gate the test |
| stale count assertion (`Expected: 1, Received: 3`) | catalog/data grew but the test's expected count wasn't updated | update the assertion to current reality |
| passes on macOS locally, fails on ubuntu CI | darwin-only behavior (codesigning, App Sandbox, `/opt/homebrew`) | `runs-on: macos-latest`, or gate the darwin-only tests |

## Machine-dep hard-throw: the CI-aware gate

A test that hard-requires a local tool and throws when absent (its author's
intent: "no CI, local is the only gate") breaks once CI exists. Gate it so it
still throws loudly **locally** but skips **under CI** — the local suite stays the
real gate, CI stops hard-failing on an artifact it can't have:

```ts
const IS_CI = process.env.CI === "true";
const present = Boolean(Bun.which("<tool>")); // or existsSync(<pinned adapter>)
if (!present && !IS_CI) {
  throw new Error("<tool> is missing — install it; the live proof needs it.");
}
describe.skipIf(IS_CI && !present)("<the live proof>", () => { /* ... */ });
```

**Find every such throw at once** — they are a category, not one test:

```
grep -rlnE "throw new Error\(.*(is missing|not on PATH|Install it|connect .*--json once)" <suite-dir>/*.test.ts
```

Gate all of them in one pass; do not discover them one CI cycle at a time. A file
can have MORE THAN ONE module-level throw (e.g. a binary AND a pinned adapter) —
gate every throw in the file, not just the first.

## Scoping a first CI on a repo that never had one

Turning on CI often uncovers pre-existing failures across many subsystems (no
gate ever ran the full suite). Do not try to make everything green in one PR.
Scope the required check to the subsystem you can prove green now (e.g. one
`skills/<x>/src`), land it, and widen coverage as other subsystems are fixed —
`log()` the deferred scope honestly so it reads as "scoped", not "green".

## When local can't reproduce

If the four differences applied and it still passes locally, the runner differs
in a *named* way — do not re-push blind. Get the failing test NAMED from the last
CI log (raw `bun test` reporter, or `gh run view <id> --log`), read its source,
and identify the specific dependency: a spawned binary (`Bun.which`), a pinned
path (`existsSync`), an env var, a network call, or an OS check
(`process.platform`). That named dep is the difference; gate or provide it.
