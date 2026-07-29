import { createHash } from "node:crypto";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import { generationFilePath, type RetentionDeps } from "./browser-use-retention";
import type {
	BrowserUseCorpusGenerationCandidatePayload,
	BrowserUseCorpusGenerationManifestPayload,
	BrowserUseCorpusGenerationTarget,
} from "./browser-use-schemas";
import type {
	BrowserUseActionGenerationSeam,
	BrowserUseReviewedActionRecord,
} from "./browser-use-runbook-actions";
import {
	type BrowserUseAuthGenerationFailure,
	type BrowserUseAuthGenerationSeam,
	type BrowserUseImportCandidate,
	validateImportCandidateShape,
} from "./browser-use-auth-bindings";
import { parseGenerationAuthRouteRecord } from "./browser-use-generation-schemas";
import {
	type BrowserUseActiveGenerationSeam,
	type BrowserUseGenerationBindingIdentity,
	type BrowserUseRunbookDiscoveryFailure,
	shippedRunbooksRoot,
} from "./browser-use-runbook";
import {
	parseRunbookRecord,
	validateRunbook,
} from "./browser-use-runbook-model";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function failure(
	code: BrowserUseRunbookDiscoveryFailure["code"],
	message: string,
): BrowserUseRunbookDiscoveryFailure {
	return { code, message };
}

function authFailure(
	code: BrowserUseAuthGenerationFailure["code"],
	message: string,
): BrowserUseAuthGenerationFailure {
	return { code, message };
}

function targetId(target: BrowserUseCorpusGenerationTarget): {
	serviceId: string;
	flowId: string;
} | undefined {
	const parts = target.canonical_target_id.split("/");
	return parts.length === 2 &&
		parts[0] !== undefined &&
		parts[1] !== undefined
		? { serviceId: parts[0], flowId: parts[1] }
		: undefined;
}

async function readBoundText(
	fs: BrowserUsePlatformFs,
	path: string,
	expectedDigest: string,
): Promise<string | undefined> {
	try {
		const raw = await fs.readTextFile(path);
		return sha256(raw) === expectedDigest ? raw : undefined;
	} catch {
		return undefined;
	}
}

/** Fields needed to resolve either the active or one retained generation. */
export type BrowserUseRuntimeGenerationManifest =
	Omit<BrowserUseCorpusGenerationCandidatePayload, "contract"> & {
		contract:
			| BrowserUseCorpusGenerationCandidatePayload["contract"]
			| BrowserUseCorpusGenerationManifestPayload["contract"];
		generation_content_hash: string;
		candidate_manifest_digest: string;
		activation_epoch: number;
	};

/** One command-scoped runtime view over an immutable Corpus Generation. */
export type BrowserUseGenerationRuntime = {
	manifest: BrowserUseRuntimeGenerationManifest;
	activeGenerationSeam: BrowserUseActiveGenerationSeam;
	actionGenerationSeam: BrowserUseActionGenerationSeam;
	authGenerationSeam: BrowserUseAuthGenerationSeam;
	bindingIdentityFor(id: {
		serviceId: string;
		flowId: string;
	}): BrowserUseGenerationBindingIdentity | BrowserUseRunbookDiscoveryFailure;
};

/** Typed generation-runtime open result. */
export type BrowserUseGenerationRuntimeResult =
	| { ok: true; runtime: BrowserUseGenerationRuntime }
	| { ok: false; failure: BrowserUseRunbookDiscoveryFailure };

/**
 * Capture one immutable manifest as the authority for a complete command.
 *
 * The shipped digest is re-proved before current-generation use. Every
 * generation record and action asset is then read only through a path and
 * digest named by this captured manifest. No legacy path participates.
 */
export async function createBrowserUseGenerationRuntime(
	deps: Pick<RetentionDeps, "fs" | "paths">,
	manifest:
		| BrowserUseCorpusGenerationManifestPayload
		| BrowserUseRuntimeGenerationManifest,
	options: { verifyShippedCatalog?: boolean } = {},
): Promise<BrowserUseGenerationRuntimeResult> {
	if (options.verifyShippedCatalog !== false) {
		let currentShippedDigest: string;
		try {
			currentShippedDigest = await shippedCatalogDigest(
				shippedRunbooksRoot(),
				deps.fs,
			);
		} catch {
			return {
				ok: false,
				failure: failure(
					"runbook_catalog_drift",
					"the shipped runbook catalog is unavailable.",
				),
			};
		}
		if (currentShippedDigest !== manifest.shipped_catalog_digest) {
			return {
				ok: false,
				failure: failure(
					"runbook_catalog_drift",
					"the shipped runbook catalog no longer matches the active generation.",
				),
			};
		}
	}

	const targets = new Map(
		manifest.canonical_targets.map((target) => [
			target.canonical_target_id,
			target,
		]),
	);
	const actions = new Map(
		manifest.action_registry.actions.map((action) => [action.action_id, action]),
	);
	const assets = new Map(
		manifest.action_registry.actions.map((action) => [
			action.asset_digest,
			action,
		]),
	);

	const authGenerationSeam: BrowserUseAuthGenerationSeam = {
		async loadAuthCandidate(authContextRef) {
			const routeRefs = manifest.auth.routes.filter(
				(ref) => ref.auth_context_ref === authContextRef,
			);
			const routeRef = routeRefs[0];
			if (routeRefs.length === 0 || routeRef === undefined) {
				return {
					ok: false,
					failure: authFailure(
						"auth_route_not_found",
						"the captured generation has no auth route for this context.",
					),
				};
			}
			if (routeRefs.length !== 1) {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_invalid",
						"the captured generation has ambiguous auth route authority.",
					),
				};
			}
			const routeRaw = await readBoundText(
				deps.fs,
				generationFilePath(
					deps.paths,
					manifest.generation_id,
					routeRef.path,
				),
				routeRef.digest,
			);
			if (routeRaw === undefined) {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_corrupt",
						"the captured generation auth route is unreadable or digest-mismatched.",
					),
				};
			}
			let routeValue: unknown;
			try {
				routeValue = JSON.parse(routeRaw);
			} catch {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_corrupt",
						"the captured generation auth route is not valid JSON.",
					),
				};
			}
			const route = parseGenerationAuthRouteRecord(routeValue);
			if (
				route === undefined ||
				route.auth_context_ref !== routeRef.auth_context_ref ||
				route.candidate_id !== routeRef.candidate_id
			) {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_invalid",
						"the captured generation auth route does not match its manifest identity.",
					),
				};
			}

			const candidateRefs = manifest.auth.candidates.filter(
				(ref) => ref.candidate_id === route.candidate_id,
			);
			const candidateRef = candidateRefs[0];
			if (candidateRefs.length !== 1 || candidateRef === undefined) {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_invalid",
						"the captured generation auth candidate authority is missing or ambiguous.",
					),
				};
			}
			const candidateRaw = await readBoundText(
				deps.fs,
				generationFilePath(
					deps.paths,
					manifest.generation_id,
					candidateRef.path,
				),
				candidateRef.digest,
			);
			if (candidateRaw === undefined) {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_corrupt",
						"the captured generation auth candidate is unreadable or digest-mismatched.",
					),
				};
			}
			let candidateValue: unknown;
			try {
				candidateValue = JSON.parse(candidateRaw);
			} catch {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_corrupt",
						"the captured generation auth candidate is not valid JSON.",
					),
				};
			}
			if (
				validateImportCandidateShape(candidateValue).length > 0 ||
				(candidateValue as { candidate_id?: unknown }).candidate_id !==
					candidateRef.candidate_id
			) {
				return {
					ok: false,
					failure: authFailure(
						"auth_generation_record_invalid",
						"the captured generation auth candidate does not match its manifest identity.",
					),
				};
			}
			return {
				ok: true,
				resolution: {
					generation_id: manifest.generation_id,
					activation_epoch: manifest.activation_epoch,
					auth_context_ref: route.auth_context_ref,
					route_digest: routeRef.digest,
					candidate_digest: candidateRef.digest,
					candidate: candidateValue as BrowserUseImportCandidate,
				},
			};
		},
	};

	const activeGenerationSeam: BrowserUseActiveGenerationSeam = {
		async listIds() {
			return manifest.canonical_targets.flatMap((target) => {
				if (target.activation !== "active") return [];
				const id = targetId(target);
				return id === undefined ? [] : [id];
			});
		},
		async loadRunbook(id) {
			const target = targets.get(`${id.serviceId}/${id.flowId}`);
			if (target === undefined) return { ok: false, absent: true };
			if (target.activation !== "active") {
				return {
					ok: false,
					absent: false,
					failure: failure(
						"runbook_inactive",
						"the requested runbook is staged inactive and cannot execute.",
					),
				};
			}
			const raw = await readBoundText(
				deps.fs,
				generationFilePath(
					deps.paths,
					manifest.generation_id,
					target.runbook_path,
				),
				target.runbook_digest,
			);
			if (raw === undefined) {
				return {
					ok: false,
					absent: false,
					failure: failure(
						"runbook_record_corrupt",
						"the active generation runbook is unreadable or digest-mismatched.",
					),
				};
			}
			let value: unknown;
			try {
				value = JSON.parse(raw);
			} catch {
				return {
					ok: false,
					absent: false,
					failure: failure(
						"runbook_record_corrupt",
						"the active generation runbook is not valid JSON.",
					),
				};
			}
			const parsed = parseRunbookRecord(value);
			if (!parsed.ok) {
				return {
					ok: false,
					absent: false,
					failure: failure(
						"runbook_record_invalid",
						`the active generation runbook shape is invalid (${parsed.issue.code}).`,
					),
				};
			}
			const issues = validateRunbook(parsed.runbook);
			if (
				issues.length > 0 ||
				parsed.runbook.service_id !== id.serviceId ||
				parsed.runbook.flow_id !== id.flowId
			) {
				return {
					ok: false,
					absent: false,
					failure: failure(
						"runbook_record_invalid",
						"the active generation runbook does not match its manifest identity.",
					),
				};
			}
			return { ok: true, runbook: parsed.runbook, health: "healthy" };
		},
	};

	const actionGenerationSeam: BrowserUseActionGenerationSeam = {
		async loadActionRecord(actionId) {
			const ref = actions.get(actionId);
			if (ref === undefined) return { ok: false, absent: true };
			const raw = await readBoundText(
				deps.fs,
				generationFilePath(
					deps.paths,
					manifest.generation_id,
					ref.record_path,
				),
				ref.record_digest,
			);
			if (raw === undefined) return { ok: false, absent: true };
			try {
				const record = JSON.parse(raw) as BrowserUseReviewedActionRecord;
				return record.action_id === actionId
					? { ok: true, record }
					: { ok: false, absent: true };
			} catch {
				return { ok: false, absent: true };
			}
		},
		async loadActionAssetBytes(assetId) {
			const ref = assets.get(assetId);
			if (ref === undefined) {
				return { ok: false, reason: "bytes_unavailable" };
			}
			const bytes = await readBoundText(
				deps.fs,
				generationFilePath(
					deps.paths,
					manifest.generation_id,
					ref.asset_path,
				),
				ref.asset_digest,
			);
			return bytes === undefined
				? { ok: false, reason: "bytes_unavailable" }
				: { ok: true, bytes };
		},
	};

	return {
		ok: true,
		runtime: {
			manifest,
			activeGenerationSeam,
			actionGenerationSeam,
			authGenerationSeam,
			bindingIdentityFor(id) {
				const target = targets.get(`${id.serviceId}/${id.flowId}`);
				if (target === undefined) {
					return failure(
						"runbook_not_found",
						"the requested runbook is not declared by this generation.",
					);
				}
				if (target.activation !== "active") {
					return failure(
						"runbook_inactive",
						"the requested runbook is staged inactive and cannot execute.",
					);
				}
				return {
					generation_id: manifest.generation_id,
					activation_epoch: manifest.activation_epoch,
					runbook_digest: target.runbook_digest,
					action_registry_digest:
						manifest.action_registry.registry_digest,
				};
			},
		},
	};
}
