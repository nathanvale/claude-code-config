import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyRunbookDraft,
	deleteRunbookDraft,
	parseRunbookDraftDocument,
	readRunbookSourceCatalog,
	runbookAuthoringSchema,
} from "./browser-use-runbook-authoring";
import { applyReviewedActionCandidate } from "./browser-use-reviewed-action-authoring";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import { fixedClock, makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { activateRunbookGeneration } from "./browser-use-runbook-generation";
import { privateRunbookCatalogDigest } from "./browser-use-private-runbook-catalog";

const cleanup = new Set<string>();

afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "demo",
		flow_id: "read",
		flow_name: "demo-read",
		version: "1",
		summary: "Read demo state.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
		...overrides,
	};
}

function bytes(value: Record<string, unknown>): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

async function sourceFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "runbook-authoring-"));
	cleanup.add(root);
	await mkdir(join(root, "skills/browser-use/runbooks"), { recursive: true });
	await mkdir(join(root, "skills/browser-use/actions"), { recursive: true });
	await writeFile(
		join(root, "skills/browser-use/actions/registry.json"),
		'{"actions":[]}\n',
	);
	return root;
}

describe("complete-document Runbook authoring", () => {
	test("facade schema and validate commands return the authoring result contract", async () => {
		const sourceRoot = await sourceFixture();
		const file = join(sourceRoot, "draft.json");
		await writeFile(file, bytes(draft()));
		const runtime = makeRuntime({ sourceCheckoutRoot: sourceRoot });
		const schema = await runForTest(["runbook", "schema", "--json"], runtime);
		expect(schema.exitCode).toBe(0);
		expect(parseJson(schema.stdout)).toMatchObject({
			status: "ok",
			data: {
				contract_id: "browser-use.runbook-authoring",
				schema_version: "1",
				command: "runbook-schema",
			},
		});
		const validated = await runForTest(
			["runbook", "validate", "--file", file, "--json"],
			runtime,
		);
		expect(validated.exitCode).toBe(0);
		expect(parseJson(validated.stdout)).toMatchObject({
			status: "ok",
			data: {
				contract_id: "browser-use.runbook-authoring",
				command: "runbook-validate",
				result: { ok: true },
			},
		});
		const applied = await runForTest(
			["runbook", "apply", "--file", file, "--json"],
			runtime,
		);
		expect(applied.exitCode).toBe(0);
		const appliedData = parseJson(applied.stdout).data as {
			result: {
				changed: boolean;
				record_digest: string;
				synchronization_status: string;
			};
		};
		expect(appliedData.result).toMatchObject({
			changed: true,
			synchronization_status: "new-pending-activation",
		});
		const deleted = await runForTest(
			[
				"runbook",
				"delete",
				"--service",
				"demo",
				"--flow",
				"read",
				"--expected-record-digest",
				appliedData.result.record_digest,
				"--json",
			],
			runtime,
		);
		expect(deleted.exitCode).toBe(0);
		expect(parseJson(deleted.stdout)).toMatchObject({
			status: "ok",
			data: {
				command: "runbook-delete",
				result: {
					changed: true,
					synchronization_status: "deletion-pending-activation",
				},
			},
		});
	});

	test("facade apply and delete refuse packaged invocation with repair-safe errors", async () => {
		const sourceRoot = await sourceFixture();
		const file = join(sourceRoot, "draft.json");
		await writeFile(file, bytes(draft()));
		for (const argv of [
			["runbook", "apply", "--file", file, "--json"],
			["runbook", "delete", "--service", "demo", "--flow", "read", "--json"],
		]) {
			const result = await runForTest(argv, makeRuntime({ sourceCheckoutRoot: null }));
			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout)).toMatchObject({
				status: "error",
				error: { code: "runbook_source_checkout_required" },
			});
			expect(result.stdout).not.toContain(sourceRoot);
		}
	});

	test("schema example round-trips through the model-owned parser and validator", () => {
		const schema = runbookAuthoringSchema();
		const parsed = parseRunbookDraftDocument(
			`${JSON.stringify(schema.minimal_valid_example, null, 2)}\n`,
		);
		expect(parsed).toMatchObject({ ok: true });
		if (parsed.ok) expect(parsed.bytes).toBe(`${JSON.stringify(schema.minimal_valid_example, null, 2)}\n`);
	});

	test("incomplete documents name every missing root field with one repair", () => {
		const parsed = parseRunbookDraftDocument("{}\n");
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.issues.map((issue) => issue.path)).toEqual([
			"$.contract",
			"$.schema_version",
			"$.service_id",
			"$.flow_id",
			"$.flow_name",
			"$.version",
			"$.summary",
			"$.allowed_origins",
			"$.inputs",
			"$.steps",
		]);
		expect(parsed.repair).toContain("every named document path");
	});

	test("rejects duplicate and unknown keys recursively before digesting", () => {
		const duplicate = parseRunbookDraftDocument(
			bytes(draft()).replace('"summary": "Read demo state.",', '"summary": "Read demo state.",\n  "summary": "hidden",'),
		);
		expect(duplicate).toMatchObject({ ok: false, code: "runbook_document_duplicate_key" });
		const prototypeKey = parseRunbookDraftDocument(
			bytes(draft()).replace('"contract":', '"__proto__": {},\n  "contract":'),
		);
		expect(prototypeKey).toMatchObject({
			ok: false,
			code: "runbook_document_key_unknown",
		});
		const fixtures = [
			draft({ approval: { disposition: "approved" } }),
			draft({ inputs: [{ id: "rows", summary: "Rows.", required: true, schema: { kind: "array", items: { kind: "string", script: "hidden" } } }] }),
			draft({ steps: [{ kind: "snapshot", interactive: false, javascript: "hidden" }] }),
			draft({ steps: [{ kind: "click", target: { role: "button", name: "Continue", selector: "#hidden" }, postcondition: { kind: "element-visible", selector: ".done" } }] }),
			draft({ steps: [{ kind: "open", url: "https://example.test/", postcondition: { kind: "url-equals", url: "https://example.test/", script: "hidden" } }] }),
		];
		for (const fixture of fixtures) {
			const parsed = parseRunbookDraftDocument(bytes(fixture));
			expect(parsed).toMatchObject({ ok: false, code: "runbook_document_key_unknown" });
		}
	});

	test("rejects secret-shaped material, login steps, and credential targets without echo", () => {
		const secret = "op://vault/item/password";
		const secretKey = draft();
		secretKey[secret] = true;
		const cases = [
			bytes(draft({ summary: secret })),
			bytes(secretKey),
			bytes(draft({ steps: [{ kind: "login", password: secret }] })),
			bytes(draft({ steps: [{ kind: "click", target: { role: "textbox", name: "Password" }, postcondition: { kind: "element-visible", selector: ".done" } }] })),
		];
		for (const raw of cases) {
			const parsed = parseRunbookDraftDocument(raw);
			expect(parsed.ok).toBe(false);
			expect(JSON.stringify(parsed)).not.toContain(secret);
		}
	});

	test("refuses unknown auth context before source write", async () => {
		const sourceRoot = await sourceFixture();
		expect(await applyRunbookDraft({ sourceRoot, bytes: bytes(draft({ auth_context_ref: "unknown-context" })) })).toMatchObject({
			ok: false,
			code: "runbook_auth_context_invalid",
		});
	});

	test("creates, no-ops, and replaces only with the observed digest", async () => {
		const sourceRoot = await sourceFixture();
		const firstBytes = bytes(draft());
		const created = await applyRunbookDraft({ sourceRoot, bytes: firstBytes });
		expect(created).toMatchObject({
			ok: true,
			changed: true,
			synchronization_status: "new-pending-activation",
		});
		if (!created.ok) return;
		if (created.record_digest === null) throw new Error("create returned no digest");
		const path = join(
			sourceRoot,
			"skills/browser-use/runbooks/demo/read/runbook.json",
		);
		expect(await readFile(path, "utf8")).toBe(firstBytes);

		const identical = await applyRunbookDraft({ sourceRoot, bytes: firstBytes });
		expect(identical).toMatchObject({ ok: true, changed: false });

		const replacementBytes = bytes(draft({ summary: "Read changed state." }));
		expect(await applyRunbookDraft({ sourceRoot, bytes: replacementBytes })).toMatchObject({
			ok: false,
			code: "runbook_replacement_digest_required",
			current_record_digest: created.record_digest,
		});
		expect(await readFile(path, "utf8")).toBe(firstBytes);
		expect(
			await applyRunbookDraft({
				sourceRoot,
				bytes: replacementBytes,
				expectedRecordDigest: "0".repeat(64),
			}),
		).toMatchObject({
			ok: false,
			code: "runbook_replacement_digest_stale",
			current_record_digest: created.record_digest,
		});
		expect(await readFile(path, "utf8")).toBe(firstBytes);

		const replaced = await applyRunbookDraft({
			sourceRoot,
			bytes: replacementBytes,
			expectedRecordDigest: created.record_digest,
		});
		expect(replaced).toMatchObject({ ok: true, changed: true });
		expect(await readFile(path, "utf8")).toBe(replacementBytes);
	});

	test("refuses an unresolved Reviewed Action before creating source", async () => {
		const sourceRoot = await sourceFixture();
		const actionBytes = bytes(
			draft({
				steps: [
					{
						kind: "action",
						action_id: "missing-action",
						expected_digest: "a".repeat(64),
						inputs: {},
					},
				],
			}),
		);
		expect(await applyRunbookDraft({ sourceRoot, bytes: actionBytes })).toMatchObject({
			ok: false,
			code: "runbook_action_absent",
		});
		expect(
			await readFile(
				join(sourceRoot, "skills/browser-use/runbooks/demo/read/runbook.json"),
				"utf8",
			).catch(() => undefined),
		).toBeUndefined();
	});

	test("refuses unpromoted, stale, and wrong-origin Reviewed Action closure", async () => {
		const sourceRoot = await sourceFixture();
		const action = await applyReviewedActionCandidate({
			sourceRoot,
			candidate: {
				contract: "browser-use.reviewed-action-candidate",
				schema_version: "1",
				action_id: "count-rows",
				origin: "https://example.test",
				source: "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })",
				containment: "read-only-observation",
				input_schema: { kind: "object", fields: {} },
				result_schema: { kind: "object", fields: { rows: { required: true, schema: { kind: "number", integer: true } } } },
				result_sensitivity: "low",
			},
		});
		expect(action.ok).toBe(true);
		if (!action.ok) return;
		const actionStep = {
			kind: "action",
			action_id: "count-rows",
			expected_digest: action.digest,
			inputs: {},
		};
		expect(await applyRunbookDraft({ sourceRoot, bytes: bytes(draft({ steps: [actionStep] })) })).toMatchObject({
			ok: false,
			code: "runbook_action_unpromoted",
		});
		expect(await applyRunbookDraft({ sourceRoot, bytes: bytes(draft({ steps: [{ ...actionStep, expected_digest: "f".repeat(64) }] })) })).toMatchObject({
			ok: false,
			code: "runbook_action_digest_stale",
		});
		expect(await applyRunbookDraft({ sourceRoot, bytes: bytes(draft({ allowed_origins: ["https://other.example.test"], steps: [actionStep] })) })).toMatchObject({
			ok: false,
			code: "runbook_action_origin_mismatch",
		});
	});

	test("refuses an auth-capable action before Runbook source write", async () => {
		const sourceRoot = await sourceFixture();
		const source = "async ({ inputs }) => ({ password: document.querySelector('input[type=password]').value })";
		const actionDigest = new Bun.CryptoHasher("sha256").update(source).digest("hex");
		const actionsRoot = join(sourceRoot, "skills/browser-use/actions");
		await mkdir(join(actionsRoot, "assets"), { recursive: true });
		await writeFile(join(actionsRoot, `assets/${actionDigest}.js`), source);
		await writeFile(
			join(actionsRoot, "registry.json"),
			`${JSON.stringify({
				actions: [
					{
						asset_path: `assets/${actionDigest}.js`,
						record: {
							action_id: "credential-read",
							asset_id: actionDigest,
							expected_digest: actionDigest,
							allowed_origin: "https://example.test",
							effect_class: "mutation",
							audited_capabilities: ["dom-query", "dom-read", "dom-write"],
							containment: "none",
							input_schema: { kind: "object", fields: {} },
							result_schema: { kind: "object", fields: {} },
							result_sensitivity: "high",
							required_postcondition: { kind: "element-visible", selector: ".done" },
							source_provenance: "authored:credential-read",
							promotion_receipt: null,
						},
					},
				],
			}, null, 2)}\n`,
		);
		expect(
			await applyRunbookDraft({
				sourceRoot,
				bytes: bytes(
					draft({
						steps: [
							{
								kind: "action",
								action_id: "credential-read",
								expected_digest: actionDigest,
								inputs: {},
							},
						],
					}),
				),
			}),
		).toMatchObject({ ok: false, code: "runbook_action_auth_capable" });
	});

	test("delete is digest-guarded and absent deletion is idempotent", async () => {
		const sourceRoot = await sourceFixture();
		const created = await applyRunbookDraft({ sourceRoot, bytes: bytes(draft()) });
		if (!created.ok) throw new Error(created.message);
		if (created.record_digest === null) throw new Error("create returned no digest");
		expect(
			await deleteRunbookDraft({
				sourceRoot,
				serviceId: "demo",
				flowId: "read",
				expectedRecordDigest: "0".repeat(64),
			}),
		).toMatchObject({
			ok: false,
			code: "runbook_delete_digest_stale",
			current_record_digest: created.record_digest,
		});
		expect(
			await deleteRunbookDraft({
				sourceRoot,
				serviceId: "demo",
				flowId: "read",
				expectedRecordDigest: created.record_digest,
			}),
		).toMatchObject({ ok: true, changed: true });
		expect(
			await deleteRunbookDraft({
				sourceRoot,
				serviceId: "demo",
				flowId: "read",
			}),
		).toMatchObject({ ok: true, changed: false });
	});

	test("relative and absent source roots refuse instead of using CWD", async () => {
		expect(await applyRunbookDraft({ sourceRoot: ".", bytes: bytes(draft()) })).toMatchObject({
			ok: false,
			code: "runbook_source_checkout_required",
		});
		expect(await deleteRunbookDraft({ sourceRoot: "/path/that/does/not/exist", serviceId: "demo", flowId: "read" })).toMatchObject({
			ok: false,
			code: "runbook_source_checkout_required",
		});
	});

	test("apply and delete refuse a source path symlink before mutating outside the catalog", async () => {
		const sourceRoot = await sourceFixture();
		const outside = await mkdtemp(join(tmpdir(), "runbook-authoring-outside-"));
		cleanup.add(outside);
		await mkdir(join(outside, "read"));
		const outsideRecord = bytes(draft());
		await writeFile(join(outside, "read/runbook.json"), outsideRecord);
		await symlink(outside, join(sourceRoot, "skills/browser-use/runbooks/demo"));
		expect(
			await applyRunbookDraft({ sourceRoot, bytes: bytes(draft()) }),
		).toMatchObject({ ok: false, code: "runbook_source_path_unsafe" });
		expect(
			await deleteRunbookDraft({
				sourceRoot,
				serviceId: "demo",
				flowId: "read",
				expectedRecordDigest: new Bun.CryptoHasher("sha256")
					.update(outsideRecord)
					.digest("hex"),
			}),
		).toMatchObject({ ok: false, code: "runbook_source_path_unsafe" });
		expect(await readFile(join(outside, "read/runbook.json"), "utf8")).toBe(outsideRecord);
	});

	test("invalid source records remain visible as typed activation blockers", async () => {
		const sourceRoot = await sourceFixture();
		const root = join(sourceRoot, "skills/browser-use/runbooks/demo/broken");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "runbook.json"), "{}\n");
		await mkdir(join(sourceRoot, "skills/browser-use/runbooks/demo/missing"));
		const source = await readRunbookSourceCatalog({ sourceRoot });
		expect(source.ok).toBe(true);
		if (!source.ok) return;
		expect(source.catalog.records).toEqual([
			expect.objectContaining({
				id: "demo/broken",
				record_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
				activation_blocker: expect.objectContaining({
					code: "runbook_document_field_missing",
				}),
			}),
			expect.objectContaining({
				id: "demo/missing",
				record_digest: null,
				activation_blocker: expect.objectContaining({
					code: "catalog_record_unreadable",
				}),
			}),
		]);
		expect(source.catalog.activation_blockers).toHaveLength(2);
	});

	test("list and show separate catalog drift from record deletion while runtime stays pinned", async () => {
		const sourceRoot = await sourceFixture();
		const raw = bytes(draft());
		const created = await applyRunbookDraft({ sourceRoot, bytes: raw });
		if (!created.ok || created.record_digest === null) throw new Error("source create failed");
		const registryBytes = '{"actions":[]}\n';
		const registryDigest = new Bun.CryptoHasher("sha256").update(registryBytes).digest("hex");
		const files = [
			{
				relative_path: "actions/registry.json",
				bytes: registryBytes,
				digest: registryDigest,
			},
			{
				relative_path: "runbooks/demo/read/runbook.json",
				bytes: raw,
				digest: created.record_digest,
			},
		].sort((left, right) => left.relative_path.localeCompare(right.relative_path));
		const catalogDigest = privateRunbookCatalogDigest(files);
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error(opened.refusal.code);
			const activated = await activateRunbookGeneration(
				{ fs, paths: opened.paths, clock: fixedClock().now, nonterminalMutationRuns: async () => [] },
				{
					catalog: {
						commit: "1".repeat(40),
						catalog_digest: catalogDigest,
						action_registry_digest: registryDigest,
						files,
					},
					reviewedCatalogDigest: catalogDigest,
					expectedEpoch: 0,
				},
			);
			expect(activated).toMatchObject({ ok: true, changed: true });
			const runtime = makeRuntime({ env: xdg.env, sourceCheckoutRoot: sourceRoot });
			const inSync = await runForTest(["runbook", "list", "--json"], runtime);
			const inSyncData = parseJson(inSync.stdout).data as Record<string, unknown>;
			expect(inSyncData).toMatchObject({
				catalog_status: "in-sync",
				source_catalog_digest: catalogDigest,
				active_catalog_digest: catalogDigest,
				active_epoch: 1,
			});
			expect(inSyncData.runbooks).toEqual([
				expect.objectContaining({
					service_id: "demo",
					flow_id: "read",
					synchronization_status: "in-sync",
				}),
			]);
			const packaged = await runForTest(
				["runbook", "list", "--json"],
				makeRuntime({ env: xdg.env, sourceCheckoutRoot: null }),
			);
			expect(parseJson(packaged.stdout).data).toMatchObject({
				source_view: "source_unavailable",
				catalog_status: "source-unavailable",
				source_catalog_digest: null,
				active_catalog_digest: catalogDigest,
				active_epoch: 1,
			});

			expect(await deleteRunbookDraft({ sourceRoot, serviceId: "demo", flowId: "read", expectedRecordDigest: created.record_digest })).toMatchObject({ ok: true, changed: true });
			const shown = await runForTest(
				["runbook", "show", "--service", "demo", "--flow", "read", "--json"],
				runtime,
			);
			expect({ exitCode: shown.exitCode, envelope: parseJson(shown.stdout) }).toMatchObject({
				exitCode: 0,
				envelope: { status: "ok" },
			});
			expect(parseJson(shown.stdout).data).toMatchObject({
				synchronization_status: "deletion-pending-activation",
				catalog_status: "activation-required",
				active_catalog_digest: catalogDigest,
				active_epoch: 1,
			});
		} finally {
			xdg.dispose();
		}
	});
});
