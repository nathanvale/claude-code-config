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
 * packet roles, `data.*` field paths, and scoped recovery/control-plane
 * links) using bounded patterns over prose and fenced code blocks. It holds
 * no expected contract VALUES of its own (AC5): it only reads structural
 * markers and emits what the doc says, leaving the comparison to later
 * batches. Later batches add the comparator and the orchestrator.
 *
 * Design law (AC5): this file holds NO literal route ids, slice names,
 * packet roles, or field paths as expected values. The only contract
 * *coordinates* it knows are which CLI fields to read (the help payload's
 * `commands`, `contract_slices`, `state_response_shape`,
 * `diagnose_response_shape`, and the `data.` path prefix docs use). Those
 * are read-locations, not duplicated contract values.
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
 *  - SCOPE is exactly the four operator docs in `SCOPED_DOCS`
 *    (skills/issue-to-pr/SKILL.md, runbooks/issue-to-pr-v2/README.md,
 *    references/ledger-and-helper.md, references/first-run-gotchas.md). It does
 *    NOT validate other Issue-to-PR references (stage-*.md,
 *    findings-and-validators.md, builder-dispatch.md, host-adapters.md, etc.).
 *  - It checks ONLY the contract-token kinds from AC1-AC4: route ids, `cli.ts`
 *    command names, `contract <slice>` names, packet roles (ONLY in explicit
 *    `cli.ts packet <role>` command positions), `data.*` response-field paths,
 *    and the scoped recovery/control-plane links (the first-run-gotchas
 *    relationship). It does NOT judge prose truth, broad docs consistency, or
 *    any token kind beyond these.
 *  - It adds NO dependency (imports are node/bun stdlib + bun:test only), NO
 *    new CLI command, NO new emitted fact (it only READS the existing CLI via
 *    subprocess), and generates NO docs.
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
 * Spawn the read-only CLI with the given args and return the parsed success
 * envelope's `data`. Throws a clear, command-naming Error when the
 * subprocess exits non-zero, emits no parseable JSON, or returns a non-ok
 * envelope (AC6). Never returns empty facts on failure.
 */
async function readCliData(
  cliPath: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const label = `bun ${cliPath} ${args.join(" ")}`;
  // Spawn inline so Bun's overload narrows stdout/stderr to ReadableStream
  // (a `{ stdout: "pipe", stderr: "pipe" }` literal). A genuinely missing
  // CLI surfaces as a non-zero exit below, not a synchronous throw.
  const proc = Bun.spawn([execPath, cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

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
 * Sources, all at runtime:
 *  - route ids   ← `contract route_ids --json`   → data.values
 *  - packet roles ← `contract packet_roles --json` → data.values
 *  - command names ← `--help --json` → data.commands[].name
 *  - slice names   ← `--help --json` → data.contract_slices
 *  - field paths   ← `--help --json` → state/diagnose response shapes
 *
 * Throws (never returns partial facts) when any subprocess fails or returns
 * a non-ok envelope, so drift detection can never be silently disarmed.
 */
export async function loadContractFacts(
  options: LoadContractFactsOptions = {},
): Promise<ContractFacts> {
  const cliPath = options.cliPath ?? defaultCliPath();

  const help = await readCliData(cliPath, ["--help", "--json"]);
  const routeIdData = await readCliData(cliPath, [
    "contract",
    "route_ids",
    "--json",
  ]);
  const packetRoleData = await readCliData(cliPath, [
    "contract",
    "packet_roles",
    "--json",
  ]);

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
  const routeIds = expectStringArray(
    routeIdData.values,
    "contract route_ids data.values",
  );
  const packetRoles = expectStringArray(
    packetRoleData.values,
    "contract packet_roles data.values",
  );

  const stateShape = help.state_response_shape;
  const diagnoseShape = help.diagnose_response_shape;
  if (
    !stateShape ||
    typeof stateShape !== "object" ||
    !diagnoseShape ||
    typeof diagnoseShape !== "object"
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
 * packet role. Flags and `<placeholder>` args are skipped. Reading the
 * `cli.ts `, `contract`, and `packet` markers is structural extraction, not a
 * contract value (AC5).
 */
function extractCliClaims(text: string): {
  commands: DocClaim[];
  slices: DocClaim[];
  packetRoles: DocClaim[];
} {
  const commands: DocClaim[] = [];
  const slices: DocClaim[] = [];
  const packetRoles: DocClaim[] = [];

  // The token after `cli.ts ` is the command. Allow `<...>` so the
  // placeholder is captured then skipped, rather than silently matching the
  // wrong token.
  const cliRe = /\bcli\.ts\s+(<[a-z-]+>|[a-z][a-z0-9-]*)/g;
  for (const m of text.matchAll(cliRe)) {
    const command = m[1];
    const index = m.index ?? 0;
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
    }
  }

  return { commands, slices, packetRoles };
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
  const { commands, slices, packetRoles } = extractCliClaims(docText);
  return {
    docPath,
    routeIds: extractRouteIds(docText),
    commands,
    slices,
    packetRoles,
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
  | "field-path"
  | "scoped-link"
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
const SKILL_DOC_REL = "skills/issue-to-pr/SKILL.md";
const LEDGER_DOC_REL = "runbooks/issue-to-pr-v2/references/ledger-and-helper.md";
/** Just the guide's basename, for matching markdown links to it. */
const GOTCHAS_GUIDE_BASENAME = "first-run-gotchas.md";

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

/**
 * True when SOME numbered orchestration step expresses the deterministic
 * blocked-route load of the guide. We split the text into step blocks (a line
 * starting with a numbered/lettered step marker like `7b.` or `8.`, its body
 * running until the next step marker or a blank line) and require ONE block to
 * carry all three signals together: a `blocked-` route trigger, a load verb,
 * and a guide reference (path or basename).
 *
 * Anchoring on the STEP construct — not whole-doc co-occurrence and not loose
 * proximity — is what lets the check detect deletion of step 7b. The route
 * catalog and the reference-loading-policy table mention `blocked-` and the
 * guide too, but they are prose/table that merely CITE step 7b; neither begins
 * with a numbered step marker, so removing the real step makes this return
 * false even though those citations remain. The check tolerates harmless
 * rewording inside the step (any load verb, path or basename, any blocked-
 * route id) and is not pinned to the literal "7b" or exact prose.
 */
function skillHasBlockedLoadStep(skillText: string): boolean {
  const lines = skillText.split("\n");
  const stepMarker = /^\s*\d+[a-z]?\.\s/;
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
    const body = block.join("\n");
    if (
      BLOCKED_ROUTE_TRIGGER.test(body) &&
      LOAD_VERB.test(body) &&
      regionMentionsGuide(body)
    ) {
      return true;
    }
    i = j;
  }
  return false;
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

/**
 * Verify the deterministic control-plane relationship the Issue-to-PR v2
 * workflow relies on for the first-run-gotchas guide (Key Decision 7). Returns
 * structured drift findings (DATA); a present, intact relationship yields an
 * empty array. Three relationship facts are checked:
 *
 *  (a) `skills/issue-to-pr/SKILL.md` carries the deterministic control-plane
 *      load of the guide for `blocked-` routes (orchestration step 7b). This is
 *      anchored STRUCTURALLY, not by whole-doc co-occurrence: SOME numbered
 *      orchestration step must, within its own bounded body, tie a `blocked-`
 *      route trigger to LOADING the guide (a load verb + the guide path or its
 *      basename). Whole-doc co-occurrence is deliberately NOT enough — the
 *      route catalog and the reference-loading-policy table both mention
 *      `blocked-` and the guide elsewhere, so a co-occurrence check could not
 *      detect deletion of the very step-7b load it exists to protect.
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
 * Hard-error boundary (Key Decision 8): SKILL.md and ledger-and-helper.md are
 * docs the check is asked to READ, so their absence throws. A missing LINK
 * TARGET (the guide file a doc links to) is a finding, not a throw.
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
  const ledgerText = await readScopedDocOrThrow(
    join(repoRoot, LEDGER_DOC_REL),
    LEDGER_DOC_REL,
    "contract-drift gotchas check",
  );

  // (a) Deterministic control-plane load in SKILL.md for blocked- routes,
  // anchored on the orchestration STEP construct (step 7b): some numbered step
  // must, within its own bounded body, tie a `blocked-` trigger to LOADING the
  // guide. Not whole-doc co-occurrence — see `skillHasBlockedLoadStep`. This is
  // a doc-level finding: it points at the doc, not a single line, so `line` is
  // omitted (Key Decision: no `0` sentinel against a 1-based contract).
  if (!skillHasBlockedLoadStep(skillText)) {
    findings.push({
      doc: SKILL_DOC_REL,
      kind: "scoped-link",
      claim: GOTCHAS_GUIDE_REL,
      reason:
        "SKILL.md is missing the deterministic control-plane load of first-run-gotchas.md for `blocked-` routes: no numbered orchestration step ties a `blocked-` route trigger to loading the guide (orchestration step 7b).",
    });
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

  // (c) every markdown link to first-run-gotchas.md in the two scoped docs
  // resolves to an existing file. A broken target is a finding (Key Decision
  // 8), not a hard error.
  for (const [relDoc, text] of [
    [SKILL_DOC_REL, skillText],
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
 * The four operator-facing docs the drift check is scoped to. These are
 * structural file COORDINATES (the check's SCOPE), not contract VALUES (AC5):
 * they say WHICH docs to validate, never WHAT the contract is. The contract
 * facts themselves still come exclusively from `loadContractFacts()`.
 *
 * `expectsClaims` marks the two docs the workflow relies on to carry contract
 * tokens (SKILL.md and first-run-gotchas.md): if their extraction yields ZERO
 * contract claims, that is a drift finding (F21), not a silent pass. README.md
 * legitimately carries no route ids / field paths (only scoped links and a
 * couple of `cli.ts` command mentions), and ledger-and-helper.md is covered by
 * the gotchas relationship check, so neither is marked `expectsClaims`.
 *
 * Repo-relative so the orchestrator can resolve them against any `repoRoot`
 * (tests point at a fixture repo; production resolves against the real root)
 * AND so `extractDocClaims` attributes claims back to the canonical path.
 */
export const SCOPED_DOCS: readonly ScopedDoc[] = [
  { path: "skills/issue-to-pr/SKILL.md", expectsClaims: true },
  { path: "runbooks/issue-to-pr-v2/README.md", expectsClaims: false },
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
 * `cliPath`). Production callers pass nothing and get the real four docs, the
 * real repo root, and the sibling `cli.ts`.
 */
export type CheckContractDriftOptions = {
  /** Repo root that scoped-doc paths and link targets resolve against. */
  repoRoot?: string;
  /**
   * Scoped docs to validate. Defaults to the four `SCOPED_DOCS`. Accepts either
   * bare repo-relative path strings (legacy callers / tests; treated as
   * `expectsClaims: false`) or full `ScopedDoc` entries. An explicitly-passed
   * EMPTY array is a caller error (F22): it would check zero docs and silently
   * pass, so the orchestrator throws.
   */
  scopedDocs?: readonly (string | ScopedDoc)[];
  /** CLI path forwarded to `loadContractFacts`. Defaults to sibling cli.ts. */
  cliPath?: string;
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
    claims.fieldPaths.length
  );
}

/**
 * Run the runtime contract-drift check over the four scoped operator docs and
 * report aggregated drift findings.
 *
 * Pipeline (composes batches 1-3, re-implements none of them):
 *  1. Load the authoritative contract facts ONCE via `loadContractFacts()`
 *     (batch 1). A failed CLI load THROWS (hard error, AC6 / Key Decision 8) —
 *     never swallowed into a clean result.
 *  2. For EACH scoped doc: read its text (missing → hard error), extract its
 *     claims (batch 2), compare them to the facts (batch 3, awaited), and
 *     aggregate the findings. ALL docs are processed — the check never
 *     short-circuits at the first doc with drift.
 *  3. Run the first-run-gotchas relationship check ONCE (batch 3) and
 *     aggregate its findings.
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
  // The DEFAULT (no scopedDocs) uses the real four SCOPED_DOCS. An EXPLICITLY
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
  const result = await checkContractDrift();
  if (result.ok) {
    console.log(
      `contract-drift: OK — the ${SCOPED_DOCS.length} scoped docs are in sync with the live CLI contract.`,
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
