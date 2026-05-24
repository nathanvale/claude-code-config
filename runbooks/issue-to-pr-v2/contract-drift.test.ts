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
import { execPath } from "node:process";
import { join } from "node:path";

import { loadContractFacts } from "./contract-drift";

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
    await rejects.toThrow(/no data object|data/i);
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
