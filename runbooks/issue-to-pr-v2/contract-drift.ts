/**
 * Issue #81 — runtime contract drift check for Issue-to-PR v2 operator docs.
 *
 * This module compares claims made in the operator-facing docs (command
 * names, contract slice names, packet roles, and `data.*` response field
 * paths) against the live CLI surface, so docs drift is caught mechanically
 * instead of by review eyeballing.
 *
 * Batch 1: the **contract-fact loader**. It reads the authoritative contract
 * facts from the running CLI subprocess — never by importing CLI internals or
 * duplicating any value as a literal.
 *
 * Batch 2 (added below `loadContractFacts`): the **doc-claim extractor**.
 * `extractDocClaims()` parses ONE scoped doc's text and reports the
 * contract-token claims it makes (route ids, command names, slice names,
 * packet roles, scaffold ids, `data.*` field paths, and scoped
 * recovery/control-plane links) using bounded patterns over prose and fenced
 * code blocks. It holds no expected contract VALUES of its own (AC5): it only
 * reads structural markers and emits what the doc says, leaving the comparison
 * to later batches. Later batches add the comparator and the orchestrator.
 *
 * Design law (AC5): this file holds NO literal route ids, slice names,
 * packet roles, or field paths as expected values. The only contract
 * *coordinates* it knows are which CLI fields to read (the help payload's
 * `commands`, `contract_slices`, `state_response_shape`,
 * `diagnose_response_shape`, `scaffold_ids`, and the `data.` path prefix docs
 * use). Those are read-locations, not duplicated contract values.
 *
 * Design law (AC6): read-only. The loader only invokes the read-only CLI
 * commands (`--help`, `contract <slice>`). It never writes files, touches
 * git, or mutates ledger state. A failed subprocess, a non-ok envelope, OR a
 * well-formed `ok` envelope carrying an EMPTY fact set (empty arrays / empty
 * response shapes) is a hard error: an empty / partial fact set would mask
 * drift or make every doc claim look like drift, so we throw instead.
 *
 * ---------------------------------------------------------------------------
 * Scope boundary (AC8) — what this check DELIBERATELY does NOT do
 * ---------------------------------------------------------------------------
 * This module is a narrow contract-drift check, NOT a broad docs auditor. The
 * boundary below is intentional; a future maintainer must NOT extend it into a
 * general prose/consistency linter without re-opening the scope decision.
 *
 *  - Main SCOPE is `SCOPED_DOCS`. It does NOT validate other Issue-to-PR
 *    references (stage-*.md, host-adapters.md, etc.). Narrow add-ons also
 *    cross-check ledger schema-slice pointers, runtime scaffold generated
 *    blocks, hidden pointer compatibility, and visible scaffold commands.
 *  - It checks ONLY the contract-token kinds from AC1-AC4: route ids, `cli.ts`
 *    command names, `contract <slice>` names, packet roles (ONLY in explicit
 *    `cli.ts packet <role>` command positions), `data.*` response-field paths,
 *    and the scoped recovery/control-plane links (the first-run-gotchas
 *    relationship). The ledger add-on checks emitted schema-slice pointers in
 *    the ledger helper reference.
 *    It does NOT judge prose truth, broad docs consistency, or any token kind
 *    beyond these.
 *  - It adds NO external dependency and generates NO docs. Runtime contract
 *    checks only read live CLI or renderer facts.
 *  - It does NOT validate decompose.ts flags
 *    (`decompose.ts --validate-ledger-batches` yields no command claim),
 *    route-precedence ORDER, enum-value prose (`committed`, `needs-revision`),
 *    template filenames (`builder-dispatch.md`), or role-ish workflow words in
 *    PROSE ("the Builder", "a validator") OUTSIDE explicit `cli.ts packet
 *    <role>` positions. The extractor is scoped by structural POSITION, not by
 *    token shape, precisely so these stay out of scope.
 */

import { statSync } from "node:fs";
import { join, posix } from "node:path";
import { execPath } from "node:process";
import { isScaffoldId, SCAFFOLD_IDS } from "./lib/scaffolds";

/**
 * The authoritative contract facts sourced from the live CLI. Field paths
 * are kept as full dotted strings including the `data.` prefix, because the
 * operator docs reference them that way (e.g. `data.drift.digest_drift`).
 */
export type ContractFacts = {
  /** Route ids from `contract route_ids --json` → data.values. */
  routeIds: string[];
  /** Command names from `--help --json` → data.commands[].name. */
  commandNames: string[];
  /** Contract slice names from `--help --json` → data.contract_slices. */
  contractSlices: string[];
  /** Packet roles from `contract packet_roles --json` → data.values. */
  packetRoles: string[];
  /** Scaffold ids from `--help --json` → data.scaffold_ids. */
  scaffoldIds: string[];
  /**
   * Ledger schema pointer slice ids from
   * `contract ledger_schema_pointer_slices --json` → data.values.
   */
  ledgerSchemaPointerSlices: string[];
  /**
   * Valid `data.*` dotted response field paths, derived from the help
   * payload's state and diagnose response shapes.
   */
  responseFieldPaths: {
    state: string[];
    diagnose: string[];
  };
};

export type LoadContractFactsOptions = {
  /**
   * Override the resolved CLI path. Defaults to the sibling `cli.ts`. Tests
   * use this to point at a missing or fake CLI to exercise the hard-error
   * path; production callers leave it unset.
   */
  cliPath?: string;
  /**
   * Override the per-call subprocess deadline (ms). Defaults to
   * {@link READ_CLI_DEADLINE_MS}. Tests use a small value to drive the
   * deadline branch deterministically; production callers leave it unset.
   */
  readCliDeadlineMs?: number;
};

/** Shape of a CLI success/error envelope, narrowed to what the loader reads. */
type CliEnvelope = {
  status?: unknown;
  data?: Record<string, unknown>;
  error?: { code?: unknown; message?: unknown };
};

/**
 * Resolve the default CLI path relative to this module so the loader works
 * regardless of the caller's cwd.
 */
function defaultCliPath(): string {
  return join(import.meta.dir, "cli.ts");
}

/**
 * Default per-call deadline for `readCliData` subprocesses, in ms. The
 * runbook CLI is local and synchronous so 10s is generous; the bound is
 * here to fail loudly (CI-friendly) if cli.ts ever hangs on a corrupted
 * ledger, blocked stdin, or filesystem stall rather than letting
 * `loadContractFacts` block indefinitely across its four sequential
 * subprocess reads.
 */
const READ_CLI_DEADLINE_MS = 10_000;

/**
 * Spawn the read-only CLI with the given args and return the parsed success
 * envelope's `data`. Throws a clear, command-naming Error when the
 * subprocess exits non-zero, emits no parseable JSON, returns a non-ok
 * envelope (AC6), or exceeds {@link READ_CLI_DEADLINE_MS}. Never returns
 * empty facts on failure.
 */
async function readCliData(
  cliPath: string,
  args: string[],
  deadlineMs: number = READ_CLI_DEADLINE_MS,
): Promise<Record<string, unknown>> {
  const label = `bun ${cliPath} ${args.join(" ")}`;
  // Spawn inline so Bun's overload narrows stdout/stderr to ReadableStream
  // (a `{ stdout: "pipe", stderr: "pipe" }` literal). A genuinely missing
  // CLI surfaces as a non-zero exit below, not a synchronous throw.
  const proc = Bun.spawn([execPath, cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      proc.kill();
      reject(
        new Error(
          `contract-fact loader: "${label}" exceeded ${deadlineMs}ms deadline; killed.`,
        ),
      );
    }, deadlineMs);
  });

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      deadline,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  if (exitCode !== 0) {
    throw new Error(
      `contract-fact loader: "${label}" exited ${exitCode}. stderr=${stderr.slice(0, 400)}`,
    );
  }

  const firstLine = stdout.split("\n").find((line) => line.length > 0);
  if (!firstLine) {
    throw new Error(
      `contract-fact loader: "${label}" emitted no parseable envelope.`,
    );
  }

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(firstLine) as CliEnvelope;
  } catch (cause) {
    throw new Error(
      `contract-fact loader: "${label}" emitted non-JSON stdout: ${firstLine.slice(0, 200)}`,
      { cause },
    );
  }

  if (envelope.status !== "ok") {
    const code = envelope.error?.code ?? "unknown";
    const message = envelope.error?.message ?? "(no message)";
    throw new Error(
      `contract-fact loader: "${label}" returned a non-ok envelope (status=${String(envelope.status)}, code=${String(code)}): ${String(message)}`,
    );
  }

  if (!envelope.data || typeof envelope.data !== "object") {
    throw new Error(
      `contract-fact loader: "${label}" returned an ok envelope with no data object.`,
    );
  }

  return envelope.data;
}

/**
 * Read a NON-EMPTY string[] from a help/slice field, throwing when the shape
 * is wrong OR the array is empty. An empty-but-well-formed fact set (e.g. an
 * `ok` envelope carrying `data.values: []`) is a hard error (AC6): an empty
 * fact set masks drift or makes every doc claim look like drift, so we never
 * return it.
 */
function expectStringArray(
  value: unknown,
  context: string,
): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(
      `contract-fact loader: expected a string array for ${context}, got ${typeof value}`,
    );
  }
  if (value.length === 0) {
    throw new Error(
      `contract-fact loader: ${context} is empty — an empty fact set would mask drift, so it is a hard error.`,
    );
  }
  return value as string[];
}

/**
 * Extract the finite child identifiers a response-shape description
 * advertises via a single `{ a, b, c }` (or `{ a: ..., b: ... }`) brace set.
 *
 * Returns `null` when the shape does NOT advertise a mechanically-finite
 * child set, so the caller stops at the nearest known parent path (AC3).
 *
 * A description is treated as finite only when it carries exactly one brace
 * group of comma-separated identifiers. Union / array-element shapes
 * (`BlockingGate[]: ... { ... } or { ... }`, semicolon-separated members,
 * quoted literal members) are deliberately rejected: they describe an
 * element shape, not a fixed set of `data.K.child` paths, so we must not
 * invent children for them.
 *
 * The array-marker / union-marker rejections are scoped to the BRACE GROUP
 * being parsed, never the whole description string. A genuinely finite shape
 * like `installed_artifact_presence` advertises a single boolean brace set
 * followed by a trailing `missing: (...)[]` array SIBLING. That array marker
 * lives outside the brace group, so it must not suppress the brace set's real
 * children. Multi-variant unions (`blocking_gates`) are still caught
 * structurally: they carry more than one brace group, and each variant's
 * brace inner carries `;` / quoted-literal members that disqualify it.
 */
export function finiteChildKeys(description: string): string[] | null {
  const braceGroups = description.match(/\{[^{}]*\}/g);
  if (!braceGroups || braceGroups.length !== 1) {
    return null;
  }

  const brace = braceGroups[0];
  const inner = brace.slice(1, -1).trim();
  if (inner.length === 0) {
    return null;
  }

  // Reject when the SURROUNDING description marks the whole thing as an array
  // element or union variant, even though the marker sits OUTSIDE the brace
  // group (so the inner-scoped guards below miss it):
  //   - array-of-objects: the brace is immediately followed by `[]`
  //     (e.g. `{ a, b, c }[]`) — that's an element shape, not a fixed set of
  //     `data.K.child` paths.
  //   - union variant: the brace is one arm of a description-level `... or ...`
  //     (e.g. `string or { a, b }`) — children would belong to only one arm.
  // The `\bor\b` test must not fire on the unrelated "one of" phrase used by
  // genuine finite shapes (`confirmation_state`'s "each one of ...").
  const afterBrace = description.slice(
    description.indexOf(brace) + brace.length,
  );
  if (/^\s*\[\]/.test(afterBrace)) {
    return null;
  }
  const descWithoutBrace = description.replace(brace, " ");
  if (/\bor\b/.test(descWithoutBrace)) {
    return null;
  }

  // Reject array-element / discriminated-union element shapes when the marker
  // lives INSIDE the brace group itself (e.g. a variant that nests `[]` or
  // spells out a union). Markers in sibling text outside the braces (a
  // trailing `missing: (...)[]` field, a leading `Foo[]:` type annotation)
  // describe other fields, not this finite set, so they are ignored here.
  if (/\[\]/.test(inner) || /discriminated union|\bor\b/.test(inner)) {
    return null;
  }

  // Semicolons signal a structured/union member list, not a finite key set.
  if (inner.includes(";")) {
    return null;
  }

  const keys: string[] = [];
  for (const part of inner.split(",")) {
    // Each member is either `name` or `name: <value desc>`; take the name.
    const name = part.trim().split(":")[0]?.trim() ?? "";
    // Quoted-literal members are union tag values, not field keys, so a
    // member that is not a bare identifier disqualifies the whole group.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return null;
    }
    keys.push(name);
  }
  return keys.length > 0 ? keys : null;
}

/**
 * Collect the names of trailing NAMED array-typed sibling fields a finite
 * object shape advertises OUTSIDE its `{ ... }` brace group (F12).
 *
 * `finiteChildKeys` returns only the brace-group keys; some shapes describe
 * one more field after the brace, of the form:
 *   `{ a, b, c } booleans + extra: (...)[]`
 * Here `extra` is a genuine named field of the SAME finite object (the object
 * lists a, b, c AND extra as keys); it just happens to be array-typed, so a
 * doc legitimately references `data.K.extra`. We surface it so the loader's
 * facts agree with the docs instead of falsely flagging drift.
 *
 * Only fires when the description has a finite brace group (so the named
 * sibling belongs to a real finite object) AND a `name: (...)[]` field follows
 * it. It deliberately does NOT fire for array-of-union element shapes (a
 * `Foo[]:` element described by `{ ... } or { ... }`), which carry no single
 * finite brace group and whose `[]` belongs to the whole element type, not a
 * named field — so `finiteChildKeys` already returns null for them and no
 * sibling is invented (preserves F7/F10).
 */
function arraySiblingKeys(description: string): string[] {
  // Require a single finite brace group; otherwise there is no finite object
  // for a named sibling to belong to.
  if (finiteChildKeys(description) === null) return [];
  const braceGroups = description.match(/\{[^{}]*\}/g);
  if (!braceGroups || braceGroups.length !== 1) return [];

  // Look only at the text AFTER the brace group for `name: (...)[]` siblings.
  const afterBrace = description.slice(
    description.indexOf(braceGroups[0]) + braceGroups[0].length,
  );
  const keys: string[] = [];
  // A named array sibling: an identifier, a colon, then an array-typed value
  // ending in `[]` (e.g. a `name: (...)[]` field after the finite brace).
  const siblingRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^;{}]*\[\]/g;
  for (const m of afterBrace.matchAll(siblingRe)) {
    keys.push(m[1]);
  }
  return keys;
}

/**
 * Resolve a `"same shape as <shape>.<key>"` cross-reference in a description
 * to that referenced shape's own description string, so finite children can
 * be derived transitively. Returns `null` when no such reference is present
 * or the referenced shape/key is unknown.
 */
function resolveCrossReference(
  description: string,
  shapes: Record<string, Record<string, unknown>>,
): string | null {
  const match = description.match(
    /same shape as ([a-z_]+)\.([a-z_]+)/i,
  );
  if (!match) return null;
  const [, shapeName, key] = match;
  const referenced = shapes[shapeName]?.[key];
  return typeof referenced === "string" ? referenced : null;
}

/**
 * Derive the set of valid `data.*` dotted paths from a single response-shape
 * object. Each top-level key K yields `data.K`. When K's description (or its
 * resolved cross-reference) advertises a finite `{ ... }` child set, also
 * emit `data.K.child` for each child, INCLUDING any named array-typed sibling
 * the same finite object carries outside the brace (F12, e.g.
 * `installed_artifact_presence.missing`). Non-finite shapes stop at `data.K`.
 *
 * `shapes` carries every named shape so cross-references like "same shape as
 * state_response_shape.digest_drift" resolve to the referenced finite set.
 */
function deriveFieldPaths(
  shape: Record<string, unknown>,
  shapes: Record<string, Record<string, unknown>>,
): string[] {
  const paths: string[] = [];
  for (const [key, rawDescription] of Object.entries(shape)) {
    const path = `data.${key}`;
    paths.push(path);

    if (typeof rawDescription !== "string") continue;

    // A description may both name nested keys AND cross-reference a shape for
    // one of those keys (e.g. drift: `{ digest_drift: same shape as ...,
    // findings_table_drift: null }`). Emit the directly-named children first,
    // then any named array-typed sibling of the same finite object (F12).
    const directChildren = finiteChildKeys(rawDescription);
    if (directChildren) {
      for (const child of directChildren) {
        paths.push(`${path}.${child}`);
      }
      for (const sibling of arraySiblingKeys(rawDescription)) {
        paths.push(`${path}.${sibling}`);
      }
    }

    // Then resolve any cross-reference to pull in the referenced shape's own
    // finite children, nested under the appropriate child segment.
    const refMatch = rawDescription.match(/same shape as ([a-z_]+)\.([a-z_]+)/i);
    if (refMatch) {
      const resolved = resolveCrossReference(rawDescription, shapes);
      if (resolved) {
        const refChildren = finiteChildKeys(resolved);
        if (refChildren) {
          // Determine the segment the reference is attached to. A pure
          // cross-ref ("same shape as X.Y") attaches at `data.K`; a named
          // child whose value is a cross-ref ("child: same shape as X.Y")
          // attaches at `data.K.child`.
          const childSegment = directChildren?.find((c) =>
            new RegExp(`${c}\\s*:\\s*same shape as`, "i").test(rawDescription),
          );
          const base = childSegment ? `${path}.${childSegment}` : path;
          for (const refChild of refChildren) {
            paths.push(`${base}.${refChild}`);
          }
          // A pure cross-ref also inherits the referenced object's named array
          // siblings (e.g. diagnose's installed_artifact_presence → missing).
          for (const sibling of arraySiblingKeys(resolved)) {
            paths.push(`${base}.${sibling}`);
          }
        }
      }
    }
  }
  return paths;
}

/**
 * Load the authoritative contract facts from the live, read-only CLI.
 *
 * Sources, all at runtime. Newly emitted slices are accepted through
 * `--help data.contract_slices`; this checker does not need per-slice
 * source edits when the CLI owns the slice.
 *
 * Sources:
 *  - route ids   ← `contract route_ids --json`   → data.values
 *  - packet roles  ← `contract packet_roles --json` → data.values
 *  - ledger schema pointer slices ← `contract ledger_schema_pointer_slices --json` → data.values
 *  - command names ← `--help --json` → data.commands[].name
 *  - slice names   ← `--help --json` → data.contract_slices
 *  - scaffold ids  ← `--help --json` → data.scaffold_ids
 *  - field paths   ← `--help --json` → state/diagnose response shapes
 *
 * Throws (never returns partial facts) when any subprocess fails or returns
 * a non-ok envelope, so drift detection can never be silently disarmed.
 */
export async function loadContractFacts(
  options: LoadContractFactsOptions = {},
): Promise<ContractFacts> {
  const cliPath = options.cliPath ?? defaultCliPath();
  const deadlineMs = options.readCliDeadlineMs ?? READ_CLI_DEADLINE_MS;

  const help = await readCliData(cliPath, ["--help", "--json"], deadlineMs);
  const routeIdData = await readCliData(
    cliPath,
    ["contract", "route_ids", "--json"],
    deadlineMs,
  );
  const packetRoleData = await readCliData(
    cliPath,
    ["contract", "packet_roles", "--json"],
    deadlineMs,
  );
  const ledgerSchemaPointerData = await readCliData(
    cliPath,
    ["contract", "ledger_schema_pointer_slices", "--json"],
    deadlineMs,
  );

  const commands = help.commands;
  if (!Array.isArray(commands)) {
    throw new Error(
      "contract-fact loader: --help data.commands is not an array",
    );
  }
  if (commands.length === 0) {
    throw new Error(
      "contract-fact loader: --help data.commands is empty — an empty fact set would mask drift, so it is a hard error.",
    );
  }
  const commandNames = commands.map((c) => {
    const name = (c as { name?: unknown }).name;
    if (typeof name !== "string") {
      throw new Error(
        "contract-fact loader: --help data.commands[].name is not a string",
      );
    }
    return name;
  });

  const contractSlices = expectStringArray(
    help.contract_slices,
    "--help data.contract_slices",
  );
  const scaffoldIds = expectStringArray(
    help.scaffold_ids,
    "--help data.scaffold_ids",
  );
  const routeIds = expectStringArray(
    routeIdData.values,
    "contract route_ids data.values",
  );
  const packetRoles = expectStringArray(
    packetRoleData.values,
    "contract packet_roles data.values",
  );
  const ledgerSchemaPointerSlices = expectStringArray(
    ledgerSchemaPointerData.values,
    "contract ledger_schema_pointer_slices data.values",
  );

  const stateShape = help.state_response_shape;
  const diagnoseShape = help.diagnose_response_shape;
  if (
    !stateShape ||
    typeof stateShape !== "object" ||
    Array.isArray(stateShape) ||
    !diagnoseShape ||
    typeof diagnoseShape !== "object" ||
    Array.isArray(diagnoseShape)
  ) {
    throw new Error(
      "contract-fact loader: --help is missing state_response_shape / diagnose_response_shape",
    );
  }

  const shapes: Record<string, Record<string, unknown>> = {
    state_response_shape: stateShape as Record<string, unknown>,
    diagnose_response_shape: diagnoseShape as Record<string, unknown>,
  };

  const stateFieldPaths = deriveFieldPaths(shapes.state_response_shape, shapes);
  const diagnoseFieldPaths = deriveFieldPaths(
    shapes.diagnose_response_shape,
    shapes,
  );
  // An empty response shape derives no paths. Like the other facts, an empty
  // path set would make every `data.*` doc claim look like drift, so each
  // shape must derive at least its top-level paths (AC6).
  if (stateFieldPaths.length === 0) {
    throw new Error(
      "contract-fact loader: --help state_response_shape derived no field paths — an empty fact set would mask drift, so it is a hard error.",
    );
  }
  if (diagnoseFieldPaths.length === 0) {
    throw new Error(
      "contract-fact loader: --help diagnose_response_shape derived no field paths — an empty fact set would mask drift, so it is a hard error.",
    );
  }

  return {
    routeIds,
    commandNames,
    contractSlices,
    packetRoles,
    scaffoldIds,
    ledgerSchemaPointerSlices,
    responseFieldPaths: {
      state: stateFieldPaths,
      diagnose: diagnoseFieldPaths,
    },
  };
}

// ---------------------------------------------------------------------------
// Batch 2: doc-claim extractor
// ---------------------------------------------------------------------------

/**
 * A single contract-token claim found in a doc. `token` is the raw token the
 * doc asserts (a route id, command, slice, packet role, or `data.*` path).
 * `line` is the 1-based line the claim was found on, so the comparator can
 * point an operator at the drift. `context` is the trimmed source line, kept
 * for human-readable drift reports.
 */
export type DocClaim = {
  token: string;
  line: number;
  context: string;
};

/**
 * A scoped markdown-link claim. `token` is the link text, `rawTarget` is the
 * link destination exactly as written (may carry a `#fragment`), and
 * `resolvedTarget` is that destination resolved relative to the doc's own
 * path (fragment stripped) so the comparator can check the file exists.
 */
export type ScopedLinkClaim = DocClaim & {
  rawTarget: string;
  resolvedTarget: string;
};

/**
 * The structured claim set extracted from one scoped doc. Each array holds
 * the claims of one KIND; `docPath` echoes the doc the claims came from so
 * the orchestrator can attribute drift back to a file.
 */
export type DocClaims = {
  docPath: string;
  routeIds: DocClaim[];
  commands: DocClaim[];
  slices: DocClaim[];
  packetRoles: DocClaim[];
  scaffoldCommands: DocClaim[];
  fieldPaths: DocClaim[];
  scopedLinks: ScopedLinkClaim[];
};

/** A token is a `<...>` angle-bracket placeholder, not a real claim. */
function isPlaceholder(token: string): boolean {
  return token.startsWith("<") && token.endsWith(">");
}

/** A CLI flag (`--json`, `--ledger`, ...), never a command/slice/role token. */
function isFlag(token: string): boolean {
  return token.startsWith("-");
}

/** Line number (1-based) of `index` within `text`. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Trimmed source line containing `index`, for human-readable context. */
function contextOf(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const endNl = text.indexOf("\n", index);
  const end = endNl === -1 ? text.length : endNl;
  return text.slice(start, end).trim();
}

/** Build a claim anchored at `index` in `text`. */
function claimAt(text: string, index: number, token: string): DocClaim {
  return { token, line: lineOf(text, index), context: contextOf(text, index) };
}

function htmlCommentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const commentRe = /<!--[\s\S]*?(?:-->|$)/g;
  for (const match of text.matchAll(commentRe)) {
    const start = match.index ?? 0;
    ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

function inHtmlComment(
  index: number,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Compute the half-open character ranges of `text` that sit inside a
 * **route-catalog context** — the only place a bare backtick kebab bullet may
 * be read as a route id (F11). The route catalog and the Stage-4 subroute list
 * use structurally identical bullets (`- \`X\`: ...`), so token SHAPE cannot
 * tell a real route id from a conceptual subroute name. Section CONTEXT can.
 *
 * Two context layers, scanned line by line:
 *  - **Tag layer** (authoritative): an XML-style `<route_catalog>` opener
 *    turns route context ON until its `</route_catalog>` (or any other
 *    `<section>` tag) closes it. Any OTHER `<tag>` opener (e.g.
 *    `<stage_shells>`) turns route context OFF, so the Stage-4 subroute
 *    bullets nested there are excluded even though one sub-heading reads
 *    "Stage 4 subroutes". Bold sub-labels inside a tag region (e.g.
 *    `**Happy path**`) do not flip context — the enclosing tag wins.
 *  - **Heading layer** (fallback, only when NOT inside any tag region): a
 *    markdown heading or bold-only label whose text matches `/route/i` opens
 *    route context; the next heading/bold that does NOT match closes it. This
 *    keeps tag-less docs (and small fixtures) working off a "routes" heading.
 *
 * Returning ranges rather than a per-line flag lets the bullet matcher reuse
 * its existing global regex and simply test whether each match index falls in
 * a route-context range.
 */
function routeCatalogRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inRoute = false;
  let rangeStart = 0;
  // Tag region we are currently inside: "route", "other", or null (none).
  let tagRegion: "route" | "other" | null = null;
  // Heading-layer flag, only consulted when tagRegion is null.
  let headingRoute = false;

  const open = (at: number) => {
    if (!inRoute) {
      inRoute = true;
      rangeStart = at;
    }
  };
  const close = (at: number) => {
    if (inRoute) {
      inRoute = false;
      ranges.push([rangeStart, at]);
    }
  };

  let offset = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    const trimmed = line.trim();

    const openTag = trimmed.match(/^<([a-z_]+)>$/i);
    const closeTag = trimmed.match(/^<\/([a-z_]+)>$/i);
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    const boldLabel = trimmed.match(/^\*\*(.+?)\*\*$/);

    if (openTag) {
      tagRegion = /route/i.test(openTag[1]) ? "route" : "other";
      if (tagRegion === "route") open(lineStart);
      else close(lineStart);
    } else if (closeTag) {
      tagRegion = null;
      // Falling out of a tag region: defer to the heading layer's last state.
      if (headingRoute) open(lineStart);
      else close(lineStart);
    } else if (heading || boldLabel) {
      const labelText = (heading?.[1] ?? boldLabel?.[1] ?? "").trim();
      headingRoute = /route/i.test(labelText);
      // Headings only flip context when not pinned by an enclosing tag region.
      if (tagRegion === null) {
        if (headingRoute) open(lineStart);
        else close(lineStart);
      }
    }

    offset += line.length + 1; // account for the split "\n"
  }
  close(text.length);
  return ranges;
}

/** True when `index` falls within any route-catalog context range. */
function inRouteCatalog(
  index: number,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Extract route-ID claims from EXPLICIT route-ID positions only:
 *  - `route_id: "X"` / `inferred_route_id: "X"` quoted assignments (anywhere).
 *  - backtick-quoted `blocked-*` tokens anywhere (the blocked-route shape
 *    heuristic: every documented backtick `blocked-<kebab>` token is a real
 *    route id, so this position is safe without section scoping).
 *  - backtick-quoted kebab tokens that lead a bullet, but ONLY when that
 *    bullet sits inside a route-catalog context section (see
 *    `routeCatalogRanges`). This is the F11 fix: structurally identical
 *    bullets in a Stage-4 subroute list or a field-name list are NOT route
 *    ids, so the bullet heuristic is scoped by section context, not by token
 *    shape, and never by a hardcoded route list (AC5).
 *
 * It deliberately does NOT treat every backtick kebab token as a route id:
 * tokens with whitespace (`git status`) or a file extension
 * (`first-run-gotchas.md`) are rejected by the bullet pattern, and a
 * route-catalog bullet may carry two ids joined by ` and ` (`- \`X\` and
 * \`Y\`: ...`) — both are captured. The `blocked-` prefix is an extraction
 * shape, not a contract value (AC5).
 */
function extractRouteIds(text: string): DocClaim[] {
  const claims: DocClaim[] = [];
  const seen = new Set<string>();
  const push = (token: string, index: number) => {
    const key = `${token}@${lineOf(text, index)}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claimAt(text, index, token));
  };

  // `route_id: "X"` and `inferred_route_id: "X"`.
  const assignRe = /\b(?:inferred_)?route_id:\s*"([a-z0-9-]+)"/g;
  for (const m of text.matchAll(assignRe)) {
    push(m[1], m.index ?? 0);
  }

  // Backtick `blocked-*` tokens anywhere (blocked-route shape heuristic).
  const blockedRe = /`(blocked-[a-z0-9-]+)`/g;
  for (const m of text.matchAll(blockedRe)) {
    push(m[1], m.index ?? 0);
  }

  // Backtick kebab tokens on a route-catalog bullet. The pattern captures one
  // or both ids of a `- \`X\`: ...` / `- \`X\` and \`Y\`: ...` bullet; the
  // token is a single kebab word (no whitespace, no dot) so file names and
  // `git status` are excluded. The match is kept ONLY when its bullet sits in
  // a route-catalog context range, so identical-shaped subroute / field-name
  // bullets elsewhere are skipped (F11).
  const routeRanges = routeCatalogRanges(text);
  const bulletRe =
    /^[\t ]*[-*]\s+`([a-z][a-z0-9-]*)`(?:\s+and\s+`([a-z][a-z0-9-]*)`)?(?=\s*:)/gm;
  for (const m of text.matchAll(bulletRe)) {
    const index = m.index ?? 0;
    if (!inRouteCatalog(index, routeRanges)) continue;
    push(m[1], index);
    if (m[2]) push(m[2], index);
  }

  return claims;
}

/**
 * Extract command, slice, and packet-role claims from `cli.ts` command
 * positions. The token immediately after `cli.ts ` is a command; after
 * `cli.ts contract ` it is also a slice; after `cli.ts packet ` it is also a
 * packet role; after visible `cli.ts scaffold ` it is also a scaffold id.
 * Flags and `<placeholder>` args are skipped. Reading the `cli.ts `,
 * `contract`, `packet`, and `scaffold` markers is structural extraction, not
 * a contract value (AC5).
 */
function extractCliClaims(text: string): {
  commands: DocClaim[];
  slices: DocClaim[];
  packetRoles: DocClaim[];
  scaffoldCommands: DocClaim[];
} {
  const commands: DocClaim[] = [];
  const slices: DocClaim[] = [];
  const packetRoles: DocClaim[] = [];
  const scaffoldCommands: DocClaim[] = [];
  const commentRanges = htmlCommentRanges(text);

  // The token after `cli.ts ` is the command. Allow `<...>` so the
  // placeholder is captured then skipped, rather than silently matching the
  // wrong token.
  const cliRe = /\bcli\.ts\s+(<[a-z-]+>|[a-z][a-z0-9-]*)/g;
  for (const m of text.matchAll(cliRe)) {
    const command = m[1];
    const index = m.index ?? 0;
    if (inHtmlComment(index, commentRanges)) continue;
    if (!isPlaceholder(command) && !isFlag(command)) {
      commands.push(claimAt(text, index, command));
    }

    // The token following the command, for `contract`/`packet` sub-positions.
    const after = text.slice(index + m[0].length);
    const nextMatch = after.match(/^\s+(<[a-z-]+>|[a-z][a-z0-9_-]*)/);
    if (!nextMatch) continue;
    const next = nextMatch[1];
    if (isPlaceholder(next) || isFlag(next)) continue;

    if (command === "contract") {
      slices.push(claimAt(text, index, next));
    } else if (command === "packet") {
      packetRoles.push(claimAt(text, index, next));
    } else if (command === "scaffold") {
      scaffoldCommands.push(claimAt(text, index, next));
    }
  }

  return { commands, slices, packetRoles, scaffoldCommands };
}

/**
 * Extract `data.*` field-path claims from prose and fenced code blocks,
 * expanding `{a, b, c}` brace sets (including multiline ones) into individual
 * `data.prefix.a` paths and skipping any path carrying a `<placeholder>`
 * segment. A bare field name without the `data.` prefix is NOT a claim.
 * Reading the `data.` prefix is structural extraction, not a value (AC5).
 */
function extractFieldPaths(text: string): DocClaim[] {
  const claims: DocClaim[] = [];
  const seen = new Set<string>();
  const push = (token: string, index: number) => {
    if (token.includes("<") || token.includes(">")) return;
    const key = `${token}@${lineOf(text, index)}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claimAt(text, index, token));
  };

  // Brace-set form: `data.prefix.{a, b, c}` where the brace inner may span
  // newlines. Matched first so the plain-path pass does not capture the
  // `data.prefix` stem on its own.
  const braceRe = /data((?:\.[a-z0-9_]+)+)\.\{([^{}]*)\}/gi;
  for (const m of text.matchAll(braceRe)) {
    const prefix = `data${m[1]}`;
    const index = m.index ?? 0;
    for (const raw of m[2].split(",")) {
      const child = raw.trim();
      if (!/^[a-z0-9_]+$/i.test(child)) continue;
      push(`${prefix}.${child}`, index);
    }
  }

  // Mask consumed brace sets so the plain-path pass below cannot re-capture
  // the `data.prefix` stem of an already-expanded brace path.
  const masked = text.replace(braceRe, (match) => " ".repeat(match.length));

  // Plain dotted form: `data.a.b.c`. Requires at least one segment after
  // `data.`; bare field names without the prefix never match.
  const plainRe = /\bdata(?:\.[a-z0-9_]+)+\b/gi;
  for (const m of masked.matchAll(plainRe)) {
    push(m[0], m.index ?? 0);
  }

  return claims;
}

/**
 * Extract scoped markdown-link claims `[text](target)` whose target is a
 * relative doc (control-plane / recovery references the comparator will check
 * for existence). External `http(s)` links and pure in-page `#fragment` links
 * are ignored. `resolvedTarget` is the target resolved relative to the doc's
 * directory, with any `#fragment` stripped.
 *
 * Two markdown details are handled (F16):
 *  - An optional link title `[t](y.md "title")` is stripped, so `rawTarget`
 *    and `resolvedTarget` carry only `y.md`, never the quoted title.
 *  - Image syntax `![alt](img.png)` is NOT a scoped doc link: the preceding
 *    `!` is required to be absent, so the image portion is skipped.
 */
function extractScopedLinks(text: string, docPath: string): ScopedLinkClaim[] {
  const links: ScopedLinkClaim[] = [];
  const docDir = posix.dirname(docPath);
  // `(?<!!)` rejects the `(...)` of an image `![alt](img.png)`. The target
  // capture stops at whitespace so an optional `"title"` is excluded.
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of text.matchAll(linkRe)) {
    const token = m[1];
    const rawTarget = m[2].trim();
    if (/^[a-z]+:\/\//i.test(rawTarget) || rawTarget.startsWith("#")) {
      continue;
    }
    const withoutFragment = rawTarget.split("#")[0];
    if (withoutFragment.length === 0) continue;
    const resolvedTarget = posix.normalize(
      posix.join(docDir === "." ? "" : docDir, withoutFragment),
    );
    const index = m.index ?? 0;
    links.push({
      ...claimAt(text, index, token),
      rawTarget,
      resolvedTarget,
    });
  }
  return links;
}

/**
 * Parse ONE scoped operator doc's text and return the contract-token claims
 * it makes. Bounded extraction over prose and fenced code blocks (the scanner
 * does not skip fences — a stale `cli.ts` command or `data.*` path inside a
 * code block IS a claim). The extractor holds no expected contract values
 * (AC5): it reads structural markers and reports what the doc asserts; the
 * comparator batch decides whether each claim matches the live CLI facts.
 *
 * @param docText The full text of the doc.
 * @param docPath The doc's path, used to resolve scoped-link targets and to
 *   attribute claims back to a file. Not used to gate which kinds are parsed.
 */
export function extractDocClaims(docText: string, docPath: string): DocClaims {
  const { commands, slices, packetRoles, scaffoldCommands } =
    extractCliClaims(docText);
  return {
    docPath,
    routeIds: extractRouteIds(docText),
    commands,
    slices,
    packetRoles,
    scaffoldCommands,
    fieldPaths: extractFieldPaths(docText),
    scopedLinks: extractScopedLinks(docText, docPath),
  };
}

// ---------------------------------------------------------------------------
// Batch 3: claim-fact comparator + first-run-gotchas relationship check
// ---------------------------------------------------------------------------

/** The kind of contract token a drift finding is about. */
export type DriftKind =
  | "route-id"
  | "command"
  | "slice"
  | "packet-role"
  | "scaffold-command"
  | "field-path"
  | "scoped-link"
  | "ledger-lifecycle-field"
  | "ledger-schema-slice-pointer"
  | "generated-scaffold-block"
  | "scaffold-pointer"
  | "scaffold-inventory"
  | "workflow-learning-scan"
  // A doc the SCOPE marks as carrying contract tokens that extracted ZERO
  // contract claims (F21): a likely extractor regression or a doc rewrite that
  // stripped structural markers, which would otherwise silently disarm that
  // doc's validation. Not tied to a single token, so no claim VALUE is hardcoded.
  | "claim-floor";

/**
 * A single structured drift finding. `doc` is the source doc the claim came
 * from, `kind` is which fact set the claim failed to match, `claim` is the
 * offending token (the route id / command / slice / role / dotted path, or
 * the resolved link target for `scoped-link`), and `reason` is a short
 * human-readable explanation for an operator. Findings are DATA — the
 * comparator returns them, it never throws on a claim that fails to match.
 */
export type DriftFinding = {
  doc: string;
  kind: DriftKind;
  claim: string;
  reason: string;
  /**
   * 1-based source line of the claim, for operator pointing. OMITTED for
   * doc-level relationship findings that are not tied to a single line (e.g.
   * "SKILL.md is missing the 7b control-plane load"): those point at the doc as
   * a whole, so there is no meaningful 1-based line and `line` is left undefined
   * rather than carrying a `0` sentinel that would contradict the 1-based
   * contract and confuse batch-4 operator output.
   */
  line?: number;
};

/**
 * Options shared by the comparator and the relationship check. `repoRoot` is
 * the directory that scoped-link `resolvedTarget`s and the relationship
 * doc paths resolve against. It defaults to the repo root two levels above
 * this module (`runbooks/issue-to-pr-v2/` → repo root), matching how
 * `extractDocClaims` emits repo-relative resolved targets when given
 * repo-relative doc paths.
 */
export type CompareOptions = {
  repoRoot?: string;
};

/** Default repo root: two levels up from `runbooks/issue-to-pr-v2/`. */
function defaultRepoRoot(): string {
  return join(import.meta.dir, "..", "..");
}

/**
 * Test whether a filesystem path exists (file OR directory). Directory link
 * targets like `../issue-to-pr/` are legitimate scoped links, so existence —
 * not file-ness — is the check (a batch-2 reviewer flagged directory targets).
 */
async function pathExists(absPath: string): Promise<boolean> {
  // Bun.file().exists() is true only for regular files; statSync covers dirs
  // too. Top-level `node:fs` import matches sibling-module house style (no
  // inline dynamic import); node:fs is stdlib, so no new dependency.
  const file = Bun.file(absPath);
  if (await file.exists()) return true;
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Membership-test every extracted claim against the live contract facts and
 * return structured drift findings. Comparison is EXACT after the extractor's
 * wrapper trimming — no lowercasing or normalization (Key Decision 6), so a
 * wrong-case token (`Blocked-Stage-3`, `data.Route_ID`) is drift. A claim that
 * is NOT a member of its corresponding fact set yields exactly one finding;
 * matching claims yield none.
 *
 * Field-path claims are tested against the UNION of the state and diagnose
 * response field paths, because a doc may legitimately reference a path that
 * exists in only one of the two shapes.
 *
 * Scoped-link claims are checked for target EXISTENCE on disk (file or
 * directory) relative to `opts.repoRoot`; a missing target is one
 * `scoped-link` finding, a present one is none. A missing LINK TARGET is drift
 * (DATA), distinct from a missing protected DOC that the relationship check is
 * asked to read (a hard error — see `checkGotchasRelationship`).
 *
 * Pure (aside from the read-only `fs.exists` checks for scoped links); never
 * throws on a claim that fails to match, never mutates anything (AC6).
 */
export async function compareClaimsToFacts(
  claims: DocClaims,
  facts: ContractFacts,
  opts: CompareOptions = {},
): Promise<DriftFinding[]> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const findings: DriftFinding[] = [];
  const doc = claims.docPath;

  /** Push a finding for any claim whose token is not in `valid`. */
  const checkSet = (
    items: DocClaim[],
    valid: Set<string>,
    kind: DriftKind,
    label: string,
  ): void => {
    for (const c of items) {
      if (!valid.has(c.token)) {
        findings.push({
          doc,
          kind,
          claim: c.token,
          line: c.line,
          reason: `doc claims ${label} \`${c.token}\` but it is not in the live CLI ${label} set.`,
        });
      }
    }
  };

  checkSet(claims.routeIds, new Set(facts.routeIds), "route-id", "route id");
  checkSet(claims.commands, new Set(facts.commandNames), "command", "command");
  checkSet(claims.slices, new Set(facts.contractSlices), "slice", "slice");
  checkSet(
    claims.packetRoles,
    new Set(facts.packetRoles),
    "packet-role",
    "packet role",
  );
  checkSet(
    claims.scaffoldCommands,
    new Set(facts.scaffoldIds),
    "scaffold-command",
    "scaffold id",
  );
  checkSet(
    claims.fieldPaths,
    new Set([
      ...facts.responseFieldPaths.state,
      ...facts.responseFieldPaths.diagnose,
    ]),
    "field-path",
    "field path",
  );

  // Scoped-link existence: resolve each link target against the repo root and
  // verify it exists on disk. Missing target → one scoped-link finding.
  for (const link of claims.scopedLinks) {
    const abs = join(repoRoot, link.resolvedTarget);
    if (!(await pathExists(abs))) {
      findings.push({
        doc,
        kind: "scoped-link",
        claim: link.resolvedTarget,
        line: link.line,
        reason: `scoped link \`[${link.token}](${link.rawTarget})\` resolves to \`${link.resolvedTarget}\`, which does not exist on disk.`,
      });
    }
  }

  return findings;
}

/**
 * Options for the first-run-gotchas relationship check. Paths are structural
 * constants (the SCOPE of the relationship the workflow relies on, allowed by
 * AC5 — they are not contract VALUES like route ids), resolved against
 * `repoRoot`.
 */
export type GotchasRelationshipOptions = {
  repoRoot?: string;
};

/**
 * The control-plane scope the gotchas-relationship check inspects. These are
 * structural file coordinates (Key Decision 7), not contract values.
 */
const GOTCHAS_GUIDE_REL = "runbooks/issue-to-pr-v2/references/first-run-gotchas.md";
const WORKFLOW_LEARNING_SCAN_REL =
  "runbooks/issue-to-pr-v2/references/workflow-learning-scan.md";
const SKILL_DOC_REL = "skills/issue-to-pr/SKILL.md";
const ISSUE_TO_PR_DOC_REL = "runbooks/issue-to-pr-v2/issue-to-pr.md";
const LEDGER_DOC_REL = "runbooks/issue-to-pr-v2/references/ledger-and-helper.md";
const STAGE_6_SHIP_REL =
  "runbooks/issue-to-pr-v2/references/stage-6-ship.md";
const WORKFLOW_LEARNINGS_REGISTRY_REL =
  "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md";
const CE_PLAN_TEMPLATE_REL =
  "runbooks/issue-to-pr-v2/templates/ce-plan-addendum.md";
const PROPOSER_TEMPLATE_REL =
  "runbooks/issue-to-pr-v2/templates/proposer-envelope.md";
const PATCH_PROPOSAL_TEMPLATE_REL =
  "runbooks/issue-to-pr-v2/templates/patch-proposal.md";
const BUILDER_RETURN_TEMPLATE_REL =
  "runbooks/issue-to-pr-v2/templates/builder-return-envelope.md";
const BUILDER_WORK_PACKET_TEMPLATE_REL =
  "runbooks/issue-to-pr-v2/templates/builder-work-packet.md";
const VALIDATOR_ENVELOPE_TEMPLATE_REL =
  "runbooks/issue-to-pr-v2/templates/validator-envelope.md";
const BUILDER_DISPATCH_REL =
  "runbooks/issue-to-pr-v2/references/builder-dispatch.md";
const FINDINGS_AND_VALIDATORS_REL =
  "runbooks/issue-to-pr-v2/references/findings-and-validators.md";
const STAGE_4_BATCH_LOOP_REL =
  "runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md";

type ScaffoldSurface = {
  doc: string;
  ids: readonly string[];
};

type ScaffoldInventoryClassification =
  | "visible-command-pointer"
  | "removed";

type ScaffoldInventoryEntry = {
  doc: string;
  coordinate: string;
  classification: ScaffoldInventoryClassification;
  scaffoldId?: string;
  forbiddenText?: string;
};

/**
 * Build a structural detector for a `removed` inventory entry's `forbiddenText`
 * sentinel. The literal `text.includes()` gate was bypassed by trivial idiomatic
 * rewrites (single-quoted scalars, tab between `key:` and value, double spaces,
 * `<sha|range>` without internal spaces). The hardened detector:
 *
 *   - collapses ASCII whitespace runs to a single match-any-whitespace class,
 *   - treats `"..."` and `'...'` as interchangeable when the literal contains
 *     a double-quoted scalar,
 *   - tolerates optional whitespace around `|` inside angle-bracket placeholders
 *     (`<sha | range>` ↔ `<sha|range>`).
 *
 * Anchored to the byte-level sentinels SCAFFOLD_INVENTORY already encodes; no
 * structural YAML parsing required for any current entry.
 */
function buildForbiddenTextDetector(forbiddenText: string): RegExp {
  // Tokenise into runs that escape verbatim and runs of whitespace that map to
  // `\s+`. Then convert `"..."` quoted scalars into `["'][...]["']` so a copy
  // restored with single quotes still trips the gate. Whitespace that bumps
  // up against a `|` collapses to optional whitespace, so `<sha | range>` and
  // `<sha|range>` both match.
  let pattern = "";
  let i = 0;
  while (i < forbiddenText.length) {
    const ch = forbiddenText[i] ?? "";
    if (/\s/.test(ch)) {
      let j = i;
      while (j < forbiddenText.length && /\s/.test(forbiddenText[j] ?? "")) {
        j += 1;
      }
      const prev = forbiddenText[i - 1] ?? "";
      const next = forbiddenText[j] ?? "";
      const adjacentToPipe = prev === "|" || next === "|";
      pattern += adjacentToPipe ? "\\s*" : "\\s+";
      i = j;
      continue;
    }
    if (ch === '"') {
      // Match either quote style at this position.
      pattern += "[\"']";
      i += 1;
      continue;
    }
    if (ch === "|") {
      pattern += "\\s*\\|\\s*";
      i += 1;
      continue;
    }
    pattern += escapeRegExp(ch);
    i += 1;
  }
  return new RegExp(pattern);
}

const SCAFFOLD_INVENTORY: readonly ScaffoldInventoryEntry[] = [
  {
    doc: CE_PLAN_TEMPLATE_REL,
    coordinate: "## Structured-output requirement (issue-to-pr workflow) / candidate batch pointer",
    classification: "visible-command-pointer",
    scaffoldId: "ce-plan-candidate-batch",
  },
  {
    doc: PATCH_PROPOSAL_TEMPLATE_REL,
    coordinate: "## Scratch file shape / patch batch pointer",
    classification: "visible-command-pointer",
    scaffoldId: "patch-proposal-candidate-batch",
  },
  {
    doc: PATCH_PROPOSAL_TEMPLATE_REL,
    coordinate: "## Scratch file shape / dynamic final_finding member list",
    classification: "removed",
    forbiddenText: "final_finding fields:",
  },
  {
    doc: BUILDER_RETURN_TEMPLATE_REL,
    coordinate: "## Authoritative source / return envelope pointer",
    classification: "visible-command-pointer",
    scaffoldId: "builder-return-envelope",
  },
  {
    doc: BUILDER_RETURN_TEMPLATE_REL,
    coordinate: "## What the Orchestrator records / compact attempt pointer",
    classification: "visible-command-pointer",
    scaffoldId: "builder-attempt-compact",
  },
  {
    doc: BUILDER_RETURN_TEMPLATE_REL,
    coordinate: "## What the Orchestrator records / Validator evidence pointer",
    classification: "visible-command-pointer",
    scaffoldId: "validator-builder-evidence",
  },
  {
    doc: BUILDER_WORK_PACKET_TEMPLATE_REL,
    coordinate: "## Packet slots / dynamic Builder packet body",
    classification: "removed",
    forbiddenText: "batch_contract:\n  id: <slug>",
  },
  {
    doc: BUILDER_WORK_PACKET_TEMPLATE_REL,
    coordinate: "## Return envelope / Builder return pointer",
    classification: "visible-command-pointer",
    scaffoldId: "builder-return-envelope",
  },
  {
    doc: BUILDER_DISPATCH_REL,
    coordinate: "## Return envelope / Builder return pointer",
    classification: "visible-command-pointer",
    scaffoldId: "builder-return-envelope",
  },
  {
    doc: BUILDER_DISPATCH_REL,
    coordinate: "## Return envelope / compact attempt pointer",
    classification: "visible-command-pointer",
    scaffoldId: "builder-attempt-compact",
  },
  {
    doc: BUILDER_DISPATCH_REL,
    coordinate: "## Replacement batches and `supersedes` / replacement pointer",
    classification: "visible-command-pointer",
    scaffoldId: "replacement-candidate-batch",
  },
  {
    doc: PROPOSER_TEMPLATE_REL,
    coordinate: "## Packet slots / dynamic Proposer packet body",
    classification: "removed",
    forbiddenText: "final_finding_row:\n  id: <finding-id>",
  },
  {
    doc: PROPOSER_TEMPLATE_REL,
    coordinate: "### Success: one candidate patch-batch / return envelope pointer",
    classification: "visible-command-pointer",
    scaffoldId: "proposer-success-envelope",
  },
  {
    doc: PROPOSER_TEMPLATE_REL,
    coordinate: "### Success: one candidate patch-batch / Candidate patch-batch pointer",
    classification: "visible-command-pointer",
    scaffoldId: "patch-proposal-candidate-batch",
  },
  {
    doc: PROPOSER_TEMPLATE_REL,
    coordinate: "### Fail-stop / return envelope pointer",
    classification: "visible-command-pointer",
    scaffoldId: "proposer-fail-stop-envelope",
  },
  {
    doc: VALIDATOR_ENVELOPE_TEMPLATE_REL,
    coordinate: "## Packet slots / dynamic Validator packet body",
    classification: "removed",
    forbiddenText: 'commit_ref_or_range: "<sha | range>"',
  },
  {
    doc: VALIDATOR_ENVELOPE_TEMPLATE_REL,
    coordinate: "## Packet slots (orchestrator → Validator) / Builder evidence pointer",
    classification: "visible-command-pointer",
    scaffoldId: "validator-builder-evidence",
  },
  {
    doc: VALIDATOR_ENVELOPE_TEMPLATE_REL,
    coordinate: "## Packet slots (orchestrator → Validator) / Inline evidence pointer",
    classification: "visible-command-pointer",
    scaffoldId: "validator-inline-evidence",
  },
  {
    doc: VALIDATOR_ENVELOPE_TEMPLATE_REL,
    coordinate: "## Return envelope / return envelope pointer",
    classification: "visible-command-pointer",
    scaffoldId: "validator-return-envelope",
  },
  {
    doc: VALIDATOR_ENVELOPE_TEMPLATE_REL,
    coordinate: "## Return envelope / finding row member list",
    classification: "removed",
    forbiddenText: "each row must be ledger-ready with `id`,",
  },
  {
    doc: VALIDATOR_ENVELOPE_TEMPLATE_REL,
    coordinate: "### Finding row schema",
    classification: "visible-command-pointer",
    scaffoldId: "ledger-finding-row",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / empty batches pointer",
    classification: "visible-command-pointer",
    scaffoldId: "ledger-empty-batches",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / lifecycle defaults pointer",
    classification: "visible-command-pointer",
    scaffoldId: "ledger-batch-lifecycle-defaults",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / empty findings pointer",
    classification: "visible-command-pointer",
    scaffoldId: "ledger-empty-findings-data",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / finding row pointer",
    classification: "visible-command-pointer",
    scaffoldId: "ledger-finding-row",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / Notes checkpoint pointer",
    classification: "visible-command-pointer",
    scaffoldId: "notes-implementation-attempt-checkpoint",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / Notes Validator wave pointer",
    classification: "visible-command-pointer",
    scaffoldId: "notes-validator-wave-completed",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / Notes version-skew pointer",
    classification: "visible-command-pointer",
    scaffoldId: "notes-runbook-version-skew-continuation",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Runtime-owned schema facts / workflow learnings pointer",
    classification: "visible-command-pointer",
    scaffoldId: "workflow-learnings-empty",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### `## Notes` implementation evidence / checkpoint pointer",
    classification: "visible-command-pointer",
    scaffoldId: "notes-implementation-attempt-checkpoint",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### `## Notes` implementation evidence / Validator wave pointer",
    classification: "visible-command-pointer",
    scaffoldId: "notes-validator-wave-completed",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Workflow Learnings entry fields",
    classification: "removed",
    forbiddenText: "Required entry fields:",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### `## Workflow Learnings` entry fields / empty state pointer",
    classification: "visible-command-pointer",
    scaffoldId: "workflow-learnings-empty",
  },
  {
    doc: LEDGER_DOC_REL,
    coordinate: "### Continuation evidence shape (U6) / version-skew pointer",
    classification: "visible-command-pointer",
    scaffoldId: "notes-runbook-version-skew-continuation",
  },
  {
    doc: STAGE_4_BATCH_LOOP_REL,
    coordinate: "### Packet rendering for Stage 4 dispatch / patch proposal pointer",
    classification: "visible-command-pointer",
    scaffoldId: "patch-proposal-candidate-batch",
  },
  {
    doc: FINDINGS_AND_VALIDATORS_REL,
    coordinate: "## Validator invocation rules / Builder evidence pointer",
    classification: "visible-command-pointer",
    scaffoldId: "validator-builder-evidence",
  },
  {
    doc: FINDINGS_AND_VALIDATORS_REL,
    coordinate: "## Validator invocation rules / inline evidence pointer",
    classification: "visible-command-pointer",
    scaffoldId: "validator-inline-evidence",
  },
  {
    doc: FINDINGS_AND_VALIDATORS_REL,
    coordinate: "## Validator invocation rules / finding row pointer",
    classification: "visible-command-pointer",
    scaffoldId: "ledger-finding-row",
  },
  {
    doc: FINDINGS_AND_VALIDATORS_REL,
    coordinate: "## Validator invocation rules / finding row member list",
    classification: "removed",
    forbiddenText: "A non-empty finding is ledger-ready only when it has `id`,",
  },
];

/**
 * Return scaffold inventory classifications for coverage tests.
 *
 * This module owns the inventory; callers receive a read-only view for
 * inspection, not a second source of truth.
 */
export function scaffoldInventoryClassifications(): readonly ScaffoldInventoryEntry[] {
  return SCAFFOLD_INVENTORY;
}

function visibleCommandSurfaces(): ScaffoldSurface[] {
  const byDoc = new Map<string, string[]>();
  for (const entry of SCAFFOLD_INVENTORY) {
    if (entry.classification !== "visible-command-pointer" || !entry.scaffoldId)
      continue;
    const ids = byDoc.get(entry.doc) ?? [];
    ids.push(entry.scaffoldId);
    byDoc.set(entry.doc, ids);
  }
  return [...byDoc].map(([doc, ids]) => ({ doc, ids }));
}

const VISIBLE_SCAFFOLD_COMMAND_SURFACES = visibleCommandSurfaces();

/**
 * Returns the set of scaffold ids referenced by the visible-command-pointer
 * inventory. A scaffold id in {@link SCAFFOLD_IDS} absent from this set has
 * no drift enforcement — see the SSOT exhaustiveness test in
 * `contract-drift.test.ts`.
 */
export function scaffoldIdsCoveredBySurfaces(): Set<string> {
  const covered = new Set<string>();
  for (const surface of VISIBLE_SCAFFOLD_COMMAND_SURFACES) {
    for (const id of surface.ids) covered.add(id);
  }
  return covered;
}

const SCAFFOLD_COMMAND_SURFACE_RELS = [
  ...new Set(VISIBLE_SCAFFOLD_COMMAND_SURFACES.map((surface) => surface.doc)),
] as const;
/** Just the guide's basename, for matching markdown links to it. */
const GOTCHAS_GUIDE_BASENAME = "first-run-gotchas.md";
const WORKFLOW_LEARNING_SCAN_BASENAME = "workflow-learning-scan.md";

/**
 * A `blocked-` route TRIGGER. Matched as the literal `blocked-` prefix with a
 * LEFT word boundary: not preceded by a word char or hyphen. The left-boundary
 * anchor is what stops `unblocked-state` from counting (a batch-3 reviewer
 * mutation): the `n` before `blocked` fails `(?<![\w-])`. We deliberately do
 * NOT require a trailing kebab segment, because the canonical step-7b construct
 * uses the BARE prefix ("`data.route_id` begins with `blocked-`"), where the
 * inline-code backtick immediately follows `blocked-`. This is a structural
 * shape, not a route-id list (AC5): it never enumerates which blocked routes
 * exist.
 */
const BLOCKED_ROUTE_TRIGGER = /(?<![\w-])blocked-/;

/** A load/loads verb near the trigger — the construct must EXPRESS loading. */
const LOAD_VERB = /\bload(?:s|ed|ing)?\b/i;

/**
 * Does a bounded region reference the guide, by full repo-relative path OR by
 * its (unambiguous-in-scope) basename? Accepting the basename keeps a
 * legitimate `first-run-gotchas.md` link from reading as a missing-7b finding
 * (a batch-3 reviewer false positive).
 */
function regionMentionsGuide(region: string): boolean {
  return (
    region.includes(GOTCHAS_GUIDE_REL) || region.includes(GOTCHAS_GUIDE_BASENAME)
  );
}

type NumberedStepBlock = {
  readonly line: number;
  readonly body: string;
};

/**
 * Split numbered orchestration steps into bounded blocks. The first line must
 * start with a numbered/lettered step marker like `7b.` or `8.`, and the block
 * runs until the next step marker or blank line.
 */
function numberedStepBlocks(text: string): NumberedStepBlock[] {
  const lines = text.split("\n");
  const stepMarker = /^\s*\d+[a-z]?\.\s/;
  const blocks: NumberedStepBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!stepMarker.test(lines[i] ?? "")) {
      i += 1;
      continue;
    }
    // Collect this step block: the marker line plus continuation lines, up to
    // the next step marker or a blank line (paragraph / list-item boundary).
    const block: string[] = [lines[i] ?? ""];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (next.trim() === "" || stepMarker.test(next)) break;
      block.push(next);
      j += 1;
    }
    blocks.push({ line: i + 1, body: block.join("\n") });
    i = j;
  }
  return blocks;
}

function isBlockedGotchasLoadStep(block: NumberedStepBlock): boolean {
  return (
    BLOCKED_ROUTE_TRIGGER.test(block.body) &&
    LOAD_VERB.test(block.body) &&
    regionMentionsGuide(block.body)
  );
}

function isRemainingPreStageGateStep(block: NumberedStepBlock): boolean {
  return /\b(?:honou?r|apply)\b[\s\S]{0,80}\bremaining\s+pre-stage gates\b/i.test(
    block.body,
  );
}

/**
 * True when the deterministic blocked-route gotchas load happens before the
 * step that applies remaining pre-stage gates. Existence alone is not enough:
 * moving the load after that gate would make `blocked-runbook-version-skew`
 * stop before recovery context was loaded.
 */
function blockedGotchasLoadPrecedesRemainingGates(text: string): boolean {
  const steps = numberedStepBlocks(text);
  const load = steps.find(isBlockedGotchasLoadStep);
  const gate = steps.find(isRemainingPreStageGateStep);
  return load !== undefined && gate !== undefined && load.line < gate.line;
}

function regionAroundLabel(text: string, labelPattern: RegExp): string | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s+/.test(line) && labelPattern.test(line)) {
      start = i;
      break;
    }
    if (/^\s*\*\*[^*]+?\*\*\s*$/.test(line) && labelPattern.test(line)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const body: string[] = [lines[start] ?? ""];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s+/.test(line) || /^\s*\*\*[^*]+?\*\*\s*$/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function versionSkewGateLoadsGotchasBeforeStop(text: string): boolean {
  const region = regionAroundLabel(text, /runbook version skew|version-skew gate/i);
  if (region === null || !regionMentionsGuide(region)) return false;

  return (
    /\bload(?:s|ed|ing)?\b[\s\S]{0,120}(?:blocked-route overlay|first-run-gotchas\.md)[\s\S]{0,120}\bstop\b/i.test(
      region,
    ) ||
    /\bstop\b[\s\S]{0,80}\bafter\s+load(?:s|ed|ing)?\b[\s\S]{0,120}(?:blocked-route overlay|first-run-gotchas\.md)/i.test(
      region,
    )
  );
}

function docPreservesGotchasLoadBeforeStops(text: string): boolean {
  return (
    blockedGotchasLoadPrecedesRemainingGates(text) &&
    versionSkewGateLoadsGotchasBeforeStop(text)
  );
}

/**
 * The body of ledger-and-helper.md's blocked-route section: the text from the
 * `Blocked route ids` heading up to the next same-or-higher markdown heading.
 * Returns null when no such heading exists. The heading match tolerates
 * reasonable casing/spacing variants of "blocked route ids" (the live heading
 * is "### Blocked route ids") without over-engineering.
 */
function blockedRouteSection(ledgerText: string): string | null {
  const lines = ledgerText.split("\n");
  const headingRe = /^(#{1,6})\s+blocked\s+route\s+ids\b/i;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = headingRe.exec(lines[i] ?? "");
    if (m) {
      start = i;
      level = m[1]?.length ?? 0;
      break;
    }
  }
  if (start === -1) return null;
  const closingRe = new RegExp(`^#{1,${level}}\\s`);
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (closingRe.test(lines[i] ?? "")) break;
    body.push(lines[i] ?? "");
  }
  return body.join("\n");
}

/**
 * Read a scoped doc the check is asked to READ, throwing a clear,
 * doc-naming error when it is absent. A missing scoped doc is a HARD ERROR
 * (throw), per Key Decision 8 / AC1: the check was told this doc is in scope,
 * so its absence is an environment/scope failure, NOT doc drift and NOT a clean
 * result. (A missing LINK TARGET inside a doc that DOES exist is a finding,
 * handled separately.)
 *
 * `context` lets the two call sites carry slightly different prose (the gotchas
 * relationship check vs. the orchestrator's per-doc loop) while sharing one
 * existence-check + read implementation, so the missing-doc-throws behavior can
 * never drift between them.
 */
async function readScopedDocOrThrow(
  absPath: string,
  relLabel: string,
  context: string,
): Promise<string> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    throw new Error(
      `${context}: required scoped doc "${relLabel}" is missing at ${absPath} — a missing scoped doc is a hard error, not a clean result.`,
    );
  }
  return file.text();
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract a markdown section body by heading-label pattern. Returns `null`
 * when no matching heading exists so callers can emit a section-missing
 * finding rather than silently scan the whole document (which would let
 * unrelated mentions of the same tokens hide a structural rename).
 */
function markdownSectionByHeadingPattern(
  text: string,
  headingPattern: RegExp,
): string | null {
  return markdownSectionRegionByHeadingPattern(text, headingPattern)?.body ?? null;
}

type MarkdownSectionRegion = {
  body: string;
  startLine: number;
};

function markdownSectionRegionByHeadingPattern(
  text: string,
  headingPattern: RegExp,
): MarkdownSectionRegion | null {
  const lines = text.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i] ?? "");
    if (!match || !headingPattern.test(match[2] ?? "")) continue;
    start = i + 1;
    level = match[1]?.length ?? 0;
    break;
  }
  if (start === -1) return null;

  const closingRe = new RegExp(`^#{1,${level}}\\s`);
  const body: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (closingRe.test(lines[i] ?? "")) break;
    body.push(lines[i] ?? "");
  }
  return { body: body.join("\n"), startLine: start + 1 };
}

/** Extract a markdown section body by exact heading label, or `null`. */
function markdownSection(text: string, headingLabel: string): string | null {
  return markdownSectionByHeadingPattern(
    text,
    new RegExp(`^${escapeRegExp(headingLabel)}$`, "i"),
  );
}

function regionMentionsContractSliceCommand(
  region: string,
  slice: string,
): boolean {
  const commandRe = new RegExp(
    `cli\\.ts\\s+contract\\s+${escapeRegExp(slice)}\\s+--json`,
  );
  return commandRe.test(region);
}

/**
 * Options for the U7 ledger lifecycle field drift check.
 *
 * @example
 * ```typescript
 * await checkLedgerLifecycleFieldDrift({ repoRoot: "/repo" });
 * ```
 */
export type LedgerLifecycleFieldDriftOptions = {
  /** Repo root that ledger docs resolve against. */
  repoRoot?: string;
  /** CLI path forwarded to live contract-slice reads. */
  cliPath?: string;
};

/**
 * Cross-check ledger schema docs against live CLI facts.
 *
 * @param opts - Optional repo root override for fixture tests.
 * @returns Drift findings. Empty means the helper reference points at emitted
 * schema slices.
 *
 * @example
 * ```typescript
 * const findings = await checkLedgerLifecycleFieldDrift();
 * if (findings.length > 0) console.error(findings);
 * ```
 */
export async function checkLedgerLifecycleFieldDrift(
  opts: LedgerLifecycleFieldDriftOptions = {},
): Promise<DriftFinding[]> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const cliPath = opts.cliPath ?? defaultCliPath();
  const findings: DriftFinding[] = [];
  const facts = await loadContractFacts({ cliPath });
  const pointerSlices = facts.ledgerSchemaPointerSlices;

  const ledgerText = await readScopedDocOrThrow(
    join(repoRoot, LEDGER_DOC_REL),
    LEDGER_DOC_REL,
    "contract-drift ledger lifecycle field check",
  );

  const schemaFactsSection = markdownSectionByHeadingPattern(
    ledgerText,
    /runtime-owned schema facts/i,
  );
  if (schemaFactsSection === null) {
    findings.push({
      doc: LEDGER_DOC_REL,
      kind: "ledger-schema-slice-pointer",
      claim: "Runtime-owned schema facts",
      reason: `ledger-and-helper.md is missing the runtime-owned schema facts section; ledger schema slice pointers cannot be checked.`,
    });
  }

  for (const slice of pointerSlices) {
    if (
      schemaFactsSection !== null &&
      !regionMentionsContractSliceCommand(schemaFactsSection, slice)
    ) {
      findings.push({
        doc: LEDGER_DOC_REL,
        kind: "ledger-schema-slice-pointer",
        claim: slice,
        reason: `ledger-and-helper.md runtime-owned schema facts section does not point to \`cli.ts contract ${slice} --json\`.`,
      });
    }
  }

  return findings;
}

type GeneratedScaffoldBlock = {
  id: string;
  source: string;
  body: string | null;
  line: number;
  startIndex: number;
  endIndex: number;
  malformedReason?: string;
};

type ScaffoldPointer = {
  id: string;
  source: string;
  line: number;
  malformedReason?: string;
};
type ScaffoldMarker = {
  id: string;
  line: number;
};
type YamlFence = {
  body: string;
  line: number;
  startIndex: number;
  endIndex: number;
};

// Marker regexes are intentionally LENIENT — they accept case variants on the
// marker name, either quote style on the `source=...` attribute, and any
// trailing attribute soup before the closing `-->`. The point is to refuse to
// silently ignore a near-match; once captured, `buildScaffoldMarkerSummary`
// classifies the marker as well-formed or malformed and the inventory check
// surfaces both as drift findings.
const GENERATED_SCAFFOLD_START_LOOSE_RE =
  /<!--\s*generated-scaffold:start\b([^>]*?)-->/gi;
const SCAFFOLD_POINTER_LOOSE_RE = /<!--\s*scaffold-pointer\b([^>]*?)-->/gi;
const SCAFFOLD_MARKER_ID_RE = /\bid\s*=\s*([A-Za-z0-9_-]+)\b/i;
const SCAFFOLD_MARKER_SOURCE_RE = /\bsource\s*=\s*("([^"]*)"|'([^']*)')/i;

function expectedGeneratedScaffoldSource(id: string): string {
  return `cli.ts scaffold ${id} --json`;
}

function generatedScaffoldEndRe(id: string): RegExp {
  return new RegExp(
    `<!--\\s*generated-scaffold:end\\s+id=${escapeRegExp(id)}\\s*-->`,
    "i",
  );
}

// Active templates must be pointer-only; any fenced YAML body — regardless of
// language-token casing (` ```YAML `), trailing info-string (` ```yaml:foo `),
// or CRLF line endings emitted by Windows or GitHub web UIs — is treated as a
// reintroduction attempt. The detector is case-insensitive on the language tag
// and accepts `\r?\n` on both fence boundaries.
const YAML_FENCE_RE = /```ya?ml\b[^\r\n]*\r?\n([\s\S]*?)\r?\n```/gi;

function parseGeneratedScaffoldRegion(region: string): {
  body: string | null;
  malformedReason?: string;
} {
  const fenceRe = new RegExp(YAML_FENCE_RE.source, YAML_FENCE_RE.flags);
  const fences = [...region.matchAll(fenceRe)];
  if (fences.length === 0) {
    return {
      body: null,
      malformedReason: "missing fenced yaml body",
    };
  }
  if (fences.length !== 1) {
    return {
      body: null,
      malformedReason: `expected exactly one fenced yaml body, found ${fences.length}`,
    };
  }

  const fence = fences[0];
  const fenceStart = fence.index ?? 0;
  const fenceEnd = fenceStart + fence[0].length;
  if (region.slice(0, fenceStart).trim().length > 0) {
    return {
      body: null,
      malformedReason: "non-whitespace content before fenced yaml body",
    };
  }
  if (region.slice(fenceEnd).trim().length > 0) {
    return {
      body: null,
      malformedReason: "non-whitespace content after fenced yaml body",
    };
  }

  return { body: `${fence[1] ?? ""}\n` };
}

/**
 * Decompose a loose marker match into its `id`, `source`, and any malformed
 * reason. Returns:
 *   - `id` empty string when the marker has no `id=...` attribute (or one with
 *     non-identifier characters);
 *   - `source` empty string when no `source=...` attribute is present;
 *   - `malformedReason` populated when the marker deviates from the canonical
 *     shape (` <!-- name id=foo source="bar" --> ` with lowercase name and
 *     double-quoted source). A populated reason still surfaces the marker as a
 *     finding so contributors get a tripwire instead of silent acceptance.
 */
function parseMarkerAttributes(
  markerName: string,
  rawMatch: string,
  attributePayload: string,
): { id: string; source: string; malformedReason?: string } {
  const reasons: string[] = [];
  const idMatch = SCAFFOLD_MARKER_ID_RE.exec(attributePayload);
  const id = idMatch?.[1] ?? "";
  if (!idMatch) {
    reasons.push("missing or non-identifier `id=...`");
  }
  const sourceMatch = SCAFFOLD_MARKER_SOURCE_RE.exec(attributePayload);
  const source = sourceMatch
    ? (sourceMatch[2] ?? sourceMatch[3] ?? "")
    : "";
  if (!sourceMatch) {
    reasons.push("missing `source=...` attribute");
  } else if (sourceMatch[3] !== undefined) {
    reasons.push("source attribute uses single-quoted scalar");
  }
  // Detect case drift on the marker name (lowercase is canonical).
  const nameMatch = new RegExp(`^<!--\\s*(${markerName})\\b`, "i").exec(
    rawMatch,
  );
  if (nameMatch && nameMatch[1] !== markerName) {
    reasons.push(`marker name "${nameMatch[1]}" must be lowercase`);
  }
  // Anything beyond `id` and `source` is unrecognised in pointer-only mode.
  const leftover = attributePayload
    .replace(SCAFFOLD_MARKER_ID_RE, "")
    .replace(SCAFFOLD_MARKER_SOURCE_RE, "")
    .trim();
  if (leftover.length > 0) {
    reasons.push(`unrecognised trailing attribute(s): ${leftover}`);
  }
  return {
    id,
    source,
    malformedReason: reasons.length > 0 ? reasons.join("; ") : undefined,
  };
}

function extractGeneratedScaffoldBlocks(text: string): GeneratedScaffoldBlock[] {
  const blocks: GeneratedScaffoldBlock[] = [];
  for (const match of text.matchAll(GENERATED_SCAFFOLD_START_LOOSE_RE)) {
    const attrs = parseMarkerAttributes(
      "generated-scaffold:start",
      match[0] ?? "",
      match[1] ?? "",
    );
    const id = attrs.id;
    const source = attrs.source;
    const startIndex = match.index ?? 0;
    const bodyStart = startIndex + (match[0]?.length ?? 0);
    const startReason = attrs.malformedReason;
    // The end-marker search only runs when we have an id to anchor against.
    const endMatch = id
      ? generatedScaffoldEndRe(id).exec(text.slice(bodyStart))
      : null;
    if (!endMatch || endMatch.index === undefined) {
      blocks.push({
        id,
        source,
        body: null,
        line: lineOf(text, startIndex),
        startIndex,
        endIndex: text.length,
        malformedReason:
          startReason ?? "missing generated-scaffold end marker",
      });
      continue;
    }

    const region = text.slice(bodyStart, bodyStart + endMatch.index);
    const endIndex = bodyStart + endMatch.index + endMatch[0].length;
    const parsed = parseGeneratedScaffoldRegion(region);
    if (parsed.body === null) {
      blocks.push({
        id,
        source,
        body: null,
        line: lineOf(text, startIndex),
        startIndex,
        endIndex,
        malformedReason: startReason ?? parsed.malformedReason,
      });
      continue;
    }

    blocks.push({
      id,
      source,
      body: parsed.body,
      line: lineOf(text, startIndex),
      startIndex,
      endIndex,
      malformedReason: startReason,
    });
  }
  return blocks;
}

function extractScaffoldPointers(text: string): ScaffoldPointer[] {
  const pointers: ScaffoldPointer[] = [];
  for (const match of text.matchAll(SCAFFOLD_POINTER_LOOSE_RE)) {
    const attrs = parseMarkerAttributes(
      "scaffold-pointer",
      match[0] ?? "",
      match[1] ?? "",
    );
    pointers.push({
      id: attrs.id,
      source: attrs.source,
      line: lineOf(text, match.index ?? 0),
      malformedReason: attrs.malformedReason,
    });
  }
  return pointers;
}

function extractYamlFences(text: string): YamlFence[] {
  const fences: YamlFence[] = [];
  const fenceRe = new RegExp(YAML_FENCE_RE.source, YAML_FENCE_RE.flags);
  for (const match of text.matchAll(fenceRe)) {
    const startIndex = match.index ?? 0;
    fences.push({
      body: `${match[1] ?? ""}\n`,
      line: lineOf(text, startIndex),
      startIndex,
      endIndex: startIndex + match[0].length,
    });
  }
  return fences;
}

/** Options for scaffold inventory drift checks. */
export type ScaffoldInventoryDriftOptions = {
  /** Repo root used for scoped doc reads. */
  repoRoot?: string;
  /** Runtime scaffold ids to compare against; defaults to `SCAFFOLD_IDS`. */
  scaffoldIds?: readonly string[];
};

/**
 * Check scaffold inventory entries and pointer-only template surfaces.
 *
 * Returns a fresh findings array owned by the caller. Empty means inventory
 * ids, hidden markers, retired generated blocks, and active template YAML
 * surfaces match the runtime-owned scaffold contract.
 */
export async function checkScaffoldInventoryDrift(
  opts: ScaffoldInventoryDriftOptions = {},
): Promise<DriftFinding[]> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const runtimeScaffoldIds = new Set(opts.scaffoldIds ?? SCAFFOLD_IDS);
  const findings: DriftFinding[] = [];

  for (const entry of SCAFFOLD_INVENTORY) {
    if (
      entry.classification === "visible-command-pointer" &&
      entry.scaffoldId &&
      !runtimeScaffoldIds.has(entry.scaffoldId)
    ) {
      findings.push({
        doc: entry.doc,
        kind: "scaffold-inventory",
        claim: entry.scaffoldId,
        reason: `${entry.classification} inventory entry at ${entry.coordinate} names a scaffold id absent from the runtime catalog.`,
      });
    }
  }

  const docs = [...new Set(SCAFFOLD_INVENTORY.map((entry) => entry.doc))];
  for (const doc of docs) {
    const text = await readScopedDocOrThrow(
      join(repoRoot, doc),
      doc,
      "contract-drift scaffold inventory check",
    );
    const entries = SCAFFOLD_INVENTORY.filter((entry) => entry.doc === doc);
    const generatedBlocks = extractGeneratedScaffoldBlocks(text);
    const hiddenPointers = extractScaffoldPointers(text);
    const yamlFences = extractYamlFences(text);

    for (const block of generatedBlocks) {
      const suffix = block.malformedReason
        ? ` (malformed marker: ${block.malformedReason})`
        : "";
      findings.push({
        doc,
        kind: "scaffold-inventory",
        claim: block.id || "<malformed-generated-scaffold-marker>",
        line: block.line,
        reason: `generated-scaffold marker reintroduced in an active scoped surface; active templates must be pointer-only.${suffix}`,
      });
    }

    for (const pointer of hiddenPointers) {
      const suffix = pointer.malformedReason
        ? ` (malformed marker: ${pointer.malformedReason})`
        : "";
      findings.push({
        doc,
        kind: "scaffold-inventory",
        claim: pointer.id || "<malformed-scaffold-pointer>",
        line: pointer.line,
        reason: `hidden scaffold-pointer marker reintroduced in an active scoped surface; use a visible \`cli.ts scaffold <id> --json\` pointer instead.${suffix}`,
      });
    }

    for (const entry of entries) {
      if (entry.classification === "removed" && entry.forbiddenText) {
        const detector = buildForbiddenTextDetector(entry.forbiddenText);
        const hit = detector.exec(text);
        if (hit) {
          findings.push({
            doc,
            kind: "scaffold-inventory",
            claim: entry.coordinate,
            line: lineOf(text, hit.index ?? 0),
            reason: `removed scaffold surface reappeared; structural detector matched (sentinel: ${entry.forbiddenText}).`,
          });
        }
      }
    }

    if (isActiveTemplateDoc(doc)) {
      for (const fence of yamlFences) {
        findings.push({
          doc,
          kind: "scaffold-inventory",
          claim: "unclassified-yaml-fence",
          line: fence.line,
          reason:
            "fenced YAML block found in an active template; active templates must be pointer-only.",
        });
      }
    }
  }

  return findings;
}

function isActiveTemplateDoc(doc: string): boolean {
  return doc.startsWith("runbooks/issue-to-pr-v2/templates/");
}

function scaffoldMarkers(text: string): ScaffoldMarker[] {
  return [
    ...extractGeneratedScaffoldBlocks(text).map((block) => ({
      id: block.id,
      line: block.line,
    })),
    ...extractScaffoldPointers(text).map((pointer) => ({
      id: pointer.id,
      line: pointer.line,
    })),
  ].sort((a, b) => a.line - b.line);
}

function checkVisibleScaffoldCommands(
  text: string,
  doc: string,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const markers = scaffoldMarkers(text);

  for (const claim of extractDocClaims(text, doc).scaffoldCommands) {
    if (!isScaffoldId(claim.token)) {
      findings.push({
        doc,
        kind: "scaffold-command",
        claim: claim.token,
        line: claim.line,
        reason: `visible scaffold command names unknown scaffold id "${claim.token}".`,
      });
      continue;
    }

    const nextMarker = markers.find(
      (marker) => marker.line > claim.line && marker.line - claim.line <= 3,
    );
    if (nextMarker && nextMarker.id !== claim.token) {
      findings.push({
        doc,
        kind: "scaffold-command",
        claim: claim.token,
        line: claim.line,
        reason: `visible scaffold command names "${claim.token}", but the adjacent scaffold marker names "${nextMarker.id}".`,
      });
    }
  }

  return findings;
}

function headingLabelFromCoordinate(coordinate: string): string {
  const raw = coordinate.split("/")[0]?.trim() ?? coordinate.trim();
  return raw.replace(/^#{1,6}\s+/, "").trim();
}

function visibleCommandSourceMatches(context: string, scaffoldId: string): boolean {
  const commandRe = new RegExp(
    `\\bcli\\.ts\\s+scaffold\\s+${escapeRegExp(scaffoldId)}\\s+--json\\b`,
  );
  return commandRe.test(context);
}

function checkVisibleCommandPointerEntry(
  text: string,
  entry: ScaffoldInventoryEntry,
): DriftFinding[] {
  if (!entry.scaffoldId) return [];

  const headingLabel = headingLabelFromCoordinate(entry.coordinate);
  const section = markdownSectionRegionByHeadingPattern(
    text,
    new RegExp(`^${escapeRegExp(headingLabel)}$`, "i"),
  );
  if (section === null) {
    return [
      {
        doc: entry.doc,
        kind: "scaffold-command",
        claim: entry.scaffoldId,
        reason: `visible scaffold command pointer at ${entry.coordinate} is missing its owning section "${headingLabel}".`,
      },
    ];
  }

  const sectionClaims = extractDocClaims(section.body, entry.doc)
    .scaffoldCommands
    .map((claim) => ({
      ...claim,
      line: claim.line + section.startLine - 1,
    }));
  const expectedSource = expectedGeneratedScaffoldSource(entry.scaffoldId);
  const matching = sectionClaims.find(
    (claim) =>
      claim.token === entry.scaffoldId &&
      visibleCommandSourceMatches(claim.context, entry.scaffoldId ?? ""),
  );
  if (matching) return [];

  const sameIdWrongSource = sectionClaims.find(
    (claim) => claim.token === entry.scaffoldId,
  );
  if (sameIdWrongSource) {
    return [
      {
        doc: entry.doc,
        kind: "scaffold-command",
        claim: entry.scaffoldId,
        line: sameIdWrongSource.line,
        reason: `visible scaffold command pointer at ${entry.coordinate} names "${entry.scaffoldId}" but does not match expected source "${expectedSource}".`,
      },
    ];
  }

  const otherScaffold = sectionClaims[0];
  return [
    {
      doc: entry.doc,
      kind: "scaffold-command",
      claim: otherScaffold?.token ?? entry.scaffoldId,
      line: otherScaffold?.line,
      reason:
        otherScaffold === undefined
          ? `visible scaffold command pointer at ${entry.coordinate} is missing expected source "${expectedSource}".`
          : `visible scaffold command pointer at ${entry.coordinate} names "${otherScaffold.token}", expected "${entry.scaffoldId}".`,
    },
  ];
}

function checkVisibleCommandPointers(
  text: string,
  entries: readonly ScaffoldInventoryEntry[],
): DriftFinding[] {
  return entries.flatMap((entry) =>
    entry.classification === "visible-command-pointer"
      ? checkVisibleCommandPointerEntry(text, entry)
      : [],
  );
}

/** Options for generated scaffold and visible pointer drift checks. */
export type GeneratedScaffoldDriftOptions = {
  /** Repo root used for scoped doc reads. */
  repoRoot?: string;
};

/**
 * Run the full scaffold drift surface for active docs.
 *
 * Returns a fresh findings array owned by the caller. Empty means active docs
 * use visible `cli.ts scaffold` pointers that resolve to runtime scaffold ids,
 * with no retired generated blocks or hidden pointer markers.
 */
export async function checkGeneratedScaffoldBlocksDrift(
  opts: GeneratedScaffoldDriftOptions = {},
): Promise<DriftFinding[]> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const findings: DriftFinding[] = await checkScaffoldInventoryDrift({
    repoRoot,
  });

  for (const surface of VISIBLE_SCAFFOLD_COMMAND_SURFACES) {
    const text = await readScopedDocOrThrow(
      join(repoRoot, surface.doc),
      surface.doc,
      "contract-drift visible scaffold command pointer check",
    );
    const entries = SCAFFOLD_INVENTORY.filter(
      (entry) =>
        entry.doc === surface.doc &&
        entry.classification === "visible-command-pointer",
    );
    findings.push(...checkVisibleCommandPointers(text, entries));
  }

  for (const doc of SCAFFOLD_COMMAND_SURFACE_RELS) {
    const text = await readScopedDocOrThrow(
      join(repoRoot, doc),
      doc,
      "contract-drift scaffold command check",
    );
    findings.push(...checkVisibleScaffoldCommands(text, doc));
  }

  return findings;
}

/**
 * Verify the deterministic control-plane relationship the Issue-to-PR v2
 * workflow relies on for the first-run-gotchas guide (Key Decision 7). Returns
 * structured drift findings (DATA); a present, intact relationship yields an
 * empty array. Three relationship facts are checked:
 *
 *  (a) `skills/issue-to-pr/SKILL.md` and `issue-to-pr.md` carry the
 *      deterministic control-plane load of the guide for `blocked-` routes
 *      before remaining pre-stage gates, plus version-skew wording that loads
 *      recovery context before stopping. This is anchored STRUCTURALLY, not by
 *      whole-doc co-occurrence.
 *  (b) `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` links from its
 *      route-id / blocked-route section to the guide: the doc's blocked-route
 *      section region (the heading through the next same-or-higher heading)
 *      must itself contain a markdown link to `first-run-gotchas.md`. A guide
 *      link that lives only in some OTHER section (e.g. a cross-references
 *      footer) does not satisfy the relationship.
 *  (c) every markdown link to `first-run-gotchas.md` in those scoped docs
 *      resolves to an existing file on disk.
 *
 * The check does NOT require per-route deep links, and does NOT require or
 * forbid the guide in CLI `required_reference_ids` (Key Decision 7).
 *
 * Hard-error boundary (Key Decision 8): SKILL.md, issue-to-pr.md, and
 * ledger-and-helper.md are docs the check is asked to READ, so their absence
 * throws. A missing LINK TARGET (the guide file a doc links to) is a finding,
 * not a throw.
 */
export async function checkGotchasRelationship(
  opts: GotchasRelationshipOptions = {},
): Promise<DriftFinding[]> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const findings: DriftFinding[] = [];

  const skillText = await readScopedDocOrThrow(
    join(repoRoot, SKILL_DOC_REL),
    SKILL_DOC_REL,
    "contract-drift gotchas check",
  );
  const issueToPrText = await readScopedDocOrThrow(
    join(repoRoot, ISSUE_TO_PR_DOC_REL),
    ISSUE_TO_PR_DOC_REL,
    "contract-drift gotchas check",
  );
  const ledgerText = await readScopedDocOrThrow(
    join(repoRoot, LEDGER_DOC_REL),
    LEDGER_DOC_REL,
    "contract-drift gotchas check",
  );

  // (a) Deterministic control-plane load in SKILL.md and issue-to-pr.md for
  // blocked- routes, anchored on ordered orchestration steps. Some numbered step
  // must tie a `blocked-` trigger to LOADING the guide, and it must occur before
  // the remaining pre-stage gates. The version-skew section must also express
  // load-before-stop semantics. Doc-level finding: no `0` line sentinel.
  for (const [relDoc, text] of [
    [SKILL_DOC_REL, skillText],
    [ISSUE_TO_PR_DOC_REL, issueToPrText],
  ] as const) {
    if (!docPreservesGotchasLoadBeforeStops(text)) {
      findings.push({
        doc: relDoc,
        kind: "scoped-link",
        claim: GOTCHAS_GUIDE_REL,
        reason:
          `${relDoc} must load first-run-gotchas.md for \`blocked-\` routes before remaining pre-stage gates and before the version-skew stop; the ordered gotchas relationship is missing or out of order.`,
      });
    }
  }

  // (b) ledger-and-helper.md links from its blocked-route-ids section to the
  // guide. The guide link must live INSIDE the blocked-route section's region
  // (heading through the next same-or-higher heading), not merely somewhere in
  // the doc — a link in a cross-references footer does not satisfy Key Decision
  // 7's "links from its blocked-route section" requirement. Doc-level finding,
  // so `line` is omitted.
  const ledgerBlockedSection = blockedRouteSection(ledgerText);
  const guideLinkRe = new RegExp(
    `\\]\\(\\s*${GOTCHAS_GUIDE_BASENAME.replace(/\./g, "\\.")}`,
  );
  const ledgerSectionLinksGuide =
    ledgerBlockedSection !== null && guideLinkRe.test(ledgerBlockedSection);
  if (!ledgerSectionLinksGuide) {
    findings.push({
      doc: LEDGER_DOC_REL,
      kind: "scoped-link",
      claim: GOTCHAS_GUIDE_BASENAME,
      reason:
        "ledger-and-helper.md is missing the link from its blocked-route-ids section to first-run-gotchas.md (the section region itself must contain the guide link, not just the doc).",
    });
  }

  // (c) every markdown link to first-run-gotchas.md in the scoped docs
  // resolves to an existing file. A broken target is a finding (Key Decision
  // 8), not a hard error.
  for (const [relDoc, text] of [
    [SKILL_DOC_REL, skillText],
    [ISSUE_TO_PR_DOC_REL, issueToPrText],
    [LEDGER_DOC_REL, ledgerText],
  ] as const) {
    for (const link of extractScopedLinks(text, relDoc)) {
      if (!link.resolvedTarget.endsWith(GOTCHAS_GUIDE_BASENAME)) continue;
      const abs = join(repoRoot, link.resolvedTarget);
      if (!(await pathExists(abs))) {
        findings.push({
          doc: relDoc,
          kind: "scoped-link",
          claim: link.resolvedTarget,
          line: link.line,
          reason: `link to first-run-gotchas.md resolves to \`${link.resolvedTarget}\`, which does not exist on disk.`,
        });
      }
    }
  }

  return findings;
}

export type WorkflowLearningScanRelationshipOptions = {
  repoRoot?: string;
};

function regionMentionsWorkflowLearningScan(region: string): boolean {
  return (
    region.includes(WORKFLOW_LEARNING_SCAN_REL) ||
    region.includes(WORKFLOW_LEARNING_SCAN_BASENAME)
  );
}

function firstMatchIndex(text: string, pattern: RegExp): number {
  return text.search(pattern);
}

function orderedMatch(text: string, first: RegExp, second: RegExp): boolean {
  const firstIndex = firstMatchIndex(text, first);
  const secondIndex = firstMatchIndex(text, second);
  return firstIndex !== -1 && secondIndex !== -1 && firstIndex < secondIndex;
}

function shipScanStep(step: string): boolean {
  return (
    /\bload(?:s|ed|ing)?\b/i.test(step) &&
    regionMentionsWorkflowLearningScan(step) &&
    orderedMatch(step, /\bPR URL\b|\bpr_url\b/i, /\bship\b|\bread-only\b/i)
  );
}

function failStopScanStep(step: string): boolean {
  return (
    /\bload(?:s|ed|ing)?\b/i.test(step) &&
    regionMentionsWorkflowLearningScan(step) &&
    /fail-stop|fail_stop/i.test(step)
  );
}

function skillRoutesToWorkflowLearningScan(text: string): boolean {
  const steps = numberedStepBlocks(text).map((step) => step.body);
  return steps.some(shipScanStep) && steps.some(failStopScanStep);
}

function hotRouterRoutesToWorkflowLearningScan(text: string): boolean {
  const startSection = markdownSection(text, "Start every turn");
  if (startSection === null) return false;
  const steps = numberedStepBlocks(startSection).map((step) => step.body);
  return steps.some(shipScanStep) && steps.some(failStopScanStep);
}

function stageSixPointsToWorkflowLearningScan(text: string): boolean {
  const actions = markdownSection(text, "Actions");
  if (actions === null) return false;
  const steps = numberedStepBlocks(actions).map((step) => step.body);
  return steps.some(shipScanStep);
}

function scanCitesRuntimeOwners(text: string): boolean {
  return (
    text.includes(WORKFLOW_LEARNINGS_REGISTRY_REL) ||
    text.includes("workflow-learnings-registry.md")
  ) &&
    text.includes("lib/learnings.ts") &&
    /learnings-registry\.ts\s+--validate/.test(text) &&
    /learnings-registry\.ts\s+--upsert/.test(text);
}

function scanPreservesReadOnlyBoundary(text: string): boolean {
  const boundary = markdownSection(text, "Read-Only Boundary");
  if (boundary === null) return false;
  return (
    /\bdo not patch\b/i.test(boundary) &&
    /\bskills\b/i.test(boundary) &&
    /\brunbook references\b/i.test(boundary) &&
    /\bCLI\/source code\b|\bCLI code\b/i.test(boundary) &&
    /\bdocs\b/i.test(boundary) &&
    /\btarget deliverables\b/i.test(boundary) &&
    /\bgotchas\b/i.test(boundary) &&
    /\bper-issue ledger\b/i.test(boundary) &&
    /\bWorkflow Learnings registry\b/i.test(boundary)
  );
}

function scanPreservesRuntimeScaffoldBaseline(text: string): boolean {
  return (
    /cli\.ts\s+scaffold\s+workflow-learnings-empty\s+--json/.test(text) &&
    text.includes("issue-N-ledger.template.md") &&
    /do not recreate/i.test(text)
  );
}

function scanPreservesGotchasRelationship(text: string): boolean {
  const gotchas = markdownSection(text, "Gotchas Relationship");
  return (
    gotchas?.includes(GOTCHAS_GUIDE_BASENAME) === true &&
    /\brecovery\b/i.test(gotchas) &&
    /\bcross-run\b/i.test(gotchas) &&
    /\bdedupe\b/i.test(gotchas)
  );
}

/**
 * Verify the Workflow Learning Scan has one prose owner, routes from the hot
 * Issue-to-PR control plane, and delegates deterministic behavior to runtime
 * helpers.
 */
export async function checkWorkflowLearningScanRelationship(
  opts: WorkflowLearningScanRelationshipOptions = {},
): Promise<DriftFinding[]> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const findings: DriftFinding[] = [];

  const scanPath = join(repoRoot, WORKFLOW_LEARNING_SCAN_REL);
  if (!(await pathExists(scanPath))) {
    findings.push({
      doc: WORKFLOW_LEARNING_SCAN_REL,
      kind: "workflow-learning-scan",
      claim: WORKFLOW_LEARNING_SCAN_BASENAME,
      reason: "Workflow Learning Scan reference is missing.",
    });
    return findings;
  }

  const skillText = await readScopedDocOrThrow(
    join(repoRoot, SKILL_DOC_REL),
    SKILL_DOC_REL,
    "contract-drift workflow learning scan check",
  );
  const issueToPrText = await readScopedDocOrThrow(
    join(repoRoot, ISSUE_TO_PR_DOC_REL),
    ISSUE_TO_PR_DOC_REL,
    "contract-drift workflow learning scan check",
  );
  const stageSixText = await readScopedDocOrThrow(
    join(repoRoot, STAGE_6_SHIP_REL),
    STAGE_6_SHIP_REL,
    "contract-drift workflow learning scan check",
  );
  const scanText = await readScopedDocOrThrow(
    scanPath,
    WORKFLOW_LEARNING_SCAN_REL,
    "contract-drift workflow learning scan check",
  );

  if (!skillRoutesToWorkflowLearningScan(skillText)) {
    findings.push({
      doc: SKILL_DOC_REL,
      kind: "workflow-learning-scan",
      claim: WORKFLOW_LEARNING_SCAN_BASENAME,
      reason:
        "SKILL.md must load workflow-learning-scan.md for ship-time PR URL confirmation and fail-stop learning capture.",
    });
  }

  if (!hotRouterRoutesToWorkflowLearningScan(issueToPrText)) {
    findings.push({
      doc: ISSUE_TO_PR_DOC_REL,
      kind: "workflow-learning-scan",
      claim: WORKFLOW_LEARNING_SCAN_BASENAME,
      reason:
        "issue-to-pr.md must route ship-time PR URL confirmation and fail-stop learning capture to workflow-learning-scan.md.",
    });
  }

  if (!stageSixPointsToWorkflowLearningScan(stageSixText)) {
    findings.push({
      doc: STAGE_6_SHIP_REL,
      kind: "workflow-learning-scan",
      claim: WORKFLOW_LEARNING_SCAN_BASENAME,
      reason:
        "stage-6-ship.md must point to workflow-learning-scan.md in the ship path after PR URL confirmation.",
    });
  }

  if (!scanCitesRuntimeOwners(scanText)) {
    findings.push({
      doc: WORKFLOW_LEARNING_SCAN_REL,
      kind: "workflow-learning-scan",
      claim: "runtime-owner-citations",
      reason:
        "workflow-learning-scan.md must cite the registry reference, lib/learnings.ts, and learnings-registry validate/upsert helpers for deterministic behavior.",
    });
  }

  if (!scanPreservesReadOnlyBoundary(scanText)) {
    findings.push({
      doc: WORKFLOW_LEARNING_SCAN_REL,
      kind: "workflow-learning-scan",
      claim: "read-only-boundary",
      reason:
        "workflow-learning-scan.md must preserve the read-only boundary and limit writes to ledger/registry metadata.",
    });
  }

  if (!scanPreservesRuntimeScaffoldBaseline(scanText)) {
    findings.push({
      doc: WORKFLOW_LEARNING_SCAN_REL,
      kind: "workflow-learning-scan",
      claim: "runtime-owned-scaffold-baseline",
      reason:
        "workflow-learning-scan.md must point to the workflow-learnings-empty scaffold and preserve the PR #125 pointer-only template baseline.",
    });
  }

  if (!scanPreservesGotchasRelationship(scanText)) {
    findings.push({
      doc: WORKFLOW_LEARNING_SCAN_REL,
      kind: "workflow-learning-scan",
      claim: GOTCHAS_GUIDE_BASENAME,
      reason:
        "workflow-learning-scan.md must keep first-run-gotchas.md recovery-focused and keep Workflow Learnings as the lifecycle/dedupe layer.",
    });
  }

  for (const [relDoc, text] of [
    [SKILL_DOC_REL, skillText],
    [ISSUE_TO_PR_DOC_REL, issueToPrText],
    [STAGE_6_SHIP_REL, stageSixText],
    [WORKFLOW_LEARNING_SCAN_REL, scanText],
  ] as const) {
    for (const link of extractScopedLinks(text, relDoc)) {
      if (!link.resolvedTarget.endsWith(WORKFLOW_LEARNING_SCAN_BASENAME)) {
        continue;
      }
      if (!(await pathExists(join(repoRoot, link.resolvedTarget)))) {
        findings.push({
          doc: relDoc,
          kind: "workflow-learning-scan",
          claim: link.resolvedTarget,
          line: link.line,
          reason: `link to workflow-learning-scan.md resolves to \`${link.resolvedTarget}\`, which does not exist on disk.`,
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Batch 4: orchestrator + runnable entry
// ---------------------------------------------------------------------------

/**
 * One scoped doc in the check's SCOPE. `path` is the repo-relative doc to
 * validate; `expectsClaims` says whether the doc is KNOWN to carry contract
 * tokens, so an extractor that yields zero contract claims for it is a drift
 * finding (F21) rather than a silent clean pass.
 *
 * `expectsClaims` is SCOPE config (which docs carry tokens), NOT a contract
 * VALUE (AC5): it never names a route id, slice, role, or field path, and it
 * never asserts HOW MANY claims a doc has — only that SOME exist.
 */
export type ScopedDoc = {
  path: string;
  expectsClaims: boolean;
};

/**
 * Operator-facing docs the drift check is scoped to. These are structural file
 * COORDINATES (the check's SCOPE), not contract VALUES (AC5): they say WHICH
 * docs to validate, never WHAT the contract is. The contract facts themselves
 * still come exclusively from `loadContractFacts()`.
 *
 * `expectsClaims` marks docs the workflow relies on to carry contract tokens:
 * if extraction yields ZERO contract claims, that is a drift finding (F21),
 * not a silent pass.
 *
 * Repo-relative so the orchestrator can resolve them against any `repoRoot`
 * (tests point at a fixture repo; production resolves against the real root)
 * AND so `extractDocClaims` attributes claims back to the canonical path.
 */
export const SCOPED_DOCS: readonly ScopedDoc[] = [
  { path: "skills/issue-to-pr/SKILL.md", expectsClaims: true },
  { path: "runbooks/issue-to-pr-v2/README.md", expectsClaims: false },
  { path: "runbooks/issue-to-pr-v2/issue-to-pr.md", expectsClaims: true },
  {
    path: "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    expectsClaims: false,
  },
  {
    path: "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    expectsClaims: true,
  },
];

/**
 * Options for the orchestrator. All are overridable so tests can point at a
 * fixture repo / fixture doc list / fake CLI (the AC7 stale-doc test relies on
 * `repoRoot`, the missing-doc test on `scopedDocs`, the CLI-failure test on
 * `cliPath`). Production callers pass nothing and get the real five docs, the
 * real repo root, and the sibling `cli.ts`.
 */
export type CheckContractDriftOptions = {
  /** Repo root that scoped-doc paths and link targets resolve against. */
  repoRoot?: string;
  /**
   * Scoped docs to validate. Defaults to the five `SCOPED_DOCS`. Accepts either
   * bare repo-relative path strings (legacy callers / tests; treated as
   * `expectsClaims: false`) or full `ScopedDoc` entries. An explicitly-passed
   * EMPTY array is a caller error (F22): it would check zero docs and silently
   * pass, so the orchestrator throws.
   */
  scopedDocs?: readonly (string | ScopedDoc)[];
  /** CLI path forwarded to `loadContractFacts`. Defaults to sibling cli.ts. */
  cliPath?: string;
  /** Include newer scan relationship docs in addition to legacy drift surfaces. */
  includeWorkflowLearningScanRelationship?: boolean;
};

/** The orchestrator result: `ok` is true exactly when there are no findings. */
export type ContractDriftResult = {
  ok: boolean;
  findings: DriftFinding[];
};

/** Normalize a scoped-doc entry (string or object) to a `ScopedDoc`. */
function toScopedDoc(entry: string | ScopedDoc): ScopedDoc {
  return typeof entry === "string"
    ? { path: entry, expectsClaims: false }
    : entry;
}

/**
 * Count the CONTRACT-token claims a doc made (route ids, commands, slices,
 * packet roles, field paths). Scoped LINKS are deliberately excluded: the F21
 * floor protects the contract-token extractors, and README legitimately emits
 * only scoped links, so counting links would defeat the per-doc `expectsClaims`
 * distinction.
 */
function contractClaimCount(claims: DocClaims): number {
  return (
    claims.routeIds.length +
    claims.commands.length +
    claims.slices.length +
    claims.packetRoles.length +
    claims.scaffoldCommands.length +
    claims.fieldPaths.length
  );
}

/**
 * Run the runtime contract-drift check over the scoped operator docs plus
 * the ledger schema surfaces, then report aggregated drift findings.
 *
 * Pipeline (composes batches 1-3, re-implements none of them):
 *  1. Load the authoritative contract facts ONCE via `loadContractFacts()`
 *     (batch 1). A failed CLI load THROWS (hard error, AC6 / Key Decision 8) —
 *     never swallowed into a clean result.
 *  2. For EACH scoped doc: read its text (missing → hard error), extract its
 *     claims (batch 2), compare them to the facts (batch 3, awaited), and
 *     aggregate the findings. ALL docs are processed — the check never
 *     short-circuits at the first doc with drift.
 *  3. Run the first-run-gotchas relationship check ONCE (batch 3), then the
 *     ledger schema contract check, and aggregate their findings.
 *
 * `ok` is true exactly when zero findings were collected. Read-only (AC6):
 * the orchestrator only reads docs and spawns the read-only CLI; it performs
 * no filesystem writes, no git, and no ledger mutation.
 *
 * @param opts Overrides for repo root, scoped doc list, and CLI path so tests
 *   can point the check at fixture docs / a fake CLI; production passes none.
 */
export async function checkContractDrift(
  opts: CheckContractDriftOptions = {},
): Promise<ContractDriftResult> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  // The DEFAULT (no scopedDocs) uses the real SCOPED_DOCS. An EXPLICITLY
  // passed empty array is a caller mis-wiring (F22): it would run the per-doc
  // loop zero times and report ok:true having validated nothing, silently
  // disarming the whole check. An empty scope is a hard error, not a clean
  // result — same boundary as a missing scoped doc (Key Decision 8 / AC1).
  if (opts.scopedDocs !== undefined && opts.scopedDocs.length === 0) {
    throw new Error(
      "contract-drift orchestrator: scopedDocs resolved to an empty array — an empty scope checks zero docs and would silently pass, so it is a caller error, not a clean result.",
    );
  }
  const scopedDocs = (opts.scopedDocs ?? SCOPED_DOCS).map(toScopedDoc);

  // Load facts once — a CLI failure throws here and aborts the whole check.
  const facts = await loadContractFacts({ cliPath: opts.cliPath });

  const findings: DriftFinding[] = [];

  // Per-doc claim extraction + comparison. Collect every doc's findings; a
  // missing scoped doc throws (never a clean pass).
  for (const { path: rel, expectsClaims } of scopedDocs) {
    const text = await readScopedDocOrThrow(
      join(repoRoot, rel),
      rel,
      "contract-drift orchestrator",
    );
    const claims = extractDocClaims(text, rel);

    // F21 runtime claim floor: a doc the SCOPE knows carries contract tokens
    // (expectsClaims) that extracted ZERO contract claims is drift, not a clean
    // pass. This catches an extractor regression (or a doc rewrite stripping
    // structural markers) that would otherwise silently disarm this doc's
    // contract validation while still reporting ok:true. It checks only THAT
    // claims exist, never WHICH or HOW MANY (AC5).
    if (expectsClaims && contractClaimCount(claims) === 0) {
      findings.push({
        doc: rel,
        kind: "claim-floor",
        claim: rel,
        reason:
          "doc is expected to carry contract claims (route ids / commands / slices / packet roles / field paths) but extraction yielded none — a likely extractor regression or a doc rewrite that stripped contract tokens, which would silently disarm this doc's drift validation.",
      });
    }

    findings.push(...(await compareClaimsToFacts(claims, facts, { repoRoot })));
  }

  // The deterministic control-plane relationship the workflow relies on.
  findings.push(...(await checkGotchasRelationship({ repoRoot })));
  if (opts.includeWorkflowLearningScanRelationship === true) {
    findings.push(...(await checkWorkflowLearningScanRelationship({ repoRoot })));
  }
  findings.push(
    ...(await checkLedgerLifecycleFieldDrift({
      repoRoot,
      cliPath: opts.cliPath,
    })),
  );
  findings.push(
    ...(await checkGeneratedScaffoldBlocksDrift({
      repoRoot,
    })),
  );

  return { ok: findings.length === 0, findings };
}

/**
 * Render one finding as a single readable block for the runnable entry: which
 * doc, the kind, the offending claim, an optional 1-based line, and the human
 * reason. Output only (no writes).
 */
function formatFinding(f: DriftFinding): string {
  const where = f.line === undefined ? f.doc : `${f.doc}:${f.line}`;
  return `  [${f.kind}] ${where}\n    claim: ${f.claim}\n    ${f.reason}`;
}

// Top-level script entrypoint. Only runs when the file is executed directly
// (Bun's import.meta.main is true for the entry script). Read-only: it prints a
// human-readable report and sets the exit code; it writes no files (AC6).
if (import.meta.main) {
  const result = await checkContractDrift({
    includeWorkflowLearningScanRelationship: true,
  });
  if (result.ok) {
    console.log(
      `contract-drift: OK — the ${SCOPED_DOCS.length} scoped docs and relationship checks are in sync with the live CLI contract.`,
    );
  } else {
    console.error(
      `contract-drift: ${result.findings.length} drift finding(s):\n${result.findings
        .map(formatFinding)
        .join("\n")}`,
    );
  }
  process.exit(result.ok ? 0 : 1);
}
