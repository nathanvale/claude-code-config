import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import {
	BROWSER_USE_GENERATION_SOURCE_LIMITS,
	produceBrowserUseGeneration,
} from "./browser-use-generation-producer";
import {
	activateBrowserUseMigration,
	readBrowserUseMigrationStatus,
} from "./browser-use-migration";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
	type BrowserUsePlatformFs,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	generationFilePath,
	readGenerationStatus,
	writeSourceSnapshot,
} from "./browser-use-retention";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import {
	type BrowserUseCorpusGenerationCandidatePayload,
	encodeDurableRecord,
} from "./browser-use-schemas";
import { writeDurableFile } from "./browser-use-store";

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

async function makeFixture(generationId: string) {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	const deps = {
		fs,
		paths: opened.paths,
		clock: fixedClock(10_000).now,
	};
	const sourceRoot = join(xdg.base, "candidate");
	const runbookPath = "runbooks/acme/read/runbook.json";
	const registryPath = "actions/registry.json";
	const proofPath = "proofs/acme-read.json";
	const runbook = `${JSON.stringify({
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "acme",
		flow_id: "read",
		flow_name: "read",
		version: "1.0.0",
		summary: "Read current state.",
		allowed_origins: ["https://acme.test"],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	})}\n`;
	const registry = '{"actions":[]}\n';
	const proof = '{"proof":"verified"}\n';
	const snapshotId = `snapshot-${generationId}`;
	const snapshotDigest = sha256(snapshotId);
	const candidate: BrowserUseCorpusGenerationCandidatePayload = {
		contract: "browser-use.corpus-generation-candidate" as const,
		schema_version: "1" as const,
		generation_id: generationId,
		source_snapshot: {
			snapshot_id: snapshotId,
			snapshot_digest: snapshotDigest,
		},
		canonical_targets: [
			{
				canonical_target_id: "acme/read",
				activation: "active" as const,
				runbook_path: runbookPath,
				runbook_digest: sha256(runbook),
				source_relative_paths: ["legacy/acme/read.json"],
				proof_refs: ["proof-acme-read"],
				inactive_reason: null,
			},
		],
		action_registry: {
			registry_path: registryPath,
			registry_digest: sha256(registry),
			actions: [],
		},
		auth: { candidates: [], routes: [] },
		proofs: [
			{
				proof_ref: "proof-acme-read",
				path: proofPath,
				digest: sha256(proof),
			},
		],
		shipped_catalog_digest: await shippedCatalogDigest(
			shippedRunbooksRoot(),
			fs,
		),
	};
	const candidateRecord = encodeDurableRecord(
		"corpus-generation-candidate",
		candidate,
	);
	for (const [relativePath, contents] of [
		[runbookPath, runbook],
		[registryPath, registry],
		[proofPath, proof],
		["corpus-generation-candidate.json", candidateRecord],
	] as const) {
		const path = join(sourceRoot, relativePath);
		await fs.mkdir(dirname(path), {
			recursive: true,
			mode: 0o700,
		});
		await fs.writeFileDurable(path, contents, 0o600);
	}
	const snapshot = await writeSourceSnapshot(deps, {
		snapshot_id: snapshotId,
		root_identity: sha256("legacy-root"),
		entries: [
			{
				relative_path: "legacy/acme/read.json",
				type: "file",
				size: 1,
				mode: 0o600,
				content_hash: "a".repeat(64),
			},
		],
		snapshot_digest: snapshotDigest,
	});
	if (!snapshot.ok) throw new Error(`snapshot refused: ${snapshot.code}`);
	const migrationState: BrowserUseMigrationState = {
		contract: "browser-use.migration-status",
		schema_version: "2",
		phase: "verified",
		snapshot_id: snapshotId,
		snapshot_digest: snapshotDigest,
		source_root_identity: sha256("legacy-root"),
		source_entry_count: 1,
		disposition_count: 1,
		dispositions: [
			{
				source_relative_path: "legacy/acme/read.json",
				source_content_hash: "a".repeat(64),
				artifact_class: "formal-playbook",
				formal_flow_id: "acme/read",
				canonical_target_id: "acme/read",
				disposition: "stage",
				reason: "fixture",
				transform_version: "fixture-v1",
				logical_destination_id: runbookPath,
				expected_hash: sha256(runbook),
			},
		],
		corpus_census: {
			formal_artifacts: 1,
			target_flows: 0,
			scripts: 0,
			auth_narratives: 0,
			login_capabilities: 0,
			domain_script_actions: 0,
		},
		canonical_targets: [
			{
				canonical_target_id: "acme/read",
				source_relative_paths: ["legacy/acme/read.json"],
			},
		],
		staged_generation: "generation-migration-apply-fixture",
		last_apply_verified_noop: false,
		activation_state: "unchanged",
	};
	const stateWrite = await writeDurableFile(deps.fs, {
		path: join(deps.paths.state.migrationsDir, "migration-state.json"),
		contents: `${JSON.stringify(migrationState, null, 2)}\n`,
	});
	if (!stateWrite.ok) throw new Error(`state refused: ${stateWrite.failure.code}`);
	const target = candidate.canonical_targets[0];
	if (target === undefined) throw new Error("fixture target missing");
	return { deps, sourceRoot, candidate, candidateRecord, target };
}

async function replaceProof(
	fixture: Awaited<ReturnType<typeof makeFixture>>,
	contents: string | Buffer,
): Promise<void> {
	const candidateRecord = encodeDurableRecord(
		"corpus-generation-candidate",
		{
			...fixture.candidate,
			proofs: [
				{
					...fixture.candidate.proofs[0],
					digest: sha256(contents),
				},
			],
		},
	);
	const proofPath = join(fixture.sourceRoot, "proofs/acme-read.json");
	if (typeof contents === "string") {
		await fixture.deps.fs.writeFileDurable(proofPath, contents, 0o600);
	} else {
		await writeFile(proofPath, contents, { mode: 0o600 });
	}
	await fixture.deps.fs.writeFileDurable(
		join(fixture.sourceRoot, "corpus-generation-candidate.json"),
		candidateRecord,
		0o600,
	);
}

describe("produceBrowserUseGeneration", () => {
	test("retains safe migrated knowledge inside the exact candidate closure", async () => {
		const generationId = "generation-producer-knowledge";
		const fixture = await makeFixture(generationId);
		const knowledgePath = "knowledge/acme/notes.md";
		const knowledge = "# Migrated knowledge\n";
		const candidate = {
			...fixture.candidate,
			knowledge: {
				files: [
					{
						source_relative_path: "legacy/acme/notes.md",
						path: knowledgePath,
						digest: sha256(knowledge),
					},
				],
			},
		};
		const candidateRecord = encodeDurableRecord(
			"corpus-generation-candidate",
			candidate,
		);
		await fixture.deps.fs.mkdir(
			dirname(join(fixture.sourceRoot, knowledgePath)),
			{ recursive: true, mode: 0o700 },
		);
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, knowledgePath),
			knowledge,
			0o600,
		);
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "corpus-generation-candidate.json"),
			candidateRecord,
			0o600,
		);

		const result = await produceBrowserUseGeneration(fixture.deps, {
			sourceRoot: fixture.sourceRoot,
		});

		expect(result).toMatchObject({ ok: true });
		expect(
			await fixture.deps.fs.readTextFile(
				generationFilePath(
					fixture.deps.paths,
					generationId,
					knowledgePath,
				),
			),
		).toBe(knowledge);
	});

	test("stages a complete source bundle and returns a redacted activation continuation", async () => {
		const generationId = "generation-producer-a";
		const fixture = await makeFixture(generationId);

		const result = await produceBrowserUseGeneration(fixture.deps, {
			sourceRoot: fixture.sourceRoot,
		});

		expect(result).toMatchObject({
			ok: true,
			identity: {
				generation_id: generationId,
				generation_content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
				candidate_manifest_digest: sha256(fixture.candidateRecord),
			},
			closure: {
				canonical_target_count: 1,
				active_target_count: 1,
				action_count: 0,
				auth_candidate_count: 0,
				auth_route_count: 0,
				proof_count: 1,
			},
			verified_noop: false,
			next_safe_action: {
				id: "activate_staged_generation",
				command: "migration",
				args: ["activate", "--generation", generationId, "--json"],
			},
		});
		expect(JSON.stringify(result)).not.toContain(fixture.sourceRoot);
		expect(
			await readGenerationStatus(fixture.deps, generationId),
		).toMatchObject({
			status: "present",
			record: { generation_id: generationId, status: "staged" },
		});
		expect(await readBrowserUseMigrationStatus(fixture.deps)).toMatchObject({
			ok: true,
			state: {
				phase: "verified",
				staged_generation: generationId,
				activation_state: "unchanged",
			},
		});
	});

	test("rejects an unsafe candidate generation id before immutable adoption", async () => {
		const fixture = await makeFixture("generation-producer-unsafe-id");
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "corpus-generation-candidate.json"),
			encodeDurableRecord("corpus-generation-candidate", {
				...fixture.candidate,
				generation_id: "../other",
			}),
			0o600,
		);

		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_candidate_invalid" },
			next_safe_action: { id: "repair_generation_source" },
		});
		expect(
			await fixture.deps.fs.lstat(
				join(fixture.deps.paths.state.generationsDir, "..", "other"),
			),
		).toBeUndefined();
		expect(await readBrowserUseMigrationStatus(fixture.deps)).toMatchObject({
			ok: true,
			state: {
				staged_generation: "generation-migration-apply-fixture",
			},
		});
	});

	test("refuses a verified target-lineage mismatch before immutable staging", async () => {
		const generationId = "generation-producer-state-mismatch";
		const fixture = await makeFixture(generationId);
		const mismatchedCandidate = {
			...fixture.candidate,
			canonical_targets: [
				{
					...fixture.target,
					source_relative_paths: ["legacy/acme/other.json"],
				},
			],
		};
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "corpus-generation-candidate.json"),
			encodeDurableRecord(
				"corpus-generation-candidate",
				mismatchedCandidate,
			),
			0o600,
		);

		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_closure_invalid" },
			next_safe_action: { id: "choose_new_generation_id" },
		});
		expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
			status: "missing",
		});
	});

	test("rejects a staged registry whose action ids are outside the candidate closure", async () => {
		const generationId = "generation-producer-registry";
		const fixture = await makeFixture(generationId);
		const registry = '{"actions":[{"action_id":"undeclared-action"}]}\n';
		const candidateRecord = encodeDurableRecord(
			"corpus-generation-candidate",
			{
				...fixture.candidate,
				action_registry: {
					...fixture.candidate.action_registry,
					registry_digest: sha256(registry),
				},
			},
		);
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "actions/registry.json"),
			registry,
			0o600,
		);
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "corpus-generation-candidate.json"),
			candidateRecord,
			0o600,
		);

		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
				generationId,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_closure_invalid" },
			next_safe_action: { id: "choose_new_generation_id" },
		});
	});

	test("rejects an active reviewed action without an approved exact receipt", async () => {
		const generationId = "generation-producer-action";
		const fixture = await makeFixture(generationId);
		const actionId = "diagnose-grid";
		const actionAsset =
			"async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })";
		const actionDigest = sha256(actionAsset);
		const actionRecord = `${JSON.stringify({
			action_id: actionId,
			asset_id: actionDigest,
			expected_digest: actionDigest,
			allowed_origin: "https://acme.test",
			effect_class: "read",
			containment: "read-only-observation",
			input_schema: { kind: "object", fields: {} },
			result_schema: {
				kind: "object",
				fields: {
					rows: {
						schema: { kind: "number" },
						required: true,
					},
				},
			},
			result_sensitivity: "low",
			source_provenance: "legacy/acme/diagnose-grid.js",
			promotion_receipt: {
				approved_digest: actionDigest,
				disposition: "rejected",
				approved_origin: "https://acme.test",
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		})}\n`;
		const runbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "acme",
			flow_id: "read",
			flow_name: "read",
			version: "1.0.0",
			summary: "Read current state.",
			allowed_origins: ["https://acme.test"],
			inputs: [],
			steps: [
				{
					kind: "action",
					action_id: actionId,
					expected_digest: actionDigest,
					inputs: {},
				},
			],
		})}\n`;
		const registry = `${JSON.stringify({ actions: [{ action_id: actionId }] })}\n`;
		const candidateRecord = encodeDurableRecord(
			"corpus-generation-candidate",
			{
				...fixture.candidate,
				canonical_targets: [
					{
						...fixture.target,
						runbook_digest: sha256(runbook),
					},
				],
				action_registry: {
					registry_path: "actions/registry.json",
					registry_digest: sha256(registry),
					actions: [
						{
							action_id: actionId,
							record_path: `actions/${actionId}.json`,
							record_digest: sha256(actionRecord),
							asset_path: `actions/${actionDigest}.js`,
							asset_digest: actionDigest,
						},
					],
				},
			},
		);
		for (const [relativePath, contents] of [
			["runbooks/acme/read/runbook.json", runbook],
			["actions/registry.json", registry],
			[`actions/${actionId}.json`, actionRecord],
			[`actions/${actionDigest}.js`, actionAsset],
			["corpus-generation-candidate.json", candidateRecord],
		] as const) {
			await fixture.deps.fs.writeFileDurable(
				join(fixture.sourceRoot, relativePath),
				contents,
				0o600,
			);
		}

		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
				generationId,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_closure_invalid" },
			next_safe_action: { id: "choose_new_generation_id" },
		});
	});

	test("rejects an active runbook whose auth context has no active route", async () => {
		const generationId = "generation-producer-auth";
		const fixture = await makeFixture(generationId);
		const runbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "acme",
			flow_id: "read",
			flow_name: "read",
			version: "1.0.0",
			summary: "Read current state.",
			allowed_origins: ["https://acme.test"],
			auth_context_ref: "interactive-login",
			inputs: [],
			steps: [{ kind: "snapshot", interactive: false }],
		})}\n`;
		const candidateRecord = encodeDurableRecord(
			"corpus-generation-candidate",
			{
				...fixture.candidate,
				canonical_targets: [
					{
						...fixture.target,
						runbook_digest: sha256(runbook),
					},
				],
			},
		);
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "runbooks/acme/read/runbook.json"),
			runbook,
			0o600,
		);
		await fixture.deps.fs.writeFileDurable(
			join(fixture.sourceRoot, "corpus-generation-candidate.json"),
			candidateRecord,
			0o600,
		);

		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
				generationId,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_closure_invalid" },
			next_safe_action: { id: "choose_new_generation_id" },
		});
	});

	test("accepts the per-file byte boundary and rejects one byte over it", async () => {
		const boundary = await makeFixture("generation-producer-boundary");
		const prefix = '{"proof":"';
		const suffix = '"}\n';
		await replaceProof(
			boundary,
			`${prefix}${"0".repeat(
				BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes -
					Buffer.byteLength(prefix) -
					Buffer.byteLength(suffix),
			)}${suffix}`,
		);
		expect(
			await produceBrowserUseGeneration(boundary.deps, {
				sourceRoot: boundary.sourceRoot,
				generationId: "generation-producer-boundary",
			}),
		).toMatchObject({ ok: true });

		const over = await makeFixture("generation-producer-over-limit");
		await replaceProof(
			over,
			`${prefix}${"0".repeat(
				BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes -
					Buffer.byteLength(prefix) -
					Buffer.byteLength(suffix) +
					1,
			)}${suffix}`,
		);
		expect(
			await produceBrowserUseGeneration(over.deps, {
				sourceRoot: over.sourceRoot,
				generationId: "generation-producer-over-limit",
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
			next_safe_action: { id: "repair_generation_source" },
		});
	});

	test("accepts one screened candidate and exact active auth route", async () => {
		const generationId = "generation-producer-auth-complete";
		const fixture = await makeFixture(generationId);
		const runbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "acme",
			flow_id: "read",
			flow_name: "read",
			version: "1.0.0",
			summary: "Read current state.",
			allowed_origins: ["https://acme.test"],
			auth_context_ref: "interactive-login",
			inputs: [],
			steps: [{ kind: "snapshot", interactive: false }],
		})}\n`;
		const authCandidate = `${JSON.stringify({
			candidate_id: "candidate-acme",
			service_id: "acme",
			auth_context: "interactive-login",
			legacy_context_prose: null,
			hint_item_id: null,
			proposed_origins: ["https://acme.test"],
			legacy_vault_name: null,
			provenance: "legacy-auth-pointer",
		})}\n`;
		const authRoute = `${JSON.stringify({
			auth_context_ref: "interactive-login",
			candidate_id: "candidate-acme",
			status: "active",
		})}\n`;
		const candidateRecord = encodeDurableRecord(
			"corpus-generation-candidate",
			{
				...fixture.candidate,
				canonical_targets: [
					{
						...fixture.target,
						runbook_digest: sha256(runbook),
					},
				],
				auth: {
					candidates: [
						{
							candidate_id: "candidate-acme",
							path: "auth/candidate-acme.json",
							digest: sha256(authCandidate),
						},
					],
					routes: [
						{
							auth_context_ref: "interactive-login",
							candidate_id: "candidate-acme",
							path: "auth/interactive-login.json",
							digest: sha256(authRoute),
						},
					],
				},
			},
		);
		await fixture.deps.fs.mkdir(join(fixture.sourceRoot, "auth"), {
			recursive: true,
			mode: 0o700,
		});
		for (const [relativePath, contents] of [
			["runbooks/acme/read/runbook.json", runbook],
			["auth/candidate-acme.json", authCandidate],
			["auth/interactive-login.json", authRoute],
			["corpus-generation-candidate.json", candidateRecord],
		] as const) {
			await fixture.deps.fs.writeFileDurable(
				join(fixture.sourceRoot, relativePath),
				contents,
				0o600,
			);
		}

		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
				generationId,
			}),
		).toMatchObject({
			ok: true,
			closure: { auth_candidate_count: 1, auth_route_count: 1 },
		});
	});

	test("rejects a source-tree symlink without exposing its target", async () => {
		const generationId = "generation-producer-symlink";
		const fixture = await makeFixture(generationId);
		const outside = join(fixture.sourceRoot, "..", "outside.json");
		await fixture.deps.fs.writeFileDurable(outside, '{"outside":true}\n', 0o600);
		await symlink(outside, join(fixture.sourceRoot, "escape.json"));

		const result = await produceBrowserUseGeneration(fixture.deps, {
			sourceRoot: fixture.sourceRoot,
			generationId,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});
		expect(JSON.stringify(result)).not.toContain(outside);
		expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
			status: "missing",
		});
	});

	test("requires a current-owner, owner-only source tree", async () => {
		const looseRoot = await makeFixture("generation-producer-loose-root");
		await looseRoot.deps.fs.chmod(looseRoot.sourceRoot, 0o755);
		expect(
			await produceBrowserUseGeneration(looseRoot.deps, {
				sourceRoot: looseRoot.sourceRoot,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});

		const looseFile = await makeFixture("generation-producer-loose-file");
		await looseFile.deps.fs.chmod(
			join(looseFile.sourceRoot, "proofs/acme-read.json"),
			0o644,
		);
		expect(
			await produceBrowserUseGeneration(looseFile.deps, {
				sourceRoot: looseFile.sourceRoot,
			}),
		).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});

		const foreignRoot = await makeFixture("generation-producer-foreign-root");
		const foreignFs = new Proxy(foreignRoot.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "lstat" || typeof value !== "function") {
					return value;
				}
				return async (path: string) => {
					const stat = await target.lstat(path);
					return path === foreignRoot.sourceRoot && stat !== undefined
						? { ...stat, uid: stat.uid + 1 }
						: stat;
				};
			},
		}) as BrowserUsePlatformFs;
		expect(
			await produceBrowserUseGeneration(
				{ ...foreignRoot.deps, fs: foreignFs },
				{ sourceRoot: foreignRoot.sourceRoot },
			),
		).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});
	});

	test("rejects every unreferenced file before immutable staging", async () => {
		for (const [generationId, relativePath, contents, code] of [
			[
				"generation-producer-extra",
				"notes.txt",
				"harmless but unreferenced\n",
				"generation_candidate_invalid",
			],
			[
				"generation-producer-extra-secret",
				"credentials.env",
				"OP_SERVICE_ACCOUNT_TOKEN=NEVER_STAGE_THIS_VALUE\n",
				"generation_source_invalid",
			],
		] as const) {
			const fixture = await makeFixture(generationId);
			await fixture.deps.fs.writeFileDurable(
				join(fixture.sourceRoot, relativePath),
				contents,
				0o600,
			);
			const result = await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
			});
			expect(result).toMatchObject({
				ok: false,
				error: { code },
				next_safe_action: { id: "repair_generation_source" },
			});
			expect(JSON.stringify(result)).not.toContain("NEVER_STAGE_THIS_VALUE");
			expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
				status: "missing",
			});
		}
	});

	test("screens every referenced JSON payload for secrets and unredacted paths", async () => {
		for (const [generationId, proof] of [
			[
				"generation-producer-proof-secret",
				'{"password":"NEVER_STAGE_THIS_VALUE"}\n',
			],
			[
				"generation-producer-proof-path",
				'{"source_path":"/private/NEVER_STAGE_THIS_PATH"}\n',
			],
		] as const) {
			const fixture = await makeFixture(generationId);
			await replaceProof(fixture, proof);
			const result = await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
			});
			expect(result).toMatchObject({
				ok: false,
				error: { code: "generation_source_invalid" },
			});
			expect(JSON.stringify(result)).not.toContain("NEVER_STAGE_THIS");
			expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
				status: "missing",
			});
		}
	});

	test("screens a referenced non-JSON action asset for quoted local paths", async () => {
		const generationId = "generation-producer-action-local-path";
		const fixture = await makeFixture(generationId);
		const actionId = "local-path-action";
		const actionRecord = "{}\n";
		const actionAsset =
			"const x = '/Users/NEVER_STAGE_ACTION_PATH';\nexport default x;\n";
		const registry = `${JSON.stringify({ actions: [{ action_id: actionId }] })}\n`;
		const candidateRecord = encodeDurableRecord(
			"corpus-generation-candidate",
			{
				...fixture.candidate,
				action_registry: {
					registry_path: "actions/registry.json",
					registry_digest: sha256(registry),
					actions: [
						{
							action_id: actionId,
							record_path: `actions/${actionId}.json`,
							record_digest: sha256(actionRecord),
							asset_path: `actions/${actionId}.js`,
							asset_digest: sha256(actionAsset),
						},
					],
				},
			},
		);
		for (const [relativePath, contents] of [
			["actions/registry.json", registry],
			[`actions/${actionId}.json`, actionRecord],
			[`actions/${actionId}.js`, actionAsset],
			["corpus-generation-candidate.json", candidateRecord],
		] as const) {
			await fixture.deps.fs.writeFileDurable(
				join(fixture.sourceRoot, relativePath),
				contents,
				0o600,
			);
		}

		const result = await produceBrowserUseGeneration(fixture.deps, {
			sourceRoot: fixture.sourceRoot,
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});
		expect(JSON.stringify(result)).not.toContain("NEVER_STAGE_ACTION_PATH");
		expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
			status: "missing",
		});
	});

	test("rejects invalid UTF-8 instead of collapsing byte-distinct source data", async () => {
		for (const [generationId, byte] of [
			["generation-producer-invalid-ff", 0xff],
			["generation-producer-invalid-fe", 0xfe],
		] as const) {
			const fixture = await makeFixture(generationId);
			await replaceProof(fixture, Buffer.from([byte]));
			expect(
				await produceBrowserUseGeneration(fixture.deps, {
					sourceRoot: fixture.sourceRoot,
				}),
			).toMatchObject({
				ok: false,
				error: { code: "generation_source_invalid" },
			});
			expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
				status: "missing",
			});
		}
	});

	test("refuses a final-component symlink swap between admission and read", async () => {
		const generationId = "generation-producer-read-race";
		const fixture = await makeFixture(generationId);
		const proofPath = join(fixture.sourceRoot, "proofs/acme-read.json");
		const outside = join(fixture.sourceRoot, "..", "raced-secret.json");
		await fixture.deps.fs.writeFileDurable(
			outside,
			'{"password":"NEVER_FOLLOW_THIS_VALUE"}\n',
			0o600,
		);
		let swapped = false;
		const racingFs = new Proxy(fixture.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "realpath" || typeof value !== "function") {
					return value;
				}
				return async (path: string) => {
					const canonical = await Reflect.apply(value, target, [path]);
					if (path === proofPath && !swapped) {
						swapped = true;
						await target.unlink(path);
						await symlink(outside, path);
					}
					return canonical;
				};
			},
		}) as BrowserUsePlatformFs;

		const result = await produceBrowserUseGeneration(
			{ ...fixture.deps, fs: racingFs },
			{ sourceRoot: fixture.sourceRoot },
		);
		expect(result).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});
		expect(JSON.stringify(result)).not.toContain("NEVER_FOLLOW_THIS_VALUE");
		expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
			status: "missing",
		});
	});

	test("refuses an oversized swap between path admission and bounded read", async () => {
		const generationId = "generation-producer-oversized-race";
		const fixture = await makeFixture(generationId);
		const proofPath = join(fixture.sourceRoot, "proofs/acme-read.json");
		let swapped = false;
		const racingFs = new Proxy(fixture.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "realpath" || typeof value !== "function") {
					return value;
				}
				return async (path: string) => {
					const canonical = await Reflect.apply(value, target, [path]);
					if (path === proofPath && !swapped) {
						swapped = true;
						await writeFile(
							path,
							"0".repeat(
								BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes + 1,
							),
							{ mode: 0o600 },
						);
					}
					return canonical;
				};
			},
		}) as BrowserUsePlatformFs;

		expect(
			await produceBrowserUseGeneration(
				{ ...fixture.deps, fs: racingFs },
				{ sourceRoot: fixture.sourceRoot },
			),
		).toMatchObject({
			ok: false,
			error: { code: "generation_source_invalid" },
		});
		expect(await readGenerationStatus(fixture.deps, generationId)).toEqual({
			status: "missing",
		});
	});

	test("maps post-stage filesystem throws to a total staged-copy refusal", async () => {
		const generationId = "generation-producer-post-stage-throw";
		const fixture = await makeFixture(generationId);
		const generationRoot = join(
			fixture.deps.paths.state.generationsDir,
			generationId,
		);
		let stagedHashCount = 0;
		const throwingFs = new Proxy(fixture.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "hashFile" || typeof value !== "function") {
					return value;
				}
				return async (path: string) => {
					if (path.startsWith(`${generationRoot}/`)) {
						stagedHashCount += 1;
						if (stagedHashCount > 4) {
							throw Object.assign(new Error("injected"), { code: "EIO" });
						}
					}
					return await Reflect.apply(value, target, [path]);
				};
			},
		}) as BrowserUsePlatformFs;

		await expect(
			produceBrowserUseGeneration(
				{ ...fixture.deps, fs: throwingFs },
				{ sourceRoot: fixture.sourceRoot },
			),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "generation_staged_copy_corrupt" },
			next_safe_action: { id: "inspect_generation_store" },
		});
	});

	test("validates the staged copy after source admission", async () => {
		const generationId = "generation-producer-staged-copy";
		const fixture = await makeFixture(generationId);
		const stagedCandidatePath = generationFilePath(
			fixture.deps.paths,
			generationId,
			"corpus-generation-candidate.json",
		);
		const corruptingFs = new Proxy(fixture.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "readTextFile" || typeof value !== "function") {
					return value;
				}
				return async (path: string) =>
					path === stagedCandidatePath
						? '{"record":'
						: await Reflect.apply(value, target, [path]);
			},
		}) as BrowserUsePlatformFs;

		expect(
			await produceBrowserUseGeneration(
				{ ...fixture.deps, fs: corruptingFs },
				{ sourceRoot: fixture.sourceRoot, generationId },
			),
		).toMatchObject({
			ok: false,
			error: { code: "generation_candidate_invalid" },
			next_safe_action: { id: "choose_new_generation_id" },
		});
	});

	test("serializes generation adoption against cooperative activation", async () => {
		const generationId = "generation-producer-owner-lock";
		const fixture = await makeFixture(generationId);
		const statePath = join(
			fixture.deps.paths.state.migrationsDir,
			"migration-state.json",
		);
		let releaseStateRead: () => void = () => {};
		const stateReadReleased = new Promise<void>((resolve) => {
			releaseStateRead = resolve;
		});
		let signalOwnerLocked: () => void = () => {};
		const ownerLocked = new Promise<void>((resolve) => {
			signalOwnerLocked = resolve;
		});
		let paused = false;
		const pausedFs = new Proxy(fixture.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "readTextFile" || typeof value !== "function") {
					return value;
				}
				return async (path: string) => {
					if (path === statePath && !paused) {
						paused = true;
						signalOwnerLocked();
						await stateReadReleased;
					}
					return await Reflect.apply(value, target, [path]);
				};
			},
		}) as BrowserUsePlatformFs;

		const producing = produceBrowserUseGeneration(
			{ ...fixture.deps, fs: pausedFs },
			{ sourceRoot: fixture.sourceRoot },
		);
		await ownerLocked;
		const activation = await activateBrowserUseMigration(fixture.deps, {});
		releaseStateRead();

		expect(activation).toMatchObject({
			ok: false,
			code: "store_lock_contended",
		});
		expect(await producing).toMatchObject({
			ok: true,
			identity: { generation_id: generationId },
		});
	});

	test("preserves a state mutation after the old final compare and safely adopts the immutable no-op after state restore", async () => {
		const generationId = "generation-producer-state-cas";
		const fixture = await makeFixture(generationId);
		const statePath = join(
			fixture.deps.paths.state.migrationsDir,
			"migration-state.json",
		);
		const originalRaw = await fixture.deps.fs.readTextFile(statePath);
		const standing = JSON.parse(originalRaw) as BrowserUseMigrationState;
		const changedRaw = `${JSON.stringify(
			{
				...standing,
				phase: "planned",
				staged_generation: null,
				last_apply_verified_noop: null,
			},
			null,
			2,
		)}\n`;
		let changedState = false;
		const racingFs = new Proxy(fixture.deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "writeFileDurable" || typeof value !== "function") {
					return value;
				}
				return async (path: string, contents: string, mode: number) => {
					if (path.startsWith(`${statePath}.tmp-`) && !changedState) {
						changedState = true;
						const changed = await writeDurableFile(target, {
							path: statePath,
							contents: changedRaw,
						});
						if (!changed.ok) {
							throw new Error(`state race failed: ${changed.failure.code}`);
						}
					}
					await Reflect.apply(value, target, [path, contents, mode]);
				};
			},
		}) as BrowserUsePlatformFs;

		const raced = await produceBrowserUseGeneration(
			{ ...fixture.deps, fs: racingFs },
			{ sourceRoot: fixture.sourceRoot },
		);
		expect(raced).toMatchObject({
			ok: false,
			error: { code: "generation_closure_invalid" },
			next_safe_action: { id: "inspect_generation_store" },
		});
		expect(JSON.stringify(raced)).not.toContain("activate_staged_generation");
		expect(await readGenerationStatus(fixture.deps, generationId)).toMatchObject({
			status: "present",
		});
		expect(await fixture.deps.fs.readTextFile(statePath)).toBe(changedRaw);
		expect(await readBrowserUseMigrationStatus(fixture.deps)).toMatchObject({
			ok: true,
			state: {
				phase: "planned",
				staged_generation: null,
			},
		});

		const restored = await writeDurableFile(fixture.deps.fs, {
			path: statePath,
			contents: originalRaw,
		});
		expect(restored).toEqual({ ok: true });
		expect(
			await produceBrowserUseGeneration(fixture.deps, {
				sourceRoot: fixture.sourceRoot,
			}),
		).toMatchObject({
			ok: true,
			identity: { generation_id: generationId },
			verified_noop: true,
		});
		expect(await readBrowserUseMigrationStatus(fixture.deps)).toMatchObject({
			ok: true,
			state: {
				phase: "verified",
				staged_generation: generationId,
			},
		});
	});
});
