# Code Style & Patterns

## Patterns

### Pressure gate (run before naming a pattern)

Before reaching for a GoF or design-pattern name, name the pressure that earns it. No pressure → no pattern. A pattern name is a translation *after* evidence, not a prescription *before* code.

This gate owns the *pre-code* moment only. Once modules exist, the same vocabulary continues elsewhere:

- Existing code, find seams → `improve-codebase-architecture` (ICA) runs the deletion test on live modules.
- A pattern name gets claimed → `gof-pressure-lens` referees whether it is earned. GoF names are never an entry point; reach them only *through* this evidence, never as a recommendation.

For any candidate pattern, state:

- Pressure source → what varies, grows, or repeats.
- Seam → where behavior gets swapped without editing in place.
- Deletion-test consequence → delete the module; does complexity vanish (pass-through, drop it) or reappear across callers (earns its keep)?
- Locality or leverage gain → bugs concentrate in one place, or one interface pays back across N callers.
- Second adapter → the real variant that makes the seam real. One adapter is hypothetical; two is earned.

If a field is absent, write the plain module first. Reach for the pattern name when the pressure arrives.

### Default plain — abstract only on proof

Costs are asymmetric. Under-design (plain module → registry when a second variant lands) is a local refactor the first repetition tells you to make. Over-design (speculative Strategy/Factory/DI) taxes every read, and removing it means tearing out the abstraction *and* the code that bent around it. When uncertain, err toward plain.

One question decides it, before any code:

> Can I name the second adapter right now, from the plan?

- Yes → the variant is on the plan (two providers in the spec, prod client + test fake, three importers one shape). Build the seam now; no refactor, not speculation.
- No → "might grow", "for flexibility", "for testability" with one impl. Deletion test fails; the abstraction is dead weight. Write the plain module; wait for the first real repetition to pull the pattern out.

"Name the second adapter" is falsifiable. "Might this grow?" is not — it always answers yes, which is how slop gets in.

Timing: this decision lives at planning time, where the fan-out is visible — see Vertical Slice First below and `to-issues` tracer-bullet slices. If two slices are "the same shape with different X", the second adapter showed up before you wrote either.

### Baseline (no pressure gate needed)

- Functional → pure functions, immutability, composition.
- Small modules → single interface, behavior concentrated behind it.

### Named patterns — defer until pressure

- Strategy / registry → only when variants grow and each owns distinct behavior. See Switch vs Registry below; it is the worked example of this gate.
- Dependency injection → only when a second adapter exists (e.g. real client in prod, in-memory fake in tests). One mocked seam is a hypothetical, not a reason.
- Factory → only when construction itself varies across a seam. A function that returns a value is just a module; do not label it.

### Switch vs Registry

- Use `switch` when variants are tiny, closed, stable, and behavior is mostly shared.
- Use a registry plus Strategy handlers when variants may grow, each variant owns different behavior, a shared entry point matters, and local tests matter.
- Use a plugin system only when external packages contribute variants or dynamic loading is required.
- Name variant count, growth pressure, behavior locality, and extension boundary before choosing.
- Keep registry entries as lookup metadata; keep variant behavior in local handlers.
- Avoid turning a registry into a plugin system without a real external extension boundary.

### Vertical Slice First

- Scope: ports, migrations, or any fan-out of similar units (multiple scripts, files, tables, sections). Not one-off fixes.
- Build one slice end-to-end first: scaffold, code, test, and prove against the real thing (live API, real data, rendered output).
- Verify that slice before replicating it across the remaining units.
- Why: in repetitive work, bugs are correlated. A flaw in the shared mental model replicates into every unit; the first proven slice finds it while it is still 1x, not Nx.
- Pick the slice that retires the most uncertainty (newest toolchain, riskiest assumption), not the easiest one.
- Surface the working slice for review before fanning out; course-correction is cheapest there.
- Planning-time counterpart: `to-issues` "tracer-bullet vertical slices" splits a plan into slices; this applies the same shape at implementation time.

## Style

- TypeScript strict mode always
- Biome defaults → tab indentation, opinionated formatting
- Import order → `node:*` → external → local
- File names → `kebab-case` lowercase
- No abbreviated variable names
- Template literals over concatenation

## JSDoc (Required for all exports)

Every exported function, interface, type, and constant MUST have JSDoc.
Focus on the **why**, not restating what TypeScript already tells you.
Omit `{type}` annotations -- TypeScript handles types; JSDoc handles intent.

### Tags to use

| Tag | When | Required? |
|-----|------|-----------|
| `@param name - desc` | Every parameter | Yes (exported fns) |
| `@returns` | Non-void return values | Yes |
| `@throws` | When function can throw | Yes (API boundaries) |
| `@example` | Public API / library exports | Yes |
| `@see` | Related functions or docs | When helpful |
| `@defaultValue` | Optional params with defaults | When helpful |
| `@remarks` | Extended detail beyond summary | When helpful |
| `@deprecated` | Scheduled for removal | When applicable |
| `@internal` | Exported but not public API | When applicable |

### Exported function (full example)

```typescript
/**
 * Run all topic queries in parallel and return results.
 *
 * Spawns one `@side-quest/last-30-days` subprocess per topic.
 * Null entries in the result indicate failed queries.
 *
 * @param topics - Search queries to research
 * @param diagnostics - Mutable array to collect errors into
 * @param verbose - Emit progress to stderr when true
 * @param days - Lookback window in days (1-365)
 * @returns Array matching input order; null entries are failures
 * @throws Never -- errors are captured in diagnostics
 *
 * @example
 * ```typescript
 * const errors: QueryError[] = []
 * const results = await gatherTopics(
 *   ['Claude Code plugins', 'MCP servers'],
 *   errors,
 *   true,
 *   7,
 * )
 * const successful = results.filter(Boolean)
 * ```
 */
export async function gatherTopics(
  topics: string[],
  diagnostics: QueryError[],
  verbose = false,
  days = 7,
): Promise<Array<Last30DaysReport | null>> {}
```

### Exported interface

```typescript
/**
 * Configuration loaded from community-intel.json.
 *
 * @example
 * ```json
 * {
 *   "topics": ["Claude Code plugins", "MCP servers"],
 *   "days": 14,
 *   "refreshIntervalDays": 30
 * }
 * ```
 */
export interface CacheConfig {
  /** Search queries for @side-quest/last-30-days. */
  topics: string[]
  /** Full-success refresh interval in days. @defaultValue 30 */
  refreshIntervalDays?: number
  /** Lookback window in days for research queries. @defaultValue 7 */
  days?: number
}
```

### Exported type alias

```typescript
/**
 * Status reported on exit via JSON to stdout.
 *
 * - `fresh` -- cache is still valid, no work done
 * - `refreshed` -- new data gathered and written
 * - `failed` -- all queries failed, backoff applied
 * - `no_cache` -- first run, no prior cache existed
 */
export type RefreshStatus = 'fresh' | 'no_cache' | 'refreshed' | 'failed'
```

### Exported constant

```typescript
/**
 * Per-query timeout in milliseconds.
 *
 * Set high enough for slow networks but low enough to
 * fail fast when a subprocess hangs.
 *
 * @defaultValue 60000
 */
export const QUERY_TIMEOUT_MS = 60_000
```

### Function that throws

```typescript
/**
 * Read and parse a JSON config file.
 *
 * @param filePath - Absolute path to the JSON file
 * @returns Parsed configuration object
 * @throws {SyntaxError} When the file contains invalid JSON
 * @throws {Error} When the file does not exist or is unreadable
 *
 * @example
 * ```typescript
 * const config = readJsonFileSync<CacheConfig>('./community-intel.json')
 * ```
 */
export function readJsonFileSync<T>(filePath: string): T {}
```

### Factory function with @see

```typescript
/**
 * Create a diagnostics collector for error aggregation.
 *
 * Returns a mutable array that gather/synthesize steps push errors into.
 * Pass to {@link emitStatus} when done to serialize as JSON.
 *
 * @returns Empty diagnostics array
 * @see emitStatus -- serializes collected diagnostics to stdout
 *
 * @example
 * ```typescript
 * const diagnostics = createDiagnostics()
 * // ... run pipeline steps that push to diagnostics ...
 * emitStatus('refreshed', diagnostics)
 * ```
 */
export function createDiagnostics(): QueryError[] {}
```

### What NOT to do

```typescript
// BAD: restates the type signature, no insight
/** @param name The name. @returns The greeting. */
export function greet(name: string): string {}

// BAD: includes {type} -- TypeScript already has it
/** @param {string} name - The name */
export function greet(name: string): string {}

// BAD: no JSDoc at all on an export
export function greet(name: string): string {}
```

### Rules of thumb

1. First line is a **summary sentence** -- what does this do and why?
2. Add a blank line then **@remarks** for extended context if needed
3. `@param` for every parameter -- describe intent, not type
4. `@returns` for non-void -- describe what the caller gets
5. `@throws` at API boundaries -- list error types and conditions
6. `@example` on all public/library exports -- show real usage
7. Private/internal helpers need only a summary line
8. Interface members get single-line `/** desc */` comments

## Tech Stack

Bun | Node 22+ | TypeScript (strict) | React (functional) | Tailwind | Biome

## Testing

- TDD for big features → write tests first
- Small features → ask Nathan
- Coverage goal → 80%
- Prefer integration over unit tests
- Colocated → `*.test.ts` alongside source
- Arrow notation in test descriptions
