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
 */

import { execPath } from "node:process";
import { join, posix } from "node:path";

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
  | "scoped-link";

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
  /** 1-based source line of the claim, for operator pointing. */
  line: number;
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
  // Bun.file().exists() is true only for regular files; stat covers dirs too.
  const file = Bun.file(absPath);
  if (await file.exists()) return true;
  try {
    const stat = await import("node:fs/promises").then((fs) =>
      fs.stat(absPath),
    );
    return stat.isDirectory();
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
 * Read a protected scoped doc the relationship check NEEDS. A missing doc is a
 * HARD ERROR (throw), per Key Decision 8: the check was asked to read it, so
 * its absence is an environment failure, not doc drift. (A missing LINK TARGET
 * inside a doc that DOES exist is a finding, handled separately.)
 */
async function readProtectedDoc(absPath: string, relLabel: string): Promise<string> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    throw new Error(
      `contract-drift gotchas check: required scoped doc "${relLabel}" is missing at ${absPath}.`,
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
 *      load of the guide for `blocked-` routes (orchestration step 7b): the
 *      doc must mention BOTH the guide path AND a `blocked-` route trigger.
 *  (b) `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` links from its
 *      route-id / blocked-route section to the guide: the doc must contain a
 *      blocked-route-ids section AND a markdown link to `first-run-gotchas.md`.
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

  const skillText = await readProtectedDoc(
    join(repoRoot, SKILL_DOC_REL),
    SKILL_DOC_REL,
  );
  const ledgerText = await readProtectedDoc(
    join(repoRoot, LEDGER_DOC_REL),
    LEDGER_DOC_REL,
  );

  // (a) Deterministic control-plane load in SKILL.md for blocked- routes. The
  // load is structural: the doc references the guide PATH near a `blocked-`
  // trigger. We require both signals to be present (not a per-route deep link).
  const skillMentionsGuide = skillText.includes(GOTCHAS_GUIDE_REL);
  const skillMentionsBlocked = /blocked-/.test(skillText);
  if (!(skillMentionsGuide && skillMentionsBlocked)) {
    findings.push({
      doc: SKILL_DOC_REL,
      kind: "scoped-link",
      claim: GOTCHAS_GUIDE_REL,
      line: 0,
      reason:
        "SKILL.md is missing the deterministic control-plane load of first-run-gotchas.md for `blocked-` routes (orchestration step 7b).",
    });
  }

  // (b) ledger-and-helper.md links from its blocked-route-ids section to the
  // guide. Require a blocked-route section heading AND a markdown link to the
  // guide basename somewhere in the doc.
  const ledgerHasBlockedSection = /blocked\s+route\s+ids/i.test(ledgerText);
  const ledgerLinksGuide = new RegExp(
    `\\]\\(\\s*${GOTCHAS_GUIDE_BASENAME.replace(/\./g, "\\.")}`,
  ).test(ledgerText);
  if (!(ledgerHasBlockedSection && ledgerLinksGuide)) {
    findings.push({
      doc: LEDGER_DOC_REL,
      kind: "scoped-link",
      claim: GOTCHAS_GUIDE_BASENAME,
      line: 0,
      reason:
        "ledger-and-helper.md is missing the link from its blocked-route-ids section to first-run-gotchas.md.",
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
