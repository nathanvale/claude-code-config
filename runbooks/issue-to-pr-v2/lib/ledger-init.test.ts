import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNBOOK_VERSION } from "./contract";
import {
  LEDGER_INIT_SECTION_ORDER,
  LedgerInitRenderError,
  renderLedgerInit,
} from "./ledger-init";
import { readLedgerSnapshot, withFailMode } from "./ledger";
import { renderScaffold } from "./scaffolds";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { force: true, recursive: true });
  }
});

function writeTempLedger(markdown: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ledger-init-test-"));
  tempDirs.push(dir);
  const path = join(dir, "ledger.md");
  writeFileSync(path, markdown);
  return path;
}

function renderSample() {
  return renderLedgerInit({
    issueNumber: 123,
    issueTitle: 'Quote "safe" title',
    issueUrl: "https://github.com/acme/widgets/issues/123",
    targetRepo: "acme/widgets",
    startedAt: "2026-05-26T10:30:00+10:00",
    acSource: "gold-standard",
    acceptanceCriteria: [
      "First confirmed behaviour",
      "Second confirmed behaviour",
    ],
  });
}

describe("ledger init renderer", () => {
  test("emits parseable initial ledger with runtime runbook version and AC digest", () => {
    const result = renderSample();
    const ledgerPath = writeTempLedger(result.ledger_markdown);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));

    expect(result.ledger_markdown).toContain(
      `runbook_version: "${RUNBOOK_VERSION}"`,
    );
    expect(result.ledger_markdown).toContain(
      'issue_title: "Quote \\"safe\\" title"',
    );
    expect(result.ledger_markdown).toContain("plan_path: null");
    expect(result.ledger_markdown).toContain("batch_contract_digest: null");
    expect(snapshot.confirmation_state.acceptance_criteria).toBe("confirmed");
    expect(snapshot.confirmation_state.batch_contract).toBe("pending");
    expect(snapshot.runbook_version_skew).toBe("matched");
    expect(snapshot.runbook_version).toBe(RUNBOOK_VERSION);
    expect(result.metadata.runbook_version).toBe(RUNBOOK_VERSION);
    expect(result.metadata.ac_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("includes canonical sections in expected order", () => {
    const { ledger_markdown, metadata } = renderSample();
    const headings = [...ledger_markdown.matchAll(/^## (.+)$/gm)].map(
      (match) => match[1],
    );

    expect(headings).toEqual([...LEDGER_INIT_SECTION_ORDER]);
    expect(metadata.section_order).toEqual([...LEDGER_INIT_SECTION_ORDER]);
    expect(metadata.acceptance_criteria_count).toBe(2);
  });

  test("empty section bodies come from runtime scaffold renderers", () => {
    const { ledger_markdown } = renderSample();

    for (const id of [
      "ledger-empty-batches",
      "ledger-empty-findings-data",
      "workflow-learnings-empty",
    ] as const) {
      expect(ledger_markdown).toContain(renderScaffold(id).body.trimEnd());
    }
  });

  test("rejects missing acceptance criteria", () => {
    expect(() =>
      renderLedgerInit({
        issueNumber: 1,
        issueTitle: "Title",
        issueUrl: "https://github.com/acme/widgets/issues/1",
        targetRepo: "acme/widgets",
        startedAt: "2026-05-26T10:30:00+10:00",
        acSource: "pasted",
        acceptanceCriteria: [],
      }),
    ).toThrow(LedgerInitRenderError);
  });
});

describe("ledger init validation contract", () => {
  function call(overrides: Partial<Parameters<typeof renderLedgerInit>[0]>) {
    return () =>
      renderLedgerInit({
        issueNumber: 7,
        issueTitle: "Title",
        issueUrl: "https://github.com/acme/widgets/issues/7",
        targetRepo: "acme/widgets",
        startedAt: "2026-05-27T07:00:00+10:00",
        acSource: "pasted",
        acceptanceCriteria: ["Behaviour"],
        ...overrides,
      });
  }

  function expectErrorCode(
    invocation: () => unknown,
    expectedCode: string,
  ): void {
    try {
      invocation();
    } catch (error) {
      if (!(error instanceof LedgerInitRenderError)) {
        throw new Error(
          `expected LedgerInitRenderError, got ${(error as Error).name}: ${(error as Error).message}`,
        );
      }
      expect(error.code as string).toBe(expectedCode);
      return;
    }
    throw new Error("expected LedgerInitRenderError, got no throw");
  }

  test("invalid issue number returns invalid-issue-number", () => {
    expectErrorCode(call({ issueNumber: 0 }), "invalid-issue-number");
    expectErrorCode(call({ issueNumber: -1 }), "invalid-issue-number");
    expectErrorCode(call({ issueNumber: 1.5 }), "invalid-issue-number");
  });

  test("whitespace-only required input returns missing-required-input", () => {
    expectErrorCode(call({ issueTitle: "   " }), "missing-required-input");
    expectErrorCode(call({ targetRepo: "" }), "missing-required-input");
  });

  test("embedded newline in any required input returns invalid-control-characters", () => {
    expectErrorCode(
      call({ issueTitle: "Title\nwith newline" }),
      "invalid-control-characters",
    );
    expectErrorCode(
      call({ issueUrl: "https://example.com/\nbad" }),
      "invalid-control-characters",
    );
    expectErrorCode(
      call({ targetRepo: "acme/\nwidgets" }),
      "invalid-control-characters",
    );
    expectErrorCode(
      call({ acceptanceCriteria: ["good", "bad\nrow"] }),
      "invalid-control-characters",
    );
  });

  test("non-printable control character (NUL, DEL) returns invalid-control-characters", () => {
    expectErrorCode(
      call({ issueTitle: "Title\x00with NUL" }),
      "invalid-control-characters",
    );
    expectErrorCode(
      call({ targetRepo: "acme\x7fwidgets" }),
      "invalid-control-characters",
    );
  });

  test("non-ISO started_at returns invalid-started-at", () => {
    expectErrorCode(
      call({ startedAt: "2026-05-27" }),
      "invalid-started-at",
    );
    expectErrorCode(
      call({ startedAt: "yesterday" }),
      "invalid-started-at",
    );
    expectErrorCode(
      call({ startedAt: "2026/05/27 07:00:00" }),
      "invalid-started-at",
    );
  });

  test("ISO started_at with Z or numeric offset succeeds", () => {
    expect(() => call({ startedAt: "2026-05-27T07:00:00Z" })()).not.toThrow();
    expect(() =>
      call({ startedAt: "2026-05-27T07:00:00.123+10:00" })(),
    ).not.toThrow();
  });

  test("invalid ac_source returns invalid-ac-source", () => {
    expectErrorCode(
      call({ acSource: "bogus" as never }),
      "invalid-ac-source",
    );
  });

  test("empty ac value returns empty-acceptance-criterion", () => {
    expectErrorCode(
      call({ acceptanceCriteria: ["valid", "   "] }),
      "empty-acceptance-criterion",
    );
  });
});
