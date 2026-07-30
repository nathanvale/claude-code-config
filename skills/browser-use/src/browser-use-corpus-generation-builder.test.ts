import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import {
	actionAssetDigest,
	type BrowserUseReviewedActionRecord,
} from "./browser-use-runbook-actions";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import {
	buildBrowserUseCorpusGeneration,
	type BrowserUseCorpusGenerationBuildInput,
} from "./browser-use-corpus-generation-builder";

const sha256 = (value: string): string =>
	createHash("sha256").update(value).digest("hex");

function stateFor(files: Readonly<Record<string, string>>): BrowserUseMigrationState {
	const targets = [
		"fasttrack/fill-week",
		"oncore/fill-timesheet",
		"xero/extract-bankstatementsplus",
		"xero/post-banktransaction",
		"xero/reconcile-batch",
	];
	const dispositions = Object.entries(files).map(([source_relative_path, contents]) => ({
		source_relative_path,
		source_content_hash: sha256(contents),
		artifact_class: "supporting" as const,
		formal_flow_id: null,
		canonical_target_id: null,
		disposition: "stage" as const,
		reason: "safe staged knowledge",
		transform_version: "browser-use-corpus-v1",
		logical_destination_id: null,
		expected_hash: null,
	}));
	return {
		contract: "browser-use.migration-status",
		schema_version: "2",
		phase: "verified",
		snapshot_id: "snapshot-reviewed",
		snapshot_digest: "a".repeat(64),
		source_root_identity: "b".repeat(64),
		source_entry_count: dispositions.length,
		disposition_count: dispositions.length,
		dispositions,
		corpus_census: {
			formal_artifacts: 5,
			target_flows: 5,
			scripts: 0,
			auth_narratives: 0,
			login_capabilities: 0,
			domain_script_actions: 0,
		},
		canonical_targets: targets.map((canonical_target_id) => ({
			canonical_target_id,
			source_relative_paths: [`definitions/${canonical_target_id}.json`],
		})),
		staged_generation: "legacy-staged",
		last_apply_verified_noop: false,
		activation_state: "unchanged",
	};
}

function readOnlyFs(files: Readonly<Record<string, string>>): BrowserUsePlatformFs {
	return {
		async lstat(path) {
			const contents = files[path];
			return contents === undefined
				? undefined
				: {
						kind: "file",
						mode: 0o600,
						uid: 1,
						dev: 1,
						size: Buffer.byteLength(contents),
					};
		},
		async realpath(path) {
			return path;
		},
		async readTextFile(path) {
			const contents = files[path];
			if (contents === undefined) throw new Error("missing");
			return contents;
		},
		async hashFile(path) {
			const contents = files[path];
			if (contents === undefined) throw new Error("missing");
			return sha256(contents);
		},
		async readDirectory() {
			return [];
		},
		async mkdir() {},
		async chmod() {},
		async writeFileDurable() {},
		async writeFile() {},
		async rename() {},
		async linkFileNoReplace() {},
		async unlink() {},
		async syncDirectory() {},
		async createExclusive() {},
		async copyFileDurable() {},
	};
}

function inactiveRunbook(canonicalTargetId: string): BrowserUseRunbook {
	const [serviceId, flowId] = canonicalTargetId.split("/");
	if (serviceId === undefined || flowId === undefined) throw new Error("bad target");
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: serviceId,
		flow_id: flowId,
		flow_name: flowId,
		version: "2",
		summary: "Preserved inactive definition.",
		allowed_origins: [`https://${serviceId}.example.test`],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	};
}

function input(files: Readonly<Record<string, string>>): BrowserUseCorpusGenerationBuildInput {
	const state = stateFor(files);
	return {
		state,
		sourceRoot: "/source",
		generationId: "corpus-snapshot-reviewed",
		shippedCatalogDigest: "c".repeat(64),
		targets: state.canonical_targets.map((target) => ({
			canonicalTargetId: target.canonical_target_id,
			runbook: inactiveRunbook(target.canonical_target_id),
			activation: "inactive" as const,
			inactiveReason: `No contract-compatible reviewed action approval exists for ${target.canonical_target_id}.`,
			proofs: [
				{
					proofRef: `definition-${target.canonical_target_id.replaceAll("/", "-")}`,
					payload: { status: "definition-preserved", redacted: true },
				},
			],
		})),
		actions: [],
		authCandidates: [],
		authRoutes: [],
	};
}

describe("buildBrowserUseCorpusGeneration", () => {
	test("builds one deterministic exact closure and retains only staged safe knowledge", async () => {
		const sourceFiles = { "/source/notes/safe.md": "# Safe knowledge\n" };
		const buildInput = input({ "notes/safe.md": sourceFiles["/source/notes/safe.md"] });
		const first = await buildBrowserUseCorpusGeneration(
			{ fs: readOnlyFs(sourceFiles) },
			buildInput,
		);
		const second = await buildBrowserUseCorpusGeneration(
			{ fs: readOnlyFs(sourceFiles) },
			buildInput,
		);

		expect(second).toEqual(first);
		expect(first.candidate.canonical_targets).toHaveLength(5);
		expect(first.candidate.canonical_targets.every((target) => target.activation === "inactive")).toBe(true);
		expect(first.candidate.knowledge?.files).toEqual([
			{
				source_relative_path: "notes/safe.md",
				path: "knowledge/notes/safe.md",
				digest: sha256("# Safe knowledge\n"),
			},
		]);
		expect(first.files.map((file) => file.relPath)).toEqual(
			[...first.files.map((file) => file.relPath)].sort(),
		);
		expect(first.files.at(-1)?.relPath).not.toBe("corpus-generation-candidate.json");
		expect(first.files.some((file) => file.relPath === "corpus-generation-candidate.json")).toBe(true);
	});

	test("carries caller-screened auth candidates but never manufactures an auth route", async () => {
		const buildInput = input({});
		buildInput.authCandidates = [
			{
				candidate_id: "auth-candidate-oncore",
				auth_context: "interactive-login",
				service_id: "oncore",
				legacy_context_prose: "delegated login shape",
				hint_item_id: null,
				proposed_origins: ["https://portal.example.test"],
				legacy_vault_name: null,
				provenance: "legacy-auth-pointer",
			},
		];

		const built = await buildBrowserUseCorpusGeneration(
			{ fs: readOnlyFs({}) },
			buildInput,
		);

		expect(built.candidate.auth.candidates).toHaveLength(1);
		expect(built.candidate.auth.routes).toEqual([]);
	});

	test("never infers session policy from runbook or candidate origins", async () => {
		const buildInput = input({});
		buildInput.authCandidates = [
			{
				candidate_id: "auth-candidate-oncore",
				auth_context: "interactive-login",
				service_id: "oncore",
				legacy_context_prose: null,
				hint_item_id: null,
				proposed_origins: ["https://legacy-oncore.example.test"],
				legacy_vault_name: null,
				provenance: "legacy-auth-pointer",
			},
		];
		buildInput.authRoutes = [
			{
				authContextRef: "oncore-session",
				candidateId: "auth-candidate-oncore",
			},
		];

		const built = await buildBrowserUseCorpusGeneration(
			{ fs: readOnlyFs({}) },
			buildInput,
		);

		expect(
			JSON.parse(
				built.files.find(
					(file) => file.relPath === "auth/routes/oncore-session.json",
				)?.contents ?? "null",
			),
		).toEqual({
			auth_context_ref: "oncore-session",
			candidate_id: "auth-candidate-oncore",
			status: "active",
		});
	});

	test("records quarantined and provenance-only dispositions in the ledger without copying bytes", async () => {
		const buildInput = input({});
		buildInput.state = {
			...buildInput.state,
			source_entry_count: 2,
			disposition_count: 2,
			dispositions: [
				{
					source_relative_path: "backup/old.yaml",
					source_content_hash: "d".repeat(64),
					artifact_class: "formal-playbook",
					formal_flow_id: "xero/post-banktransaction",
					canonical_target_id: "xero/post-banktransaction",
					disposition: "provenance-only",
					reason: "retained as lineage only",
					transform_version: "browser-use-corpus-v1",
					logical_destination_id: null,
					expected_hash: null,
				},
				{
					source_relative_path: "scripts/unsafe.js",
					source_content_hash: "e".repeat(64),
					artifact_class: "script",
					formal_flow_id: null,
					canonical_target_id: null,
					disposition: "quarantine-executable",
					reason: "unreviewed executable",
					transform_version: "browser-use-corpus-v1",
					logical_destination_id: null,
					expected_hash: null,
				},
			],
		};

		const built = await buildBrowserUseCorpusGeneration(
			{ fs: readOnlyFs({}) },
			buildInput,
		);
		const ledger = built.files.find((file) => file.relPath === "proofs/corpus-ledger.json");

		expect(ledger?.contents).toContain("backup/old.yaml");
		expect(ledger?.contents).toContain("scripts/unsafe.js");
		expect(built.files.some((file) => file.relPath.includes("unsafe.js"))).toBe(false);
	});

	test("binds active closure only from exact caller-supplied actions and auth routes", async () => {
		const buildInput = input({});
		const assetBytes =
			"async () => ({ rows: document.querySelectorAll('.row').length })";
		const digest = actionAssetDigest(assetBytes);
		const submitAssetBytes =
			"async () => { document.querySelector('#submit').click(); return { submitted: true } }";
		const submitDigest = actionAssetDigest(submitAssetBytes);
		const identifyAssetBytes =
			"async ({ inputs }) => ({ forms: document.querySelectorAll('form').length })";
		const identifyDigest = actionAssetDigest(identifyAssetBytes);
		const action: BrowserUseReviewedActionRecord = {
			action_id: "oncore-read-grid",
			asset_id: digest,
			expected_digest: digest,
			allowed_origin: "https://oncore.example.test",
			effect_class: "read",
			containment: "read-only-observation",
			input_schema: { kind: "object", fields: {} },
			result_schema: {
				kind: "object",
				fields: {
					rows: { required: true, schema: { kind: "number" } },
				},
			},
			result_sensitivity: "low",
			source_provenance: "reviewed/oncore-read-grid.js",
			promotion_receipt: {
				approved_digest: digest,
				disposition: "approved",
				approved_origin: "https://oncore.example.test",
				approved_effect: "read",
				approver_ref: "operator-review",
			},
		};
		const submitAction: BrowserUseReviewedActionRecord = {
			action_id: "oncore-submit-login",
			asset_id: submitDigest,
			expected_digest: submitDigest,
			allowed_origin: "https://login.example.test",
			effect_class: "mutation",
			containment: "none",
			input_schema: { kind: "object", fields: {} },
			result_schema: { kind: "object", fields: {} },
			result_sensitivity: "low",
			required_postcondition: {
				kind: "element-visible",
				selector: "#authenticated",
			},
			source_provenance: "reviewed/oncore-submit-login.js",
			promotion_receipt: {
				approved_digest: submitDigest,
				disposition: "approved",
				approved_origin: "https://login.example.test",
				approved_effect: "mutation",
				approver_ref: "operator-review",
			},
		};
		const identifyAction: BrowserUseReviewedActionRecord = {
			...action,
			action_id: "oncore-identify-login",
			asset_id: identifyDigest,
			expected_digest: identifyDigest,
			allowed_origin: "https://login.example.test",
			source_provenance: "reviewed/oncore-identify-login.js",
			promotion_receipt: {
				...action.promotion_receipt,
				approved_digest: identifyDigest,
				approved_origin: "https://login.example.test",
			},
		};
		const oncore = buildInput.targets.find(
			(target) => target.canonicalTargetId === "oncore/fill-timesheet",
		);
		if (oncore === undefined) throw new Error("fixture target missing");
		oncore.activation = "active";
		oncore.inactiveReason = null;
		oncore.runbook = {
			...oncore.runbook,
			auth_context_ref: "oncore-session",
			steps: [
				{
					kind: "action",
					action_id: action.action_id,
					expected_digest: digest,
					inputs: {},
				},
			],
		};
		buildInput.actions = [
			{ record: action, assetBytes },
			{ record: identifyAction, assetBytes: identifyAssetBytes },
			{ record: submitAction, assetBytes: submitAssetBytes },
		];
		buildInput.authCandidates = [
			{
				candidate_id: "auth-candidate-oncore",
				auth_context: "interactive-login",
				service_id: "oncore",
				legacy_context_prose: "delegated login shape",
				hint_item_id: null,
				proposed_origins: ["https://oncore.example.test"],
				legacy_vault_name: null,
				provenance: "legacy-auth-pointer",
			},
		];
		buildInput.authRoutes = [
			{
				authContextRef: "oncore-session",
				candidateId: "auth-candidate-oncore",
				sessionPolicy: {
					schema_version: "1",
					approved_service_origins: ["https://oncore.example.test"],
					approved_identity_provider_origins: [
						"https://login.example.test",
					],
					auth_flow: {
						schema_version: "1",
						fields: {
							username: { role: "textbox", name: "Email address" },
							password: { role: "textbox", name: "Password" },
						},
						identify_state: {
							action_id: identifyAction.action_id,
							expected_digest: identifyDigest,
						},
						password_submit: {
							action_id: submitAction.action_id,
							expected_digest: submitDigest,
						},
					},
					identity_verifier: {
						schema_version: "1",
						action: {
							action_id: action.action_id,
							expected_digest: digest,
						},
						expected: {
							subject_reference: "oncore-subject",
							account_reference: "oncore-account",
							tenant_reference: "oncore-tenant",
						},
						freshness_ms: 60_000,
					},
				},
			},
		];

		const built = await buildBrowserUseCorpusGeneration(
			{ fs: readOnlyFs({}) },
			buildInput,
		);

		expect(
			built.candidate.canonical_targets.find(
				(target) => target.canonical_target_id === "oncore/fill-timesheet",
			)?.activation,
		).toBe("active");
		expect(built.candidate.action_registry.actions).toHaveLength(3);
		expect(built.candidate.auth.routes).toEqual([
			expect.objectContaining({
				auth_context_ref: "oncore-session",
				candidate_id: "auth-candidate-oncore",
			}),
		]);
		expect(
			JSON.parse(
				built.files.find(
					(file) => file.relPath === "auth/routes/oncore-session.json",
				)?.contents ?? "null",
			),
		).toEqual({
			auth_context_ref: "oncore-session",
			candidate_id: "auth-candidate-oncore",
			status: "active",
			session_policy: buildInput.authRoutes[0]?.sessionPolicy,
		});
	});
});
