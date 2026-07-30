import { createHash } from "node:crypto";
import { createBrowserUseAuthBindingStore } from "./browser-use-auth-binding-store";
import type {
	BrowserUseAuthLaneAdmission,
	BrowserUseItemBinding,
	BrowserUseResolvedAuthCandidate,
} from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthStatusProofCoordinates,
	authStatusProofCoordinatesForBinding,
	createBrowserUseAuthProvider,
} from "./browser-use-auth-provider";
import {
	type BrowserUseGenerationRuntime,
	createBrowserUseGenerationRuntime,
} from "./browser-use-generation-runtime";
import {
	readActiveCorpusManifest,
	readBrowserUseMigrationStatus,
} from "./browser-use-migration";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import type { RunStoreDeps } from "./browser-use-runs";
import { attestationByDigestFrom } from "./browser-use-runs";

export type BrowserUseAuthStatusGenerationCapture =
	| { status: "missing" }
	| { status: "invalid" }
	| { status: "present"; runtime: BrowserUseGenerationRuntime };

export type BrowserUseAuthStatusBindingInspection =
	| { state: "missing" | "stale" | "invalid" }
	| { state: "ready"; binding_receipt_digest: string };

type BrowserUseAuthStatusBindingOptions = {
	proofCoordinates: BrowserUseAuthStatusProofCoordinates;
	captureGeneration?: (
		deps: RunStoreDeps,
	) => Promise<BrowserUseAuthStatusGenerationCapture>;
};

function sha256(parts: readonly string[]): string {
	return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");
}

async function captureActiveGeneration(
	deps: RunStoreDeps,
): Promise<BrowserUseAuthStatusGenerationCapture> {
	const status = await readBrowserUseMigrationStatus(deps);
	if (!status.ok) return { status: "invalid" };
	const active = await readActiveCorpusManifest(deps);
	if (active.status === "missing") return { status: "missing" };
	if (active.status === "corrupt") return { status: "invalid" };
	const opened = await createBrowserUseGenerationRuntime(deps, active.manifest);
	return opened.ok
		? { status: "present", runtime: opened.runtime }
		: { status: "invalid" };
}

function bindingReceiptDigest(input: {
	resolution: BrowserUseResolvedAuthCandidate;
	binding: BrowserUseItemBinding;
	requiredMethod: "password";
	reviewedOrigins: readonly string[];
}): string {
	const { resolution, binding } = input;
	return sha256([
		"browser-use.auth-status.binding-receipt.v1",
		resolution.generation_id,
		String(resolution.activation_epoch),
		resolution.auth_context_ref,
		resolution.route_digest,
		resolution.candidate.candidate_id,
		resolution.candidate_digest,
		resolution.candidate.service_id,
		resolution.candidate.auth_context,
		input.requiredMethod,
		...input.reviewedOrigins,
		binding.service_id,
		binding.service_account_id,
		binding.auth_context,
		...binding.allowed_origins,
		...binding.allowed_login_paths,
		binding.vault_id,
		binding.item_id,
		String(binding.item_revision),
		...binding.allowed_auth_methods,
		String(binding.binding_revision),
	]);
}

function blockedState(
	cause: string,
	hadCachedBinding: boolean,
): "missing" | "stale" | "invalid" {
	return cause === "revoked-binding"
		? hadCachedBinding
			? "stale"
			: "missing"
		: cause === "ambiguous-binding-selection" ||
				cause === "unsupported-method" ||
				cause === "capability-loss" ||
				cause === "invalid-vault-scope" ||
				cause === "missing-token"
			? "invalid"
			: "invalid";
}

function exactRouteAuthority(
	runtime: BrowserUseGenerationRuntime,
): "missing" | "invalid" | readonly string[] {
	const routeRefs = runtime.manifest.auth.routes;
	const candidateRefs = runtime.manifest.auth.candidates;
	if (routeRefs.length === 0 && candidateRefs.length === 0) return "missing";
	if (
		routeRefs.length === 0 ||
		routeRefs.length !== candidateRefs.length ||
		new Set(routeRefs.map((route) => route.auth_context_ref)).size !==
			routeRefs.length ||
		new Set(routeRefs.map((route) => route.candidate_id)).size !==
			routeRefs.length ||
		new Set(candidateRefs.map((candidate) => candidate.candidate_id)).size !==
			candidateRefs.length
	) {
		return "invalid";
	}
	const candidates = new Set(
		candidateRefs.map((candidate) => candidate.candidate_id),
	);
	if (routeRefs.some((route) => !candidates.has(route.candidate_id))) {
		return "invalid";
	}
	return routeRefs
		.map((route) => route.auth_context_ref)
		.sort((left, right) => left.localeCompare(right));
}

/**
 * Re-prove every active generation auth route using metadata only.
 *
 * The binding cache is a hint. Missing cache state triggers read-only unique
 * discovery; present cache state triggers an exact item read. This command
 * never saves, invalidates, or retrieves a protected field.
 */
export async function inspectBrowserUseAuthStatusBinding(
	deps: RunStoreDeps,
	admission: Exclude<
		BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>,
		{ kind: "blocked" }
	>,
	options: BrowserUseAuthStatusBindingOptions,
): Promise<BrowserUseAuthStatusBindingInspection> {
	const captured = await (
		options.captureGeneration ?? captureActiveGeneration
	)(deps);
	if (captured.status !== "present") return { state: captured.status };
	const contexts = exactRouteAuthority(captured.runtime);
	if (contexts === "missing" || contexts === "invalid") {
		return { state: contexts };
	}

	const bindingStore = createBrowserUseAuthBindingStore({
		paths: deps.paths,
	});
	const provider = createBrowserUseAuthProvider({
		store: deps,
		admission,
		attestationByDigest: attestationByDigestFrom(deps),
	});
	const routeDigests: string[] = [];
	for (const authContextRef of contexts) {
		const loadedCandidate =
			await captured.runtime.authGenerationSeam.loadAuthCandidate(
				authContextRef,
			);
		if (!loadedCandidate.ok) return { state: "invalid" };
		const resolution = loadedCandidate.resolution;
		if (
			resolution.auth_context_ref !== authContextRef ||
			resolution.route === undefined ||
			!("session_policy" in resolution.route)
		) {
			return { state: "invalid" };
		}
		const reviewedOrigins = [
			...new Set([
				...resolution.route.session_policy.approved_service_origins,
				...resolution.route.session_policy
					.approved_identity_provider_origins,
			]),
		].sort((left, right) => left.localeCompare(right));
		const cached = await bindingStore.load(resolution);
		if (!cached.ok) {
			return {
				state:
					cached.failure.code === "auth_binding_cache_stale"
						? "stale"
						: "invalid",
			};
		}
		const prepared = await provider.prepareSecretFree({
			service_id: resolution.candidate.service_id,
			auth_context: resolution.candidate.auth_context,
			target_origins: reviewedOrigins,
			login_path: null,
			method: "password",
			binding: cached.binding,
			candidate_hint: {
				hint_item_id: resolution.candidate.hint_item_id,
				legacy_vault_name: resolution.candidate.legacy_vault_name,
			},
		});
		if (!prepared.ok) {
			return {
				state: blockedState(
					prepared.event.cause,
					cached.binding !== null,
				),
			};
		}
		if (prepared.binding === null) return { state: "invalid" };
		const liveCoordinates = authStatusProofCoordinatesForBinding(
			admission,
			prepared.binding,
		);
		if (
			liveCoordinates.lane_digest !==
				options.proofCoordinates.lane_digest ||
			liveCoordinates.principal_digest !==
				options.proofCoordinates.principal_digest ||
			liveCoordinates.vault_digest !==
				options.proofCoordinates.vault_digest ||
			liveCoordinates.profile_digest !==
				options.proofCoordinates.profile_digest
		) {
			return { state: "invalid" };
		}
		routeDigests.push(
			bindingReceiptDigest({
				resolution,
				binding: prepared.binding,
				requiredMethod: "password",
				reviewedOrigins,
			}),
		);
	}

	return {
		state: "ready",
		binding_receipt_digest: sha256([
			"browser-use.auth-status.binding-set-receipt.v1",
			...routeDigests,
		]),
	};
}
