import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	defineCheckpoint,
	readActiveCheckpoint,
	renderCheckpoint,
	writeActiveCheckpoint,
} from "../src/checkpoint.ts";
import { writePrivateJsonAtomic } from "../src/receipt-store.ts";

test("a checkpoint exposes one owner, expected result, stop, rollback, and next action", () => {
	const checkpoint = defineCheckpoint({
		schema_version: 1,
		id: "u5",
		position: 5,
		total: 13,
		objective: "Prove deterministic tool execution.",
		owner: "runtime/tool-execution",
		expected: "Lifecycle tests pass.",
		stop: "Any result class overlaps.",
		rollback: "Abort the worktree.",
		next: "Implement provider packages.",
		active: true,
	});

	expect(renderCheckpoint(checkpoint)).toContain("Checkpoint: 5 of 13");
	expect(renderCheckpoint(checkpoint)).toContain("Owner: runtime/tool-execution");
	expect(renderCheckpoint(checkpoint)).toContain("Next: Implement provider packages.");
});

test("active checkpoint persistence is private and round-trips one card", async () => {
	const root = await mkdtemp(join(tmpdir(), "tool-execution-checkpoint-"));
	const card = defineCheckpoint({
		schema_version: 1,
		id: "u5",
		position: 5,
		total: 13,
		objective: "Prove deterministic tool execution.",
		owner: "runtime/tool-execution",
		expected: "Lifecycle tests pass.",
		stop: "Any result class overlaps.",
		rollback: "Abort the worktree.",
		next: "Implement provider packages.",
		active: true,
	});

	await writeActiveCheckpoint(card, root);
	expect(await readActiveCheckpoint(root)).toEqual(card);
	expect((await stat(root)).mode & 0o777).toBe(0o700);
	expect((await stat(join(root, "active.json"))).mode & 0o777).toBe(0o600);
});

test("inactive cards cannot authorize through active checkpoint storage", async () => {
	const root = await mkdtemp(join(tmpdir(), "tool-execution-checkpoint-"));
	const inactive = defineCheckpoint({
		schema_version: 1,
		id: "u5",
		position: 5,
		total: 13,
		objective: "Prove deterministic tool execution.",
		owner: "runtime/tool-execution",
		expected: "Lifecycle tests pass.",
		stop: "Any result class overlaps.",
		rollback: "Abort the worktree.",
		next: "Implement provider packages.",
		active: false,
	});

	await expect(writeActiveCheckpoint(inactive, root)).rejects.toThrow(
		"requires an active card",
	);
	await writePrivateJsonAtomic(root, "active.json", inactive);
	expect(await readActiveCheckpoint(root)).toBeUndefined();
});

test("checkpoint input rejects wrong field types and undeclared fields", () => {
	const valid = {
		schema_version: 1,
		id: "u5",
		position: 5,
		total: 13,
		objective: "Prove deterministic tool execution.",
		owner: "runtime/tool-execution",
		expected: "Lifecycle tests pass.",
		stop: "Any result class overlaps.",
		rollback: "Abort the worktree.",
		next: "Implement provider packages.",
		active: true,
	};

	expect(() => defineCheckpoint({ ...valid, id: 42 } as never)).toThrow(
		"Checkpoint id must be a non-empty string.",
	);
	expect(() => defineCheckpoint({ ...valid, active: "yes" } as never)).toThrow(
		"Checkpoint active must be a boolean.",
	);
	expect(() => defineCheckpoint({ ...valid, extra: true } as never)).toThrow(
		"Checkpoint has unsupported field: extra.",
	);
	expect(() =>
		defineCheckpoint({ ...valid, native_observation_binding: false }),
	).toThrow("Native observation binding is invalid.");
	expect(() =>
		defineCheckpoint({
			...valid,
			native_observation_binding: {
				qualification_cell: {
					lane: "codex_desktop",
					client: "codex-desktop",
					provider: "firecrawl",
					route: "native.firecrawl.search",
				},
				client: "codex-desktop",
				process_identity: "process-1",
				query_fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
				config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				route: "native.firecrawl.search",
				evidence_source: "receipt-1",
				max_age_ms: 60_000,
				extra: true,
			},
		}),
	).toThrow("Native observation binding has unsupported field: extra.");
});

test("native observation binding keeps the top-level client and fingerprints exact", () => {
	const valid = {
		schema_version: 1,
		id: "u10",
		position: 10,
		total: 13,
		objective: "Prove native observation provenance.",
		owner: "runtime/tool-execution",
		expected: "Every binding agrees.",
		stop: "Any binding differs.",
		rollback: "Discard the observation.",
		next: "Review the result.",
		active: true,
		native_observation_binding: {
			qualification_cell: {
				lane: "codex_desktop",
				client: "codex-desktop",
				provider: "firecrawl",
				route: "native.firecrawl.search",
			},
			client: "codex-desktop",
			process_identity: "process-1",
			query_fingerprint: `sha256:${"a".repeat(64)}`,
			config_fingerprint: `sha256:${"b".repeat(64)}`,
			route: "native.firecrawl.search",
			evidence_source: "receipt-1",
			max_age_ms: 60_000,
		},
	};

	expect(() =>
		defineCheckpoint({
			...valid,
			native_observation_binding: {
				...valid.native_observation_binding,
				client: "other-client",
			},
		}),
	).toThrow("Native observation binding is invalid.");
	expect(() =>
		defineCheckpoint({
			...valid,
			native_observation_binding: {
				...valid.native_observation_binding,
				query_fingerprint: "sha256:short",
			},
		}),
	).toThrow("Native observation binding is invalid.");
});
