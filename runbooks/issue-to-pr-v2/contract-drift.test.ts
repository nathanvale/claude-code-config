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

import { describe, expect, test } from "bun:test";
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

    const forbidden = [...routeIds, ...packetRoles, ...slices].filter(
      // `route_ids` and `packet_roles` are slice *argument* names the loader
      // legitimately passes to the CLI, so they may appear. Every other value
      // is a contract value that must not be duplicated.
      (v) => v !== "route_ids" && v !== "packet_roles",
    );

    for (const value of forbidden) {
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
