import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { hasSensitiveOptionName } from "./browser-use-core";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import {
	type BrowserUseDurableRecordKind,
	type BrowserUseSharedRunPayload,
	type PayloadOf,
	BROWSER_USE_DURABLE_RECORD_KINDS,
	BROWSER_USE_DURABLE_SCHEMA_VERSION,
	BROWSER_USE_OPAQUE_AUTH_REFERENCE_KEYS,
	encodeDurableRecord,
	findRedactionViolations,
	parseDurableRecord,
	receiptForRun,
	validateSharedRunPayload,
} from "./browser-use-schemas";

// =========================================================================
// Versioned durable-record schemas (platform plan 2026-07-21-002 U2).
//
// Owns the ledger rows: the schema parse matrix (json-invalid /
// kind-mismatch / version-unsupported / payload-invalid) and V5 ("no
// secret-bearing fixture enters durable state" — every fixture file under
// src/fixtures/browser-use-platform/, parsable JSON or raw text, walks
// clean, and the guard itself rejects the one guard-proving fixture).
// =========================================================================

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "browser-use-platform");

async function fixtureText(name: string): Promise<string> {
	return await readFile(join(FIXTURES_DIR, name), "utf8");
}

function baseRun(overrides: Partial<BrowserUseSharedRun> = {}): BrowserUseSharedRun {
	return {
		run_id: "run-1",
		revision: 3,
		state: "running",
		task_intent: "routine-automation",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "agent-browser",
		handoff_evidence_id: "evidence-1",
		mutation_dispatched: false,
		artifacts: [],
		...overrides,
	};
}

function basePayload(
	overrides: Partial<BrowserUseSharedRunPayload> = {},
): BrowserUseSharedRunPayload {
	return {
		...baseRun(),
		created_at_epoch_ms: 1_000,
		updated_at_epoch_ms: 2_000,
		...overrides,
	};
}

// One valid sample per record kind: encode → parse must round-trip for all
// eight kinds through the same envelope.
const SAMPLE_PAYLOADS: { [K in BrowserUseDurableRecordKind]: PayloadOf<K> } = {
	"shared-run": basePayload(),
	"run-lease": {
		key: "agent-chrome/default",
		holder_id: "holder-1",
		fencing_token: 2,
		activation_epoch: 1,
		acquired_at_epoch_ms: 1_000,
		heartbeat_at_epoch_ms: 1_500,
		expires_at_epoch_ms: 31_000,
		recovered_from: {
			fencing_token: 1,
			holder_id: "holder-0",
			observed_expired_at_epoch_ms: 900,
		},
		scope: { auth_context_ref: "auth-context-1", target_id: "target-1" },
	},
	"activation-epoch": { epoch: 1 },
	generation: {
		generation_id: "generation-1",
		content_hash: "a".repeat(64),
		status: "staged",
		staged_at_epoch_ms: 1_000,
	},
	"source-snapshot": {
		snapshot_id: "snapshot-1",
		root_identity: "root-identity-1",
		entries: [
			{
				relative_path: "runbooks/example.md",
				type: "file",
				size: 42,
				mode: 0o600,
				content_hash: "b".repeat(64),
			},
		],
		snapshot_digest: "c".repeat(64),
	},
	"artifact-manifest": {
		artifact_id: "artifact-1",
		run_id: "run-1",
		task_intent: "frontend-test",
		adapter_id: "playwright-cdp",
		adapter_version: "1.0.0",
		sanitized_target: { origin: "https://example.test", path_shape: "/reports/:num" },
		producer_capability: "trace-capture",
		content_hash: "d".repeat(64),
		sensitivity: "high",
		retention: "failure-evidence",
		outcome_ref: null,
		created_at_epoch_ms: 2_500,
		export_receipt: { destination_digest: "e".repeat(64), exported_at_epoch_ms: 3_000 },
	},
	tombstone: {
		artifact_id: "artifact-1",
		run_id: "run-1",
		retention: "ephemeral",
		reason: "explicit-delete",
		phase: "complete",
		deleted_at_epoch_ms: 4_000,
	},
	"run-receipt": {
		run_id: "run-1",
		revision: 3,
		state: "confirmed",
		summary: "routine-automation run is confirmed.",
		receipt_digest: "f".repeat(64),
	},
};

describe("durable record envelope (R10)", () => {
	test("the kind vocabulary carries the eight durable record kinds", () => {
		expect(BROWSER_USE_DURABLE_RECORD_KINDS).toEqual([
			"shared-run",
			"run-lease",
			"activation-epoch",
			"generation",
			"source-snapshot",
			"artifact-manifest",
			"tombstone",
			"run-receipt",
		]);
	});

	test("encode emits the canonical envelope: tab-indented, one trailing newline", () => {
		const encoded = encodeDurableRecord("activation-epoch", { epoch: 1 });
		expect(encoded).toBe(
			`{\n\t"record": "activation-epoch",\n\t"schema_version": "${BROWSER_USE_DURABLE_SCHEMA_VERSION}",\n\t"payload": {\n\t\t"epoch": 1\n\t}\n}\n`,
		);
	});

	for (const kind of BROWSER_USE_DURABLE_RECORD_KINDS) {
		test(`${kind}: encode then parse round-trips through the one envelope`, () => {
			const payload = SAMPLE_PAYLOADS[kind];
			const parsed = parseDurableRecord(encodeDurableRecord(kind, payload), kind);
			expect(parsed).toEqual({ ok: true, payload });
		});
	}

	test("the valid shared-run fixture is byte-exact canonical form", async () => {
		const raw = await fixtureText("shared-run-valid.json");
		const parsed = parseDurableRecord(raw, "shared-run");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error("unreachable");
		expect(encodeDurableRecord("shared-run", parsed.payload)).toBe(raw);
	});
});

describe("schema parse matrix (owned ledger row)", () => {
	test("truncated JSON is record_json_invalid", async () => {
		const parsed = parseDurableRecord(
			await fixtureText("shared-run-corrupt.json.txt"),
			"shared-run",
		);
		expect(parsed).toEqual({
			ok: false,
			code: "record_json_invalid",
			message: expect.any(String),
		});
	});

	test("valid JSON that is not an object envelope is record_json_invalid", () => {
		expect(parseDurableRecord("[1,2,3]", "shared-run")).toMatchObject({
			ok: false,
			code: "record_json_invalid",
		});
	});

	test("a wrong record kind is record_kind_mismatch naming both kinds", async () => {
		const parsed = parseDurableRecord(
			await fixtureText("record-wrong-kind.json"),
			"shared-run",
		);
		expect(parsed).toMatchObject({ ok: false, code: "record_kind_mismatch" });
		if (parsed.ok) throw new Error("unreachable");
		expect(parsed.message).toContain("shared-run");
		expect(parsed.message).toContain("activation-epoch");
	});

	test("a missing record kind is record_kind_mismatch", () => {
		expect(parseDurableRecord("{}", "shared-run")).toMatchObject({
			ok: false,
			code: "record_kind_mismatch",
		});
	});

	test("schema version 2 is record_version_unsupported", async () => {
		const parsed = parseDurableRecord(
			await fixtureText("shared-run-version-2.json"),
			"shared-run",
		);
		expect(parsed).toMatchObject({ ok: false, code: "record_version_unsupported" });
		if (parsed.ok) throw new Error("unreachable");
		expect(parsed.message).toContain("2");
	});

	test("a structurally broken payload is record_payload_invalid", () => {
		const raw = JSON.stringify({
			record: "shared-run",
			schema_version: "1",
			payload: { run_id: "run-1" },
		});
		expect(parseDurableRecord(raw, "shared-run")).toMatchObject({
			ok: false,
			code: "record_payload_invalid",
		});
	});

	test("a payload violating a U1 run invariant is record_payload_invalid", () => {
		// Blocked state without a continuation: structural fields parse, but the
		// delegated U1 validateSharedRun invariant rejects it.
		const payload = basePayload({ state: "awaiting-auth" });
		const raw = encodeDurableRecord("shared-run", payload);
		expect(parseDurableRecord(raw, "shared-run")).toMatchObject({
			ok: false,
			code: "record_payload_invalid",
		});
	});
});

describe("per-kind payload invariants", () => {
	const invalidCases: readonly {
		kind: BrowserUseDurableRecordKind;
		mutate: (payload: Record<string, unknown>) => void;
		label: string;
	}[] = [
		{
			kind: "run-lease",
			mutate: (p) => {
				p.fencing_token = 0;
			},
			label: "a zero fencing token",
		},
		{
			kind: "run-lease",
			mutate: (p) => {
				p.recovered_from = { fencing_token: 1 };
			},
			label: "an incomplete fenced-takeover proof",
		},
		{
			kind: "activation-epoch",
			mutate: (p) => {
				p.epoch = 0;
			},
			label: "epoch zero (epochs start at 1)",
		},
		{
			kind: "generation",
			mutate: (p) => {
				p.status = "promoted";
			},
			label: "an unknown generation status",
		},
		{
			kind: "source-snapshot",
			mutate: (p) => {
				p.entries = [{ relative_path: "x", type: "socket" }];
			},
			label: "a snapshot entry with an unknown type",
		},
		{
			kind: "artifact-manifest",
			mutate: (p) => {
				p.retention = "forever";
			},
			label: "an unregistered retention class",
		},
		{
			kind: "artifact-manifest",
			mutate: (p) => {
				p.export_receipt = {};
			},
			label: "an export receipt without a destination digest",
		},
		{
			kind: "tombstone",
			mutate: (p) => {
				p.phase = "started";
			},
			label: "an unknown tombstone phase",
		},
		{
			kind: "run-receipt",
			mutate: (p) => {
				p.revision = 0;
			},
			label: "a zero receipt revision",
		},
	];

	for (const { kind, mutate, label } of invalidCases) {
		test(`${kind}: ${label} is record_payload_invalid`, () => {
			const payload = structuredClone(SAMPLE_PAYLOADS[kind]) as Record<
				string,
				unknown
			>;
			mutate(payload);
			const raw = JSON.stringify({
				record: kind,
				schema_version: "1",
				payload,
			});
			expect(parseDurableRecord(raw, kind)).toMatchObject({
				ok: false,
				code: "record_payload_invalid",
			});
		});
	}
});

describe("shared-run payload validation (R24)", () => {
	test("a valid persisted payload has no issues", () => {
		expect(validateSharedRunPayload(basePayload())).toEqual([]);
	});

	test("revision below 1 is a typed CAS-token issue", () => {
		expect(validateSharedRunPayload(basePayload({ revision: 0 }))).toEqual([
			expect.objectContaining({ code: "run_revision_invalid" }),
		]);
	});

	test("missing clock timestamps are typed issues, one per field", () => {
		const payload = basePayload({
			created_at_epoch_ms: Number.NaN,
			updated_at_epoch_ms: -1,
		});
		expect(validateSharedRunPayload(payload)).toEqual([
			expect.objectContaining({ code: "run_timestamp_invalid" }),
			expect.objectContaining({ code: "run_timestamp_invalid" }),
		]);
	});

	test("U1 run invariants flow through, never re-derived", () => {
		expect(validateSharedRunPayload(basePayload({ state: "awaiting-auth" }))).toEqual(
			[expect.objectContaining({ code: "run_blocked_without_continuation" })],
		);
	});
});

describe("redaction walker (R13, V5 guard)", () => {
	test("a clean durable payload has zero violations", () => {
		expect(findRedactionViolations(SAMPLE_PAYLOADS["artifact-manifest"])).toEqual(
			[],
		);
	});

	test("a sensitive key is a typed violation with its path", () => {
		expect(
			findRedactionViolations({ nested: { password: "sentinel-not-a-secret" } }),
		).toEqual([{ path: "nested.password", reason: "sensitive_key" }]);
	});

	test("op:// and ws:// shaped values are typed violations", () => {
		expect(
			findRedactionViolations({ ref: "op://vault/item/field" }),
		).toEqual([{ path: "ref", reason: "secret_shaped_value" }]);
		expect(
			findRedactionViolations({ endpoint: "ws://127.0.0.1:9222/devtools" }),
		).toEqual([{ path: "endpoint", reason: "secret_shaped_value" }]);
		expect(
			findRedactionViolations({ endpoint: "wss://example.test/socket" }),
		).toEqual([{ path: "endpoint", reason: "secret_shaped_value" }]);
	});

	test("array elements carry indexed paths", () => {
		expect(
			findRedactionViolations({ items: ["clean", "ws://127.0.0.1:1/x"] }),
		).toEqual([{ path: "items.1", reason: "secret_shaped_value" }]);
	});

	test("the auth_fragment.fragment subtree is skipped, not certified (R6)", () => {
		const payload = {
			auth_fragment: {
				schema_version: "1",
				// Auth-owned opaque content: the platform never walks it. The
				// sentinel below proves the skip; it is not a real credential.
				fragment: { session_token: "sentinel-not-a-secret" },
			},
		};
		expect(findRedactionViolations(payload)).toEqual([]);
	});

	test("auth_fragment.schema_version stays walked — only the fragment is opaque", () => {
		const payload = {
			auth_fragment: {
				schema_version: "ws://not-a-version",
				fragment: {},
			},
		};
		expect(findRedactionViolations(payload)).toEqual([
			{ path: "auth_fragment.schema_version", reason: "secret_shaped_value" },
		]);
	});

	test("opaque U1 auth-reference keys are legal despite matching the pattern", () => {
		const payload = {
			auth_fragment: { schema_version: "1", fragment: {} },
			auth_attestation: {
				attestation_digest: "digest-1",
				fresh_until_epoch_ms: 10_000,
			},
			scope: { auth_context_ref: "auth-context-1" },
		};
		expect(findRedactionViolations(payload)).toEqual([]);
	});

	test("skipPaths skips exactly the named subtree", () => {
		const payload = {
			quarantined: { password: "sentinel-not-a-secret" },
			live: { password: "sentinel-not-a-secret" },
		};
		expect(
			findRedactionViolations(payload, { skipPaths: ["quarantined"] }),
		).toEqual([{ path: "live.password", reason: "sensitive_key" }]);
	});
});

describe("run receipts (R24/R29, S20 substrate)", () => {
	test("a receipt carries run facts and a deterministic content digest", () => {
		const run = baseRun();
		const first = receiptForRun(run);
		const second = receiptForRun(run);
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			run_id: "run-1",
			revision: 3,
			state: "running",
		});
		expect(first.receipt_digest).toMatch(/^[0-9a-f]{64}$/);
	});

	test("the digest changes when the run state changes", () => {
		expect(receiptForRun(baseRun()).receipt_digest).not.toBe(
			receiptForRun(baseRun({ state: "confirmed" })).receipt_digest,
		);
	});

	test("a blocked run's receipt names its one next safe action by id", () => {
		const receipt = receiptForRun(
			baseRun({
				state: "awaiting-auth",
				continuation: {
					next_action_id: "prepare_auth_binding",
					summary: "Prepare the credential binding, then resume this run.",
				},
			}),
		);
		expect(receipt.summary).toContain("prepare_auth_binding");
	});

	test("a receipt passes the redaction walker and re-parses as a record", () => {
		const receipt = receiptForRun(baseRun());
		expect(findRedactionViolations(receipt)).toEqual([]);
		expect(
			parseDurableRecord(encodeDurableRecord("run-receipt", receipt), "run-receipt"),
		).toEqual({ ok: true, payload: receipt });
	});
});

describe("V5 — no secret-bearing fixture enters durable state", () => {
	test("every fixture file, parsable or not, walks redaction-clean except the guard-proving one", async () => {
		const all = await readdir(FIXTURES_DIR);
		// The fixture set this test owns must be present before sweeping. The
		// corrupt fixture carries a .json.txt name so Biome's JSON parser skips
		// the intentional truncation; the bytes fixture is plain text. Both are
		// written INTO durable state by retention tests, so the sweep must
		// reach beyond *.json names.
		for (const required of [
			"shared-run-valid.json",
			"shared-run-corrupt.json.txt",
			"record-wrong-kind.json",
			"shared-run-version-2.json",
			"tombstone-pending.json",
			"tombstone-complete.json",
			"artifact-manifest.json",
			"artifact-manifest-present.json",
			"artifact-bytes-present.txt",
			"redaction-violation.json",
		]) {
			expect(all).toContain(required);
		}
		// README.md is documentation that names the banned shapes verbatim
		// (it literally spells out `ws://`) and never enters durable state;
		// it is the ONE exclusion. Every other file is swept.
		const names = all.filter((name) => name !== "README.md");
		for (const name of names) {
			const raw = await fixtureText(name);
			// Raw-text half: an op:// reference or ws(s):// endpoint is
			// secret-shaped in ANY fixture, JSON or not.
			expect({ name, violations: findRedactionViolations(raw) }).toEqual({
				name,
				violations: [],
			});
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				if (name.endsWith(".json")) {
					throw new Error(`fixture ${name} is not valid JSON`);
				}
				// Parsed half unavailable: enforce the sensitive-KEY rule on
				// the raw text instead. Quoted-key shapes must be non-sensitive
				// unless they are the legal opaque auth-reference keys (R6).
				const sensitiveKeys = [...raw.matchAll(/"([^"\\]+)"\s*:/g)]
					.map((match) => match[1] ?? "")
					.filter(
						(key) =>
							hasSensitiveOptionName(key) &&
							!(BROWSER_USE_OPAQUE_AUTH_REFERENCE_KEYS as readonly string[]).includes(
								key,
							),
					);
				expect({ name, sensitiveKeys }).toEqual({ name, sensitiveKeys: [] });
				continue;
			}
			const violations = findRedactionViolations(parsed);
			if (name === "redaction-violation.json") {
				// The guard itself must reject the guard-proving fixture.
				expect(violations).toEqual([
					{
						path: "payload.password",
						reason: "sensitive_key",
					},
				]);
			} else {
				expect({ name, violations }).toEqual({ name, violations: [] });
			}
		}
	});
});
