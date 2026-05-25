/**
 * Digest payload construction and hashing for the Issue-to-PR v2 helper.
 *
 * Lifted from v1 `runbooks/issue-to-pr/decompose.ts` lines 834-858 (U3 slice
 * S2). Only the pure primitives live here — `contractDigest` and
 * `sha256Digest`. The emit wrappers (`emitContractDigest`, `emitPlanDigest`,
 * `emitAcDigest`) stay in `decompose.ts` because they perform stdout writes
 * and depend on ledger-parsing helpers that land in `lib/ledger.ts`.
 *
 * Why this is its own slice: AC3 of issue #51 requires that lifecycle-only
 * ledger changes do not change the digest. `contractDigest` enforces that
 * by hashing only the 10 candidate-contract fields (the `Batch` type from
 * `lib/contract.ts`), never the runtime lifecycle fields.
 */

import { createHash } from "node:crypto";
import type { Batch } from "./contract";

/**
 * Compute the SHA-256 digest of the confirmed batch contract.
 *
 * Hashes the canonical JSON form of every batch's 10 contract fields. A
 * `null` `supersedes` is omitted so legacy ledgers (written before
 * replacement-batch support landed) keep their stored digest.
 *
 * @param batches - The confirmed batch list. Lifecycle fields on the same
 *   row are intentionally ignored.
 * @returns A string of the form `sha256:<64-hex-digits>`.
 */
export function contractDigest(batches: Batch[]): string {
  const contract = batches.map((b) => ({
    id: b.id,
    name: b.name,
    goal: b.goal,
    files: b.files,
    depends_on: b.depends_on,
    // Omit null supersedes so legacy ledgers keep their stored digest.
    ...(b.supersedes === null ? {} : { supersedes: b.supersedes }),
    execution_mode: b.execution_mode,
    acceptance_tests: b.acceptance_tests,
    ac_mapping: b.ac_mapping,
    rationale: b.rationale,
  }));
  const payload = JSON.stringify(contract);
  return sha256Digest(payload);
}

/**
 * Compute the canonical `sha256:<hex>` digest of an arbitrary string.
 *
 * Used by `contractDigest` and by the plan/AC-digest emitters in
 * `decompose.ts`. Output format matches the `^sha256:[0-9a-f]{64}$` shape
 * the frontmatter validator enforces.
 */
export function sha256Digest(payload: string): string {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}
