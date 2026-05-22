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

describe("installedArtifactPresence (F020 fix: hoisted out of cli.ts)", () => {
  test("returns the static U4 baseline: every artifact present", () => {
    expect(installedArtifactPresence()).toEqual({
      cli: true,
      lib: true,
      references: true,
      templates: true,
    });
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
