// Deterministic `reference` lens: find backticked path claims in the doc surface
// that do not resolve on disk. No model involved.
//
// `test -e` is deterministic. Deciding WHICH backticked tokens are path claims is
// not — that is a heuristic, and it is where every false positive lives. On a
// 39-candidate run against a real repo, the raw heuristic produced 39 findings and
// 0 true positives; the filters below cut it to 1. Each SKIP class below was
// earned by a specific false positive, so removing one regresses a known case.
//
// Usage:
//   node resolve-references.mjs <repo-root>          → JSON findings on stdout
//   import { resolveReferences } from './resolve-references.mjs'

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const EXT = /\.(ts|js|mjs|cjs|json|md|yml|yaml|sh|toml|lock|svg|html)$/

// A superseded ADR records history. Its dead paths are correct, not drift.
const isSuperseded = (text) => /supersed(ed|es)\s+by/i.test(text.slice(0, 1500))

// A sentence asserting a path's ABSENCE is not a broken reference.
// Earned by: docs/agents/domain.md "This repo has no `src/`" and
// CONTEXT-MAP.md "`packages/skill-a/CONTEXT.md` _(not yet created)_".
const ASSERTS_ABSENCE =
  /\b(has no|have no|no longer|does not (exist|have)|not yet created|never|without (a|an))\b/i

// Token classes that look path-shaped but are not repo paths.
const skipToken = (tok) =>
  /^https?:/.test(tok) ||   // URLs
  /[<>*]/.test(tok) ||      // placeholders, globs
  tok.startsWith('--') ||   // CLI flags
  tok.startsWith('/') ||    // slash commands: /hooks, /triage, /domain-modeling
  tok.startsWith('@') ||    // scoped npm packages: @rollup/plugin-node-resolve
  tok.startsWith('$') ||    // env-var paths: $XDG_STATE_HOME/...
  tok.startsWith('~') ||    // home-relative runtime paths
  tok.startsWith('.') ||    // dotfile refs used as prose
  /^origin\//.test(tok) ||  // git refs: origin/main
  /^[a-z]+:/.test(tok)      // protocol-ish: qjs:std

/**
 * @param {string} root repo root
 * @param {{ excludeDirs?: string[] }} [opts] extra doc-surface exclusions
 * @returns {Promise<Array<{doc:string, code:string, claim:string, observation:string}>>}
 */
export async function resolveReferences(root = '.', opts = {}) {
  // Historical plans record rationale, not current claims. Repos that keep
  // plans elsewhere should pass their own excludeDirs.
  const excludeDirs = opts.excludeDirs ?? ['docs/plans/']

  const docs = execSync(
    `find "${root}" -maxdepth 1 -name '*.md' -not -path '*/node_modules/*'; ` +
      `find "${root}/docs" -name '*.md' 2>/dev/null`,
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)

  let scripts = {}
  let deps = {}
  try {
    const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    scripts = p.scripts ?? {}
    deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) }
  } catch {
    // no package.json: script and dependency claims simply do not resolve
  }

  const findings = []

  for (const doc of docs) {
    const text = readFileSync(doc, 'utf8')
    const rel = doc.replace(`${root}/`, '')
    if (isSuperseded(text)) continue
    if (excludeDirs.some((d) => rel.startsWith(d))) continue

    let inFence = false
    text.split('\n').forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return
      }
      if (inFence) return

      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const tok = m[1].trim()
        const at = `${rel}:${i + 1}`

        // `bun run <script>` resolves against package.json scripts, not the filesystem.
        const run = tok.match(/^(?:bun|npm|pnpm|yarn)\s+run\s+([\w:.-]+)$/)
        if (run) {
          if (!(run[1] in scripts)) {
            findings.push({
              doc: at,
              code: '',
              claim: tok,
              observation: `doc names script "${run[1]}"; package.json has no such script`,
            })
          }
          continue
        }

        if (skipToken(tok) || /\s/.test(tok)) continue
        if (ASSERTS_ABSENCE.test(line)) continue
        if (tok in deps) continue
        if (!tok.includes('/') && !EXT.test(tok)) continue

        // Bare `a/b` with no extension and no trailing slash is usually a module
        // specifier (fs/promises), not a repo path. Only report if it resolves
        // as a path shape we recognise.
        if (tok.includes('/') && !EXT.test(tok) && !tok.endsWith('/')) {
          if (!existsSync(resolve(root, tok))) continue
        }

        const clean = tok.replace(/\/$/, '')
        if (!existsSync(resolve(root, clean))) {
          findings.push({
            doc: at,
            code: '',
            claim: tok,
            observation: `doc names ${tok}; path does not exist in the repo`,
          })
        }
      }
    })
  }

  return findings
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await resolveReferences(process.argv[2] ?? '.'), null, 2))
}
