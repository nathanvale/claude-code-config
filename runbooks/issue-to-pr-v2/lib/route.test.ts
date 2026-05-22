import { describe, expect, test } from "bun:test";

import {
  BLOCKED_ROUTE_IDS,
  blockingGatesFor,
  buildDiagnoseDrift,
  classifyRoute,
  computeDigestDrift,
  installedArtifactPresence,
  isRouteId,
  requiredReferenceIdsFor,
  ROUTE_IDS,
  type RouteId,
  type RouteInputs,
  SPECIAL_ROUTE_IDS,
  STAGE_ROUTE_IDS,
} from "./route";

function inputs(overrides: Partial<RouteInputs> = {}): RouteInputs {
  return {
    ledger_exists: true,
    acceptance_criteria: "confirmed",
    batch_contract: "confirmed",
    digests: "confirmed",
    plan_path: "docs/plans/2026-05-22-001-feat-thing.md",
    has_batches: true,
    all_batches_terminal: false,
    final_reviewed_at: null,
    pr_url: null,
    frontmatter_status: "in-progress",
    runbook_version_skew: null,
    ...overrides,
  };
}

describe("ROUTE_IDS catalog", () => {
  test("is the union of STAGE_ROUTE_IDS + BLOCKED_ROUTE_IDS + SPECIAL_ROUTE_IDS", () => {
    expect(ROUTE_IDS).toEqual([
      ...STAGE_ROUTE_IDS,
      ...BLOCKED_ROUTE_IDS,
      ...SPECIAL_ROUTE_IDS,
    ]);
  });

  test("has no duplicate ids", () => {
    expect(new Set(ROUTE_IDS).size).toBe(ROUTE_IDS.length);
  });

  test("STAGE_ROUTE_IDS enumerates the six v1 stages + shipped", () => {
    expect(STAGE_ROUTE_IDS).toEqual([
      "pick-issue",
      "plan",
      "decompose",
      "batch-loop",
      "final-review",
      "ship",
      "shipped",
    ]);
  });

  test("BLOCKED_ROUTE_IDS covers the six durable blocked states in precedence order", () => {
    expect(BLOCKED_ROUTE_IDS).toEqual([
      "blocked-frontmatter-blocked-reason",
      "blocked-runbook-version-skew",
      "blocked-acceptance-criteria-stale",
      "blocked-stage-3",
      "blocked-batch-contract-stale",
      "blocked-digests-stale",
    ]);
  });

  test("SPECIAL_ROUTE_IDS lists no-ledger only", () => {
    expect(SPECIAL_ROUTE_IDS).toEqual(["no-ledger"]);
  });
});

describe("isRouteId", () => {
  test("returns true for every catalog id", () => {
    for (const id of ROUTE_IDS) {
      expect(isRouteId(id)).toBe(true);
    }
  });

  test("returns false for unknown strings", () => {
    expect(isRouteId("bogus")).toBe(false);
    expect(isRouteId("")).toBe(false);
    expect(isRouteId("blocked-")).toBe(false);
  });
});

describe("classifyRoute: special routes", () => {
  test("returns no-ledger when ledger_exists is false", () => {
    expect(classifyRoute(inputs({ ledger_exists: false }))).toBe("no-ledger");
  });

  test("ignores every other input when ledger_exists is false", () => {
    expect(
      classifyRoute(
        inputs({
          ledger_exists: false,
          acceptance_criteria: "blocked",
          frontmatter_status: "shipped",
          pr_url: "https://example.test/pr/1",
        }),
      ),
    ).toBe("no-ledger");
  });
});

describe("classifyRoute: happy-path stage progression", () => {
  test("pick-issue when acceptance_criteria is pending", () => {
    expect(
      classifyRoute(inputs({ acceptance_criteria: "pending" })),
    ).toBe("pick-issue");
  });

  test("plan when AC confirmed but plan_path is null", () => {
    expect(
      classifyRoute(
        inputs({
          plan_path: null,
          batch_contract: "pending",
          has_batches: false,
        }),
      ),
    ).toBe("plan");
  });

  test("decompose when AC + plan path present but batch contract pending", () => {
    expect(
      classifyRoute(
        inputs({ batch_contract: "pending", has_batches: false }),
      ),
    ).toBe("decompose");
  });

  test("decompose when batch contract confirmed but has_batches is false", () => {
    expect(
      classifyRoute(inputs({ has_batches: false })),
    ).toBe("decompose");
  });

  test("batch-loop when batches exist but not all are terminal", () => {
    expect(
      classifyRoute(inputs({ all_batches_terminal: false })),
    ).toBe("batch-loop");
  });

  test("final-review when all batches terminal but final_reviewed_at is null", () => {
    expect(
      classifyRoute(
        inputs({ all_batches_terminal: true, final_reviewed_at: null }),
      ),
    ).toBe("final-review");
  });

  test("ship when final review done but pr_url null", () => {
    expect(
      classifyRoute(
        inputs({
          all_batches_terminal: true,
          final_reviewed_at: "2026-05-22T03:00:00Z",
        }),
      ),
    ).toBe("ship");
  });

  test("shipped when pr_url set and frontmatter_status: shipped", () => {
    expect(
      classifyRoute(
        inputs({
          all_batches_terminal: true,
          final_reviewed_at: "2026-05-22T03:00:00Z",
          pr_url: "https://example.test/pr/1",
          frontmatter_status: "shipped",
        }),
      ),
    ).toBe("shipped");
  });
});

describe("classifyRoute: blocked states", () => {
  test("blocked-frontmatter-blocked-reason wins over any other state", () => {
    expect(
      classifyRoute(
        inputs({
          frontmatter_status: "blocked",
          acceptance_criteria: "pending",
          batch_contract: "stale",
        }),
      ),
    ).toBe("blocked-frontmatter-blocked-reason");
  });

  test("blocked-runbook-version-skew when skew is mismatched", () => {
    expect(
      classifyRoute(inputs({ runbook_version_skew: "mismatched" })),
    ).toBe("blocked-runbook-version-skew");
  });

  test("blocked-runbook-version-skew when skew is missing", () => {
    expect(
      classifyRoute(inputs({ runbook_version_skew: "missing" })),
    ).toBe("blocked-runbook-version-skew");
  });

  test("continuation-evidence-present does NOT block", () => {
    expect(
      classifyRoute(
        inputs({ runbook_version_skew: "continuation-evidence-present" }),
      ),
    ).toBe("batch-loop"); // falls through to happy-path
  });

  test("matched skew does NOT block", () => {
    expect(
      classifyRoute(inputs({ runbook_version_skew: "matched" })),
    ).toBe("batch-loop");
  });

  test("blocked-acceptance-criteria-stale when AC confirmation is blocked", () => {
    expect(
      classifyRoute(inputs({ acceptance_criteria: "blocked" })),
    ).toBe("blocked-acceptance-criteria-stale");
  });

  test("blocked-stage-3 when batch_contract is blocked", () => {
    expect(
      classifyRoute(inputs({ batch_contract: "blocked" })),
    ).toBe("blocked-stage-3");
  });

  test("blocked-acceptance-criteria-stale when AC drifted to stale", () => {
    expect(
      classifyRoute(inputs({ acceptance_criteria: "stale" })),
    ).toBe("blocked-acceptance-criteria-stale");
  });

  test("blocked-batch-contract-stale when batch contract drifted to stale", () => {
    expect(
      classifyRoute(inputs({ batch_contract: "stale" })),
    ).toBe("blocked-batch-contract-stale");
  });

  test("blocked-digests-stale when only digests drifted to stale", () => {
    expect(
      classifyRoute(inputs({ digests: "stale" })),
    ).toBe("blocked-digests-stale");
  });

  test("U7 F016: blocked-digests-stale wins over final-review when digests drift after every batch terminal", () => {
    // Regression for the U7 audit's scenario 4: stale digests must
    // route to Stage 3 BEFORE Stage 5 or Stage 6 work, even when the
    // happy-path classifier would otherwise return `final-review` or
    // `ship`. The precedence walk inside classifyRoute (route.ts
    // L148-149) reads digest staleness before any final-review or
    // ship-state check; this test pins that precedence.
    expect(
      classifyRoute(
        inputs({
          digests: "stale",
          all_batches_terminal: true,
          final_reviewed_at: null,
        }),
      ),
    ).toBe("blocked-digests-stale");
    expect(
      classifyRoute(
        inputs({
          digests: "stale",
          all_batches_terminal: true,
          final_reviewed_at: "2026-05-23T00:00:00.000Z",
          pr_url: null,
        }),
      ),
    ).toBe("blocked-digests-stale");
  });
});

describe("classifyRoute: determinism", () => {
  test("same inputs always produce the same id (10 iterations)", () => {
    const input = inputs({ all_batches_terminal: true });
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) results.add(classifyRoute(input));
    expect(results.size).toBe(1);
  });
});

describe("computeDigestDrift (F002 fix: symmetric three-axis shape)", () => {
  test("all confirmed → no drift on any axis", () => {
    const drift = computeDigestDrift({
      acceptance_criteria: "confirmed",
      batch_contract: "confirmed",
      digests: "confirmed",
    });
    expect(drift).toEqual({
      acceptance_criteria: false,
      batch_contract: false,
      digests: false,
      any: false,
    });
  });

  test("only digests stale → digests:true, any:true, others false", () => {
    const drift = computeDigestDrift({
      acceptance_criteria: "confirmed",
      batch_contract: "confirmed",
      digests: "stale",
    });
    expect(drift).toEqual({
      acceptance_criteria: false,
      batch_contract: false,
      digests: true,
      any: true,
    });
  });

  test("acceptance_criteria stale → axis flag + any flag set", () => {
    const drift = computeDigestDrift({
      acceptance_criteria: "stale",
      batch_contract: "confirmed",
      digests: "confirmed",
    });
    expect(drift.acceptance_criteria).toBe(true);
    expect(drift.any).toBe(true);
    expect(drift.batch_contract).toBe(false);
    expect(drift.digests).toBe(false);
  });
});

describe("requiredReferenceIdsFor (F010 fix: exhaustiveness guard)", () => {
  test("returns a non-empty list for every catalog route id except shipped", () => {
    for (const id of ROUTE_IDS as readonly RouteId[]) {
      const refs = requiredReferenceIdsFor(id);
      if (id === "shipped") {
        expect(refs).toEqual([]);
      } else {
        expect(refs.length).toBeGreaterThan(0);
      }
    }
  });

  test("batch-loop returns the full Stage 4 reference set", () => {
    expect(requiredReferenceIdsFor("batch-loop")).toEqual([
      "stage-4-batch-loop.md",
      "builder-dispatch.md",
      "host-adapters.md",
      "findings-and-validators.md",
      "ledger-and-helper.md",
    ]);
  });

  test("no-ledger points back at Stage 1", () => {
    expect(requiredReferenceIdsFor("no-ledger")).toEqual([
      "stage-1-pick-issue.md",
    ]);
  });

  test("every blocked-* AC/batch/digest/stage-3 route shares the ledger + decompose refs", () => {
    for (const id of [
      "blocked-acceptance-criteria-stale",
      "blocked-batch-contract-stale",
      "blocked-digests-stale",
      "blocked-stage-3",
    ] as const) {
      expect(requiredReferenceIdsFor(id)).toEqual([
        "ledger-and-helper.md",
        "stage-3-decompose.md",
      ]);
    }
  });
});

describe("blockingGatesFor (F006 fix: typed discriminated union)", () => {
  test("no gates on a healthy in-progress route", () => {
    expect(
      blockingGatesFor({
        route: "batch-loop",
        confirmation_state: {
          acceptance_criteria: "confirmed",
          batch_contract: "confirmed",
          digests: "confirmed",
        },
        frontmatter_status: "in-progress",
      }),
    ).toEqual([]);
  });

  test("emits a kind:route_id gate for any blocked-* route", () => {
    const gates = blockingGatesFor({
      route: "blocked-acceptance-criteria-stale",
      confirmation_state: {
        acceptance_criteria: "stale",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
    });
    expect(gates).toContainEqual({
      kind: "route_id",
      value: "blocked-acceptance-criteria-stale",
    });
  });

  test("emits a kind:field gate for frontmatter.status:blocked", () => {
    const gates = blockingGatesFor({
      route: "blocked-frontmatter-blocked-reason",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "blocked",
    });
    expect(gates).toContainEqual({
      kind: "field",
      field: "frontmatter.status",
      value: "blocked",
    });
    expect(gates).toContainEqual({
      kind: "route_id",
      value: "blocked-frontmatter-blocked-reason",
    });
  });

  test("emits a kind:field gate for batch_contract_confirmation_status:blocked", () => {
    const gates = blockingGatesFor({
      route: "blocked-stage-3",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "blocked",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
    });
    expect(gates).toContainEqual({
      kind: "field",
      field: "batch_contract_confirmation_status",
      value: "blocked",
    });
  });

  test("returns typed records, never raw strings", () => {
    const gates = blockingGatesFor({
      route: "blocked-frontmatter-blocked-reason",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "blocked",
    });
    for (const gate of gates) {
      expect(typeof gate).toBe("object");
      expect(gate.kind === "route_id" || gate.kind === "field").toBe(true);
    }
  });

  test("F011-coverage: emits a kind:field gate for ac_confirmation_status:blocked", () => {
    const gates = blockingGatesFor({
      route: "blocked-acceptance-criteria-stale",
      confirmation_state: {
        acceptance_criteria: "blocked",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
    });
    expect(gates).toContainEqual({
      kind: "field",
      field: "ac_confirmation_status",
      value: "blocked",
    });
  });

  test("U6: missing runbook_version_skew emits frontmatter.runbook_version stop-required field gate", () => {
    const gates = blockingGatesFor({
      route: "blocked-runbook-version-skew",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
      runbook_version_skew: "missing",
    });
    expect(gates).toContainEqual({
      kind: "field",
      field: "frontmatter.runbook_version",
      value: "missing",
    });
    expect(gates).toContainEqual({
      kind: "route_id",
      value: "blocked-runbook-version-skew",
    });
  });

  test("U6: mismatched runbook_version_skew emits frontmatter.runbook_version stop-required field gate", () => {
    const gates = blockingGatesFor({
      route: "blocked-runbook-version-skew",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
      runbook_version_skew: "mismatched",
    });
    expect(gates).toContainEqual({
      kind: "field",
      field: "frontmatter.runbook_version",
      value: "mismatched",
    });
  });

  test("U6: continuation-evidence-present does NOT emit the runbook_version stop-required gate", () => {
    const gates = blockingGatesFor({
      route: "batch-loop",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
      runbook_version_skew: "continuation-evidence-present",
    });
    for (const gate of gates) {
      if (gate.kind === "field") {
        expect(gate.field).not.toBe("frontmatter.runbook_version");
      }
    }
  });

  test("U6: matched runbook_version_skew does NOT emit the stop-required gate", () => {
    const gates = blockingGatesFor({
      route: "batch-loop",
      confirmation_state: {
        acceptance_criteria: "confirmed",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
      frontmatter_status: "in-progress",
      runbook_version_skew: "matched",
    });
    expect(gates).toEqual([]);
  });

  test("U6: null runbook_version_skew (no-ledger case) does NOT emit the stop-required gate", () => {
    const gates = blockingGatesFor({
      route: "no-ledger",
      confirmation_state: {
        acceptance_criteria: "pending",
        batch_contract: "pending",
        digests: "pending",
      },
      frontmatter_status: null,
      runbook_version_skew: null,
    });
    expect(gates).toEqual([]);
  });
});

describe("buildDiagnoseDrift (F037 hoist: dedicated unit test)", () => {
  test("all-confirmed snapshot returns no drift on any axis + findings_table_drift: null", () => {
    expect(
      buildDiagnoseDrift({
        confirmation_state: {
          acceptance_criteria: "confirmed",
          batch_contract: "confirmed",
          digests: "confirmed",
        },
      }),
    ).toEqual({
      digest_drift: {
        acceptance_criteria: false,
        batch_contract: false,
        digests: false,
        any: false,
      },
      findings_table_drift: null,
    });
  });

  test("stale-on-an-axis snapshot flags the right axis and `any`", () => {
    const drift = buildDiagnoseDrift({
      confirmation_state: {
        acceptance_criteria: "stale",
        batch_contract: "confirmed",
        digests: "confirmed",
      },
    });
    expect(drift.digest_drift.acceptance_criteria).toBe(true);
    expect(drift.digest_drift.any).toBe(true);
    expect(drift.findings_table_drift).toBe(null);
  });

  test("findings_table_drift is always null in U4 (forward-compat pin)", () => {
    // U6/U9 will widen this shape. The test exists so the widening is a
    // visible test-file change rather than a silent contract drift.
    const drift = buildDiagnoseDrift({
      confirmation_state: {
        acceptance_criteria: "blocked",
        batch_contract: "stale",
        digests: "stale",
      },
    });
    expect(drift.findings_table_drift).toBe(null);
  });
});

describe("installedArtifactPresence (U6: real recursive walk)", () => {
  test("default invocation against the live v2 install reports every root present", () => {
    const presence = installedArtifactPresence();
    expect(presence).toEqual({
      references: true,
      templates: true,
      cli_ts: true,
      lib_dir: true,
      all_present: true,
      missing: [],
    });
  });

  test("non-existent install path collapses every root to missing", () => {
    const presence = installedArtifactPresence(
      "/tmp/does-not-exist-u6-install-root",
    );
    expect(presence.all_present).toBe(false);
    expect(presence.references).toBe(false);
    expect(presence.templates).toBe(false);
    expect(presence.cli_ts).toBe(false);
    expect(presence.lib_dir).toBe(false);
    expect([...presence.missing].sort()).toEqual(
      ["cli_ts", "lib_dir", "references", "templates"],
    );
  });

  test("partial install reports only the missing roots", () => {
    // Use the v2 root for references/templates/lib_dir, but resolve
    // cli_ts off a sibling directory that doesn't contain cli.ts.
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-"));
    try {
      mkdirSync(join(fakeRoot, "references"));
      writeFileSync(join(fakeRoot, "references", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      // No cli.ts on purpose.
      const presence = installedArtifactPresence(fakeRoot);
      expect(presence.references).toBe(true);
      expect(presence.templates).toBe(true);
      expect(presence.lib_dir).toBe(true);
      expect(presence.cli_ts).toBe(false);
      expect(presence.all_present).toBe(false);
      expect(presence.missing).toEqual(["cli_ts"]);
      // Loop-safety smoke: a symlink loop inside references/ does not
      // hang or escape the walk.
      symlinkSync(
        join(fakeRoot, "references"),
        join(fakeRoot, "references", "loop"),
      );
      const presence2 = installedArtifactPresence(fakeRoot);
      expect(presence2.references).toBe(true);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("empty subdirectory is reported as missing (recursive walk requires at least one file)", () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-empty-"));
    try {
      // references/ exists but is empty.
      mkdirSync(join(fakeRoot, "references"));
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      writeFileSync(join(fakeRoot, "cli.ts"), "// noop\n");
      const presence = installedArtifactPresence(fakeRoot);
      expect(presence.references).toBe(false);
      expect(presence.missing).toEqual(["references"]);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("only-empty-nested-directory subtree is missing (no file at any depth)", () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-nested-"));
    try {
      mkdirSync(join(fakeRoot, "references", "deep", "deeper"), {
        recursive: true,
      });
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      writeFileSync(join(fakeRoot, "cli.ts"), "// noop\n");
      const presence = installedArtifactPresence(fakeRoot);
      expect(presence.references).toBe(false);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("does not leak any per-file enumeration in the response shape (U6 MUST-NOT)", () => {
    const presence = installedArtifactPresence();
    const keys = Object.keys(presence).sort();
    expect(keys).toEqual(
      [
        "all_present",
        "cli_ts",
        "lib_dir",
        "missing",
        "references",
        "templates",
      ].sort(),
    );
    // No path-shaped strings anywhere — `missing` is a fixed-vocabulary
    // tag set, not a file list.
    for (const tag of presence.missing) {
      expect(["references", "templates", "cli_ts", "lib_dir"]).toContain(tag);
    }
  });

  test("regular file at a directory-root path reports that root missing", () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-fileat-"));
    try {
      // references is a regular file, not a directory.
      writeFileSync(join(fakeRoot, "references"), "oops\n");
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      writeFileSync(join(fakeRoot, "cli.ts"), "// noop\n");
      const presence = installedArtifactPresence(fakeRoot);
      expect(presence.references).toBe(false);
      expect(presence.missing).toContain("references");
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("directory at the cli_ts path reports cli_ts missing", () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-dirat-"));
    try {
      mkdirSync(join(fakeRoot, "references"));
      writeFileSync(join(fakeRoot, "references", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      // cli.ts is a directory, not a file.
      mkdirSync(join(fakeRoot, "cli.ts"));
      const presence = installedArtifactPresence(fakeRoot);
      expect(presence.cli_ts).toBe(false);
      expect(presence.missing).toContain("cli_ts");
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("directory containing only a symlink-to-file reports that root present", () => {
    // Regression for the correctness sweep-1 finding: previously a
    // root containing only a symlink pointing at a regular file was
    // misclassified as missing because walkHasFile expected a
    // directory after dereferencing.
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-sym2file-"));
    try {
      writeFileSync(join(fakeRoot, "real.md"), "hello\n");
      mkdirSync(join(fakeRoot, "references"));
      symlinkSync(
        join(fakeRoot, "real.md"),
        join(fakeRoot, "references", "linked.md"),
      );
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      writeFileSync(join(fakeRoot, "cli.ts"), "// noop\n");
      const presence = installedArtifactPresence(fakeRoot);
      expect(presence.references).toBe(true);
      expect(presence.all_present).toBe(true);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("broken symlink does not poison the walk", () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-broken-"));
    try {
      mkdirSync(join(fakeRoot, "references"));
      // Symlink to a target that does not exist.
      symlinkSync(
        join(fakeRoot, "nope.md"),
        join(fakeRoot, "references", "broken.md"),
      );
      writeFileSync(join(fakeRoot, "references", "real.md"), "x\n");
      mkdirSync(join(fakeRoot, "templates"));
      writeFileSync(join(fakeRoot, "templates", "stub.md"), "x\n");
      mkdirSync(join(fakeRoot, "lib"));
      writeFileSync(join(fakeRoot, "lib", "stub.ts"), "export {};\n");
      writeFileSync(join(fakeRoot, "cli.ts"), "// noop\n");
      const presence = installedArtifactPresence(fakeRoot);
      // Broken symlink is skipped; real.md still counts.
      expect(presence.references).toBe(true);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  test("isolated symlink loop returns bounded result without hang", () => {
    // Build a root whose references/ subtree contains nothing but a
    // self-loop. The walk must terminate (no hang, no exception) and
    // report references missing because no regular file exists in the
    // subtree.
    const { mkdtempSync, rmSync, mkdirSync, symlinkSync } =
      require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const fakeRoot = mkdtempSync(join(tmpdir(), "u6-presence-loop-"));
    try {
      mkdirSync(join(fakeRoot, "references"));
      symlinkSync(
        join(fakeRoot, "references"),
        join(fakeRoot, "references", "self"),
      );
      const startedAt = Date.now();
      const presence = installedArtifactPresence(fakeRoot);
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeLessThan(1000);
      expect(presence.references).toBe(false);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });
});

describe("requiredReferenceIdsFor: per-route value mapping pin", () => {
  // Sweep-2 F019 fix: explicit value mapping for every catalog route
  // so a regression that swaps values between routes is caught at the
  // unit level rather than slipping into the char suite.
  const EXPECTED: Record<RouteId, readonly string[]> = {
    "pick-issue": ["stage-1-pick-issue.md", "ledger-and-helper.md"],
    plan: ["stage-2-plan.md", "ledger-and-helper.md"],
    decompose: ["stage-3-decompose.md", "ledger-and-helper.md"],
    "batch-loop": [
      "stage-4-batch-loop.md",
      "builder-dispatch.md",
      "host-adapters.md",
      "findings-and-validators.md",
      "ledger-and-helper.md",
    ],
    "final-review": [
      "stage-5-final-review.md",
      "findings-and-validators.md",
      "stage-4-batch-loop.md",
    ],
    ship: ["stage-6-ship.md", "findings-and-validators.md"],
    shipped: [],
    "no-ledger": ["stage-1-pick-issue.md"],
    "blocked-acceptance-criteria-stale": [
      "ledger-and-helper.md",
      "stage-3-decompose.md",
    ],
    "blocked-batch-contract-stale": [
      "ledger-and-helper.md",
      "stage-3-decompose.md",
    ],
    "blocked-digests-stale": ["ledger-and-helper.md", "stage-3-decompose.md"],
    "blocked-stage-3": ["ledger-and-helper.md", "stage-3-decompose.md"],
    "blocked-runbook-version-skew": ["ledger-and-helper.md"],
    "blocked-frontmatter-blocked-reason": [
      "ledger-and-helper.md",
      "findings-and-validators.md",
    ],
  };

  for (const id of ROUTE_IDS as readonly RouteId[]) {
    test(`${id}`, () => {
      expect(requiredReferenceIdsFor(id)).toEqual(EXPECTED[id]);
    });
  }
});
