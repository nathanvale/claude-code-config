/**
 * Issue #81 — runtime contract drift check for Issue-to-PR v2 operator docs.
 *
 * This module compares claims made in the operator-facing docs (command
 * names, contract slice names, packet roles, and `data.*` response field
 * paths) against the live CLI surface, so docs drift is caught mechanically
 * instead of by review eyeballing.
 *
 * Batch 1 (this file's current surface): the **contract-fact loader**. It
 * reads the authoritative contract facts from the running CLI subprocess —
 * never by importing CLI internals or duplicating any value as a literal.
 * Later batches add the doc-claim extractor, the comparator, and the
 * orchestrator on top of these facts.
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
 * git, or mutates ledger state. A failed subprocess or a non-ok envelope is
 * a hard error: an empty / partial fact set would mask drift or make every
 * doc claim look like drift, so we throw instead.
 */

import { execPath } from "node:process";
import { join } from "node:path";

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

/** Read a string[] from a help/slice field, throwing when the shape is wrong. */
function expectStringArray(
  value: unknown,
  context: string,
): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(
      `contract-fact loader: expected a string array for ${context}, got ${typeof value}`,
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
 */
function finiteChildKeys(description: string): string[] | null {
  // Reject array-of / discriminated-union element shapes outright: their
  // braces describe one variant, not a finite field set.
  if (/\[\]/.test(description) || /discriminated union|\bor\b/.test(description)) {
    return null;
  }

  const braceGroups = description.match(/\{[^{}]*\}/g);
  if (!braceGroups || braceGroups.length !== 1) {
    return null;
  }

  const inner = braceGroups[0].slice(1, -1).trim();
  if (inner.length === 0) {
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
    // Quoted literals (e.g. 'route_id') are union tag values, not field keys.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return null;
    }
    keys.push(name);
  }
  return keys.length > 0 ? keys : null;
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
 * emit `data.K.child` for each child. Non-finite shapes stop at `data.K`.
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
    // findings_table_drift: null }`). Emit the directly-named children first.
    const directChildren = finiteChildKeys(rawDescription);
    if (directChildren) {
      for (const child of directChildren) {
        paths.push(`${path}.${child}`);
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

  return {
    routeIds,
    commandNames,
    contractSlices,
    packetRoles,
    responseFieldPaths: {
      state: deriveFieldPaths(shapes.state_response_shape, shapes),
      diagnose: deriveFieldPaths(shapes.diagnose_response_shape, shapes),
    },
  };
}
