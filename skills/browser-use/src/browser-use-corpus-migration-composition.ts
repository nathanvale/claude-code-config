import { isAbsolute, join } from "node:path";
import type {
	BrowserUseCorpusGenerationActionInput,
	BrowserUseCorpusGenerationAuthRouteInput,
	BrowserUseCorpusGenerationBuildInput,
	BrowserUseCorpusGenerationBuilderDeps,
	BrowserUseCorpusGenerationTargetInput,
} from "./browser-use-corpus-generation-builder";
import type { BrowserUseImportCandidate } from "./browser-use-auth-bindings";
import {
	buildAuthCandidateMigration,
	type BrowserUseLoginNarrativeSource,
} from "./browser-use-auth-candidate-migration";
import { buildFasttrackSaveDraftMigration } from "./browser-use-fasttrack-migration";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import {
	buildOncoreSaveDraftMigration,
	buildOncoreTimesheetDiagnosisMigration,
} from "./browser-use-oncore-migration";
import {
	actionAssetDigest,
	ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
	XERO_BANKSTATEMENTS_CAPTURE_ACTION_BYTES,
	XERO_BANKSTATEMENTS_REQUEST_ACTION_BYTES,
} from "./browser-use-runbook-actions";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import {
	buildXeroActionCandidates,
	buildXeroMigration,
} from "./browser-use-xero-migration";

/** Production composition dependencies share the generic builder filesystem seam. */
export type BrowserUseCorpusMigrationCompositionDeps =
	BrowserUseCorpusGenerationBuilderDeps;

/** Exact authority optionally admitted into otherwise inactive definitions. */
export type BrowserUseCorpusMigrationCompositionInput = {
	state: BrowserUseMigrationState;
	sourceRoot: string;
	generationId: string;
	shippedCatalogDigest: string;
	actions?: readonly BrowserUseCorpusGenerationActionInput[];
	authCandidates?: readonly BrowserUseImportCandidate[];
	authRoutes?: readonly BrowserUseCorpusGenerationAuthRouteInput[];
	/** Separate caller confirmation required before a financial definition activates. */
	confirmedFinancialTargets?: readonly (
		| "xero/post-banktransaction"
		| "xero/reconcile-batch"
	)[];
};

const ONCORE_ORIGIN = "https://iteraterecruitment.oncoreservices.com";
const FASTTRACK_ORIGIN = "https://manpowergroup.fasttrack360.com.au";
const XERO_API_EXPLORER_ORIGIN = "https://api-explorer.xero.com";
const XERO_GO_ORIGIN = "https://go.xero.com";

const KNOWN_TARGETS = new Set([
	"fasttrack/fill-week",
	"oncore/fill-timesheet",
	"oncore/timesheet-diagnose",
	"xero/extract-bankstatementsplus",
	"xero/post-banktransaction",
	"xero/reconcile-batch",
]);

const AUTH_SOURCE_CANDIDATES: readonly BrowserUseLoginNarrativeSource[] = [
	{
		serviceId: "ellucian-sso",
		loginOrigin: "https://sso.ellucian.com",
		methodShapeHint: "password-totp-three-step",
		mfaSelectionStage: false,
		contextProse: null,
		sourceRelativePath: "domains/ellucian-okta/runbook-okta-login.md",
	},
	{
		serviceId: "monash-okta",
		loginOrigin: "https://monashuni.okta.com",
		methodShapeHint: "password-totp-four-step",
		mfaSelectionStage: true,
		contextProse: null,
		sourceRelativePath: "domains/monash-edu/runbook-okta-login.md",
	},
	{
		serviceId: "monash-qa-okta",
		loginOrigin: "https://monashuniqa.oktapreview.com",
		methodShapeHint: "password-totp-three-step",
		mfaSelectionStage: false,
		contextProse: null,
		sourceRelativePath:
			"domains/monash-qa-experience/runbook-okta-login.md",
	},
	{
		serviceId: "monash-confluence",
		loginOrigin: "https://monash-esol.atlassian.net",
		methodShapeHint: "delegated-vendor-login",
		mfaSelectionStage: false,
		contextProse: null,
		sourceRelativePath: "domains/monash-confluence/capabilities/login.yaml",
	},
	{
		serviceId: "monash-jira",
		loginOrigin: "https://monash-esol.atlassian.net",
		methodShapeHint: "delegated-vendor-login",
		mfaSelectionStage: false,
		contextProse: null,
		sourceRelativePath: "domains/monash-jira/capabilities/login.yaml",
	},
];

function defaultAuthCandidates(
	state: BrowserUseMigrationState,
): readonly BrowserUseImportCandidate[] {
	const presentPaths = new Set(
		state.dispositions.map((disposition) => disposition.source_relative_path),
	);
	return buildAuthCandidateMigration(
		AUTH_SOURCE_CANDIDATES.filter((source) =>
			presentPaths.has(source.sourceRelativePath),
		),
	).candidates;
}

function targetSources(
	state: BrowserUseMigrationState,
	targetId: string,
): readonly string[] {
	const target = state.canonical_targets.find(
		(candidate) => candidate.canonical_target_id === targetId,
	);
	if (target === undefined || target.source_relative_paths.length === 0) {
		throw new Error(`Production composition lacks provenance for ${targetId}.`);
	}
	return [...target.source_relative_paths].sort();
}

async function exactLegacyDigest(
	deps: BrowserUseCorpusMigrationCompositionDeps,
	input: BrowserUseCorpusMigrationCompositionInput,
	pathSuffix: string,
	fallbackTargetId: string,
): Promise<string> {
	const disposition = input.state.dispositions.find((candidate) =>
		candidate.source_relative_path.endsWith(pathSuffix),
	);
	if (disposition !== undefined) {
		const path = join(input.sourceRoot, disposition.source_relative_path);
		const stat = await deps.fs.lstat(path);
		if (
			stat?.kind === "file" &&
			(await deps.fs.hashFile(path)) === disposition.source_content_hash
		) {
			return disposition.source_content_hash;
		}
	}
	const source = targetSources(input.state, fallbackTargetId)[0];
	const fallback = input.state.dispositions.find(
		(candidate) => candidate.source_relative_path === source,
	)?.source_content_hash;
	if (fallback === undefined) {
		throw new Error(
			`Production composition lacks an exact source identity for ${fallbackTargetId}.`,
		);
	}
	return fallback;
}

function actionReferences(
	runbook: BrowserUseRunbook,
): readonly { actionId: string; digest: string }[] {
	return runbook.steps.flatMap((step) => {
		if (step.kind === "action") {
			return [{ actionId: step.action_id, digest: step.expected_digest }];
		}
		if (step.kind === "iterate") {
			return [
				{
					actionId: step.step.action_id,
					digest: step.step.expected_digest,
				},
			];
		}
		return [];
	});
}

function actionApproved(
	action: BrowserUseCorpusGenerationActionInput | undefined,
	digest: string,
): boolean {
	if (action === undefined) return false;
	const receipt = action.record.promotion_receipt;
	return (
		action.record.expected_digest === digest &&
		actionAssetDigest(action.assetBytes) === digest &&
		receipt.disposition === "approved" &&
		receipt.approved_digest === digest &&
		receipt.approved_origin === action.record.allowed_origin &&
		receipt.approved_effect === action.record.effect_class
	);
}

function authReady(
	runbook: BrowserUseRunbook,
	input: BrowserUseCorpusMigrationCompositionInput,
): boolean {
	if (runbook.auth_context_ref === undefined) return true;
	const route = input.authRoutes?.find(
		(candidate) => candidate.authContextRef === runbook.auth_context_ref,
	);
	if (route === undefined) return false;
	const candidate = input.authCandidates?.find(
		(authCandidate) => authCandidate.candidate_id === route.candidateId,
	);
	return candidate?.service_id === runbook.service_id;
}

function inactiveRunbook(definition: BrowserUseRunbook): BrowserUseRunbook {
	return {
		...definition,
		steps: [{ kind: "snapshot", interactive: false }],
	};
}

function activationFor(
	targetId: string,
	definition: BrowserUseRunbook,
	input: BrowserUseCorpusMigrationCompositionInput,
	forcedInactiveReason?: string,
): {
	activation: "active" | "inactive";
	inactiveReason: string | null;
} {
	if (forcedInactiveReason !== undefined) {
		return {
			activation: "inactive",
			inactiveReason: forcedInactiveReason,
		};
	}
	const byId = new Map(
		(input.actions ?? []).map((action) => [action.record.action_id, action]),
	);
	const missingActions = actionReferences(definition)
		.filter(
			(reference) =>
				!actionApproved(byId.get(reference.actionId), reference.digest),
		)
		.map((reference) => reference.actionId);
	if (missingActions.length > 0) {
		return {
			activation: "inactive",
			inactiveReason: `Missing exact approved actions: ${missingActions.join(", ")}.`,
		};
	}
	if (!authReady(definition, input)) {
		return {
			activation: "inactive",
			inactiveReason: `No exact active auth route exists for ${definition.auth_context_ref}.`,
		};
	}
	if (
		(targetId === "xero/post-banktransaction" ||
			targetId === "xero/reconcile-batch") &&
		!input.confirmedFinancialTargets?.includes(targetId)
	) {
		return {
			activation: "inactive",
			inactiveReason:
				"Financial mutation requires separate explicit caller confirmation.",
		};
	}
	return { activation: "active", inactiveReason: null };
}

function targetInput(
	targetId: string,
	definition: BrowserUseRunbook,
	state: BrowserUseMigrationState,
	input: BrowserUseCorpusMigrationCompositionInput,
	forcedInactiveReason?: string,
): BrowserUseCorpusGenerationTargetInput {
	const activation = activationFor(
		targetId,
		definition,
		input,
		forcedInactiveReason,
	);
	const proofRef = `definition-${targetId.replaceAll("/", "-")}`;
	return {
		canonicalTargetId: targetId,
		runbook:
			activation.activation === "active"
				? definition
				: inactiveRunbook(definition),
		...activation,
		proofs: [
			{
				proofRef,
				payload: {
					contract: "browser-use.migrated-definition-proof",
					schema_version: "1",
					canonical_target_id: targetId,
					source_relative_paths: targetSources(state, targetId),
					intended_runbook: definition,
					activation: activation.activation,
					inactive_reason: activation.inactiveReason,
				},
			},
		],
	};
}

/**
 * Compose current Browser Use corpus definitions into generic generation input.
 *
 * Existing domain builders remain definition owners. This layer normalizes
 * their service ids to planner canonical ids, binds exact source identities,
 * and removes dispatch steps when approvals or auth routes are absent. The
 * intended builder output remains in a redacted proof; inactive runbooks carry
 * only a snapshot and cannot dispatch.
 *
 * @param deps - Injected filesystem for exact legacy-byte identity checks
 * @param input - Verified migration state and explicit caller authority
 * @returns Generic build input consumable by buildBrowserUseCorpusGeneration
 * @throws {Error} When state, target vocabulary, or provenance is incomplete
 *
 * @example
 * ```typescript
 * const genericInput = await composeBrowserUseCorpusMigration({ fs }, input)
 * const build = await buildBrowserUseCorpusGeneration({ fs }, genericInput)
 * ```
 */
export async function composeBrowserUseCorpusMigration(
	deps: BrowserUseCorpusMigrationCompositionDeps,
	input: BrowserUseCorpusMigrationCompositionInput,
): Promise<BrowserUseCorpusGenerationBuildInput> {
	if (
		input.state.phase !== "verified" ||
		!isAbsolute(input.sourceRoot) ||
		input.state.canonical_targets.some(
			(target) => !KNOWN_TARGETS.has(target.canonical_target_id),
		)
	) {
		throw new Error(
			"Production composition requires a verified state, absolute source root, and known canonical targets.",
		);
	}

	const diagnosisDigest = actionAssetDigest(
		ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
	);
	const oncoreFillDigests = {
		reconcileRows: await exactLegacyDigest(
			deps,
			input,
			"/iteraterecruitment-oncoreservices/domain-script-actions/diagnose-grid-state.js",
			"oncore/fill-timesheet",
		),
		fillEntry: await exactLegacyDigest(
			deps,
			input,
			"/iteraterecruitment-oncoreservices/domain-script-actions/fill-entry.js",
			"oncore/fill-timesheet",
		),
		saveDraft: await exactLegacyDigest(
			deps,
			input,
			"/iteraterecruitment-oncoreservices/domain-script-actions/fill-week.js",
			"oncore/fill-timesheet",
		),
		verifyDraft: await exactLegacyDigest(
			deps,
			input,
			"/iteraterecruitment-oncoreservices/domain-script-actions/verify-filled-week.js",
			"oncore/fill-timesheet",
		),
	};
	const fasttrackDigests = {
		fillWeek: await exactLegacyDigest(
			deps,
			input,
			"/manpowergroup-fasttrack360/domain-script-actions/fill-week.js",
			"fasttrack/fill-week",
		),
		verifyFilledWeek: await exactLegacyDigest(
			deps,
			input,
			"/manpowergroup-fasttrack360/domain-script-actions/verify-filled-week.js",
			"fasttrack/fill-week",
		),
		saveDraft: await exactLegacyDigest(
			deps,
			input,
			"/manpowergroup-fasttrack360/domain-script-actions/save-draft.js",
			"fasttrack/fill-week",
		),
		verifySavedDraft: await exactLegacyDigest(
			deps,
			input,
			"/manpowergroup-fasttrack360/domain-script-actions/verify-saved-draft.js",
			"fasttrack/fill-week",
		),
	};
	const xeroDigests = {
		requestBankStatements: actionAssetDigest(
			XERO_BANKSTATEMENTS_REQUEST_ACTION_BYTES,
		),
		captureBankStatements: actionAssetDigest(
			XERO_BANKSTATEMENTS_CAPTURE_ACTION_BYTES,
		),
		postBankTransaction: await exactLegacyDigest(
			deps,
			input,
			"/playbooks/post-banktransaction.yaml",
			"xero/post-banktransaction",
		),
		reconcileBatch: await exactLegacyDigest(
			deps,
			input,
			"/playbooks/reconcile-batch.yaml",
			"xero/reconcile-batch",
		),
	};

	const definitions = new Map<string, BrowserUseRunbook>();
	const forcedInactiveReasons = new Map<string, string>();
	if (
		input.state.canonical_targets.some(
			(target) =>
				target.canonical_target_id === "oncore/timesheet-diagnose",
		)
	) {
		definitions.set(
			"oncore/timesheet-diagnose",
			buildOncoreTimesheetDiagnosisMigration({
				allowedOrigin: ONCORE_ORIGIN,
				sourceRelativePath: targetSources(
					input.state,
					"oncore/timesheet-diagnose",
				)[0] as string,
				actionDigest: diagnosisDigest,
			}).runbook,
		);
	}
	if (
		input.state.canonical_targets.some(
			(target) => target.canonical_target_id === "oncore/fill-timesheet",
		)
	) {
		const sources = targetSources(input.state, "oncore/fill-timesheet");
		const migration = buildOncoreSaveDraftMigration({
			allowedOrigin: ONCORE_ORIGIN,
			timesheetUrl: `${ONCORE_ORIGIN}/`,
			activeSourceRelativePath: sources[0] as string,
			supersededSourceRelativePaths: sources.slice(1),
			actionDigests: oncoreFillDigests,
		});
		definitions.set(
			"oncore/fill-timesheet",
			migration.runbook,
		);
		forcedInactiveReasons.set(
			"oncore/fill-timesheet",
			migration.activation_blocker,
		);
	}
	if (
		input.state.canonical_targets.some(
			(target) => target.canonical_target_id === "fasttrack/fill-week",
		)
	) {
		const sources = targetSources(input.state, "fasttrack/fill-week");
		definitions.set(
			"fasttrack/fill-week",
			buildFasttrackSaveDraftMigration({
				allowedOrigin: FASTTRACK_ORIGIN,
				activeSourceRelativePath: sources[0] as string,
				supersededSourceRelativePaths: sources.slice(1),
				actionDigests: fasttrackDigests,
			}).runbook,
		);
	}
	if (
		input.state.canonical_targets.some((target) =>
			target.canonical_target_id.startsWith("xero/"),
		)
	) {
		const xeroSources = input.state.canonical_targets
			.filter((target) => target.canonical_target_id.startsWith("xero/"))
			.flatMap((target) => target.source_relative_paths);
		const xero = buildXeroMigration({
			apiExplorerOrigin: XERO_API_EXPLORER_ORIGIN,
			goXeroOrigin: XERO_GO_ORIGIN,
			actionDigests: xeroDigests,
			sourceRelativePaths: [...new Set(xeroSources)].sort(),
		});
		for (const flow of [xero.extract, ...xero.stagedInactive]) {
			const normalized = { ...flow.runbook, service_id: "xero" };
			definitions.set(`xero/${flow.runbook.flow_id}`, normalized);
		}
	}

	const defaultActions =
		input.state.canonical_targets.some(
			(target) =>
				target.canonical_target_id === "xero/extract-bankstatementsplus",
		)
			? buildXeroActionCandidates({
					allowedOrigin: XERO_API_EXPLORER_ORIGIN,
					sourceProvenance: targetSources(
						input.state,
						"xero/extract-bankstatementsplus",
					)[0] as string,
				})
			: [];
	const actionsById = new Map(
		defaultActions.map((action) => [action.record.action_id, action]),
	);
	for (const action of input.actions ?? []) {
		actionsById.set(action.record.action_id, action);
	}
	const actions = [...actionsById.values()].sort((left, right) =>
		left.record.action_id.localeCompare(right.record.action_id),
	);
	const effectiveInput = { ...input, actions };
	const targets = input.state.canonical_targets
		.map((target) => {
			const definition = definitions.get(target.canonical_target_id);
			if (definition === undefined) {
				throw new Error(
					`Production composition lacks a builder definition for ${target.canonical_target_id}.`,
				);
			}
			return targetInput(
				target.canonical_target_id,
				definition,
				input.state,
				effectiveInput,
				forcedInactiveReasons.get(target.canonical_target_id),
			);
		})
		.sort((left, right) =>
			left.canonicalTargetId.localeCompare(right.canonicalTargetId),
		);

	return {
		state: input.state,
		sourceRoot: input.sourceRoot,
		generationId: input.generationId,
		shippedCatalogDigest: input.shippedCatalogDigest,
		targets,
		actions,
		authCandidates: [
			...(input.authCandidates ?? defaultAuthCandidates(input.state)),
		].sort((left, right) => left.candidate_id.localeCompare(right.candidate_id)),
		authRoutes: [...(input.authRoutes ?? [])].sort((left, right) =>
			left.authContextRef.localeCompare(right.authContextRef),
		),
	};
}
