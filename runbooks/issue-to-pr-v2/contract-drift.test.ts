/**
 * Issue #81 — runtime contract drift check, batch 1 (contract-fact loader).
 *
 * These tests pin the `loadContractFacts()` loader against the LIVE CLI
 * surface. They never hardcode the expected route ids, slice names, packet
 * roles, or field paths — instead each test spawns `cli.ts` itself and
 * compares the loader's facts to what the CLI just emitted. That is the
 * whole point of the loader (AC2/AC5): the docs check must source its
 * source-of-truth from the running CLI, not a duplicated list.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { execPath } from "node:process";
import { join } from "node:path";

import {
  type DocClaims,
  type DriftFinding,
  checkContractDrift,
  checkGotchasRelationship,
  compareClaimsToFacts,
  extractDocClaims,
  finiteChildKeys,
  loadContractFacts,
} from "./contract-drift";

const cliPath = join(import.meta.dir, "cli.ts");

/**
 * Local spawn helper mirroring cli-smoke.test.ts. Used ONLY by the tests to
 * independently fetch the live CLI surface for comparison — the loader under
 * test must spawn the CLI on its own.
 */
async function runCli(args: string[]): Promise<{
  stdout: string;
  exitCode: number;
  data: Record<string, unknown>;
}> {
  const proc = Bun.spawn([execPath, cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const firstLine = stdout.split("\n").find((l) => l.length > 0) ?? "{}";
  const envelope = JSON.parse(firstLine) as Record<string, unknown>;
  return {
    stdout,
    exitCode,
    data: (envelope.data ?? {}) as Record<string, unknown>,
  };
}

describe("AC2: loadContractFacts derives names from the live CLI", () => {
  test("route ids match `contract route_ids --json` data.values exactly", async () => {
    const facts = await loadContractFacts();
    const live = await runCli(["contract", "route_ids", "--json"]);
    const liveRouteIds = live.data.values as string[];

    expect(Array.isArray(liveRouteIds)).toBe(true);
    expect(liveRouteIds.length).toBeGreaterThan(0);
    expect(facts.routeIds).toEqual(liveRouteIds);
  });

  test("command names match `--help --json` data.commands[].name", async () => {
    const facts = await loadContractFacts();
    const help = await runCli(["--help", "--json"]);
    const liveNames = (help.data.commands as { name: string }[]).map(
      (c) => c.name,
    );

    expect(liveNames.length).toBeGreaterThan(0);
    expect(facts.commandNames).toEqual(liveNames);
  });

  test("contract slice names match `--help --json` data.contract_slices", async () => {
    const facts = await loadContractFacts();
    const help = await runCli(["--help", "--json"]);
    const liveSlices = help.data.contract_slices as string[];

    expect(Array.isArray(liveSlices)).toBe(true);
    expect(liveSlices.length).toBeGreaterThan(0);
    expect(facts.contractSlices).toEqual(liveSlices);
  });

  test("packet roles match `contract packet_roles --json` data.values", async () => {
    const facts = await loadContractFacts();
    const live = await runCli(["contract", "packet_roles", "--json"]);
    const liveRoles = live.data.values as string[];

    expect(Array.isArray(liveRoles)).toBe(true);
    expect(liveRoles.length).toBeGreaterThan(0);
    expect(facts.packetRoles).toEqual(liveRoles);
  });
});

describe("AC3: response field paths derived from the live help payload", () => {
  test("every top-level state shape key becomes a data.K path", async () => {
    const facts = await loadContractFacts();
    const help = await runCli(["--help", "--json"]);
    const stateShape = help.data.state_response_shape as Record<
      string,
      unknown
    >;

    for (const key of Object.keys(stateShape)) {
      expect(facts.responseFieldPaths.state).toContain(`data.${key}`);
    }
  });

  test("every top-level diagnose shape key becomes a data.K path", async () => {
    const facts = await loadContractFacts();
    const help = await runCli(["--help", "--json"]);
    const diagnoseShape = help.data.diagnose_response_shape as Record<
      string,
      unknown
    >;

    for (const key of Object.keys(diagnoseShape)) {
      expect(facts.responseFieldPaths.diagnose).toContain(`data.${key}`);
    }
  });

  test("finite brace-set children are flattened one level (state digest_drift)", async () => {
    const facts = await loadContractFacts();
    // digest_drift advertises a finite `{ acceptance_criteria, batch_contract,
    // digests, any }` set, so the loader must emit the child paths.
    expect(facts.responseFieldPaths.state).toContain(
      "data.digest_drift.acceptance_criteria",
    );
    expect(facts.responseFieldPaths.state).toContain("data.digest_drift.any");
  });

  test("cross-referenced finite shape resolves (diagnose drift.digest_drift.*)", async () => {
    const facts = await loadContractFacts();
    // drift advertises `{ digest_drift: same shape as
    // state_response_shape.digest_drift, findings_table_drift: null }`. The
    // cross-reference must resolve to digest_drift's finite children.
    expect(facts.responseFieldPaths.diagnose).toContain(
      "data.drift.digest_drift",
    );
    expect(facts.responseFieldPaths.diagnose).toContain(
      "data.drift.digest_drift.acceptance_criteria",
    );
    expect(facts.responseFieldPaths.diagnose).toContain(
      "data.drift.findings_table_drift",
    );
  });

  test("non-finite nested shapes stop at the nearest known parent (blocking_gates)", async () => {
    const facts = await loadContractFacts();
    // blocking_gates describes an array of union objects, not a finite child
    // set: the loader must stop at data.blocking_gates and invent no children.
    expect(facts.responseFieldPaths.state).toContain("data.blocking_gates");
    const inventedChild = facts.responseFieldPaths.state.some((p) =>
      p.startsWith("data.blocking_gates."),
    );
    expect(inventedChild).toBe(false);
  });

  test("finite brace set with a trailing array-typed sibling still yields children (installed_artifact_presence)", async () => {
    const facts = await loadContractFacts();
    // installed_artifact_presence is genuinely finite:
    //   "{ references, templates, cli_ts, lib_dir, all_present } booleans +
    //    missing: ('references' | ...)[]"
    // The trailing `missing: (...)[]` array sibling must NOT suppress the
    // finite brace set's five children. Verify each one resolves under both
    // shapes (state holds it directly; diagnose via cross-reference).
    for (const child of [
      "references",
      "templates",
      "cli_ts",
      "lib_dir",
      "all_present",
    ]) {
      expect(facts.responseFieldPaths.state).toContain(
        `data.installed_artifact_presence.${child}`,
      );
    }
    // The cross-referenced diagnose copy resolves to the same children.
    expect(facts.responseFieldPaths.diagnose).toContain(
      "data.installed_artifact_presence.references",
    );
  });
});

describe("AC3 (F10): finiteChildKeys rejects single-brace array / union shapes", () => {
  test("single-brace array-of-objects `{ a, b, c }[]` returns null", () => {
    // The `[]` sits OUTSIDE the brace group, so the inner-scoped guard misses
    // it. The whole thing is an element shape, not a fixed data.K.child set:
    // children must NOT be invented.
    expect(finiteChildKeys("{ a, b, c }[]")).toBeNull();
  });

  test("single-brace union `string or { a, b }` returns null", () => {
    // The `or` marks a description-level union; the brace is only one arm, so
    // its keys are not guaranteed `data.K.child` paths.
    expect(finiteChildKeys("string or { a, b }")).toBeNull();
    expect(finiteChildKeys("{ a, b } or string")).toBeNull();
  });

  test("genuine finite CLI shapes still resolve (regression)", async () => {
    // Re-assert against the LIVE shapes: the F10 guard must not over-correct
    // and strip children from genuinely finite sets.
    const help = await runCli(["--help", "--json"]);
    const state = help.data.state_response_shape as Record<string, string>;

    // installed_artifact_presence: 5 boolean children + a trailing
    // `missing: (...)[]` array SIBLING whose `[]` is NOT right after the brace.
    expect(finiteChildKeys(state.installed_artifact_presence)).toEqual([
      "references",
      "templates",
      "cli_ts",
      "lib_dir",
      "all_present",
    ]);

    // digest_drift: 4 boolean children, no array/union markers.
    expect(finiteChildKeys(state.digest_drift)).toEqual([
      "acceptance_criteria",
      "batch_contract",
      "digests",
      "any",
    ]);

    // confirmation_state: 3 children, "one of" must NOT trip the `\bor\b` guard.
    expect(finiteChildKeys(state.confirmation_state)).toEqual([
      "acceptance_criteria",
      "batch_contract",
      "digests",
    ]);

    // blocking_gates: union with two brace groups → still null.
    expect(finiteChildKeys(state.blocking_gates)).toBeNull();
  });
});

describe("AC5: the loader holds no duplicate source-of-truth lists", () => {
  test("source file contains no literal route id, slice name, packet role, or field path", async () => {
    const source = await Bun.file(join(import.meta.dir, "contract-drift.ts")).text();

    // Pull the real contract values from the live CLI, then assert none of
    // them appear as a hardcoded literal in the loader source. If a future
    // edit pastes a list in, this fails loudly.
    const routeIds = (await runCli(["contract", "route_ids", "--json"])).data
      .values as string[];
    const packetRoles = (await runCli(["contract", "packet_roles", "--json"]))
      .data.values as string[];
    const help = await runCli(["--help", "--json"]);
    const slices = help.data.contract_slices as string[];

    // AC5 also covers response-shape FIELD PATHS: a future hardcoded
    // `digest_drift` / `data.drift.digest_drift` literal would otherwise slip
    // through. Derive both the dotted paths and their distinctive leaf keys
    // from the live facts and forbid them too. (Source the paths from the
    // loader itself so this scan tracks whatever the CLI actually advertises.)
    const facts = await loadContractFacts();
    const fieldPaths = [
      ...facts.responseFieldPaths.state,
      ...facts.responseFieldPaths.diagnose,
    ];
    const fieldPathLeaves = fieldPaths.flatMap((p) =>
      p.split(".").filter((seg) => seg !== "data"),
    );

    // ALLOWED read-coordinates: these are help-payload field NAMES (which CLI
    // fields to read) and slice *argument* names, NOT duplicated contract
    // values. They may legitimately appear in the source.
    const allowedReadCoordinates = new Set([
      "route_ids",
      "packet_roles",
      "commands",
      "contract_slices",
      "state_response_shape",
      "diagnose_response_shape",
    ]);

    const forbidden = [
      ...routeIds,
      ...packetRoles,
      ...slices,
      ...fieldPaths,
      ...fieldPathLeaves,
    ].filter((v) => !allowedReadCoordinates.has(v));

    for (const value of new Set(forbidden)) {
      expect(source.includes(`"${value}"`)).toBe(false);
      expect(source.includes(`'${value}'`)).toBe(false);
    }
  });
});

describe("AC6: read-only loader, hard errors on CLI failure", () => {
  test("returns a fully populated fact set (never silently empty)", async () => {
    const facts = await loadContractFacts();
    expect(facts.routeIds.length).toBeGreaterThan(0);
    expect(facts.commandNames.length).toBeGreaterThan(0);
    expect(facts.contractSlices.length).toBeGreaterThan(0);
    expect(facts.packetRoles.length).toBeGreaterThan(0);
    expect(facts.responseFieldPaths.state.length).toBeGreaterThan(0);
    expect(facts.responseFieldPaths.diagnose.length).toBeGreaterThan(0);
  });

  test("throws a clear error naming the failing command when the CLI is missing", async () => {
    await expect(
      loadContractFacts({ cliPath: join(import.meta.dir, "does-not-exist.ts") }),
    ).rejects.toThrow();
  });

  test("throws when the CLI returns an error envelope (status !== ok)", async () => {
    // Inject a fake CLI path that emits an error envelope for one of the
    // expected invocations to prove the loader never accepts a non-ok status.
    const errorEnvelope = JSON.stringify({
      status: "error",
      error: { code: "boom", message: "synthetic failure" },
    });
    const dir = join(
      import.meta.dir,
      `../../.tmp-contract-drift-${process.pid}`,
    );
    const fakeCli = join(dir, "fake-cli.ts");
    await Bun.write(fakeCli, `console.log(${JSON.stringify(errorEnvelope)});`);
    try {
      await expect(
        loadContractFacts({ cliPath: fakeCli }),
      ).rejects.toThrow(/fake-cli|error|ok|contract|help|status/i);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });
});

describe("AC6: exit-0 processes with unusable stdout are hard errors", () => {
  const dir = join(import.meta.dir, `../../.tmp-contract-stdout-${process.pid}`);

  /** Write a fake CLI whose body is `scriptBody` and load through it. */
  async function loadWithScript(
    scriptBody: string,
  ): Promise<ReturnType<typeof expect>["rejects"]> {
    const fakeCli = join(dir, `fake-${Math.random().toString(36).slice(2)}.ts`);
    await Bun.write(fakeCli, scriptBody);
    return expect(loadContractFacts({ cliPath: fakeCli })).rejects;
  }

  afterAll(async () => {
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("(a) exit-0 process emitting non-JSON stdout throws", async () => {
    // The CLI exits 0 but prints prose, not JSON: JSON.parse must throw and
    // the loader must surface it (AC6 names "unparseable stdout" explicitly).
    const rejects = await loadWithScript(`console.log("not json at all");`);
    await rejects.toThrow(/non-JSON|parse|unparseable|stdout/i);
  });

  test("(b) exit-0 process emitting empty stdout / no envelope throws", async () => {
    // Prints nothing on stdout — no parseable first line at all.
    const rejects = await loadWithScript(`process.exit(0);`);
    await rejects.toThrow(/no parseable envelope|envelope|empty|stdout/i);
  });

  test("(c) exit-0 ok envelope with NO data object throws", async () => {
    const okNoData = JSON.stringify({ status: "ok" });
    const rejects = await loadWithScript(`console.log(${JSON.stringify(okNoData)});`);
    // Pin the distinctive no-data-object message only. A loose `/data/i`
    // alternative also matched the downstream "--help data.commands is not an
    // array" throw, so deleting the no-data-object branch left this test green
    // (passing for the wrong reason). Match the exact branch message instead.
    await rejects.toThrow(/no data object/i);
  });
});

/**
 * Build a fake CLI script body that dispatches on argv and emits a
 * well-formed `{"status":"ok","data":{...}}` envelope per command. Each
 * `data` value is supplied by the caller, letting a test inject EMPTY or
 * partial fact sets to prove the loader hard-errors on them (AC6). The
 * script writes exactly one JSON line and exits 0, so the failure under test
 * is purely "ok envelope, empty facts", never a process/parse failure.
 */
function fakeCliScript(parts: {
  help: Record<string, unknown>;
  routeIds: unknown;
  packetRoles: unknown;
}): string {
  const help = JSON.stringify({ status: "ok", data: parts.help });
  const routeIds = JSON.stringify({
    status: "ok",
    data: { values: parts.routeIds },
  });
  const packetRoles = JSON.stringify({
    status: "ok",
    data: { values: parts.packetRoles },
  });
  // process.argv: [bun, scriptPath, ...cliArgs]. The loader invokes
  // `--help`, `contract route_ids`, and `contract packet_roles`.
  return [
    `const argv = process.argv.slice(2);`,
    `if (argv.includes("--help")) { console.log(${JSON.stringify(help)}); }`,
    `else if (argv.includes("route_ids")) { console.log(${JSON.stringify(routeIds)}); }`,
    `else if (argv.includes("packet_roles")) { console.log(${JSON.stringify(packetRoles)}); }`,
    `else { console.log(${JSON.stringify(JSON.stringify({ status: "ok", data: {} }))}); }`,
  ].join("\n");
}

/**
 * A fully populated, minimally valid help payload. Tests clone this and zero
 * out one field at a time to prove each empty fact set is hard-errored
 * individually (rather than only catching a wholly-empty payload).
 */
function validHelpPayload(): Record<string, unknown> {
  return {
    commands: [{ name: "state" }, { name: "diagnose" }],
    contract_slices: ["route_ids", "packet_roles"],
    state_response_shape: { ledger_path: "string", route_id: "one of route_ids" },
    diagnose_response_shape: {
      ledger_path: "string",
      inferred_route_id: "one of route_ids",
    },
  };
}

describe("AC6: empty/partial well-formed fact sets are hard errors", () => {
  const dir = join(import.meta.dir, `../../.tmp-contract-empty-${process.pid}`);

  async function loadWith(parts: {
    help: Record<string, unknown>;
    routeIds: unknown;
    packetRoles: unknown;
  }): Promise<{ rejects: ReturnType<typeof expect>["rejects"] }> {
    const fakeCli = join(dir, `fake-${Math.random().toString(36).slice(2)}.ts`);
    await Bun.write(fakeCli, fakeCliScript(parts));
    return { rejects: expect(loadContractFacts({ cliPath: fakeCli })).rejects };
  }

  afterAll(async () => {
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("empty route_ids data.values is a hard error", async () => {
    const { rejects } = await loadWith({
      help: validHelpPayload(),
      routeIds: [],
      packetRoles: ["builder"],
    });
    await rejects.toThrow(/route_ids|empty/i);
  });

  test("empty packet_roles data.values is a hard error", async () => {
    const { rejects } = await loadWith({
      help: validHelpPayload(),
      routeIds: ["blocked-x"],
      packetRoles: [],
    });
    await rejects.toThrow(/packet_roles|empty/i);
  });

  test("empty commands array is a hard error", async () => {
    const help = validHelpPayload();
    help.commands = [];
    const { rejects } = await loadWith({
      help,
      routeIds: ["blocked-x"],
      packetRoles: ["builder"],
    });
    await rejects.toThrow(/commands|empty/i);
  });

  test("empty contract_slices is a hard error", async () => {
    const help = validHelpPayload();
    help.contract_slices = [];
    const { rejects } = await loadWith({
      help,
      routeIds: ["blocked-x"],
      packetRoles: ["builder"],
    });
    await rejects.toThrow(/contract_slices|empty/i);
  });

  test("empty state_response_shape (no derivable paths) is a hard error", async () => {
    const help = validHelpPayload();
    help.state_response_shape = {};
    const { rejects } = await loadWith({
      help,
      routeIds: ["blocked-x"],
      packetRoles: ["builder"],
    });
    await rejects.toThrow(/state|response|shape|empty|path/i);
  });

  test("empty diagnose_response_shape (no derivable paths) is a hard error", async () => {
    const help = validHelpPayload();
    help.diagnose_response_shape = {};
    const { rejects } = await loadWith({
      help,
      routeIds: ["blocked-x"],
      packetRoles: ["builder"],
    });
    await rejects.toThrow(/diagnose|response|shape|empty|path/i);
  });

  test("partial: one populated slice + empty route_ids still hard-errors", async () => {
    // Mirrors the real partial case: contract_slices/commands populated but a
    // values: [] envelope sneaks through. Must still reject, not return a
    // partially-empty fact set.
    const { rejects } = await loadWith({
      help: validHelpPayload(),
      routeIds: [],
      packetRoles: ["builder", "validator"],
    });
    await rejects.toThrow(/route_ids|empty/i);
  });
});

/**
 * Issue #81 — batch 2 (doc-claim extractor).
 *
 * `extractDocClaims(docText, docPath)` parses ONE scoped operator doc's text
 * and returns the contract-token CLAIMS it makes — route ids, command names,
 * contract slice names, packet roles, `data.*` field paths, and scoped
 * recovery/control-plane links. It holds no expected contract VALUES of its
 * own (AC5): it reads bounded structural markers and reports what the doc
 * says. The comparator (batch 3) and orchestrator (batch 4) consume these.
 *
 * Fixtures below are small real snippets from the four scoped docs so the
 * extractor's patterns stay grounded in the actual prose.
 */

/** Collect just the token strings from a claim array, for terse assertions. */
function tokens(claims: { token: string }[]): string[] {
  return claims.map((c) => c.token);
}

describe("AC1: route-ID claims from explicit route-ID positions", () => {
  test("extracts a quoted `route_id: \"...\"` value", () => {
    const claims = extractDocClaims(
      'route_id: "blocked-stage-3".',
      "doc.md",
    );
    expect(tokens(claims.routeIds)).toContain("blocked-stage-3");
  });

  test("extracts backtick-quoted kebab tokens from route-catalog bullets", () => {
    const doc = [
      "**Blocked routes**",
      "",
      "- `blocked-frontmatter-blocked-reason`: surface the reason.",
      "- `blocked-acceptance-criteria-stale`: return to Stage 1.",
      "- `no-ledger` and `pick-issue`: enter Stage 1.",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "SKILL.md").routeIds);
    expect(got).toContain("blocked-frontmatter-blocked-reason");
    expect(got).toContain("blocked-acceptance-criteria-stale");
    expect(got).toContain("no-ledger");
    expect(got).toContain("pick-issue");
  });

  test("extracts the `inferred_route_id: \"...\"` diagnose form", () => {
    const claims = extractDocClaims(
      'with `inferred_route_id: "blocked-digests-stale"` proves drift.',
      "first-run-gotchas.md",
    );
    expect(tokens(claims.routeIds)).toContain("blocked-digests-stale");
  });

  test("extracts a backtick `blocked-*` route id from prose", () => {
    const claims = extractDocClaims(
      "read the `blocked-digests-stale` recipe (Part 2.3).",
      "first-run-gotchas.md",
    );
    expect(tokens(claims.routeIds)).toContain("blocked-digests-stale");
  });

  test("does NOT treat `git status` or a filename as a route id", () => {
    const doc =
      "prose backtick like `git status`, and the file `first-run-gotchas.md` is linked.";
    const got = tokens(extractDocClaims(doc, "doc.md").routeIds);
    expect(got).not.toContain("git status");
    expect(got).not.toContain("first-run-gotchas.md");
    expect(got).not.toContain("status");
  });

  test("carries a line number for each route-ID claim", () => {
    const doc = ["line one", '`route_id: "shipped"`'].join("\n");
    const claim = extractDocClaims(doc, "doc.md").routeIds.find(
      (c) => c.token === "shipped",
    );
    expect(claim?.line).toBe(2);
  });
});

describe("AC2: command, slice, and packet-role claims from cli.ts positions", () => {
  test("extracts the command token following `cli.ts `", () => {
    const doc = [
      "Run `bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json`",
      "and `cli.ts diagnose <ledger> --json`.",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "doc.md").commands);
    expect(got).toContain("state");
    expect(got).toContain("diagnose");
  });

  test("skips `--json`/`--help` flags and `<placeholder>` command args", () => {
    const got = tokens(
      extractDocClaims("`cli.ts diagnose <ledger> --json`", "doc.md").commands,
    );
    expect(got).toEqual(["diagnose"]);
    expect(got).not.toContain("<ledger>");
    expect(got).not.toContain("--json");
  });

  test("extracts the slice token following `cli.ts contract ` only", () => {
    const doc = [
      "`cli.ts contract route_ids --json`",
      "`cli.ts contract packet_roles --json`",
    ].join("\n");
    const claims = extractDocClaims(doc, "doc.md");
    expect(tokens(claims.slices)).toEqual(["route_ids", "packet_roles"]);
    // `contract` is itself a command; the slice is the NEXT token, not a
    // duplicate command claim of the slice name.
    expect(tokens(claims.commands)).toContain("contract");
  });

  test("does NOT emit a slice claim for the literal `<slice>` placeholder", () => {
    const claims = extractDocClaims("`cli.ts contract <slice> --json`", "doc.md");
    expect(tokens(claims.slices)).not.toContain("<slice>");
    expect(claims.slices.length).toBe(0);
  });

  test("extracts packet-role token from `cli.ts packet <role>` command position", () => {
    const doc = [
      "`cli.ts packet builder --ledger <ledger> --json`",
      "`cli.ts packet validator --ledger <path> --persona <skill> --json`",
      "`cli.ts packet proposer --ledger <path> --finding <id> --json`",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "doc.md").packetRoles);
    expect(got).toContain("builder");
    expect(got).toContain("validator");
    expect(got).toContain("proposer");
  });

  test("does NOT extract a packet role from a template filename or prose noun", () => {
    const doc = [
      "the `builder-work-packet.md` template renders for the Builder.",
      "Validators run against the batch; the Builder dispatches.",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "doc.md").packetRoles);
    expect(got).not.toContain("builder-work-packet.md");
    expect(got).not.toContain("Builder");
    expect(got).not.toContain("Validators");
    expect(got.length).toBe(0);
  });

  test("packet-role placeholder `<role>` is skipped", () => {
    const got = tokens(
      extractDocClaims(
        "`cli.ts packet <role> --ledger <path> [...] --json`",
        "doc.md",
      ).packetRoles,
    );
    expect(got.length).toBe(0);
  });
});

describe("AC3: data.* field-path claims with brace expansion", () => {
  test("expands a single-line `{a, b, c}` brace set into individual paths", () => {
    const claims = extractDocClaims(
      "`data.confirmation_state.{acceptance_criteria, batch_contract, digests}`",
      "first-run-gotchas.md",
    );
    const got = tokens(claims.fieldPaths);
    expect(got).toContain("data.confirmation_state.acceptance_criteria");
    expect(got).toContain("data.confirmation_state.batch_contract");
    expect(got).toContain("data.confirmation_state.digests");
    expect(got).not.toContain("data.confirmation_state");
  });

  test("expands a MULTILINE brace set into individual paths", () => {
    const doc = [
      "`data.drift.digest_drift.{acceptance_criteria,",
      "batch_contract, digests, any}`.",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "first-run-gotchas.md").fieldPaths);
    expect(got).toContain("data.drift.digest_drift.acceptance_criteria");
    expect(got).toContain("data.drift.digest_drift.batch_contract");
    expect(got).toContain("data.drift.digest_drift.digests");
    expect(got).toContain("data.drift.digest_drift.any");
  });

  test("extracts plain `data.<dotted.path>` claims from prose", () => {
    const doc =
      "inspect `data.route_id`, `data.plan_path`, and `data.has_batches`.";
    const got = tokens(extractDocClaims(doc, "first-run-gotchas.md").fieldPaths);
    expect(got).toContain("data.route_id");
    expect(got).toContain("data.plan_path");
    expect(got).toContain("data.has_batches");
  });

  test("skips `<placeholder>` segments inside a data.* path", () => {
    const got = tokens(
      extractDocClaims("`data.drift.digest_drift.<axis>`", "doc.md").fieldPaths,
    );
    for (const p of got) {
      expect(p).not.toContain("<axis>");
    }
  });

  test("a bare field name without the `data.` prefix is NOT a claim", () => {
    const got = tokens(
      extractDocClaims(
        "the field `installed_artifact_presence.all_present` is checked.",
        "doc.md",
      ).fieldPaths,
    );
    expect(got).not.toContain("installed_artifact_presence.all_present");
    expect(got.length).toBe(0);
  });

  test("enum prose `matched | missing` produces no field-path claim", () => {
    const got = tokens(
      extractDocClaims(
        "`runbook_version_skew` (`matched | missing | mismatched`)",
        "doc.md",
      ).fieldPaths,
    );
    expect(got.length).toBe(0);
  });
});

describe("doc-claim extractor scans fenced code blocks too", () => {
  test("a `cli.ts` command inside a fenced block IS extracted", () => {
    const doc = [
      "Run:",
      "```",
      "bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json",
      "```",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "first-run-gotchas.md").commands);
    expect(got).toContain("state");
  });

  test("a stale `data.*` path inside a fenced block IS extracted", () => {
    const doc = ["```", "data.confirmation_state.stale_axis", "```"].join("\n");
    const got = tokens(extractDocClaims(doc, "doc.md").fieldPaths);
    expect(got).toContain("data.confirmation_state.stale_axis");
  });

  test("`decompose.ts --validate-ledger-batches` yields no cli.ts command claim", () => {
    const doc = [
      "```",
      "bun runbooks/issue-to-pr-v2/decompose.ts --validate-ledger-batches {ledger}",
      "```",
    ].join("\n");
    const claims = extractDocClaims(doc, "first-run-gotchas.md");
    expect(claims.commands.length).toBe(0);
    expect(tokens(claims.commands)).not.toContain("decompose.ts");
    expect(tokens(claims.commands)).not.toContain("--validate-ledger-batches");
  });
});

describe("scoped-link claims for control-plane / recovery docs", () => {
  test("extracts a markdown link to first-run-gotchas.md with resolved target", () => {
    const doc =
      "use [first-run-gotchas.md](first-run-gotchas.md) for recipes.";
    const claims = extractDocClaims(
      doc,
      "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    );
    const link = claims.scopedLinks.find(
      (l) => l.token === "first-run-gotchas.md",
    );
    expect(link).toBeDefined();
    expect(link?.resolvedTarget).toBe(
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
  });

  test("resolves a relative-up link target against the doc path", () => {
    const doc = "see the [README](../README.md#file-map).";
    const claims = extractDocClaims(
      doc,
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
    const link = claims.scopedLinks.find((l) => l.token === "README");
    expect(link?.resolvedTarget).toBe("runbooks/issue-to-pr-v2/README.md");
  });

  test("ignores external http(s) links", () => {
    const doc = "see [docs](https://example.com/page) online.";
    const claims = extractDocClaims(doc, "doc.md");
    expect(claims.scopedLinks.length).toBe(0);
  });
});

describe("AC5: extractor emits claims only, holds no contract values", () => {
  test("source has no hardcoded route id / slice / role / field-path literal beyond extraction markers", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "contract-drift.ts"),
    ).text();

    // Pull the real contract values from the live CLI and forbid them as
    // literals in the SOURCE. Reading structural markers (`route_id:`,
    // `cli.ts `, `data.`, the `blocked-` prefix) is allowed; pasting a
    // contract VALUE the extractor compares against is not.
    const routeIds = (await runCli(["contract", "route_ids", "--json"])).data
      .values as string[];
    const packetRoles = (await runCli(["contract", "packet_roles", "--json"]))
      .data.values as string[];
    const help = await runCli(["--help", "--json"]);
    const slices = help.data.contract_slices as string[];
    const facts = await loadContractFacts();
    const fieldPathLeaves = [
      ...facts.responseFieldPaths.state,
      ...facts.responseFieldPaths.diagnose,
    ].flatMap((p) => p.split(".").filter((seg) => seg !== "data"));

    // `route_ids` / `packet_roles` are slice ARGUMENT names (read-coordinates),
    // not duplicated contract values, so they may appear in the source.
    const allowedReadCoordinates = new Set(["route_ids", "packet_roles"]);

    const forbidden = [
      ...routeIds,
      ...packetRoles,
      ...slices,
      ...fieldPathLeaves,
    ].filter((v) => !allowedReadCoordinates.has(v));

    for (const value of new Set(forbidden)) {
      expect(source.includes(`"${value}"`)).toBe(false);
      expect(source.includes(`'${value}'`)).toBe(false);
    }
  });

  test("extractor returns ONLY what the doc text contains (no injected values)", () => {
    const claims = extractDocClaims("plain prose with no contract tokens.", "doc.md");
    expect(claims.routeIds.length).toBe(0);
    expect(claims.commands.length).toBe(0);
    expect(claims.slices.length).toBe(0);
    expect(claims.packetRoles.length).toBe(0);
    expect(claims.fieldPaths.length).toBe(0);
    expect(claims.scopedLinks.length).toBe(0);
  });

  test("carries docPath through so the orchestrator can attribute claims", () => {
    const claims = extractDocClaims('`route_id: "shipped"`', "some/doc.md");
    expect(claims.docPath).toBe("some/doc.md");
  });
});

/**
 * Issue #81 — batch-2 repair (F11/F12/F13/F14/F16).
 *
 * These tests run the extractor over the REAL scoped docs and reconcile its
 * claims with `loadContractFacts()` live output — the actual clean-pass
 * invariant batch 3's comparator will enforce. They are the load-bearing
 * guard (F13) that catches the route-ID over-capture (F11) and the
 * installed_artifact_presence.missing asymmetry (F12). They never hardcode an
 * expected route-id / field-path list (AC5): the "must include" anchors are
 * read from the live `loadContractFacts()` facts, and the "must NOT include"
 * anchors are conceptual subroute / field NAMES read out of the docs
 * themselves, not contract values.
 */

const repoRoot = join(import.meta.dir, "..", "..");
const skillDocPath = "skills/issue-to-pr/SKILL.md";
const ledgerDocPath = "runbooks/issue-to-pr-v2/references/ledger-and-helper.md";
const gotchasDocPath = "runbooks/issue-to-pr-v2/references/first-run-gotchas.md";

/** Read one scoped doc's text by its repo-relative path. */
async function readScopedDoc(relPath: string): Promise<string> {
  return Bun.file(join(repoRoot, relPath)).text();
}

describe("F11/F13: live-doc route-ID claims reconcile with loadContractFacts", () => {
  test("SKILL.md + ledger-and-helper route-ID claims are all live route ids", async () => {
    const facts = await loadContractFacts();
    const liveRouteIds = new Set(facts.routeIds);

    const skillClaims = extractDocClaims(
      await readScopedDoc(skillDocPath),
      skillDocPath,
    );
    const ledgerClaims = extractDocClaims(
      await readScopedDoc(ledgerDocPath),
      ledgerDocPath,
    );

    const docRouteIds = new Set(
      [...skillClaims.routeIds, ...ledgerClaims.routeIds].map((c) => c.token),
    );

    // The real clean-pass invariant: every route-ID the live docs CLAIM must
    // be a member of the live CLI's route_ids. A false positive (subroute or
    // field name leaking in) would not be a member and would fail here.
    for (const claimed of docRouteIds) {
      expect(liveRouteIds.has(claimed)).toBe(true);
    }
  });

  test("Stage 4 subroute names are NOT extracted as route ids (F11)", async () => {
    // These are conceptual subroute names from SKILL.md's <stage_shells>
    // section, structurally identical to route-catalog bullets but NOT route
    // ids. They previously leaked in via the unscoped bullet heuristic.
    const subrouteNames = [
      "select-eligible-batch",
      "start-batch-checkpoint",
      "builder-attempt",
      "validator-wave",
      "finding-repair",
      "converge-batch",
      "accepted-risk-or-reframe",
    ];
    const got = tokens(
      extractDocClaims(await readScopedDoc(skillDocPath), skillDocPath)
        .routeIds,
    );
    for (const name of subrouteNames) {
      expect(got).not.toContain(name);
    }
  });

  test("YAML field-name bullets are NOT extracted as route ids (F11)", async () => {
    // `status` / `iterations` are ledger field-name bullets under non-route
    // headings; they must not be mistaken for route ids.
    const got = tokens(
      extractDocClaims(await readScopedDoc(ledgerDocPath), ledgerDocPath)
        .routeIds,
    );
    expect(got).not.toContain("status");
    expect(got).not.toContain("iterations");
  });

  test("genuine route ids from the route catalog ARE still extracted", async () => {
    // The happy-path and blocked-* route ids live in SKILL.md's
    // <route_catalog>; scoping must not drop them. Anchor the "must include"
    // set to the live facts so this is not a hardcoded expectation (AC5): we
    // assert every live route id that the doc text literally mentions in a
    // route-catalog bullet is captured.
    const facts = await loadContractFacts();
    const skillText = await readScopedDoc(skillDocPath);
    const got = new Set(
      tokens(extractDocClaims(skillText, skillDocPath).routeIds),
    );
    // Sanity floor: the catalog covers the full happy path + blocked family,
    // so the extractor must capture the bulk of live route ids, not a handful.
    const captured = facts.routeIds.filter((id) => got.has(id));
    expect(captured.length).toBe(facts.routeIds.length);
  });
});

describe("F12: installed_artifact_presence.missing reconciles loader vs extractor", () => {
  test("loader facts now include data.installed_artifact_presence.missing", async () => {
    const facts = await loadContractFacts();
    expect(facts.responseFieldPaths.state).toContain(
      "data.installed_artifact_presence.missing",
    );
    // The diagnose copy resolves via cross-reference to the same children.
    expect(facts.responseFieldPaths.diagnose).toContain(
      "data.installed_artifact_presence.missing",
    );
  });

  test("every live-doc installed_artifact_presence field claim is a known fact", async () => {
    const facts = await loadContractFacts();
    const knownPaths = new Set([
      ...facts.responseFieldPaths.state,
      ...facts.responseFieldPaths.diagnose,
    ]);
    const gotchasClaims = extractDocClaims(
      await readScopedDoc(gotchasDocPath),
      gotchasDocPath,
    );
    const iapClaims = gotchasClaims.fieldPaths
      .map((c) => c.token)
      .filter((p) => p.startsWith("data.installed_artifact_presence"));

    // The doc's brace set expands to references/templates/cli_ts/lib_dir/
    // all_present/missing — including the previously-asymmetric `missing`.
    expect(iapClaims).toContain("data.installed_artifact_presence.missing");
    for (const path of iapClaims) {
      expect(knownPaths.has(path)).toBe(true);
    }
  });

  test("regression: blocking_gates still yields no invented children (F7/F10)", async () => {
    const facts = await loadContractFacts();
    expect(facts.responseFieldPaths.state).toContain("data.blocking_gates");
    const invented = facts.responseFieldPaths.state.some((p) =>
      p.startsWith("data.blocking_gates."),
    );
    expect(invented).toBe(false);
  });
});

describe("F14: route-id and packet-role negative guards", () => {
  test("a non-blocked kebab token in plain PROSE is NOT a route id", () => {
    // No route-catalog context, not a blocked-* token, not a route_id:
    // assignment — a backtick kebab token in prose must not be extracted.
    const doc =
      "The `select-eligible-batch` step runs first in normal prose, see below.";
    const got = tokens(extractDocClaims(doc, "doc.md").routeIds);
    expect(got).not.toContain("select-eligible-batch");
    expect(got.length).toBe(0);
  });

  test("a non-blocked kebab bullet OUTSIDE a route section is NOT a route id", () => {
    // A bullet whose nearest section heading does not mention routes must not
    // be treated as a route-catalog bullet.
    const doc = [
      "**Lifecycle fields**",
      "",
      "- `start-batch-checkpoint`: record the start.",
      "- `converge-batch`: run the gate.",
    ].join("\n");
    const got = tokens(extractDocClaims(doc, "doc.md").routeIds);
    expect(got).not.toContain("start-batch-checkpoint");
    expect(got).not.toContain("converge-batch");
    expect(got.length).toBe(0);
  });

  test("a non-packet cli.ts command arg does NOT yield a packet role", () => {
    // `cli.ts state somearg` — `state` is the command, `somearg` is its arg,
    // NOT a packet role. Only `cli.ts packet <role>` yields a packet role.
    const claims = extractDocClaims("`cli.ts state somearg --json`", "doc.md");
    expect(tokens(claims.packetRoles)).not.toContain("somearg");
    expect(claims.packetRoles.length).toBe(0);
  });
});

describe("F16: scoped-link title and image mis-parse", () => {
  test("strips a link title so the resolved target excludes the quoted title", () => {
    const doc = 'see [guide](first-run-gotchas.md "the recipes") for help.';
    const claims = extractDocClaims(
      doc,
      "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    );
    const link = claims.scopedLinks.find((l) => l.token === "guide");
    expect(link).toBeDefined();
    expect(link?.rawTarget).toBe("first-run-gotchas.md");
    expect(link?.resolvedTarget).toBe(
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
  });

  test("does NOT match the image portion of `![alt](img.png)`", () => {
    const doc = "an inline image ![diagram](diagram.png) in prose.";
    const claims = extractDocClaims(doc, "doc.md");
    expect(claims.scopedLinks.find((l) => l.token === "diagram")).toBeUndefined();
    expect(
      claims.scopedLinks.some((l) => l.rawTarget === "diagram.png"),
    ).toBe(false);
  });

  test("a real link adjacent to an image still extracts (image skipped only)", () => {
    const doc =
      "![alt](pic.png) and then [README](../README.md) for the map.";
    const claims = extractDocClaims(
      doc,
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
    expect(claims.scopedLinks.some((l) => l.rawTarget === "pic.png")).toBe(
      false,
    );
    const readme = claims.scopedLinks.find((l) => l.token === "README");
    expect(readme?.resolvedTarget).toBe("runbooks/issue-to-pr-v2/README.md");
  });
});

/**
 * Issue #81 — batch 3 (claim-fact comparator).
 *
 * `compareClaimsToFacts(claims, facts, opts?)` membership-tests each extracted
 * claim against the corresponding live fact set and returns structured
 * `DriftFinding[]` — never throws on a missing CLAIM target (that is drift
 * DATA), exact-match only (no case normalization, Key Decision 6).
 * `checkGotchasRelationship(opts?)` verifies the deterministic control-plane
 * relationship the workflow relies on (Key Decision 7).
 *
 * The "must-not-drift" anchors here come from the LIVE CLI facts and the real
 * docs, never a hardcoded contract list (AC5). Synthetic drift fixtures use
 * tokens that provably are NOT contract values (e.g. `frobnicate`).
 */

/** Build a minimal claims object with only the fields a test cares about. */
function claimsFrom(partial: Partial<DocClaims>): DocClaims {
  return {
    docPath: partial.docPath ?? "doc.md",
    routeIds: partial.routeIds ?? [],
    commands: partial.commands ?? [],
    slices: partial.slices ?? [],
    packetRoles: partial.packetRoles ?? [],
    fieldPaths: partial.fieldPaths ?? [],
    scopedLinks: partial.scopedLinks ?? [],
  };
}

/** A bare DocClaim with a fixed line/context for synthetic fixtures. */
function claim(token: string): { token: string; line: number; context: string } {
  return { token, line: 1, context: token };
}

/** Findings of one kind, terse. */
function findingsOfKind(
  findings: DriftFinding[],
  kind: DriftFinding["kind"],
): DriftFinding[] {
  return findings.filter((f) => f.kind === kind);
}

describe("AC1: route-ID claim membership against facts.routeIds", () => {
  test("a route-ID claim absent from facts.routeIds produces exactly one route-id finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ routeIds: [claim("blocked-nonexistent-route")] }),
      facts,
    );
    const routeFindings = findingsOfKind(findings, "route-id");
    expect(routeFindings.length).toBe(1);
    expect(routeFindings[0].claim).toBe("blocked-nonexistent-route");
  });

  test("a route-ID claim present in facts.routeIds produces no finding", async () => {
    const facts = await loadContractFacts();
    const live = facts.routeIds[0];
    const findings = await compareClaimsToFacts(
      claimsFrom({ routeIds: [claim(live)] }),
      facts,
    );
    expect(findingsOfKind(findings, "route-id").length).toBe(0);
  });
});

describe("AC2: command / slice / packet-role claim membership", () => {
  test("an unknown command claim produces one command finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ commands: [claim("frobnicate")] }),
      facts,
    );
    const commandFindings = findingsOfKind(findings, "command");
    expect(commandFindings.length).toBe(1);
    expect(commandFindings[0].claim).toBe("frobnicate");
  });

  test("an unknown slice claim produces one slice finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ slices: [claim("not_a_slice")] }),
      facts,
    );
    expect(findingsOfKind(findings, "slice").length).toBe(1);
    expect(findingsOfKind(findings, "slice")[0].claim).toBe("not_a_slice");
  });

  test("an unknown packet-role claim produces one packet-role finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ packetRoles: [claim("buildmaster")] }),
      facts,
    );
    expect(findingsOfKind(findings, "packet-role").length).toBe(1);
    expect(findingsOfKind(findings, "packet-role")[0].claim).toBe("buildmaster");
  });

  test("a live command / slice / packet-role claim produces no finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({
        commands: [claim(facts.commandNames[0])],
        slices: [claim(facts.contractSlices[0])],
        packetRoles: [claim(facts.packetRoles[0])],
      }),
      facts,
    );
    expect(findings.length).toBe(0);
  });
});

describe("AC3: data.* field-path claim membership against response shapes", () => {
  test("an unknown field-path claim produces one field-path finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ fieldPaths: [claim("data.totally_made_up")] }),
      facts,
    );
    expect(findingsOfKind(findings, "field-path").length).toBe(1);
    expect(findingsOfKind(findings, "field-path")[0].claim).toBe(
      "data.totally_made_up",
    );
  });

  test("a field-path that exists in EITHER state or diagnose shape is not drift", async () => {
    const facts = await loadContractFacts();
    // Pick a state-only and a diagnose-only path to prove the union semantics.
    const stateOnly = facts.responseFieldPaths.state[0];
    const diagnoseOnly = facts.responseFieldPaths.diagnose.find(
      (p) => !facts.responseFieldPaths.state.includes(p),
    );
    const claims = [claim(stateOnly)];
    if (diagnoseOnly) claims.push(claim(diagnoseOnly));
    const findings = await compareClaimsToFacts(
      claimsFrom({ fieldPaths: claims }),
      facts,
    );
    expect(findingsOfKind(findings, "field-path").length).toBe(0);
  });
});

describe("Key Decision 6: exact-match comparison, no case normalization", () => {
  test("a wrong-case route id `Blocked-Stage-3` is drift; the exact form is not", async () => {
    const facts = await loadContractFacts();
    // Use a known live blocked route in its exact lowercase form, then mangle
    // the case. The facts are sourced live, so this never hardcodes a value.
    const exact = facts.routeIds.find((id) => id.startsWith("blocked-"));
    expect(exact).toBeDefined();
    const exactId = exact as string;
    const mangled = exactId
      .split("-")
      .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
      .join("-");

    const driftFindings = await compareClaimsToFacts(
      claimsFrom({ routeIds: [claim(mangled)] }),
      facts,
    );
    expect(findingsOfKind(driftFindings, "route-id").length).toBe(1);

    const cleanFindings = await compareClaimsToFacts(
      claimsFrom({ routeIds: [claim(exactId)] }),
      facts,
    );
    expect(findingsOfKind(cleanFindings, "route-id").length).toBe(0);
  });

  test("a wrong-case field path `data.Route_ID` is drift", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ fieldPaths: [claim("data.Route_ID")] }),
      facts,
    );
    expect(findingsOfKind(findings, "field-path").length).toBe(1);
  });
});

describe("AC4: scoped-link existence checking", () => {
  const repoRoot = join(import.meta.dir, "..", "..");

  test("a scoped link to a missing recovery doc produces one scoped-link finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({
        docPath: "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
        scopedLinks: [
          {
            ...claim("missing recipe"),
            rawTarget: "no-such-recovery-doc.md",
            resolvedTarget:
              "runbooks/issue-to-pr-v2/references/no-such-recovery-doc.md",
          },
        ],
      }),
      facts,
      { repoRoot },
    );
    const linkFindings = findingsOfKind(findings, "scoped-link");
    expect(linkFindings.length).toBe(1);
    expect(linkFindings[0].claim).toBe(
      "runbooks/issue-to-pr-v2/references/no-such-recovery-doc.md",
    );
  });

  test("a scoped link to an existing file produces no finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({
        docPath: "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
        scopedLinks: [
          {
            ...claim("first-run-gotchas.md"),
            rawTarget: "first-run-gotchas.md",
            resolvedTarget:
              "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
          },
        ],
      }),
      facts,
      { repoRoot },
    );
    expect(findingsOfKind(findings, "scoped-link").length).toBe(0);
  });

  test("a directory target that exists produces no finding", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({
        docPath: "runbooks/issue-to-pr-v2/references/some-doc.md",
        scopedLinks: [
          {
            ...claim("issue-to-pr"),
            rawTarget: "../../issue-to-pr/",
            // Resolves to an existing directory.
            resolvedTarget: "skills/issue-to-pr",
          },
        ],
      }),
      facts,
      { repoRoot },
    );
    expect(findingsOfKind(findings, "scoped-link").length).toBe(0);
  });
});

describe("AC4: first-run-gotchas relationship check", () => {
  const repoRoot = join(import.meta.dir, "..", "..");

  test("the real SKILL.md + ledger-and-helper.md relationship produces no finding", async () => {
    const findings = await checkGotchasRelationship({ repoRoot });
    expect(findings).toEqual([]);
  });

  // F17 (load-bearing): deleting ONLY the step-7b orchestration block — while
  // leaving the route catalog and reference-loading-policy table intact — must
  // make signal (a) fire. This is the regression a whole-doc co-occurrence
  // check could NOT catch: `blocked-` and the guide path both still appear
  // elsewhere in the doc after the deletion, so the old logic returned 0
  // findings. The structural orchestration-step anchor returns a finding.
  test("deleting ONLY the step-7b load block (catalog + policy table intact) produces a finding", async () => {
    const realSkill = await Bun.file(
      join(repoRoot, "skills/issue-to-pr/SKILL.md"),
    ).text();
    const lines = realSkill.split("\n");
    const stepMarker = /^\s*\d+[a-z]?\.\s/;
    // Locate the `7b.` orchestration step block: marker line + continuation
    // lines up to the next step marker or a blank line.
    const start = lines.findIndex((l) => /^7b\.\s/.test(l));
    expect(start).toBeGreaterThanOrEqual(0);
    let end = start + 1;
    while (
      end < lines.length &&
      lines[end]?.trim() !== "" &&
      !stepMarker.test(lines[end] ?? "")
    ) {
      end += 1;
    }
    const mutated = [...lines.slice(0, start), ...lines.slice(end)].join("\n");

    // Sanity-check the mutation is surgical: the route catalog and the
    // reference-loading-policy table (which co-locate `blocked-` and the guide)
    // survive, so whole-doc co-occurrence would still hold.
    expect(mutated.includes("<route_catalog>")).toBe(true);
    expect(mutated.includes("<reference_loading_policy>")).toBe(true);
    expect(
      mutated.includes(
        "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
      ),
    ).toBe(true);
    expect(/blocked-/.test(mutated)).toBe(true);
    // But the operative `7b.` orchestration step is gone.
    expect(/^7b\.\s/m.test(mutated)).toBe(false);

    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-7b-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    await Bun.write(join(dir, "skills/issue-to-pr/SKILL.md"), mutated);
    // A valid ledger + present guide so ONLY signal (a) can fire.
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"),
      "### Blocked route ids\n\nsee [first-run-gotchas.md](first-run-gotchas.md).\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"),
      "# First run gotchas\n",
    );
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      const skillFindings = findings.filter(
        (f) => f.doc === "skills/issue-to-pr/SKILL.md",
      );
      expect(skillFindings.length).toBe(1);
      expect(skillFindings[0]?.kind).toBe("scoped-link");
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("a missing 7b control-plane load in SKILL.md produces one relationship finding", async () => {
    // Mock SKILL.md without the deterministic 7b first-run-gotchas load.
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-skill-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    const skillPath = join(dir, "skills/issue-to-pr/SKILL.md");
    const ledgerPath = join(
      dir,
      "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    );
    const gotchasPath = join(
      dir,
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
    await Bun.write(skillPath, "# Skill\n\nNo deterministic gotchas load here.\n");
    await Bun.write(
      ledgerPath,
      "### Blocked route ids\n\nsee [first-run-gotchas.md](first-run-gotchas.md).\n",
    );
    await Bun.write(gotchasPath, "# First run gotchas\n");
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      expect(findingsOfKind(findings, "scoped-link").length).toBe(1);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("a missing ledger-and-helper link to first-run-gotchas.md produces one finding", async () => {
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-ledger-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    const skillPath = join(dir, "skills/issue-to-pr/SKILL.md");
    const ledgerPath = join(
      dir,
      "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    );
    const gotchasPath = join(
      dir,
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
    await Bun.write(
      skillPath,
      "7b. When `data.route_id` begins with `blocked-`, also load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`.\n",
    );
    // ledger doc has the blocked section but NO link to the gotchas guide.
    await Bun.write(
      ledgerPath,
      "### Blocked route ids\n\nNo recovery link here.\n",
    );
    await Bun.write(gotchasPath, "# First run gotchas\n");
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      expect(findings.length).toBe(1);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("a link to a first-run-gotchas.md that does not exist on disk produces a finding", async () => {
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-target-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    const skillPath = join(dir, "skills/issue-to-pr/SKILL.md");
    const ledgerPath = join(
      dir,
      "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    );
    await Bun.write(
      skillPath,
      "7b. When `data.route_id` begins with `blocked-`, also load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`.\n",
    );
    await Bun.write(
      ledgerPath,
      "### Blocked route ids\n\nsee [first-run-gotchas.md](first-run-gotchas.md).\n",
    );
    // Deliberately DO NOT write first-run-gotchas.md — the link target is broken.
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings.some((f) => f.kind === "scoped-link")).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("a MISSING protected scoped doc is a hard error, not a finding", async () => {
    // checkGotchasRelationship must read SKILL.md and ledger-and-helper.md;
    // if a doc it is asked to read is absent, that is a hard error (throw),
    // distinct from a missing LINK target which is a finding (Key Decision 8).
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-hard-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    // Empty dir: SKILL.md does not exist.
    await Bun.$`mkdir -p ${dir}`.quiet();
    try {
      await expect(checkGotchasRelationship({ repoRoot: dir })).rejects.toThrow();
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  // F18.1: a SKILL.md whose only `blocked` token is `unblocked-...` does NOT
  // satisfy the blocked-route trigger, so signal (a) must still fire (no real
  // blocked-route load step exists). `unblocked-state` is a substring trap the
  // old `/blocked-/` regex would have wrongly accepted.
  test("an `unblocked-` token does not satisfy the blocked-route trigger", async () => {
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-unblocked-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    await Bun.write(
      join(dir, "skills/issue-to-pr/SKILL.md"),
      "7b. On an `unblocked-state` route, load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`.\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"),
      "### Blocked route ids\n\nsee [first-run-gotchas.md](first-run-gotchas.md).\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"),
      "# First run gotchas\n",
    );
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      const skillFindings = findings.filter(
        (f) => f.doc === "skills/issue-to-pr/SKILL.md",
      );
      expect(skillFindings.length).toBe(1);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  // F18.2: a basename-only guide reference in the step-7b construct is a
  // legitimate load — it must NOT produce a false 'missing 7b' finding. The
  // basename is unambiguous in this scope, so signal (a) accepts it.
  test("a basename-only guide reference in step 7b does not produce a false finding", async () => {
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-basename-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    await Bun.write(
      join(dir, "skills/issue-to-pr/SKILL.md"),
      "7b. When `data.route_id` begins with `blocked-`, this loop also loads `first-run-gotchas.md` deterministically.\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"),
      "### Blocked route ids\n\nsee [first-run-gotchas.md](first-run-gotchas.md).\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"),
      "# First run gotchas\n",
    );
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      const skillFindings = findings.filter(
        (f) => f.doc === "skills/issue-to-pr/SKILL.md",
      );
      expect(skillFindings.length).toBe(0);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  // F18.3: a ledger whose guide link lives OUTSIDE the blocked-route section
  // (e.g. in a cross-references footer) does NOT satisfy the relationship —
  // Key Decision 7 requires the link to come FROM the blocked-route section.
  test("a ledger guide-link outside the blocked-route section produces a finding", async () => {
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-ledger-section-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    await Bun.write(
      join(dir, "skills/issue-to-pr/SKILL.md"),
      "7b. When `data.route_id` begins with `blocked-`, also load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`.\n",
    );
    // The blocked-route section has NO guide link; the link only appears under
    // a later, unrelated heading.
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"),
      "### Blocked route ids\n\n| Route id | When |\n| --- | --- |\n| `blocked-stage-3` | stage 3 open finding. |\n\n### Cross references\n\nsee [first-run-gotchas.md](first-run-gotchas.md) for recipes.\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"),
      "# First run gotchas\n",
    );
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      const ledgerFindings = findings.filter(
        (f) =>
          f.doc === "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
      );
      expect(ledgerFindings.length).toBe(1);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  // F18.3 (positive control): a guide link INSIDE the blocked-route section
  // satisfies the relationship — no finding. Mirrors the live ledger layout.
  test("a ledger guide-link inside the blocked-route section produces no finding", async () => {
    const dir = join(
      import.meta.dir,
      `../../.tmp-gotchas-ledger-in-section-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    await Bun.write(
      join(dir, "skills/issue-to-pr/SKILL.md"),
      "7b. When `data.route_id` begins with `blocked-`, also load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`.\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"),
      "### Blocked route ids\n\n| Route id | When |\n| --- | --- |\n| `blocked-stage-3` | stage 3 open finding. |\n\nsee [first-run-gotchas.md](first-run-gotchas.md) for recovery recipes.\n\n### Special route ids\n\nnothing here.\n",
    );
    await Bun.write(
      join(dir, "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"),
      "# First run gotchas\n",
    );
    try {
      const findings = await checkGotchasRelationship({ repoRoot: dir });
      expect(findings).toEqual([]);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });
});

describe("Live clean-pass: real scoped docs produce ZERO drift findings", () => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const liveDocs = [
    "skills/issue-to-pr/SKILL.md",
    "runbooks/issue-to-pr-v2/README.md",
    "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
  ];

  // F19: docs known to carry contract tokens. Their clean pass must be EARNED
  // by real claims being extracted and matched, not vacuously satisfied by an
  // extractor regression that returns empty claims (which would also yield 0
  // findings). We pin a non-empty claim floor for these.
  const tokenCarryingDocs = new Set([
    "skills/issue-to-pr/SKILL.md",
    "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
  ]);

  /** Total claims extracted across all kinds, for the non-empty floor. */
  const totalClaims = (c: DocClaims): number =>
    c.routeIds.length +
    c.commands.length +
    c.slices.length +
    c.packetRoles.length +
    c.fieldPaths.length +
    c.scopedLinks.length;

  test("each of the 4 scoped docs reconciles cleanly against live facts", async () => {
    const facts = await loadContractFacts();
    for (const rel of liveDocs) {
      const text = await Bun.file(join(repoRoot, rel)).text();
      const claims = extractDocClaims(text, rel);
      // F19: token-carrying docs must extract at least one claim, so the
      // "zero findings" assertion below proves real matching, not an empty set.
      if (tokenCarryingDocs.has(rel)) {
        expect(totalClaims(claims)).toBeGreaterThan(0);
      }
      const findings = await compareClaimsToFacts(claims, facts, { repoRoot });
      // The clean-pass invariant batch 4 depends on: zero drift per real doc.
      if (findings.length > 0) {
        throw new Error(
          `clean-pass violated for ${rel}: ${JSON.stringify(findings, null, 2)}`,
        );
      }
      expect(findings.length).toBe(0);
    }
  });

  test("the live gotchas relationship check returns zero findings", async () => {
    const findings = await checkGotchasRelationship({ repoRoot });
    expect(findings).toEqual([]);
  });
});

describe("comparator returns findings as DATA, never throws on claim drift", () => {
  test("multiple drift kinds in one claims set are all reported together", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({
        routeIds: [claim("blocked-nope")],
        commands: [claim("frobnicate")],
        slices: [claim("not_a_slice")],
        packetRoles: [claim("buildmaster")],
        fieldPaths: [claim("data.nope")],
      }),
      facts,
    );
    expect(findingsOfKind(findings, "route-id").length).toBe(1);
    expect(findingsOfKind(findings, "command").length).toBe(1);
    expect(findingsOfKind(findings, "slice").length).toBe(1);
    expect(findingsOfKind(findings, "packet-role").length).toBe(1);
    expect(findingsOfKind(findings, "field-path").length).toBe(1);
  });

  test("each finding carries doc, kind, claim, and a human reason", async () => {
    const facts = await loadContractFacts();
    const findings = await compareClaimsToFacts(
      claimsFrom({ docPath: "some/doc.md", routeIds: [claim("blocked-nope")] }),
      facts,
    );
    const f = findings[0] as DriftFinding;
    expect(f.doc).toBe("some/doc.md");
    expect(f.kind).toBe("route-id");
    expect(f.claim).toBe("blocked-nope");
    expect(typeof f.reason).toBe("string");
    expect(f.reason.length).toBeGreaterThan(0);
  });
});

/**
 * Issue #81 — batch 4 (orchestrator + runnable entry).
 *
 * `checkContractDrift(opts?)` ties the loader, extractor, comparator, and
 * gotchas-relationship check together over the four scoped operator docs and
 * returns `{ ok, findings }`. These tests prove:
 *  - AC7: a fixture doc with a deliberately STALE contract claim (a route id
 *    not in the live route_ids, a removed command, a bogus data.* path, a
 *    missing scoped link) makes the check return `ok:false` with a finding
 *    NAMING that token — the check fails for a real mismatch (load-bearing).
 *  - AC1: over the four REAL scoped docs the check returns `ok:true` (docs in
 *    sync), and a MISSING scoped doc is a hard error (throw), not a clean pass.
 *  - AC6: the check (and the runnable entry) perform no filesystem writes / no
 *    git mutations; the four scoped docs are unchanged after a run.
 *
 * Fixture docs are written to a temp dir (test scaffolding); the CHECK under
 * test reads them read-only. Stale tokens are provably NOT contract values
 * (e.g. `blocked-nonexistent-route`, `frobnicate`, `data.totally_made_up`).
 */
describe("AC1/AC6/AC7: checkContractDrift orchestrator", () => {
  const realRepoRoot = join(import.meta.dir, "..", "..");
  const scopedDocRels = [
    "skills/issue-to-pr/SKILL.md",
    "runbooks/issue-to-pr-v2/README.md",
    "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
  ];

  /**
   * Stage a fixture repo by copying the four REAL scoped docs into a temp dir,
   * so the gotchas relationship + clean-pass invariants hold by default. The
   * caller mutates one doc to inject drift. The CLI is still the real sibling
   * cli.ts (facts come from the live surface), via the default cliPath.
   */
  async function stageFixtureRepo(): Promise<string> {
    const dir = join(
      import.meta.dir,
      `../../.tmp-cd-orch-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    for (const rel of scopedDocRels) {
      const text = await Bun.file(join(realRepoRoot, rel)).text();
      await Bun.write(join(dir, rel), text);
    }
    return dir;
  }

  test("AC1: over the 4 REAL scoped docs the check returns ok:true with no findings", async () => {
    const result = await checkContractDrift({ repoRoot: realRepoRoot });
    if (!result.ok) {
      throw new Error(
        `expected clean pass, got: ${JSON.stringify(result.findings, null, 2)}`,
      );
    }
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("AC7: a fixture doc with a stale route-ID claim makes the check fail, naming the token", async () => {
    const dir = await stageFixtureRepo();
    // Inject a route_id assignment whose value is provably NOT a live route id.
    const staleToken = "blocked-nonexistent-route";
    const readme = join(dir, "runbooks/issue-to-pr-v2/README.md");
    const original = await Bun.file(readme).text();
    await Bun.write(
      readme,
      `${original}\n\nStale claim: \`route_id: "${staleToken}"\` should be caught.\n`,
    );
    try {
      const result = await checkContractDrift({ repoRoot: dir });
      expect(result.ok).toBe(false);
      const named = result.findings.find(
        (f) => f.kind === "route-id" && f.claim === staleToken,
      );
      expect(named).toBeDefined();
      expect(named?.doc).toBe("runbooks/issue-to-pr-v2/README.md");
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("AC7: a removed/bogus command claim makes the check fail, naming the command", async () => {
    const dir = await stageFixtureRepo();
    const readme = join(dir, "runbooks/issue-to-pr-v2/README.md");
    const original = await Bun.file(readme).text();
    await Bun.write(
      readme,
      `${original}\n\nRun \`bun runbooks/issue-to-pr-v2/cli.ts frobnicate --json\`.\n`,
    );
    try {
      const result = await checkContractDrift({ repoRoot: dir });
      expect(result.ok).toBe(false);
      expect(
        result.findings.some(
          (f) => f.kind === "command" && f.claim === "frobnicate",
        ),
      ).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("AC7: a bogus data.* field-path claim makes the check fail, naming the path", async () => {
    const dir = await stageFixtureRepo();
    const readme = join(dir, "runbooks/issue-to-pr-v2/README.md");
    const original = await Bun.file(readme).text();
    await Bun.write(
      readme,
      `${original}\n\nInspect \`data.totally_made_up\` for the result.\n`,
    );
    try {
      const result = await checkContractDrift({ repoRoot: dir });
      expect(result.ok).toBe(false);
      expect(
        result.findings.some(
          (f) => f.kind === "field-path" && f.claim === "data.totally_made_up",
        ),
      ).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("AC7: a missing scoped-link target makes the check fail, naming the resolved target", async () => {
    const dir = await stageFixtureRepo();
    const ledger = join(
      dir,
      "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
    );
    const original = await Bun.file(ledger).text();
    await Bun.write(
      ledger,
      `${original}\n\nSee [missing recipe](./no-such-recovery-doc.md) for details.\n`,
    );
    try {
      const result = await checkContractDrift({ repoRoot: dir });
      expect(result.ok).toBe(false);
      expect(
        result.findings.some(
          (f) =>
            f.kind === "scoped-link" &&
            f.claim.endsWith("no-such-recovery-doc.md"),
        ),
      ).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("AC6: aggregation — drift in two different docs is collected, not short-circuited", async () => {
    const dir = await stageFixtureRepo();
    const readme = join(dir, "runbooks/issue-to-pr-v2/README.md");
    const gotchas = join(
      dir,
      "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
    );
    await Bun.write(
      readme,
      `${await Bun.file(readme).text()}\n\nStale: \`route_id: "blocked-nonexistent-route"\`.\n`,
    );
    await Bun.write(
      gotchas,
      `${await Bun.file(gotchas).text()}\n\nBogus: \`data.totally_made_up\`.\n`,
    );
    try {
      const result = await checkContractDrift({ repoRoot: dir });
      expect(result.ok).toBe(false);
      const docsWithFindings = new Set(result.findings.map((f) => f.doc));
      expect(docsWithFindings.has("runbooks/issue-to-pr-v2/README.md")).toBe(
        true,
      );
      expect(
        docsWithFindings.has(
          "runbooks/issue-to-pr-v2/references/first-run-gotchas.md",
        ),
      ).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("AC1/KD8: a MISSING scoped doc is a hard error (throw), not a clean ok:true result", async () => {
    // Point the doc list at a path that does not exist; the orchestrator must
    // throw (naming the doc), never return a clean pass for an absent doc.
    const missingRel = "runbooks/issue-to-pr-v2/does-not-exist.md";
    await expect(
      checkContractDrift({
        repoRoot: realRepoRoot,
        scopedDocs: [missingRel],
      }),
    ).rejects.toThrow(/does-not-exist\.md/);
  });

  test("AC6: a failed CLI load throws (hard error), never a clean result", async () => {
    await expect(
      checkContractDrift({
        repoRoot: realRepoRoot,
        cliPath: join(import.meta.dir, "does-not-exist-cli.ts"),
      }),
    ).rejects.toThrow();
  });

  test("AC6: the check performs no writes — the 4 scoped docs are unchanged after a run", async () => {
    // Capture content + mtime of each real scoped doc, run the check, and
    // assert nothing changed on disk (read-only invariant).
    const before = await Promise.all(
      scopedDocRels.map(async (rel) => {
        const abs = join(realRepoRoot, rel);
        return {
          rel,
          text: await Bun.file(abs).text(),
          mtimeMs: statSync(abs).mtimeMs,
        };
      }),
    );
    await checkContractDrift({ repoRoot: realRepoRoot });
    for (const snap of before) {
      const abs = join(realRepoRoot, snap.rel);
      expect(await Bun.file(abs).text()).toBe(snap.text);
      expect(statSync(abs).mtimeMs).toBe(snap.mtimeMs);
    }
  });
});
