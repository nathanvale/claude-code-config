import { describe, expect, test } from "bun:test";

import type { Batch } from "./contract";
import { contractDigest, sha256Digest } from "./digest";

function makeBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: "b1",
    name: "First batch",
    goal: "do the thing",
    files: ["a.ts"],
    depends_on: [],
    supersedes: null,
    execution_mode: "tdd",
    acceptance_tests: ["AC 1 holds: thing happens"],
    ac_mapping: [1],
    rationale: null,
    ...overrides,
  };
}

describe("sha256Digest", () => {
  test("emits the canonical sha256:<64-hex> shape", () => {
    const digest = sha256Digest("hello");
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("is deterministic for the same input", () => {
    expect(sha256Digest("payload")).toBe(sha256Digest("payload"));
  });

  test("different inputs produce different digests", () => {
    expect(sha256Digest("a")).not.toBe(sha256Digest("b"));
  });

  test("matches the well-known SHA-256 of the empty string", () => {
    expect(sha256Digest("")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("contractDigest", () => {
  test("is deterministic for the same batch list", () => {
    const batches = [makeBatch()];
    expect(contractDigest(batches)).toBe(contractDigest(batches));
  });

  test("changes when a contract field changes (goal)", () => {
    const a = contractDigest([makeBatch({ goal: "first goal" })]);
    const b = contractDigest([makeBatch({ goal: "second goal" })]);
    expect(a).not.toBe(b);
  });

  test("changes when a contract field changes (execution_mode)", () => {
    const a = contractDigest([makeBatch({ execution_mode: "tdd" })]);
    const b = contractDigest([makeBatch({ execution_mode: "proof_first" })]);
    expect(a).not.toBe(b);
  });

  test("changes when ac_mapping changes", () => {
    const a = contractDigest([makeBatch({ ac_mapping: [1] })]);
    const b = contractDigest([makeBatch({ ac_mapping: [1, 2] })]);
    expect(a).not.toBe(b);
  });

  test("AC3: digest does NOT change when lifecycle fields change", () => {
    // The Batch type only declares the 10 contract fields. Lifecycle fields
    // are added to the row in lib/ledger.ts; contractDigest must never see
    // them. Use a structural cast to simulate a future regression where a
    // lifecycle field leaks into the digest input.
    const base = makeBatch();
    const withLifecycle = {
      ...base,
      status: "in-progress",
      iterations: 3,
      builder_commits: ["abc123"],
      builder_attempts: [{ status: "committed" }],
      orchestrator_inline_attempts: [{ commit_sha: "def456" }],
      final_verdict: "converged",
    } as unknown as Batch;
    expect(contractDigest([withLifecycle])).toBe(contractDigest([base]));
  });

  test("legacy compat: null supersedes is omitted from the digest payload", () => {
    // A row written before replacement-batch support has no supersedes
    // field at all. A row written after, with supersedes: null, must
    // produce the same digest. This is the compatibility stability rule.
    const base = makeBatch();
    const { supersedes: _omit, ...beforeSupersedesField } = base;
    const afterSupersedesNull = makeBatch({ supersedes: null });
    expect(contractDigest([afterSupersedesNull])).toBe(
      contractDigest([beforeSupersedesField as unknown as Batch]),
    );
  });

  test("non-null supersedes IS included in the digest payload", () => {
    const a = contractDigest([makeBatch({ supersedes: null })]);
    const b = contractDigest([makeBatch({ supersedes: "blocked-batch-1" })]);
    expect(a).not.toBe(b);
  });

  test("order of batches matters (DAG ordering is contract-relevant)", () => {
    const b1 = makeBatch({ id: "b1" });
    const b2 = makeBatch({ id: "b2", depends_on: ["b1"] });
    expect(contractDigest([b1, b2])).not.toBe(contractDigest([b2, b1]));
  });

  test("empty batch list yields the digest of '[]'", () => {
    expect(contractDigest([])).toBe(sha256Digest("[]"));
  });
});
