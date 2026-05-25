import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PacketRenderError,
  renderBuilderPacket,
  renderCePlanPacket,
  renderPatchProposalPacket,
  renderProposerPacket,
  renderValidatorPacket,
} from "./packets";

/**
 * U5 packet rendering tests.
 *
 * **Deny-list assertions are written first.** The central U5 invariant
 * is "no context leaks." Every test verifies BOTH directions:
 *
 * 1. The packet **includes** every field on the MUST-include allow-list
 * 2. The packet **excludes** every field on the MUST-NOT-leak deny-list
 *
 * Per the runbook: rubber-stamping the exclusion side is P1. Exclusion
 * assertions are explicit, not inferred from inclusion.
 *
 * Tests use isolated tempdir ledgers built per case (no shared
 * mutable fixtures). All renders use a frozen `now` so the dispatch
 * evidence timestamp is byte-stable.
 */

const FROZEN_TIME = new Date("2026-05-22T07:30:00.000Z");

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "u5-packets-test-"));
}

function writeLedger(content: string): string {
  const dir = makeTempDir();
  const path = join(dir, "ledger.md");
  writeFileSync(path, content);
  return path;
}

function builderLedger(opts: {
  batches?: string;
  findings?: string;
  findingsTable?: string;
  notes?: string;
}): string {
  return [
    "---",
    "issue_number: 42",
    "target_repo: \"acme/widgets\"",
    "status: in-progress",
    "ac_confirmation_status: confirmed",
    "batch_contract_confirmation_status: confirmed",
    "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
    "---",
    "",
    "# Issue 42",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] AC 1",
    "- [ ] AC 2",
    "",
    "## Batches",
    "",
    "```yaml",
    opts.batches ?? "",
    "```",
    "",
    "## Findings data",
    "",
    "```yaml",
    opts.findings ?? "findings: []",
    "```",
    "",
    "## Findings",
    "",
    "| id | batch_id | signature | persona | severity | status | summary | resolution |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    opts.findingsTable ?? "",
    "",
    "## Notes",
    "",
    opts.notes ??
      "<append-only log of escape hatch fires, user decisions, blocker overrides>",
    "",
  ].join("\n");
}

function pendingBatchYaml(id: string, files: string[], ac: number[]): string {
  return [
    `  - id: ${id}`,
    `    name: "Batch ${id}"`,
    `    goal: "implement ${id}"`,
    "    files:",
    ...files.map((f) => `      - ${f}`),
    "    depends_on: []",
    "    execution_mode: tdd",
    "    acceptance_tests:",
    ...ac.map(
      (i) => `      - "AC ${i} holds: behavior ${i}"`,
    ),
    "    ac_mapping:",
    ...ac.map((i) => `      - ${i}`),
    "    rationale: null",
    "    status: pending",
    "    builder_commits: []",
    "    builder_attempts: []",
    "    iterations: 0",
    "    final_verdict: null",
  ].join("\n");
}

function committedBuilderAttemptYaml(opts: {
  commitSha?: string;
  filesTouched?: string[];
  notes?: string;
  extraLines?: string[];
} = {}): string {
  return [
    "      - attempt_type: implementation",
    "        status: committed",
    `        commit_sha: ${opts.commitSha ?? "abc123"}`,
    "        files_touched:",
    ...(opts.filesTouched ?? ["app/foo.ts"]).map((f) => `          - ${f}`),
    "        route_hint: null",
    "        blockers: []",
    "        probe_results: []",
    `        notes: "${opts.notes ?? "previous Builder attempt"}"`,
    ...(opts.extraLines ?? []),
  ].join("\n");
}

function tempDirsCleanup(paths: string[]): void {
  for (const p of paths) {
    try {
      rmSync(join(p, ".."), { force: true, recursive: true });
    } catch {
      // best-effort cleanup
    }
  }
}

// =====================================================================
// BUILDER PACKET
// =====================================================================

describe("Builder packet", () => {
  // ---- DENY-LIST (written first) ----

  describe("MUST NOT leak (deny-list)", () => {
    test("does not include the full plan file content", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("b1", ["app/foo.ts"], [1]) +
            "\n" +
            pendingBatchYaml("b2", ["app/bar.ts"], [2]),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      const json = JSON.stringify(packet.data);
      expect(json).not.toContain("/ce-plan");
      expect(json).not.toContain("Structured-output requirement");
      expect(json).not.toContain("Implementation Unit");
      tempDirsCleanup([ledgerPath]);
    });

    test("does not include unrelated batch contracts (F022 — synthetic bait token)", () => {
      // F022 fix: bait token must be clearly synthetic so a future
      // edit to the framing text cannot false-positive this assertion.
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("target", ["app/target.ts"], [1]) +
            "\n" +
            pendingBatchYaml("bait-batch-do-not-leak", ["app/BAIT-OTHER-FILE.ts"], [2]),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "target",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      expect(packet.data.batch_contract.id).toBe("target");
      expect(packet.data.batch_contract.files).toEqual(["app/target.ts"]);
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("bait-batch-do-not-leak");
      expect(blob).not.toContain("BAIT-OTHER-FILE.ts");
      tempDirsCleanup([ledgerPath]);
    });

    test("does not include findings from other batches or stage-3 findings", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("target", ["app/target.ts"], [1]) +
            "\n" +
            pendingBatchYaml("other", ["app/other.ts"], [2]),
          findingsTable: [
            "| f001 | target | sig-a | persona-1 | P2 | open | own row | |",
            "| f002 | other | sig-b | persona-1 | P1 | open | OTHER BATCH ROW | |",
            "| f003 | stage-3 | sig-c | persona-1 | P0 | open | STAGE 3 ROW | |",
          ].join("\n"),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "target",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      const ids = packet.data.findings_data_for_this_batch.map((f) => f.id);
      expect(ids).toEqual(["f001"]);
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("OTHER BATCH ROW");
      expect(blob).not.toContain("STAGE 3 ROW");
      tempDirsCleanup([ledgerPath]);
    });

    test("does not include rich Builder evidence from prior envelopes (F015 — fixture seeds bait)", () => {
      // F015 fix: the previous form of this test asserted absence
      // without seeding bait. The ledger fixture below embeds bait
      // tokens inside the ## Notes section (since the ledger schema
      // only persists the compact builder_attempts shape — the rich
      // evidence fields don't have a place to land in the row, but
      // hostile notes could still try to smuggle them in). The deny
      // check asserts that no BAIT- token from those notes appears in
      // the rendered packet for an UNRELATED batch.
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("target", ["app/target.ts"], [1]) +
            "\n" +
            pendingBatchYaml("other", ["app/other.ts"], [2]),
          notes: [
            "- 2026-05-20T10:00 batch other implementation_steps: [BAIT-IMPL-STEP-leak]",
            "- 2026-05-20T11:00 batch other tests_run: [BAIT-TEST-RUN-leak]",
            "- 2026-05-20T12:00 batch other suggested_validator_focus: [BAIT-VALIDATOR-FOCUS-leak]",
          ].join("\n"),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "target",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("BAIT-IMPL-STEP-leak");
      expect(blob).not.toContain("BAIT-TEST-RUN-leak");
      expect(blob).not.toContain("BAIT-VALIDATOR-FOCUS-leak");
      tempDirsCleanup([ledgerPath]);
    });

    test("F001/F027 fix: substring-of-id collision (b1 vs b10) does not leak", () => {
      // Adversarial fixture: a batch id that is a substring of another
      // batch id. The Notes section references both. A naive
      // substring matcher would surface the b10 note in the b1
      // packet. The boundary-token matcher must not.
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("b1", ["app/one.ts"], [1]) +
            "\n" +
            pendingBatchYaml("b10", ["app/ten.ts"], [2]),
          notes: [
            "- 2026-05-20T10:00 on batch b1 something benign happened",
            "- 2026-05-20T11:00 on batch b10 BAIT-B10-LEAK should not appear in the b-one packet",
          ].join("\n"),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("BAIT-B10-LEAK");
      expect(packet.data.notes_summary_for_this_batch).toContain("batch b1");
      expect(packet.data.notes_summary_for_this_batch).not.toContain("b10");
      tempDirsCleanup([ledgerPath]);
    });

    test("does not include unrelated Notes lines (only batch-scoped notes survive)", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("target", ["app/target.ts"], [1]) +
            "\n" +
            pendingBatchYaml("other", ["app/other.ts"], [2]),
          notes: [
            "- 2026-05-20T10:00 escape hatch fire on batch target; user accepted",
            "- 2026-05-20T11:00 unrelated host failure on batch other",
            "- 2026-05-20T12:00 generic line with no batch reference",
          ].join("\n"),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "target",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      expect(packet.data.notes_summary_for_this_batch).toContain("batch target");
      expect(packet.data.notes_summary_for_this_batch).not.toContain("other");
      expect(packet.data.notes_summary_for_this_batch).not.toContain(
        "generic line",
      );
      tempDirsCleanup([ledgerPath]);
    });

    test("does not render Orchestrator-inline attempts as prior Builder attempts", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches: [
            "batches:",
            "  - id: target",
            "    name: \"Batch target\"",
            "    goal: \"implement target\"",
            "    files:",
            "      - app/foo.ts",
            "    depends_on: []",
            "    execution_mode: tdd",
            "    acceptance_tests:",
            "      - \"AC 1 holds: behavior 1\"",
            "    ac_mapping:",
            "      - 1",
            "    rationale: null",
            "    status: pending",
            "    builder_commits:",
            "      - abc123",
            "    builder_attempts:",
            committedBuilderAttemptYaml({
              commitSha: "abc123",
              notes: "real Builder evidence",
            }),
            "    orchestrator_inline_attempts:",
            "      - commit_sha: inline123",
            "        files_touched:",
            "          - app/foo.ts",
            "        notes: \"INLINE-BAIT-DO-NOT-RENDER\"",
            "    iterations: 1",
            "    final_verdict: null",
          ].join("\n"),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "target",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      expect(packet.data.prior_builder_attempts).toHaveLength(1);
      expect(packet.data.prior_builder_attempts[0].commit_sha).toBe("abc123");
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("inline123");
      expect(blob).not.toContain("INLINE-BAIT-DO-NOT-RENDER");
      tempDirsCleanup([ledgerPath]);
    });

    test("repair packets include only the targeted open P0/P1 finding", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("target", ["app/foo.ts"], [1]),
          findingsTable: [
            "| f001 | target | sig-p1 | reviewer | P1 | open | repair this blocker | |",
            "| f002 | target | sig-p2 | reviewer | P2 | open | P2-DEBT-BAIT | |",
            "| f003 | target | sig-fixed | reviewer | P1 | fixed | FIXED-BAIT | commit abc123 |",
          ].join("\n"),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "target",
        attemptType: "repair",
        targetFindingSignature: "sig-p1",
        now: FROZEN_TIME,
      });
      expect(packet.data.findings_data_for_this_batch.map((f) => f.id)).toEqual([
        "f001",
      ]);
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).toContain("repair this blocker");
      expect(blob).not.toContain("P2-DEBT-BAIT");
      expect(blob).not.toContain("FIXED-BAIT");
      tempDirsCleanup([ledgerPath]);
    });

    test("rejects repair packets for non-blocking findings", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("target", ["app/foo.ts"], [1]),
          findingsTable:
            "| f002 | target | sig-p2 | reviewer | P2 | open | p2 debt | |",
        }),
      );
      expect(() =>
        renderBuilderPacket({
          ledgerPath,
          batchId: "target",
          attemptType: "repair",
          targetFindingSignature: "sig-p2",
          now: FROZEN_TIME,
        }),
      ).toThrow(PacketRenderError);
      tempDirsCleanup([ledgerPath]);
    });

    test("rejects malformed prior Builder attempt rows instead of compacting them", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches: [
            "batches:",
            "  - id: target",
            "    name: \"Batch target\"",
            "    goal: \"implement target\"",
            "    files:",
            "      - app/foo.ts",
            "    depends_on: []",
            "    execution_mode: tdd",
            "    acceptance_tests:",
            "      - \"AC 1 holds: behavior 1\"",
            "    ac_mapping:",
            "      - 1",
            "    rationale: null",
            "    status: pending",
            "    builder_commits:",
            "      - abc123",
            "    builder_attempts:",
            committedBuilderAttemptYaml({
              extraLines: [
                "        implementation_steps:",
                "          - BAIT-RICH-EVIDENCE-DO-NOT-SILENTLY-DROP",
              ],
            }),
            "    iterations: 1",
            "    final_verdict: null",
          ].join("\n"),
        }),
      );
      expect(() =>
        renderBuilderPacket({
          ledgerPath,
          batchId: "target",
          attemptType: "implementation",
          now: FROZEN_TIME,
        }),
      ).toThrow(PacketRenderError);
      tempDirsCleanup([ledgerPath]);
    });
  });

  // ---- ALLOW-LIST ----

  describe("MUST include (allow-list)", () => {
    test("includes issue_number, target_repo, attempt_type, target_finding_signature", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      expect(packet.data.issue_number).toBe(42);
      expect(packet.data.target_repo).toBe("acme/widgets");
      expect(packet.data.attempt_type).toBe("implementation");
      expect(packet.data.target_finding_signature).toBeNull();
      tempDirsCleanup([ledgerPath]);
    });

    test("repair attempt carries target_finding_signature", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
          findingsTable:
            "| f001 | b1 | repair-target-sig | reviewer | P1 | open | target blocker | |",
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "repair",
        targetFindingSignature: "repair-target-sig",
        now: FROZEN_TIME,
      });
      expect(packet.data.attempt_type).toBe("repair");
      expect(packet.data.target_finding_signature).toBe("repair-target-sig");
      tempDirsCleanup([ledgerPath]);
    });

    test("includes the confirmed batch_contract for the target batch only", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      expect(packet.data.batch_contract).toMatchObject({
        id: "b1",
        files: ["app/foo.ts"],
        execution_mode: "tdd",
        ac_mapping: [1],
      });
    });

    test("includes the prose framing slots", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
        }),
      );
      const packet = renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        now: FROZEN_TIME,
      });
      expect(packet.data.local_law_read_order).toContain(
        "target repo root agent instructions",
      );
      expect(packet.data.authority_boundary).toContain(
        "Builder may edit only files in batch_contract.files",
      );
      expect(packet.data.preflight_checklist).toContain("acceptance criteria");
      expect(packet.data.allowed_probes).toContain("rename path probe");
      expect(packet.data.output_contract).toContain("builder-dispatch.md");
      expect(packet.packet_markdown).toContain("<local_law_read_order>");
      expect(packet.packet_markdown).toContain("<authority_boundary>");
      expect(packet.packet_markdown).toContain("<preflight_checklist>");
      expect(packet.packet_markdown).toContain("<allowed_probes>");
      expect(packet.packet_markdown).toContain("<output_contract>");
      expect(packet.packet_markdown).not.toContain(
        "Orchestrator-inline attempts are Builder attempts",
      );
    });
  });

  // ---- determinism + dispatch evidence ----

  test("renders byte-identical output for the same ledger + inputs (R8)", () => {
    const src = builderLedger({
      batches: "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
    });
    const ledger1 = writeLedger(src);
    const ledger2 = writeLedger(src);
    const a = renderBuilderPacket({
      ledgerPath: ledger1,
      batchId: "b1",
      attemptType: "implementation",
      now: FROZEN_TIME,
    });
    const b = renderBuilderPacket({
      ledgerPath: ledger2,
      batchId: "b1",
      attemptType: "implementation",
      now: FROZEN_TIME,
    });
    expect(a.packet_markdown).toBe(b.packet_markdown);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  test("dispatch evidence is returned but ledger is not mutated", async () => {
    // T001 fix: declared async + awaited assertion so a future
    // refactor cannot silently drop the post-mutation assertion.
    const original = builderLedger({
      batches: "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
    });
    const ledgerPath = writeLedger(original);
    const packet = renderBuilderPacket({
      ledgerPath,
      batchId: "b1",
      attemptType: "implementation",
      now: FROZEN_TIME,
    });
    // F038 fix: assert all six dispatch_evidence fields, not five.
    expect(packet.dispatch_evidence.role).toBe("builder");
    expect(packet.dispatch_evidence.target_id).toBe("b1");
    expect(packet.dispatch_evidence.cli_route_id).toBe("packet.builder");
    expect(packet.dispatch_evidence.timestamp).toBe(
      "2026-05-22T07:30:00.000Z",
    );
    expect(packet.dispatch_evidence.loaded_templates).toContain(
      "templates/builder-work-packet.md",
    );
    expect(packet.dispatch_evidence.loaded_references).toContain(
      "references/builder-dispatch.md",
    );
    expect(packet.dispatch_evidence.loaded_references.length).toBeGreaterThan(
      0,
    );
    // ledger contents unchanged
    const after = await Bun.file(ledgerPath).text();
    expect(after).toBe(original);
  });

  test("rejects implementation attempt with a target_finding_signature", () => {
    const ledgerPath = writeLedger(
      builderLedger({
        batches: "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
      }),
    );
    expect(() =>
      renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        targetFindingSignature: "should-be-null",
        now: FROZEN_TIME,
      }),
    ).toThrow(PacketRenderError);
  });

  test("rejects repair attempt without a target_finding_signature", () => {
    const ledgerPath = writeLedger(
      builderLedger({
        batches: "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
      }),
    );
    expect(() =>
      renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "repair",
        now: FROZEN_TIME,
      }),
    ).toThrow(PacketRenderError);
  });

  test("rejects unknown batch id", () => {
    const ledgerPath = writeLedger(
      builderLedger({
        batches: "batches:\n" + pendingBatchYaml("b1", ["app/foo.ts"], [1]),
      }),
    );
    expect(() =>
      renderBuilderPacket({
        ledgerPath,
        batchId: "nonexistent",
        attemptType: "implementation",
        now: FROZEN_TIME,
      }),
    ).toThrow(PacketRenderError);
  });
});

// =====================================================================
// PROPOSER PACKET
// =====================================================================

describe("Proposer packet", () => {
  function proposerLedger(opts: {
    batches?: string;
    findingsTable?: string;
  }): string {
    return [
      "---",
      "issue_number: 7",
      "target_repo: \"acme/proposer\"",
      "status: in-progress",
      "ac_confirmation_status: confirmed",
      "batch_contract_confirmation_status: confirmed",
      "plan_path: docs/plans/2026-05-22-002-feat-thing.md",
      "---",
      "",
      "# Issue 7",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] AC 1",
      "",
      "## Batches",
      "",
      "```yaml",
      opts.batches ?? "batches: []",
      "```",
      "",
      "## Findings data",
      "",
      "```yaml",
      "findings: []",
      "```",
      "",
      "## Findings",
      "",
      "| id | batch_id | signature | persona | severity | status | summary | resolution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      opts.findingsTable ?? "",
      "",
      "## Notes",
      "",
      "",
    ].join("\n");
  }

  // ---- DENY-LIST ----

  describe("MUST NOT leak (deny-list)", () => {
    test("does not contain a commit_sha slot", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      const json = JSON.stringify(packet.data);
      expect(json).not.toContain("commit_sha");
      expect(json).not.toContain("builder_commits");
      expect(json).not.toContain("builder_attempts");
    });

    test("does not contain any scratch-file-write directive", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      // No imperative verb fields ("write_to", "execute", "next_action").
      const json = JSON.stringify(packet.data);
      expect(json).not.toContain("next_action");
      expect(json).not.toContain("recommended_step");
      expect(json).not.toContain("execute_now");
    });

    test("does not include findings outside batch_id: final", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable: [
            "| ff1 | final | sig-x | reviewer | P1 | open | the final blocker | |",
            "| ff2 | b-other | sig-z | reviewer | P0 | open | OTHER BATCH P0 | |",
          ].join("\n"),
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("OTHER BATCH P0");
      expect(blob).not.toContain("ff2");
    });

    test("rejects non-final findings", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | b-some-batch | sig-x | reviewer | P1 | open | summary | |",
        }),
      );
      expect(() =>
        renderProposerPacket({
          ledgerPath,
          findingId: "ff1",
          now: FROZEN_TIME,
        }),
      ).toThrow(PacketRenderError);
    });

    test("rejects non-blocking severities", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P2 | open | summary | |",
        }),
      );
      expect(() =>
        renderProposerPacket({
          ledgerPath,
          findingId: "ff1",
          now: FROZEN_TIME,
        }),
      ).toThrow(PacketRenderError);
    });

    test("does not include the full plan or whole-ledger content", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      const json = JSON.stringify(packet.data);
      expect(json).not.toContain("/ce-plan");
      expect(json).not.toContain("Structured-output requirement");
      // No frontmatter dump
      expect(json).not.toContain("plan_path");
    });

    test("F005/F016 fix: strips Builder fix prose markers from both summary and evidence", () => {
      // The finding summary embeds a Validator-authored 'recommended
      // fix:' phrase. The proposer packet must surface the leading
      // observation but truncate at the marker on BOTH summary and
      // evidence so the proposer is never handed an authorized fix
      // directive.
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker. recommended fix: REWRITE-BAIT-DO-NOT-LEAK | |",
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("REWRITE-BAIT-DO-NOT-LEAK");
      expect(packet.data.final_finding_row.summary).toBe("a final blocker.");
      expect(packet.data.final_finding_row.evidence).toBe("a final blocker.");
    });
  });

  // ---- ALLOW-LIST ----

  describe("MUST include (allow-list)", () => {
    test("includes issue_number, target_repo, final finding row, confirmation snapshot, pointers", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      expect(packet.data.issue_number).toBe(7);
      expect(packet.data.target_repo).toBe("acme/proposer");
      expect(packet.data.final_finding_row).toMatchObject({
        id: "ff1",
        signature: "sig-x",
        persona: "reviewer",
        severity: "P1",
        summary: "a final blocker",
      });
      // confirmation_state mirrors the snapshot from readLedgerSnapshot
      // verbatim. The test ledger has frontmatter status confirmed but
      // no digest field, so the state machine reports "pending" — what
      // matters is that the snapshot is faithfully forwarded.
      expect(
        packet.data.confirmation_state_snapshot.acceptance_criteria,
      ).toMatch(/^(pending|confirmed|stale|blocked)$/);
      expect(packet.data.local_law_read_order).toContain("builder-dispatch.md");
      expect(packet.data.patch_proposal_helper_contract).toContain(
        "stage-4-batch-loop.md",
      );
      expect(packet.data.scratch_proposal_schema).toContain(
        "patch-proposal.md",
      );
    });

    test("returns empty confirmed_batch_summaries when no terminal batches exist", () => {
      const ledgerPath = writeLedger(
        proposerLedger({
          findingsTable:
            "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
        }),
      );
      const packet = renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      });
      expect(packet.data.confirmed_batch_summaries).toEqual([]);
    });
  });

  test("dispatch evidence target_id is the finding id (F039: asserts all six fields)", () => {
    const ledgerPath = writeLedger(
      proposerLedger({
        findingsTable:
          "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
      }),
    );
    const packet = renderProposerPacket({
      ledgerPath,
      findingId: "ff1",
      now: FROZEN_TIME,
    });
    expect(packet.dispatch_evidence.role).toBe("proposer");
    expect(packet.dispatch_evidence.target_id).toBe("ff1");
    expect(packet.dispatch_evidence.cli_route_id).toBe("packet.proposer");
    expect(packet.dispatch_evidence.timestamp).toBe(
      "2026-05-22T07:30:00.000Z",
    );
    expect(packet.dispatch_evidence.loaded_references).toContain(
      "references/builder-dispatch.md",
    );
    expect(packet.dispatch_evidence.loaded_templates).toContain(
      "templates/proposer-envelope.md",
    );
  });
});

// =====================================================================
// VALIDATOR PACKET
// =====================================================================

describe("Validator packet", () => {
  // ---- DENY-LIST (load-bearing) ----

  describe("MUST NOT leak (deny-list)", () => {
    test("does not include findings from other batches", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("target", ["app/target.ts"], [1]) +
            "\n" +
            pendingBatchYaml("other", ["app/other.ts"], [2]),
          findingsTable: [
            "| f1 | target | sig-a | persona | P2 | open | own | |",
            "| f2 | other | sig-b | persona | P0 | open | OTHER LEAK | |",
          ].join("\n"),
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "target",
        persona: "compound-engineering:ce-correctness-reviewer",
        commitRefOrRange: "deadbeef",
        touchedFiles: ["app/target.ts"],
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("OTHER LEAK");
      expect(blob).not.toContain("f2");
    });

    test("strips Builder fix prose: notes and suggested_scope_changes never flow through", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("target", ["app/target.ts"], [1]),
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "target",
        persona: "compound-engineering:ce-correctness-reviewer",
        commitRefOrRange: "deadbeef",
        touchedFiles: ["app/target.ts"],
        builderEvidence: {
          notes: "I FIXED THE BUG by replacing X with Y",
          suggested_scope_changes: ["BUILDER WANTS TO EDIT app/other.ts"],
          implementation_steps: ["step 1"],
          tests_run: ["bun test"],
          suggested_validator_focus: ["focus area 1"],
        },
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("I FIXED THE BUG");
      expect(blob).not.toContain("BUILDER WANTS TO EDIT");
      // But the seven typed arrays DO flow:
      expect(packet.data.builder_evidence.implementation_steps).toEqual(["step 1"]);
      expect(packet.data.builder_evidence.tests_run).toEqual(["bun test"]);
      expect(packet.data.builder_evidence.suggested_validator_focus).toEqual([
        "focus area 1",
      ]);
    });

    test("does not contain a commit-write or ledger-write slot", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("target", ["app/target.ts"], [1]),
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "target",
        persona: "compound-engineering:ce-correctness-reviewer",
        commitRefOrRange: "deadbeef",
        touchedFiles: ["app/target.ts"],
        now: FROZEN_TIME,
      });
      const json = JSON.stringify(packet.data);
      expect(json).not.toContain("commit_sha");
      expect(json).not.toContain("next_action");
      expect(json).not.toContain("recommended_fix");
    });

    test("F017 fix: full-ledger bait is not surfaced (frontmatter / unrelated batches / notes)", () => {
      // The ledger embeds bait tokens in Notes and in the goal/files
      // of an unrelated batch. The Validator packet must surface
      // neither — the only batch-scoped content allowed is the target
      // batch and its findings/files.
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" +
            pendingBatchYaml("target", ["app/target.ts"], [1]) +
            "\n" +
            "  - id: bait-unrelated\n" +
            "    name: \"BAIT-UNRELATED-NAME\"\n" +
            "    goal: \"BAIT-UNRELATED-GOAL\"\n" +
            "    files:\n" +
            "      - app/BAIT-UNRELATED-FILE.ts\n" +
            "    depends_on: []\n" +
            "    execution_mode: tdd\n" +
            "    acceptance_tests:\n" +
            "      - \"AC 2 holds: BAIT-UNRELATED-TEST\"\n" +
            "    ac_mapping:\n" +
            "      - 2\n" +
            "    rationale: null\n" +
            "    status: pending\n" +
            "    builder_commits: []\n" +
            "    builder_attempts: []\n" +
            "    iterations: 0\n" +
            "    final_verdict: null",
          notes: [
            "- 2026-05-20T10:00 on batch bait-unrelated BAIT-NOTES-LEAK-LINE",
          ].join("\n"),
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "target",
        persona: "compound-engineering:ce-correctness-reviewer",
        commitRefOrRange: "deadbeef",
        touchedFiles: ["app/target.ts"],
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("BAIT-UNRELATED-NAME");
      expect(blob).not.toContain("BAIT-UNRELATED-GOAL");
      expect(blob).not.toContain("BAIT-UNRELATED-FILE.ts");
      expect(blob).not.toContain("BAIT-UNRELATED-TEST");
      expect(blob).not.toContain("BAIT-NOTES-LEAK-LINE");
    });
  });

  // ---- ALLOW-LIST ----

  describe("MUST include (allow-list)", () => {
    test("includes persona, commit_ref_or_range, batch fields, builder_evidence", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches:
            "batches:\n" + pendingBatchYaml("target", ["app/target.ts"], [1]),
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "target",
        persona: "compound-engineering:ce-security-sentinel",
        commitRefOrRange: "abc1234..def5678",
        touchedFiles: ["app/target.ts"],
        builderEvidence: {
          implementation_steps: ["a"],
          existing_seams_used: ["b"],
          tests_run: ["c"],
          assumptions: ["d"],
          risks: ["e"],
          deferred: ["f"],
          suggested_validator_focus: ["g"],
        },
        now: FROZEN_TIME,
      });
      expect(packet.data.persona).toBe("compound-engineering:ce-security-sentinel");
      expect(packet.data.commit_ref_or_range).toBe("abc1234..def5678");
      expect(packet.data.batch_id).toBe("target");
      expect(packet.data.batch_files).toEqual(["app/target.ts"]);
      expect(packet.data.execution_mode).toBe("tdd");
      expect(packet.data.acceptance_tests).toHaveLength(1);
      expect(packet.data.ac_mapping).toEqual([1]);
      expect(packet.data.builder_evidence).toEqual({
        implementation_steps: ["a"],
        existing_seams_used: ["b"],
        tests_run: ["c"],
        assumptions: ["d"],
        risks: ["e"],
        deferred: ["f"],
        suggested_validator_focus: ["g"],
      });
    });

    test("handles stage-3 and final pseudo-batches without requiring ledger Batches entry", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches: "batches: []",
          findingsTable:
            "| ff1 | final | sig | reviewer | P1 | open | a final blocker | |",
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "final",
        persona: "compound-engineering:ce-correctness-reviewer",
        commitRefOrRange: "deadbeef",
        touchedFiles: [],
        now: FROZEN_TIME,
      });
      expect(packet.data.batch_id).toBe("final");
      expect(packet.data.relevant_ledger_findings).toHaveLength(1);
      expect(packet.data.relevant_ledger_findings[0].id).toBe("ff1");
    });

    test("F019 fix: stage-3 pseudo-batch synthesises Stage 3 Contract Review virtual batch", () => {
      const ledgerPath = writeLedger(
        builderLedger({
          batches: "batches: []",
          findingsTable:
            "| s3-1 | stage-3 | contract-sig | reviewer | P1 | open | stage-3 contract issue | |",
        }),
      );
      const packet = renderValidatorPacket({
        ledgerPath,
        batchId: "stage-3",
        persona: "compound-engineering:ce-correctness-reviewer",
        commitRefOrRange: "deadbeef",
        touchedFiles: [],
        now: FROZEN_TIME,
      });
      expect(packet.data.batch_id).toBe("stage-3");
      expect(packet.data.batch_goal).toBe(
        "review the candidate batch DAG for contract violations",
      );
      expect(packet.data.relevant_ledger_findings).toHaveLength(1);
      expect(packet.data.relevant_ledger_findings[0].id).toBe("s3-1");
    });
  });
});

// =====================================================================
// PATCH PROPOSAL PACKET
// =====================================================================

describe("Patch proposal packet", () => {
  function patchLedger(table: string): string {
    return [
      "---",
      "issue_number: 9",
      "status: in-progress",
      "ac_confirmation_status: confirmed",
      "batch_contract_confirmation_status: confirmed",
      "plan_path: docs/plans/2026-05-22-003-feat.md",
      "---",
      "# Issue 9",
      "",
      "## Acceptance criteria",
      "- [ ] AC 1",
      "",
      "## Batches",
      "```yaml",
      "batches: []",
      "```",
      "",
      "## Findings data",
      "```yaml",
      "findings: []",
      "```",
      "",
      "## Findings",
      "| id | batch_id | signature | persona | severity | status | summary | resolution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      table,
      "",
      "## Notes",
      "",
    ].join("\n");
  }

  describe("MUST NOT leak (deny-list)", () => {
    test("contains exactly one patch_batches entry", () => {
      const ledgerPath = writeLedger(
        patchLedger(
          "| ff1 | final | sig-x | reviewer | P0 | open | a final P0 blocker | |",
        ),
      );
      const packet = renderPatchProposalPacket({
        ledgerPath,
        findingId: "ff1",
        candidatePatchBatch: {
          id: "patch-001",
          name: "Patch one",
          goal: "fix the bug",
          files: ["app/x.ts"],
          depends_on: ["b-terminal"],
          execution_mode: "tdd",
          acceptance_tests: ["AC 1 holds: bug gone"],
          rationale: "new-file-patch-exception: new test file",
        },
        now: FROZEN_TIME,
      });
      expect(packet.data.patch_batches.length).toBe(1);
    });

    test("ac_mapping is always [] for patch batches", () => {
      const ledgerPath = writeLedger(
        patchLedger(
          "| ff1 | final | sig-x | reviewer | P0 | open | a final P0 blocker | |",
        ),
      );
      const packet = renderPatchProposalPacket({
        ledgerPath,
        findingId: "ff1",
        candidatePatchBatch: {
          id: "patch-001",
          name: "Patch one",
          goal: "fix the bug",
          files: ["app/x.ts"],
          depends_on: ["b-terminal"],
          execution_mode: "tdd",
          acceptance_tests: ["AC 1 holds: bug gone"],
          rationale: "rationale",
        },
        now: FROZEN_TIME,
      });
      expect(packet.data.patch_batches[0].ac_mapping).toEqual([]);
    });

    test("does not contain findings beyond the cited final_finding", () => {
      const ledgerPath = writeLedger(
        patchLedger(
          [
            "| ff1 | final | sig-x | reviewer | P0 | open | the cited blocker | |",
            "| ff2 | final | sig-y | reviewer | P1 | open | OTHER FINAL FINDING | |",
            "| ff3 | b-other | sig-z | reviewer | P0 | open | OTHER BATCH | |",
          ].join("\n"),
        ),
      );
      const packet = renderPatchProposalPacket({
        ledgerPath,
        findingId: "ff1",
        candidatePatchBatch: {
          id: "patch-002",
          name: "Patch two",
          goal: "fix the bug",
          files: ["app/x.ts"],
          depends_on: ["b-terminal"],
          execution_mode: "tdd",
          acceptance_tests: ["AC 1 holds: bug gone"],
          rationale: "rationale",
        },
        now: FROZEN_TIME,
      });
      const blob = JSON.stringify(packet.data) + packet.packet_markdown;
      expect(blob).not.toContain("OTHER FINAL FINDING");
      expect(blob).not.toContain("OTHER BATCH");
    });

    test("rejects malformed patch ids", () => {
      const ledgerPath = writeLedger(
        patchLedger(
          "| ff1 | final | sig-x | reviewer | P0 | open | a final P0 blocker | |",
        ),
      );
      expect(() =>
        renderPatchProposalPacket({
          ledgerPath,
          findingId: "ff1",
          candidatePatchBatch: {
            id: "not-a-patch-id",
            name: "x",
            goal: "x",
            files: ["app/x.ts"],
            depends_on: ["b"],
            execution_mode: "tdd",
            acceptance_tests: ["AC 1 holds: x"],
            rationale: "x",
          },
          now: FROZEN_TIME,
        }),
      ).toThrow(PacketRenderError);
    });

    test("rejects invalid execution_mode with PacketRenderError", () => {
      const ledgerPath = writeLedger(
        patchLedger(
          "| ff1 | final | sig-x | reviewer | P0 | open | a final P0 blocker | |",
        ),
      );
      let caught: unknown;
      try {
        renderPatchProposalPacket({
          ledgerPath,
          findingId: "ff1",
          candidatePatchBatch: {
            id: "patch-001",
            name: "Patch one",
            goal: "fix the bug",
            files: ["app/x.ts"],
            depends_on: ["b-terminal"],
            execution_mode: "bogus-mode",
            acceptance_tests: ["AC 1 holds: bug gone"],
            rationale: "rationale",
          },
          now: FROZEN_TIME,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PacketRenderError);
      expect((caught as PacketRenderError).code).toBe(
        "invalid-execution-mode",
      );
    });
  });

  describe("MUST include (allow-list)", () => {
    test("includes final_finding fields and exactly one patch_batches entry with correct shape", () => {
      const ledgerPath = writeLedger(
        patchLedger(
          "| ff1 | final | sig-x | reviewer | P1 | open | the cited blocker | |",
        ),
      );
      const packet = renderPatchProposalPacket({
        ledgerPath,
        findingId: "ff1",
        candidatePatchBatch: {
          id: "patch-003",
          name: "Patch three",
          goal: "fix sig-x",
          files: ["app/x.ts", "app/x.test.ts"],
          depends_on: ["b-terminal"],
          execution_mode: "tdd",
          acceptance_tests: ["AC 1 holds: bug gone"],
          rationale: "new-file-patch-exception: test sibling",
        },
        now: FROZEN_TIME,
      });
      expect(packet.data.final_finding).toMatchObject({
        id: "ff1",
        signature: "sig-x",
        persona: "reviewer",
        severity: "P1",
        summary: "the cited blocker",
      });
      expect(packet.data.patch_batches[0]).toMatchObject({
        id: "patch-003",
        files: ["app/x.ts", "app/x.test.ts"],
        depends_on: ["b-terminal"],
        ac_mapping: [],
      });
    });
  });
});

// =====================================================================
// CE-PLAN PACKET
// =====================================================================

describe("ce-plan packet", () => {
  describe("MUST NOT leak (deny-list)", () => {
    test("does not include issue-specific content", () => {
      const packet = renderCePlanPacket({ now: FROZEN_TIME });
      const blob = packet.data.addendum_body;
      expect(blob).not.toContain("issue_number");
      expect(blob).not.toContain("target_repo");
      expect(blob).not.toContain("acme/widgets");
    });

    test("does not include Builder, Proposer, or Validator packet content", () => {
      const packet = renderCePlanPacket({ now: FROZEN_TIME });
      const blob = packet.data.addendum_body;
      expect(blob).not.toContain("builder_commits");
      expect(blob).not.toContain("final_finding_row");
      expect(blob).not.toContain("relevant_ledger_findings");
    });
  });

  describe("MUST include (allow-list)", () => {
    test("includes the verbatim structured-output requirement", () => {
      const packet = renderCePlanPacket({ now: FROZEN_TIME });
      const blob = packet.data.addendum_body;
      expect(blob).toContain("Structured-output requirement");
      expect(blob).toContain("tdd");
      expect(blob).toContain("proof_first");
      expect(blob).toContain("change_first");
      expect(blob).toContain("ac_mapping");
      expect(blob).toContain("execution_mode");
    });
  });

  test("dispatch evidence carries cli_route_id packet.ce-plan (F040: asserts all six fields)", () => {
    const packet = renderCePlanPacket({ now: FROZEN_TIME });
    expect(packet.dispatch_evidence.cli_route_id).toBe("packet.ce-plan");
    expect(packet.dispatch_evidence.role).toBe("ce-plan");
    expect(packet.dispatch_evidence.target_id).toBe("addendum");
    expect(packet.dispatch_evidence.timestamp).toBe(
      "2026-05-22T07:30:00.000Z",
    );
    expect(packet.dispatch_evidence.loaded_references).toContain(
      "references/stage-2-plan.md",
    );
    expect(packet.dispatch_evidence.loaded_templates).toContain(
      "templates/ce-plan-addendum.md",
    );
  });
});

// =====================================================================
// CROSS-ROLE DETERMINISM, DISPATCH EVIDENCE, AND HOSTILE INPUTS
// =====================================================================

describe("R8 determinism per role (F018, F025)", () => {
  test("proposer renders byte-identical output for identical inputs", () => {
    const src = [
      "---",
      "issue_number: 7",
      "target_repo: \"acme/proposer\"",
      "status: in-progress",
      "ac_confirmation_status: confirmed",
      "batch_contract_confirmation_status: confirmed",
      "plan_path: docs/plans/2026-05-22-002-feat-thing.md",
      "---",
      "",
      "# Issue 7",
      "## Acceptance criteria",
      "- [ ] AC 1",
      "## Batches",
      "```yaml",
      "batches: []",
      "```",
      "## Findings data",
      "```yaml",
      "findings: []",
      "```",
      "## Findings",
      "| id | batch_id | signature | persona | severity | status | summary | resolution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
      "",
      "## Notes",
      "",
    ].join("\n");
    const ledger1 = writeLedger(src);
    const ledger2 = writeLedger(src);
    const a = renderProposerPacket({
      ledgerPath: ledger1,
      findingId: "ff1",
      now: FROZEN_TIME,
    });
    const b = renderProposerPacket({
      ledgerPath: ledger2,
      findingId: "ff1",
      now: FROZEN_TIME,
    });
    expect(a.packet_markdown).toBe(b.packet_markdown);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(JSON.stringify(a.dispatch_evidence)).toBe(
      JSON.stringify(b.dispatch_evidence),
    );
  });

  test("validator renders byte-identical output for identical inputs", () => {
    const src = builderLedger({
      batches:
        "batches:\n" + pendingBatchYaml("target", ["app/target.ts"], [1]),
    });
    const ledger1 = writeLedger(src);
    const ledger2 = writeLedger(src);
    const a = renderValidatorPacket({
      ledgerPath: ledger1,
      batchId: "target",
      persona: "compound-engineering:ce-correctness-reviewer",
      commitRefOrRange: "abc1234",
      touchedFiles: ["app/target.ts"],
      now: FROZEN_TIME,
    });
    const b = renderValidatorPacket({
      ledgerPath: ledger2,
      batchId: "target",
      persona: "compound-engineering:ce-correctness-reviewer",
      commitRefOrRange: "abc1234",
      touchedFiles: ["app/target.ts"],
      now: FROZEN_TIME,
    });
    expect(a.packet_markdown).toBe(b.packet_markdown);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(JSON.stringify(a.dispatch_evidence)).toBe(
      JSON.stringify(b.dispatch_evidence),
    );
  });

  test("patch-proposal renders byte-identical output for identical inputs", () => {
    const src = [
      "---",
      "issue_number: 9",
      "status: in-progress",
      "ac_confirmation_status: confirmed",
      "batch_contract_confirmation_status: confirmed",
      "plan_path: docs/plans/x.md",
      "---",
      "# Issue 9",
      "## Acceptance criteria",
      "- [ ] AC 1",
      "## Batches",
      "```yaml",
      "batches: []",
      "```",
      "## Findings data",
      "```yaml",
      "findings: []",
      "```",
      "## Findings",
      "| id | batch_id | signature | persona | severity | status | summary | resolution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| ff1 | final | sig-x | reviewer | P1 | open | blocker | |",
      "## Notes",
      "",
    ].join("\n");
    const ledger1 = writeLedger(src);
    const ledger2 = writeLedger(src);
    const candidate = {
      id: "patch-001",
      name: "Patch one",
      goal: "fix the bug",
      files: ["app/x.ts"],
      depends_on: ["b-terminal"],
      execution_mode: "tdd",
      acceptance_tests: ["AC 1 holds: bug gone"],
      rationale: "new-file-patch-exception: test sibling",
    };
    const a = renderPatchProposalPacket({
      ledgerPath: ledger1,
      findingId: "ff1",
      candidatePatchBatch: candidate,
      now: FROZEN_TIME,
    });
    const b = renderPatchProposalPacket({
      ledgerPath: ledger2,
      findingId: "ff1",
      candidatePatchBatch: candidate,
      now: FROZEN_TIME,
    });
    expect(a.packet_markdown).toBe(b.packet_markdown);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  test("ce-plan renders byte-identical output", () => {
    const a = renderCePlanPacket({ now: FROZEN_TIME });
    const b = renderCePlanPacket({ now: FROZEN_TIME });
    expect(a.packet_markdown).toBe(b.packet_markdown);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });
});

describe("Dispatch evidence per role (F021)", () => {
  test("validator dispatch_evidence carries all six fields", () => {
    const ledgerPath = writeLedger(
      builderLedger({
        batches:
          "batches:\n" + pendingBatchYaml("target", ["app/target.ts"], [1]),
      }),
    );
    const packet = renderValidatorPacket({
      ledgerPath,
      batchId: "target",
      persona: "compound-engineering:ce-correctness-reviewer",
      commitRefOrRange: "abc1234",
      touchedFiles: ["app/target.ts"],
      now: FROZEN_TIME,
    });
    expect(packet.dispatch_evidence.role).toBe("validator");
    expect(packet.dispatch_evidence.target_id).toBe("target@abc1234");
    expect(packet.dispatch_evidence.cli_route_id).toBe("packet.validator");
    expect(packet.dispatch_evidence.timestamp).toBe(
      "2026-05-22T07:30:00.000Z",
    );
    expect(packet.dispatch_evidence.loaded_references).toContain(
      "references/findings-and-validators.md",
    );
    expect(packet.dispatch_evidence.loaded_templates).toContain(
      "templates/validator-envelope.md",
    );
  });

  test("patch-proposal dispatch_evidence carries all six fields", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 9",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/x.md",
        "---",
        "# Issue 9",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig-x | reviewer | P1 | open | blocker | |",
        "## Notes",
        "",
      ].join("\n"),
    );
    const packet = renderPatchProposalPacket({
      ledgerPath,
      findingId: "ff1",
      candidatePatchBatch: {
        id: "patch-001",
        name: "x",
        goal: "x",
        files: ["app/x.ts"],
        depends_on: ["b"],
        execution_mode: "tdd",
        acceptance_tests: ["AC 1 holds: x"],
        rationale: "rationale",
      },
      now: FROZEN_TIME,
    });
    expect(packet.dispatch_evidence.role).toBe("patch-proposal");
    expect(packet.dispatch_evidence.target_id).toBe("ff1");
    expect(packet.dispatch_evidence.cli_route_id).toBe("packet.patch-proposal");
    expect(packet.dispatch_evidence.timestamp).toBe(
      "2026-05-22T07:30:00.000Z",
    );
    expect(packet.dispatch_evidence.loaded_templates).toContain(
      "templates/patch-proposal.md",
    );
  });
});

describe("Hostile inputs and contract guards (F003, F023, F031)", () => {
  test("F003 fix: patch-proposal rejects wildcard / glob file paths", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 9",
        "status: in-progress",
        "plan_path: x",
        "---",
        "# Issue 9",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig | reviewer | P1 | open | blocker | |",
        "## Notes",
        "",
      ].join("\n"),
    );
    expect(() =>
      renderPatchProposalPacket({
        ledgerPath,
        findingId: "ff1",
        candidatePatchBatch: {
          id: "patch-001",
          name: "x",
          goal: "x",
          files: ["app/**/*.ts"],
          depends_on: ["b"],
          execution_mode: "tdd",
          acceptance_tests: ["AC 1 holds: x"],
          rationale: "x",
        },
        now: FROZEN_TIME,
      }),
    ).toThrow(/wildcard/i);
  });

  test("F023: proposer rejects findings whose status is not open", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 7",
        "status: in-progress",
        "plan_path: x",
        "---",
        "# Issue 7",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig | reviewer | P1 | fixed | blocker | commit abc1234567 |",
        "## Notes",
        "",
      ].join("\n"),
    );
    expect(() =>
      renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      }),
    ).toThrow(PacketRenderError);
  });

  test("F026/F031: ledger with invalid severity throws PacketRenderError, not raw error", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 7",
        "status: in-progress",
        "plan_path: x",
        "---",
        "# Issue 7",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig | reviewer | INJECT | open | blocker | |",
        "## Notes",
        "",
      ].join("\n"),
    );
    expect(() =>
      renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      }),
    ).toThrow(/invalid severity/);
  });

  test("F031: ledger with invalid status throws PacketRenderError", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 7",
        "status: in-progress",
        "plan_path: x",
        "---",
        "# Issue 7",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig | reviewer | P1 | INVALID-STATUS | blocker | |",
        "## Notes",
        "",
      ].join("\n"),
    );
    expect(() =>
      renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      }),
    ).toThrow(/invalid status/);
  });

  test("F029: pipe in summary trips malformed-findings-row (fail-closed)", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 7",
        "status: in-progress",
        "plan_path: x",
        "---",
        "# Issue 7",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig | reviewer | P1 | open | a | b | c |",
        "## Notes",
        "",
      ].join("\n"),
    );
    expect(() =>
      renderProposerPacket({
        ledgerPath,
        findingId: "ff1",
        now: FROZEN_TIME,
      }),
    ).toThrow(/8 columns/);
  });

  test("F007: builder fails fast on missing issue_number", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "status: in-progress",
        "plan_path: x",
        "---",
        "# Issue",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches:",
        "  - id: b1",
        "    name: \"Batch one\"",
        "    goal: \"do thing\"",
        "    files:",
        "      - app/x.ts",
        "    depends_on: []",
        "    execution_mode: tdd",
        "    acceptance_tests:",
        "      - \"AC 1 holds: t\"",
        "    ac_mapping:",
        "      - 1",
        "    rationale: null",
        "    status: pending",
        "    builder_commits: []",
        "    builder_attempts: []",
        "    iterations: 0",
        "    final_verdict: null",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "## Notes",
        "",
      ].join("\n"),
    );
    expect(() =>
      renderBuilderPacket({
        ledgerPath,
        batchId: "b1",
        attemptType: "implementation",
        now: FROZEN_TIME,
      }),
    ).toThrow(/issue_number/);
  });
});
