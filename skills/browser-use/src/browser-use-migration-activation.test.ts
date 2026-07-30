import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	shippedCatalogDigest,
} from "./browser-use-catalog-digest";
import {
	validateBrowserUseGenerationCandidateClosure,
	validateBrowserUseGenerationCandidateForMigrationState,
} from "./browser-use-generation-activation";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import {
	CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	activateBrowserUseMigration,
	applyBrowserUseMigration,
	inventoryBrowserUseMigration,
	planBrowserUseMigration,
	readActiveCorpusManifest,
	readBrowserUseMigrationStatus,
	readRetainedCorpusGenerationManifest,
	tripActiveGenerationEffectFence,
	verifyBrowserUseMigration,
} from "./browser-use-migration";
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
	type RetentionDeps,
	generationFilePath,
	generationRecordPath,
	sourceSnapshotPath,
	stageGeneration,
	writeSourceSnapshot,
} from "./browser-use-retention";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import { reviewedActionPostconditionDigest } from "./browser-use-runbook-actions";
import { parseDurableRecord } from "./browser-use-schemas";
import { readDurableFile, writeDurableFile } from "./browser-use-store";

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function makeDeps() {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		fs,
		paths: opened.paths,
		clock: fixedClock(10_000).now,
	};
}

function durableRecord(record: string, payload: unknown): string {
	return `${JSON.stringify(
		{ record, schema_version: "1", payload },
		null,
		"\t",
	)}\n`;
}

async function seedCompleteGeneration(
	deps: RetentionDeps,
	input: {
		generationId: string;
		targetId: string;
		sourcePath: string;
		auth?: {
			candidateServiceId: string;
			authContextRef?: string;
			routeExtra?: Record<string, unknown>;
			sessionPolicy?: boolean;
			sessionPolicyFault?:
				| "missing"
				| "digest"
				| "origin"
				| "effect"
				| "purpose"
				| "receipt-purpose"
				| "postcondition";
		};
	},
): Promise<{ contentHash: string }> {
	const [serviceId, flowId] = input.targetId.split("/");
	if (serviceId === undefined || flowId === undefined) {
		throw new Error("test target id must be service/flow");
	}
	const snapshotId = `snapshot-${input.generationId}`;
	const snapshotDigest = sha256(snapshotId);
	const runbookPath = `runbooks/${serviceId}/${flowId}/runbook.json`;
	const registryPath = "actions/registry.json";
	const proofPath = `proofs/${serviceId}-${flowId}.json`;
	const authContextRef = input.auth?.authContextRef ?? "interactive-login";
	const runbook = `${JSON.stringify({
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: serviceId,
		flow_id: flowId,
		flow_name: flowId,
		version: "1.0.0",
		summary: `Read ${input.targetId}.`,
		allowed_origins: [`https://${serviceId}.test`],
		...(input.auth === undefined
			? {}
			: { auth_context_ref: authContextRef }),
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	})}\n`;
	const proof = `${JSON.stringify({ proof: "verified" })}\n`;
	const serviceOrigin = `https://${serviceId}.test`;
	const identityProviderOrigin = `https://login.${serviceId}.test`;
	const identifyAsset =
		"async ({ inputs }) => ({ forms: document.querySelectorAll('form').length })";
	const verifierAsset =
		"async ({ inputs }) => ({ markers: document.querySelectorAll('[data-session]').length })";
	const submitAsset =
		"async ({ inputs }) => { document.querySelector('#submit').click(); return { submitted: true } }";
	const identifyDigest = sha256(identifyAsset);
	const verifierDigest = sha256(verifierAsset);
	const submitDigest = sha256(submitAsset);
	const actionRecords =
		input.auth?.sessionPolicy === true
			? [
					{
						action_id: `${serviceId}-identify-auth`,
						asset_id: identifyDigest,
						expected_digest: identifyDigest,
						allowed_origin: identityProviderOrigin,
						effect_class: "read",
						containment: "read-only-observation",
						input_schema: { kind: "object", fields: {} },
						result_schema: { kind: "object", fields: {} },
						result_sensitivity: "low",
						source_provenance: `reviewed/${serviceId}-identify-auth.js`,
						promotion_receipt: {
							approved_digest: identifyDigest,
							disposition: "approved",
							approved_origin: identityProviderOrigin,
							approved_effect: "read",
							approver_ref: "operator-review",
						},
					},
					{
						action_id: `${serviceId}-verify-session`,
						asset_id: verifierDigest,
						expected_digest: verifierDigest,
						allowed_origin: serviceOrigin,
						effect_class: "read",
						containment: "read-only-observation",
						input_schema: { kind: "object", fields: {} },
						result_schema: { kind: "object", fields: {} },
						result_sensitivity: "low",
						source_provenance: `reviewed/${serviceId}-verify-session.js`,
						promotion_receipt: {
							approved_digest: verifierDigest,
							disposition: "approved",
							approved_origin: serviceOrigin,
							approved_effect: "read",
							approver_ref: "operator-review",
						},
					},
					{
						action_id: `${serviceId}-submit-login`,
						asset_id: submitDigest,
						expected_digest: submitDigest,
						allowed_origin: identityProviderOrigin,
						effect_class: "mutation",
						...(input.auth?.sessionPolicyFault === "purpose"
							? {}
							: { purpose: "runbook-auth-submit" }),
						containment: "none",
						input_schema: { kind: "object", fields: {} },
						result_schema: { kind: "object", fields: {} },
						result_sensitivity: "low",
						required_postcondition: {
							kind: "element-visible",
							selector:
								input.auth?.sessionPolicyFault === "postcondition"
									? "#changed-authenticated"
									: "#authenticated",
						},
						source_provenance: `reviewed/${serviceId}-submit-login.js`,
						promotion_receipt: {
							approved_digest: submitDigest,
							disposition: "approved",
							approved_origin: identityProviderOrigin,
							approved_effect: "mutation",
							...(input.auth?.sessionPolicyFault === "purpose" ||
							input.auth?.sessionPolicyFault === "receipt-purpose"
								? {}
								: {
										approved_purpose: "runbook-auth-submit",
										approved_postcondition_digest:
											reviewedActionPostconditionDigest({
												kind: "element-visible",
												selector: "#authenticated",
											}),
									}),
							approver_ref: "operator-review",
						},
					},
				]
			: [];
	const actionFiles = actionRecords.flatMap((record) => {
		const asset =
			record.action_id === `${serviceId}-identify-auth`
				? identifyAsset
				: record.action_id === `${serviceId}-verify-session`
					? verifierAsset
					: submitAsset;
		const recordContents = `${JSON.stringify(record)}\n`;
		return [
			{
				record,
				recordPath: `actions/records/${record.action_id}.json`,
				recordContents,
				assetPath: `actions/assets/${record.expected_digest}.js`,
				asset,
			},
		];
	});
	const registry = `${JSON.stringify({ actions: actionRecords })}\n`;
	const authCandidate =
		input.auth === undefined
			? undefined
			: `${JSON.stringify({
					candidate_id: `candidate-${input.generationId}`,
					service_id: input.auth.candidateServiceId,
					auth_context: "interactive-login",
					legacy_context_prose: null,
					hint_item_id: null,
					proposed_origins: [`https://${serviceId}.test`],
					legacy_vault_name: null,
					provenance: "legacy-auth-pointer",
				})}\n`;
	const sessionPolicy =
		input.auth?.sessionPolicy !== true
			? undefined
			: {
					schema_version: "1",
					approved_service_origins: [serviceOrigin],
					approved_identity_provider_origins: [
						input.auth.sessionPolicyFault === "origin"
							? `https://other-login.${serviceId}.test`
							: identityProviderOrigin,
					],
					auth_flow: {
						schema_version: "1",
						fields: {
							username: { role: "textbox", name: "Email address" },
						},
						identify_state: {
							action_id:
								input.auth.sessionPolicyFault === "missing"
									? `${serviceId}-missing-identify`
									: input.auth.sessionPolicyFault === "effect"
										? `${serviceId}-submit-login`
										: `${serviceId}-identify-auth`,
							expected_digest:
								input.auth.sessionPolicyFault === "digest"
									? "f".repeat(64)
									: input.auth.sessionPolicyFault === "effect"
										? submitDigest
										: identifyDigest,
						},
						username_submit: {
							action_id: `${serviceId}-submit-login`,
							expected_digest: submitDigest,
						},
					},
					identity_verifier: {
						schema_version: "1",
						action: {
							action_id: `${serviceId}-verify-session`,
							expected_digest: verifierDigest,
						},
						expected: {
							subject_reference: `${serviceId}-subject`,
							account_reference: `${serviceId}-account`,
							tenant_reference: `${serviceId}-tenant`,
						},
						freshness_ms: 60_000,
					},
				};
	const authRoute =
		input.auth === undefined
			? undefined
			: `${JSON.stringify({
					auth_context_ref: authContextRef,
					candidate_id: `candidate-${input.generationId}`,
					status: "active",
					...(sessionPolicy === undefined
						? {}
						: { session_policy: sessionPolicy }),
					...(input.auth.routeExtra ?? {}),
				})}\n`;
	const authCandidatePath = `auth/candidate-${input.generationId}.json`;
	const authRoutePath = `auth/route-${input.generationId}.json`;
	const candidate = {
		contract: "browser-use.corpus-generation-candidate",
		schema_version: "1",
		generation_id: input.generationId,
		source_snapshot: {
			snapshot_id: snapshotId,
			snapshot_digest: snapshotDigest,
		},
		canonical_targets: [
			{
				canonical_target_id: input.targetId,
				activation: "active",
				runbook_path: runbookPath,
				runbook_digest: sha256(runbook),
				source_relative_paths: [input.sourcePath],
				proof_refs: [`proof-${serviceId}-${flowId}`],
				inactive_reason: null,
			},
		],
		action_registry: {
			registry_path: registryPath,
			registry_digest: sha256(registry),
			actions: actionFiles.map((action) => ({
				action_id: action.record.action_id,
				record_path: action.recordPath,
				record_digest: sha256(action.recordContents),
				asset_path: action.assetPath,
				asset_digest: action.record.expected_digest,
			})),
		},
		auth:
			input.auth === undefined ||
			authCandidate === undefined ||
			authRoute === undefined
				? { candidates: [], routes: [] }
				: {
						candidates: [
							{
								candidate_id: `candidate-${input.generationId}`,
								path: authCandidatePath,
								digest: sha256(authCandidate),
							},
						],
						routes: [
							{
								auth_context_ref: authContextRef,
								candidate_id: `candidate-${input.generationId}`,
								path: authRoutePath,
								digest: sha256(authRoute),
							},
						],
					},
		proofs: [
			{
				proof_ref: `proof-${serviceId}-${flowId}`,
				path: proofPath,
				digest: sha256(proof),
			},
		],
		shipped_catalog_digest: await shippedCatalogDigest(
			shippedRunbooksRoot(),
			deps.fs,
		),
	};
	const staged = await stageGeneration(deps, {
		generationId: input.generationId,
		files: [
			{ relPath: runbookPath, contents: runbook },
			{ relPath: registryPath, contents: registry },
			...actionFiles.flatMap((action) => [
				{ relPath: action.recordPath, contents: action.recordContents },
				{ relPath: action.assetPath, contents: action.asset },
			]),
			{ relPath: proofPath, contents: proof },
			...(authCandidate === undefined || authRoute === undefined
				? []
				: [
						{ relPath: authCandidatePath, contents: authCandidate },
						{ relPath: authRoutePath, contents: authRoute },
					]),
			{
				relPath: CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
				contents: durableRecord(
					"corpus-generation-candidate",
					candidate,
				),
			},
		],
	});
	if (!staged.ok) throw new Error(`stage failed: ${staged.code}`);
	const snapshot = await writeSourceSnapshot(deps, {
		snapshot_id: snapshotId,
		root_identity: sha256("legacy-root"),
		entries: [
			{
				relative_path: input.sourcePath,
				type: "file",
				size: 1,
				mode: 0o600,
				content_hash: "b".repeat(64),
			},
		],
		snapshot_digest: snapshotDigest,
	});
	if (!snapshot.ok) throw new Error(`snapshot failed: ${snapshot.code}`);
	const state: BrowserUseMigrationState = {
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
				source_relative_path: input.sourcePath,
				source_content_hash: "b".repeat(64),
				artifact_class: "formal-playbook",
				formal_flow_id: input.targetId,
				canonical_target_id: input.targetId,
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
				canonical_target_id: input.targetId,
				source_relative_paths: [input.sourcePath],
			},
		],
		staged_generation: input.generationId,
		last_apply_verified_noop: false,
		activation_state: "unchanged",
	};
	await deps.fs.mkdir(deps.paths.state.migrationsDir, {
		recursive: true,
		mode: 0o700,
	});
	const stateWrite = await writeDurableFile(deps.fs, {
		path: join(deps.paths.state.migrationsDir, "migration-state.json"),
		contents: `${JSON.stringify(state, null, 2)}\n`,
	});
	if (!stateWrite.ok) throw new Error(`state failed: ${stateWrite.failure.code}`);
	return { contentHash: staged.record.content_hash };
}

describe("activateBrowserUseMigration", () => {
	test("exposes exact staged-candidate closure validation for producer reuse", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-shared-validator",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});

		expect(
			await validateBrowserUseGenerationCandidateClosure(
				deps,
				"generation-shared-validator",
			),
		).toMatchObject({
			ok: true,
			candidate: { generation_id: "generation-shared-validator" },
			candidateDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			generationContentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
	});

	test("validates a source candidate against verified migration and exact snapshot identity before staging", async () => {
		const deps = await makeDeps();
		const generationId = "generation-state-aware-validator";
		await seedCompleteGeneration(deps, {
			generationId,
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		const candidateRead = await readDurableFile(
			deps.fs,
			generationFilePath(
				deps.paths,
				generationId,
				CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
			),
		);
		expect(candidateRead.status).toBe("present");
		if (candidateRead.status !== "present") throw new Error("unreachable");
		const candidate = parseDurableRecord(
			candidateRead.raw,
			"corpus-generation-candidate",
		);
		expect(candidate.ok).toBe(true);
		if (!candidate.ok) throw new Error("unreachable");
		const state = JSON.parse(
			await deps.fs.readTextFile(
				join(deps.paths.state.migrationsDir, "migration-state.json"),
			),
		) as BrowserUseMigrationState;

		expect(
			await validateBrowserUseGenerationCandidateForMigrationState(
				deps,
				candidate.payload,
				state,
			),
		).toEqual({ ok: true });
		expect(
			await validateBrowserUseGenerationCandidateForMigrationState(
				deps,
				{
					...candidate.payload,
					source_snapshot: {
						...candidate.payload.source_snapshot,
						snapshot_digest: "f".repeat(64),
					},
				},
				state,
			),
		).toMatchObject({ ok: false, code: "migration_not_verified" });

		const snapshotPath = sourceSnapshotPath(
			deps.paths,
			candidate.payload.source_snapshot.snapshot_id,
		);
		const snapshotRead = await readDurableFile(deps.fs, snapshotPath);
		expect(snapshotRead.status).toBe("present");
		if (snapshotRead.status !== "present") throw new Error("unreachable");
		const snapshot = parseDurableRecord(snapshotRead.raw, "source-snapshot");
		expect(snapshot.ok).toBe(true);
		if (!snapshot.ok) throw new Error("unreachable");
		await deps.fs.writeFileDurable(
			snapshotPath,
			durableRecord("source-snapshot", {
				...snapshot.payload,
				snapshot_id: "snapshot-other",
			}),
			0o600,
		);
		expect(
			await validateBrowserUseGenerationCandidateForMigrationState(
				deps,
				candidate.payload,
				state,
			),
		).toMatchObject({
			ok: false,
			code: "migration_manifest_incomplete",
		});
	});

	test("status distinguishes never-active state from damaged active authority", async () => {
		const cleanDeps = await makeDeps();
		expect(await readBrowserUseMigrationStatus(cleanDeps)).toMatchObject({
			ok: true,
			state: {
				phase: "empty",
				activation_state: "unchanged",
				active_generation: {
					state: "never-activated",
					current: null,
					prior: null,
					retained: [],
					activation_epoch: null,
					pending: "none",
					effect_fence: "not-applicable",
				},
			},
		});

		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-status-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		const statePath = join(
			deps.paths.state.migrationsDir,
			"migration-state.json",
		);
		const state = JSON.parse(
			await deps.fs.readTextFile(statePath),
		) as BrowserUseMigrationState;
		await deps.fs.writeFileDurable(
			statePath,
			`${JSON.stringify({ ...state, activation_state: "active" }, null, 2)}\n`,
			0o600,
		);
		const activePath = join(
			deps.paths.state.migrationsDir,
			"active-corpus-manifest.json",
		);
		await deps.fs.unlink(activePath);

		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});

		await deps.fs.writeFileDurable(activePath, '{"record":', 0o600);
		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});
	});

	test("persists completed activation and fails closed when its manifest disappears", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-status-durable-active",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
			state: { activation_state: "active" },
		});
		expect(
			JSON.parse(
				await deps.fs.readTextFile(
					join(deps.paths.state.migrationsDir, "migration-state.json"),
				),
			),
		).toMatchObject({ activation_state: "active" });

		await deps.fs.unlink(
			join(deps.paths.state.migrationsDir, "active-corpus-manifest.json"),
		);
		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});
	});

	test("every later migration phase preserves ever-activated evidence and missing authority still fails closed", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-monotonic-active",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);

		const sourceRoot = join(
			deps.paths.state.migrationsDir,
			"later-phase-source",
		);
		await deps.fs.mkdir(sourceRoot, { recursive: true, mode: 0o700 });
		await deps.fs.writeFileDurable(
			join(sourceRoot, "acme.json"),
			'{"flow":"read"}\n',
			0o600,
		);

		for (const runPhase of [
			() => inventoryBrowserUseMigration(deps, sourceRoot),
			() => planBrowserUseMigration(deps, sourceRoot),
			() => applyBrowserUseMigration(deps, sourceRoot),
			() => verifyBrowserUseMigration(deps, sourceRoot),
		]) {
			expect(await runPhase()).toMatchObject({
				ok: true,
				state: { activation_state: "active" },
			});
		}
		expect(
			JSON.parse(
				await deps.fs.readTextFile(
					join(deps.paths.state.migrationsDir, "migration-state.json"),
				),
			),
		).toMatchObject({
			phase: "verified",
			activation_state: "active",
		});

		await deps.fs.unlink(
			join(deps.paths.state.migrationsDir, "active-corpus-manifest.json"),
		);
		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});
	});

	test("retry finalizes activation after the manifest commits but state persistence fails", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-state-commit-retry",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		let failStateCommit = true;
		const failingFs = new Proxy(deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "rename" || typeof value !== "function") return value;
				return async (oldPath: string, newPath: string) => {
					if (
						failStateCommit &&
						newPath.endsWith("/migration-state.json")
					) {
						failStateCommit = false;
						throw Object.assign(new Error("fixture state crash"), {
							code: "EIO",
						});
					}
					return await Reflect.apply(value, target, [oldPath, newPath]);
				};
			},
		}) as BrowserUsePlatformFs;

		expect(
			await activateBrowserUseMigration({ ...deps, fs: failingFs }, {}),
		).toMatchObject({ ok: false, code: "store_flush_failed" });
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: { generation_id: "generation-state-commit-retry" },
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
			state: { activation_state: "active" },
		});
		expect(
			JSON.parse(
				await deps.fs.readTextFile(
					join(deps.paths.state.migrationsDir, "migration-state.json"),
				),
			),
		).toMatchObject({ activation_state: "active" });
	});

	test("status projects redacted rollback coordinates and the current fence", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-status-current-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		await seedCompleteGeneration(deps, {
			generationId: "generation-status-current-b",
			targetId: "acme/read-b",
			sourcePath: "acme/playbooks/read-b.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		const tripped = await tripActiveGenerationEffectFence(deps, {
			generationId: "generation-status-current-b",
			activationEpoch: 3,
			effectKind: "external-dispatch",
			effectRef: "run-status-current",
		});
		expect(tripped.ok).toBe(true);

		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: true,
			state: {
				activation_state: "active",
				active_generation: {
					state: "active",
					current: {
						generation_id: "generation-status-current-b",
						activation_epoch: 3,
					},
					prior: {
						generation_id: "generation-status-current-a",
						activation_epoch: 2,
					},
					retained: [
						{
							generation_id: "generation-status-current-a",
							activation_epoch: 2,
						},
					],
					activation_epoch: 3,
					pending: "committed",
					effect_fence: "tripped",
				},
			},
		});
	});

	test("activates one complete verified generation without reading legacy source bytes", async () => {
		const deps = await makeDeps();
		const generationId = "generation-activation-a";
		const sourcePath = "acme/playbooks/read.json";
		const targetId = "acme/read";
		const snapshotDigest = "a".repeat(64);
		const runbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "acme",
			flow_id: "read",
			flow_name: "read",
			version: "1.0.0",
			summary: "Read the current portal state.",
			allowed_origins: ["https://acme.test"],
			inputs: [],
			steps: [{ kind: "snapshot", interactive: false }],
		})}\n`;
		const registry = `${JSON.stringify({ actions: [] })}\n`;
		const proof = `${JSON.stringify({ proof: "verified" })}\n`;
		const runbookPath = "runbooks/acme/read/runbook.json";
		const registryPath = "actions/registry.json";
		const proofPath = "proofs/acme-read.json";
		const shippedDigest = await shippedCatalogDigest(
			shippedRunbooksRoot(),
			deps.fs,
		);
		const candidate = {
			contract: "browser-use.corpus-generation-candidate",
			schema_version: "1",
			generation_id: generationId,
			source_snapshot: {
				snapshot_id: "snapshot-activation-a",
				snapshot_digest: snapshotDigest,
			},
			canonical_targets: [
				{
					canonical_target_id: targetId,
					activation: "active",
					runbook_path: runbookPath,
					runbook_digest: sha256(runbook),
					source_relative_paths: [sourcePath],
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
			shipped_catalog_digest: shippedDigest,
		};
		const staged = await stageGeneration(deps, {
			generationId,
			files: [
				{ relPath: runbookPath, contents: runbook },
				{ relPath: registryPath, contents: registry },
				{ relPath: proofPath, contents: proof },
				{
					relPath: "corpus-generation-candidate.json",
					contents: durableRecord("corpus-generation-candidate", candidate),
				},
			],
		});
		expect(staged.ok).toBe(true);
		await writeSourceSnapshot(deps, {
			snapshot_id: "snapshot-activation-a",
			root_identity: sha256("legacy-root"),
			entries: [
				{
					relative_path: sourcePath,
					type: "file",
					size: 1,
					mode: 0o600,
					content_hash: "b".repeat(64),
				},
			],
			snapshot_digest: snapshotDigest,
		});
		const state: BrowserUseMigrationState = {
			contract: "browser-use.migration-status",
			schema_version: "2",
			phase: "verified",
			snapshot_id: "snapshot-activation-a",
			snapshot_digest: snapshotDigest,
			source_root_identity: sha256("legacy-root"),
			source_entry_count: 1,
			disposition_count: 1,
			dispositions: [
				{
					source_relative_path: sourcePath,
					source_content_hash: "b".repeat(64),
					artifact_class: "formal-playbook",
					formal_flow_id: targetId,
					canonical_target_id: targetId,
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
					canonical_target_id: targetId,
					source_relative_paths: [sourcePath],
				},
			],
			staged_generation: generationId,
			last_apply_verified_noop: false,
			activation_state: "unchanged",
		};
		await deps.fs.mkdir(deps.paths.state.migrationsDir, {
			recursive: true,
			mode: 0o700,
		});
		const stateWrite = await writeDurableFile(deps.fs, {
			path: join(deps.paths.state.migrationsDir, "migration-state.json"),
			contents: `${JSON.stringify(state, null, 2)}\n`,
		});
		expect(stateWrite.ok).toBe(true);

		const noLegacyFs = new Proxy(deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					if (
						args.some(
							(argument) =>
								typeof argument === "string" &&
								argument.startsWith("/legacy"),
						)
					) {
						throw new Error("activation read legacy source bytes");
					}
					return Reflect.apply(value, target, args);
				};
			},
		}) as BrowserUsePlatformFs;

		const activated = await activateBrowserUseMigration(
			{ ...deps, fs: noLegacyFs },
			{},
		);
		expect(activated).toMatchObject({
			ok: true,
			state: {
				phase: "verified",
				staged_generation: generationId,
				activation_state: "active",
			},
		});
		const active = await readActiveCorpusManifest(deps);
		expect(active).toMatchObject({
			status: "present",
			manifest: {
				generation_id: generationId,
				generation_content_hash: staged.ok
					? staged.record.content_hash
					: "unreachable",
				activation_epoch: 2,
				canonical_targets: [
					{ canonical_target_id: targetId, activation: "active" },
				],
			},
		});

		const recordRead = await readDurableFile(
			deps.fs,
			generationRecordPath(deps.paths, generationId),
		);
		expect(recordRead.status).toBe("present");
		if (recordRead.status !== "present") throw new Error("unreachable");
		expect(parseDurableRecord(recordRead.raw, "generation")).toMatchObject({
			ok: true,
			payload: { generation_id: generationId, status: "staged" },
		});
	});

	test("an interrupted epoch advance reserves expected+1 for the same target only", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-cas-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		let failActiveCommit = true;
		const failingFs = new Proxy(deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "rename" || typeof value !== "function") return value;
				return async (oldPath: string, newPath: string) => {
					if (
						failActiveCommit &&
						newPath.endsWith("/active-corpus-manifest.json")
					) {
						failActiveCommit = false;
						throw Object.assign(new Error("fixture crash"), { code: "EIO" });
					}
					return await Reflect.apply(value, target, [oldPath, newPath]);
				};
			},
		}) as BrowserUsePlatformFs;
		expect(
			await activateBrowserUseMigration({ ...deps, fs: failingFs }, {}),
		).toMatchObject({ ok: false, code: "store_flush_failed" });
		expect(await readActiveCorpusManifest(deps)).toEqual({ status: "missing" });
		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: true,
			state: {
				active_generation: {
					state: "activation-interrupted",
					current: null,
					activation_epoch: 2,
					pending: "interrupted",
					effect_fence: "not-applicable",
				},
			},
		});

		await seedCompleteGeneration(deps, {
			generationId: "generation-cas-b",
			targetId: "acme/read-b",
			sourcePath: "acme/playbooks/read-b.json",
		});
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_activation_conflict",
		});

		await seedCompleteGeneration(deps, {
			generationId: "generation-cas-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
			state: { activation_state: "active" },
		});
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: {
				generation_id: "generation-cas-a",
				activation_epoch: 2,
			},
		});
	});

	test("a pending claim at the current epoch remains retryable after epoch persistence fails", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-pending-prepared",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		let failEpochCommit = true;
		const failingFs = new Proxy(deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "rename" || typeof value !== "function") return value;
				return async (oldPath: string, newPath: string) => {
					if (failEpochCommit && newPath === deps.paths.state.epochFile) {
						failEpochCommit = false;
						throw Object.assign(new Error("fixture epoch crash"), {
							code: "EIO",
						});
					}
					return await Reflect.apply(value, target, [oldPath, newPath]);
				};
			},
		}) as BrowserUsePlatformFs;

		expect(
			await activateBrowserUseMigration({ ...deps, fs: failingFs }, {}),
		).toMatchObject({ ok: false, code: "store_flush_failed" });
		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: true,
			state: {
				active_generation: {
					state: "activation-prepared",
					pending: "prepared",
					current: null,
					activation_epoch: 1,
				},
			},
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
			state: { activation_state: "active" },
		});
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: {
				generation_id: "generation-pending-prepared",
				activation_epoch: 2,
			},
		});
	});

	test("same-generation activation revalidates closure without advancing the epoch", async () => {
		const deps = await makeDeps();
		const generationId = "generation-idempotent-a";
		await seedCompleteGeneration(deps, {
			generationId,
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
		});
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
		});
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: { generation_id: generationId, activation_epoch: 2 },
		});

		await deps.fs.writeFileDurable(
			generationFilePath(
				deps.paths,
				generationId,
				"proofs/acme-read-a.json",
			),
			'{"proof":"changed"}\n',
			0o600,
		);

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: { generation_id: generationId, activation_epoch: 2 },
		});
	});

	test("same-generation status and activation reject authority digests that do not match the immutable candidate", async () => {
		const deps = await makeDeps();
		const generationId = "generation-active-identity-drift";
		await seedCompleteGeneration(deps, {
			generationId,
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		const activePath = join(
			deps.paths.state.migrationsDir,
			"active-corpus-manifest.json",
		);
		const active = await readDurableFile(deps.fs, activePath);
		expect(active.status).toBe("present");
		if (active.status !== "present") throw new Error("unreachable");
		const parsedActive = parseDurableRecord(
			active.raw,
			"corpus-generation-manifest",
		);
		expect(parsedActive.ok).toBe(true);
		if (!parsedActive.ok) throw new Error("unreachable");
		const pendingPath = join(
			deps.paths.state.migrationsDir,
			"activation-pending.json",
		);
		const pending = await readDurableFile(deps.fs, pendingPath);
		expect(pending.status).toBe("present");
		if (pending.status !== "present") throw new Error("unreachable");
		const parsedPending = parseDurableRecord(pending.raw, "activation-pending");
		expect(parsedPending.ok).toBe(true);
		if (!parsedPending.ok) throw new Error("unreachable");
		const falseGenerationHash = "e".repeat(64);
		const falseCandidateDigest = "f".repeat(64);
		await deps.fs.writeFileDurable(
			activePath,
			durableRecord("corpus-generation-manifest", {
				...parsedActive.payload,
				generation_content_hash: falseGenerationHash,
				candidate_manifest_digest: falseCandidateDigest,
			}),
			0o600,
		);
		await deps.fs.writeFileDurable(
			pendingPath,
			durableRecord("activation-pending", {
				...parsedPending.payload,
				generation_content_hash: falseGenerationHash,
				candidate_manifest_digest: falseCandidateDigest,
			}),
			0o600,
		);

		expect(await readBrowserUseMigrationStatus(deps)).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_active_manifest_corrupt",
		});
	});

	test("hashes and parses the same single read of each generation file", async () => {
		const deps = await makeDeps();
		const generationId = "generation-single-read-a";
		await seedCompleteGeneration(deps, {
			generationId,
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		const runbookPath = generationFilePath(
			deps.paths,
			generationId,
			"runbooks/acme/read-a/runbook.json",
		);
		const swappedRunbook = `${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "acme",
			flow_id: "read-a",
			flow_name: "read-a",
			version: "1.0.0",
			summary: "Unhashed replacement bytes.",
			allowed_origins: ["https://acme.test"],
			inputs: [],
			steps: [{ kind: "snapshot", interactive: false }],
		})}\n`;
		let runbookReads = 0;
		const swappingFs = new Proxy(deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "readTextFile" || typeof value !== "function") {
					return value;
				}
				return async (path: string) => {
					if (path === runbookPath) {
						runbookReads += 1;
						return swappedRunbook;
					}
					return await Reflect.apply(value, target, [path]);
				};
			},
		}) as BrowserUsePlatformFs;

		expect(
			await activateBrowserUseMigration({ ...deps, fs: swappingFs }, {}),
		).toMatchObject({
			ok: false,
			code: "migration_manifest_incomplete",
		});
		expect(runbookReads).toBe(1);
		expect(await readActiveCorpusManifest(deps)).toEqual({ status: "missing" });
	});

	test("candidate bytes must match the exact candidate digest verified in the generation tree", async () => {
		const deps = await makeDeps();
		const generationId = "generation-candidate-single-read";
		await seedCompleteGeneration(deps, {
			generationId,
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		const candidatePath = generationFilePath(
			deps.paths,
			generationId,
			CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
		);
		const candidateRaw = await deps.fs.readTextFile(candidatePath);
		const reserializedCandidate = `${JSON.stringify(
			JSON.parse(candidateRaw),
		)}\n`;
		expect(sha256(reserializedCandidate)).not.toBe(sha256(candidateRaw));
		const swappingFs = new Proxy(deps.fs, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== "readTextFile" || typeof value !== "function") {
					return value;
				}
				return async (path: string) =>
					path === candidatePath
						? reserializedCandidate
						: await Reflect.apply(value, target, [path]);
			},
		}) as BrowserUsePlatformFs;

		expect(
			await activateBrowserUseMigration({ ...deps, fs: swappingFs }, {}),
		).toMatchObject({
			ok: false,
			code: "migration_candidate_corrupt",
		});
		expect(await readActiveCorpusManifest(deps)).toEqual({ status: "missing" });
	});

	test("auth route admission rejects unknown secret-bearing fields", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-auth-route-extra",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
			auth: {
				candidateServiceId: "acme",
				routeExtra: { password: "secret-sentinel" },
			},
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_manifest_incomplete",
		});
	});

	test("auth route admission rejects secret-shaped values in admitted fields", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-auth-route-secret-ref",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
			auth: {
				candidateServiceId: "acme",
				authContextRef: "op://vault/item",
			},
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_manifest_incomplete",
		});
	});

	test("auth route admission accepts an exact reviewed session policy", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-auth-session-policy",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
			auth: {
				candidateServiceId: "acme",
				authContextRef: "acme-portal-session",
				sessionPolicy: true,
			},
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
			state: { activation_state: "active" },
		});
	});

	test("auth route admission rejects missing or drifted reviewed action authority", async () => {
		for (const fault of [
			"missing",
			"digest",
			"origin",
			"effect",
			"purpose",
			"receipt-purpose",
			"postcondition",
		] as const) {
			const deps = await makeDeps();
			await seedCompleteGeneration(deps, {
				generationId: `generation-auth-session-${fault}`,
				targetId: "acme/read",
				sourcePath: "acme/playbooks/read.json",
				auth: {
					candidateServiceId: "acme",
					authContextRef: "acme-portal-session",
					sessionPolicy: true,
					sessionPolicyFault: fault,
				},
			});

			expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
				ok: false,
				code: "migration_manifest_incomplete",
			});
		}
	});

	test("auth route admission binds the selected candidate to the active target service", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-auth-route-service",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
			auth: { candidateServiceId: "other-service" },
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_manifest_incomplete",
		});
	});

	test("auth route admission keeps opaque route refs separate from auth-context vocabulary", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-auth-opaque-ref",
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
			auth: {
				candidateServiceId: "acme",
				authContextRef: "acme-portal-session",
			},
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: true,
			state: { activation_state: "active" },
		});
	});

	test("corrupt target closure preserves the prior active manifest", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-closure-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		await seedCompleteGeneration(deps, {
			generationId: "generation-closure-b",
			targetId: "acme/read-b",
			sourcePath: "acme/playbooks/read-b.json",
		});
		await deps.fs.writeFileDurable(
			generationFilePath(
				deps.paths,
				"generation-closure-b",
				"proofs/acme-read-b.json",
			),
			'{"proof":"changed"}\n',
			0o600,
		);
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_generation_corrupt",
		});
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: { generation_id: "generation-closure-a" },
		});
	});

	test("retains historical epochs and permits rollback only before the first effect", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-rollback-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		await seedCompleteGeneration(deps, {
			generationId: "generation-rollback-b",
			targetId: "acme/read-b",
			sourcePath: "acme/playbooks/read-b.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);

		expect(
			await readRetainedCorpusGenerationManifest(deps, {
				generationId: "generation-rollback-a",
				activationEpoch: 2,
			}),
		).toMatchObject({
			status: "present",
			identity: {
				generation_id: "generation-rollback-a",
				activation_epoch: 2,
			},
		});
		expect(
			await activateBrowserUseMigration(deps, {
				generationId: "generation-rollback-a",
			}),
		).toMatchObject({ ok: true, state: { activation_state: "active" } });
		const rolledBack = await readActiveCorpusManifest(deps);
		expect(rolledBack).toMatchObject({
			status: "present",
			manifest: {
				generation_id: "generation-rollback-a",
				activation_epoch: 4,
				prior_generation: {
					generation_id: "generation-rollback-b",
					activation_epoch: 3,
				},
			},
		});
		if (rolledBack.status !== "present") throw new Error("unreachable");
		expect(
			await readRetainedCorpusGenerationManifest(deps, {
				generationId: "generation-rollback-b",
				activationEpoch: 3,
			}),
		).toMatchObject({
			status: "present",
			identity: {
				generation_id: "generation-rollback-b",
				activation_epoch: 3,
			},
		});

		const firstTrip = await tripActiveGenerationEffectFence(deps, {
			generationId: "generation-rollback-a",
			activationEpoch: rolledBack.manifest.activation_epoch,
			effectKind: "generation-run",
			effectRef: "run-first",
		});
		expect(firstTrip).toMatchObject({
			ok: true,
			fence: {
				state: "tripped",
				first_effect: {
					effect_kind: "generation-run",
					effect_ref: "run-first",
				},
			},
		});
		const repeatedTrip = await tripActiveGenerationEffectFence(deps, {
			generationId: "generation-rollback-a",
			activationEpoch: rolledBack.manifest.activation_epoch,
			effectKind: "artifact",
			effectRef: "artifact-later",
		});
		expect(repeatedTrip).toEqual(firstTrip);
		expect(
			await activateBrowserUseMigration(deps, {
				generationId: "generation-rollback-b",
			}),
		).toMatchObject({
			ok: false,
			code: "migration_effect_fence_tripped",
		});
	});

	test("effect-fence trip rejects a payload that addresses another activation epoch", async () => {
		const deps = await makeDeps();
		const generationId = "generation-fence-epoch";
		await seedCompleteGeneration(deps, {
			generationId,
			targetId: "acme/read",
			sourcePath: "acme/playbooks/read.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		const fencePath = join(
			deps.paths.state.migrationsDir,
			"effect-fences",
			"2.json",
		);
		await deps.fs.writeFileDurable(
			fencePath,
			durableRecord("generation-effect-fence", {
				generation_id: generationId,
				activation_epoch: 3,
				state: "untripped",
				tripped_at_epoch_ms: null,
				first_effect: null,
			}),
			0o600,
		);

		expect(
			await tripActiveGenerationEffectFence(deps, {
				generationId,
				activationEpoch: 2,
				effectKind: "generation-run",
				effectRef: "run-wrong-fence-epoch",
			}),
		).toMatchObject({
			ok: false,
			code: "migration_effect_fence_corrupt",
		});
	});

	test("a corrupt prior-generation run routes to repair-state diagnostics", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-corrupt-run-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		const runPath = deps.paths.state.runFile("run-corrupt");
		await deps.fs.mkdir(runPath.replace(/\/run\.json$/, ""), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(runPath, '{"record":', 0o600);
		await seedCompleteGeneration(deps, {
			generationId: "generation-corrupt-run-b",
			targetId: "acme/read-b",
			sourcePath: "acme/playbooks/read-b.json",
		});

		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_state_corrupt",
			message: expect.stringContaining("repair status"),
		});
	});

	test("a nonterminal prior-generation mutation-capable run blocks activation", async () => {
		const deps = await makeDeps();
		await seedCompleteGeneration(deps, {
			generationId: "generation-run-a",
			targetId: "acme/read-a",
			sourcePath: "acme/playbooks/read-a.json",
		});
		expect((await activateBrowserUseMigration(deps, {})).ok).toBe(true);
		await deps.fs.mkdir(deps.paths.state.runFile("run-blocker").replace(/\/run\.json$/, ""), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(
			deps.paths.state.runFile("run-blocker"),
			`${JSON.stringify({
				record: "shared-run",
				schema_version: "2",
				payload: {
					run_id: "run-blocker",
					revision: 1,
					state: "running",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: "handoff-1",
					runbook_target_binding: {
						schema_version: "1",
						mode: "exact",
						binding_id: "binding-1",
					},
					runbook_progress: {
						schema_version: "1",
						service_id: "acme",
						flow_id: "read-a",
						runbook_version: "1.0.0",
						next_step: 0,
						total_steps: 1,
					},
					run_execution_binding: {
						schema_version: "1",
						generation_id: "generation-run-a",
						activation_epoch: 2,
						service_id: "acme",
						flow_id: "read-a",
						runbook_version: "1.0.0",
						runbook_digest: "1".repeat(64),
						action_registry_digest: "2".repeat(64),
						normalized_input_digest: "3".repeat(64),
						item_key_digest: "4".repeat(64),
						target_scope: "https://acme.test",
						postcondition: {
							id: "saved",
							summary: "Save remains proven.",
						},
					},
					postcondition: {
						id: "saved",
						summary: "Save remains proven.",
					},
					mutation_dispatched: false,
					artifacts: [],
					created_at_epoch_ms: 10_000,
					updated_at_epoch_ms: 10_000,
				},
			}, null, "\t")}\n`,
			0o600,
		);
		await seedCompleteGeneration(deps, {
			generationId: "generation-run-b",
			targetId: "acme/read-b",
			sourcePath: "acme/playbooks/read-b.json",
		});
		expect(await activateBrowserUseMigration(deps, {})).toMatchObject({
			ok: false,
			code: "migration_prior_run_active",
		});
		expect(await readActiveCorpusManifest(deps)).toMatchObject({
			status: "present",
			manifest: { generation_id: "generation-run-a" },
		});
	});
});
