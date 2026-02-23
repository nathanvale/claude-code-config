# Code Style & Patterns

## Patterns

- Functional → pure functions, immutability, composition
- Factory patterns → for object creation
- Dependency injection → for testability
- Small modules → single responsibility
- Abstraction → well-structured over "simple but messy"

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
