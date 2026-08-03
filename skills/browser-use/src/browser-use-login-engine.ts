import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthBlockedCause,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";
import type {
	BrowserUseAccessibilityNode,
	BrowserUseAccessibilitySnapshot,
	BrowserUseCdpObserver,
} from "./browser-use-cdp-observer";
import {
	type BrowserUseDeliveryBlocked,
	type BrowserUseDeliveryHook,
	deliverConfidentialFields,
	type BrowserUseHumanChallenge,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import type {
	BrowserUseTargetProofInput,
	BrowserUseTargetProofResult,
} from "./browser-use-target-proof";

/**
 * Screen class produced from role, accessible name, and local AX structure.
 */
export type BrowserUseLoginStep =
	| "username"
	| "password"
	| "otp"
	| "submit"
	| "challenge"
	| "unknown";

/**
 * One confident classifier decision, or a fail-closed challenge/unknown result.
 */
export type BrowserUseLoginClassification =
	| {
			step: "username" | "password" | "otp";
			field: BrowserUseOpCredentialField;
			field_node: BrowserUseAccessibilityNode & { backend_node_id: number };
	  }
	| {
			step: "submit";
			control_node: BrowserUseAccessibilityNode & { backend_node_id: number };
	  }
	| { step: "challenge"; challenge: BrowserUseHumanChallenge }
	| { step: "unknown" };

/**
 * U3 target-proof boundary consumed immediately before each credential step.
 */
export type BrowserUseLoginTargetProof = (
	input: BrowserUseTargetProofInput,
) => Promise<BrowserUseTargetProofResult>;

export type BrowserUseAuthenticatedStateProofRecord = {
	target_id: string;
	page_id: string;
	frame_id: string;
	origin: string;
	subject_reference: string;
	account_reference: string;
	tenant_reference: string;
	identity_basis_digest: string;
};

export type BrowserUseAuthenticatedStateProof = (input: {
	lane_id: string;
	run_id: string;
	target_id: string;
	expected_url: string;
	allowed_origins: readonly string[];
	binding: BrowserUseItemBinding;
	snapshot: BrowserUseAccessibilitySnapshot;
	transition: "pre-existing-session" | "post-submit";
}) => Promise<
	| { proven: true; proof: BrowserUseAuthenticatedStateProofRecord }
	| {
			proven: false;
			cause:
				| "human-identity-attestation-required"
				| "session-identity-proof-unavailable"
				| "origin-mismatch"
				| "target-proof-invalid";
	  }
>;

export type BrowserUseLoginLifecycleEvent =
	| { type: "credential-delivered"; field: BrowserUseOpCredentialField }
	| { type: "username-advance-dispatching" }
	| { type: "credential-submit-dispatching" }
	| { type: "submit-outcome-observed"; outcome: "success" | "otp-required" | "timeout-unknown" };

export type BrowserUseLoginLifecycleJournal = (
	event: BrowserUseLoginLifecycleEvent,
) => Promise<
	| { ok: true }
	| { ok: false; cause: BrowserUseAuthBlockedCause }
>;

/**
 * Secret-free and custody boundaries required by the generic loop.
 */
export type BrowserUseLoginEngineDeps = {
	/** Main-process observer attached by CDP target id. */
	observer: BrowserUseCdpObserver;
	/** Fresh U3 target proof for the classified semantic field. */
	proveTarget: BrowserUseLoginTargetProof;
	/** Opaque-handle credential retrieval boundary. */
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	/** One-shot disposable delivery-child boundary. */
	deliver: BrowserUseDeliveryHook;
	/** Fresh auth-owned proof. Signed-in words alone never authorize `ready`. */
	proveAuthenticatedState?: BrowserUseAuthenticatedStateProof;
	/** Durable auth journal. Dispatching events run before control activation. */
	journal?: BrowserUseLoginLifecycleJournal;
	/** Bounded observation wait after trusted control activation. */
	waitForPostActivation?: () => Promise<void>;
};

/**
 * Per-run login declaration. Portal-specific selectors and field names have no
 * slot: only the approved binding and origin policy vary by portal.
 */
export type BrowserUseLoginEngineInput = {
	lane_id: string;
	run_id: string;
	target_id: string;
	expected_url: string;
	allowed_origins: readonly string[];
	binding: BrowserUseItemBinding;
	/** Bounded no-progress guard. @defaultValue 16 */
	max_iterations?: number;
};

/**
 * Secret-free trace entry retained for diagnostics and fixture proof.
 */
export type BrowserUseLoginTraceEntry = {
	step: Exclude<BrowserUseLoginStep, "challenge" | "unknown">;
	field?: BrowserUseOpCredentialField;
	backend_node_id: number;
};

/**
 * Generic login result with exactly one resumable blocked continuation on
 * failure. No branch can carry secret bytes.
 */
export type BrowserUseLoginEngineResult =
	| {
			ok: true;
			signed_in: true;
			authenticated_state: "pre-existing-session" | "post-submit";
			proof: BrowserUseAuthenticatedStateProofRecord;
			trace: readonly BrowserUseLoginTraceEntry[];
	  }
	| {
			ok: false;
			reason: "blocked" | "human-challenge" | "no-progress";
			blocked: BrowserUseDeliveryBlocked;
			trace: readonly BrowserUseLoginTraceEntry[];
	  };

const USERNAME_NAME = /\b(user(?:name)?|email|login|account|identifier|member)\b/i;
const PASSWORD_NAME = /\b(password|passphrase|secret phrase)\b/i;
const OTP_NAME =
	/\b(one[ -]?time|verification|authenticator|security code|otp|2fa|two[ -]?factor)\b/i;
const ADVANCE_NAME =
	/^(next|continue|proceed|sign[ -]?in|log[ -]?in|submit|verify|done)$/i;
const SIGNED_IN_NAME =
	/\b(signed[ -]?in|sign out|log out|dashboard|my account|welcome(?:,| ))\b/i;

function challengedBy(snapshot: BrowserUseAccessibilitySnapshot):
	| BrowserUseHumanChallenge
	| undefined {
	const text = snapshot.nodes
		.filter((node) => !node.ignored)
		.map((node) => node.accessible_name)
		.join(" ");
	if (/\b(captcha|not a robot|human verification)\b/i.test(text)) {
		return "captcha";
	}
	if (/\b(passkey|security key|fingerprint|face id|touch id)\b/i.test(text)) {
		return "passkey";
	}
	if (/\b(recovery code)\b/i.test(text)) return "recovery-code";
	if (
		/\b(consent|allow access|grant permission|accept terms|approve sign[ -]?in)\b/i.test(
			text,
		)
	) {
		return "consent";
	}
	return undefined;
}

function credentialFieldOf(name: string): BrowserUseOpCredentialField | undefined {
	if (OTP_NAME.test(name)) return "otp-current";
	if (PASSWORD_NAME.test(name)) return "password";
	if (USERNAME_NAME.test(name)) return "username";
	return undefined;
}

function credentialStepOf(
	field: BrowserUseOpCredentialField,
): "username" | "password" | "otp" {
	return field === "otp-current" ? "otp" : field;
}

function backendNode(
	node: BrowserUseAccessibilityNode,
): (BrowserUseAccessibilityNode & { backend_node_id: number }) | undefined {
	return node.backend_node_id === undefined
		? undefined
		: (node as BrowserUseAccessibilityNode & { backend_node_id: number });
}

function advanceControls(
	snapshot: BrowserUseAccessibilitySnapshot,
): Array<BrowserUseAccessibilityNode & { backend_node_id: number }> {
	return snapshot.nodes.flatMap((node) => {
		const withBackend = backendNode(node);
		return !node.ignored &&
			node.role.toLowerCase() === "button" &&
			ADVANCE_NAME.test(node.accessible_name.trim()) &&
			node.properties.disabled !== true &&
			withBackend !== undefined
			? [withBackend]
			: [];
	});
}

function structuralField(
	snapshot: BrowserUseAccessibilitySnapshot,
	fields: Array<BrowserUseAccessibilityNode & { backend_node_id: number }>,
): BrowserUseOpCredentialField | undefined {
	if (fields.length !== 1) return undefined;
	const context = snapshot.nodes
		.filter((node) => !node.ignored && node !== fields[0])
		.map((node) => node.accessible_name)
		.join(" ");
	const contextual = credentialFieldOf(context);
	if (contextual !== undefined) return contextual;
	const controls = advanceControls(snapshot);
	const field = fields.at(0);
	if (field === undefined) return undefined;
	const nextControls = controls.filter(
		(control) =>
			control.accessible_name.trim().toLowerCase() === "next" &&
			(control.parent_id === field.parent_id ||
				snapshot.nodes.find((node) => node.node_id === field.parent_id)?.child_ids
					?.includes(control.node_id) === true),
	);
	return nextControls.length === 1 ? "username" : undefined;
}

/**
 * Classify one login screen without portal selectors or a hardcoded step order.
 *
 * Named fields use role plus accessible name. A lone unlabelled textbox falls
 * back to surrounding AX text, or to a sibling `Next` control for a
 * username-first screen. Ambiguity returns `unknown` before delivery.
 *
 * @param snapshot - Fresh full accessibility-tree projection
 * @param deliveredBackendNodeIds - Fields already delivered on this unchanged screen
 * @param deliveredCredentialFields - Credential kinds already delivered in this transaction
 * @returns One confident credential/control/challenge class, or `unknown`
 *
 * @example
 * ```typescript
 * const classification = classifyBrowserUseLoginStep(snapshot)
 * if (classification.step === 'password') {
 *   // re-prove origin, then deliver `classification.field`
 * }
 * ```
 */
export function classifyBrowserUseLoginStep(
	snapshot: BrowserUseAccessibilitySnapshot,
	deliveredBackendNodeIds: ReadonlySet<number> = new Set(),
	deliveredCredentialFields: ReadonlySet<BrowserUseOpCredentialField> = new Set(),
): BrowserUseLoginClassification {
	const challenge = challengedBy(snapshot);
	if (challenge !== undefined) return { step: "challenge", challenge };

	const fields = snapshot.nodes.flatMap((node) => {
		const withBackend = backendNode(node);
		return !node.ignored &&
			(node.role.toLowerCase() === "textbox" ||
				node.role.toLowerCase() === "searchbox") &&
			node.properties.disabled !== true &&
			withBackend !== undefined &&
			!deliveredBackendNodeIds.has(withBackend.backend_node_id)
			? [withBackend]
			: [];
	});
	const classified = fields.map((field) => ({
		field,
		credential: credentialFieldOf(field.accessible_name),
	}));
	const available = classified.filter(
		(item) =>
			item.credential === undefined ||
			!deliveredCredentialFields.has(item.credential),
	);
	const named = available.filter(
		(
			item,
		): item is {
			field: BrowserUseAccessibilityNode & { backend_node_id: number };
			credential: BrowserUseOpCredentialField;
		} => item.credential !== undefined,
	);
	if (named.length > 0) {
		const first =
			named.find((candidate) => candidate.credential === "username") ??
			named.find((candidate) => candidate.credential === "password") ??
			named.find((candidate) => candidate.credential === "otp-current");
		if (first === undefined) return { step: "unknown" };
		if (
			named.filter((candidate) => candidate.credential === first.credential)
				.length > 1
		) {
			return { step: "unknown" };
		}
		return {
			step: credentialStepOf(first.credential),
			field: first.credential,
			field_node: first.field,
		};
	}
	const availableFields = available.map((item) => item.field);
	if (availableFields.length > 0) {
		const structural = structuralField(snapshot, availableFields);
		const field = availableFields.at(0);
		if (
			structural === undefined ||
			field === undefined ||
			deliveredCredentialFields.has(structural)
		) {
			return { step: "unknown" };
		}
		return {
			step: credentialStepOf(structural),
			field: structural,
			field_node: field,
		};
	}

	const controls = advanceControls(snapshot);
	const control = controls.length === 1 ? controls.at(0) : undefined;
	return control === undefined
		? { step: "unknown" }
		: { step: "submit", control_node: control };
}

function authenticatedStateCandidate(
	snapshot: BrowserUseAccessibilitySnapshot,
	submitted: boolean,
): boolean {
	const hasCredentialField = snapshot.nodes.some(
		(node) =>
			!node.ignored &&
			(node.role.toLowerCase() === "textbox" ||
				node.role.toLowerCase() === "searchbox") &&
			credentialFieldOf(node.accessible_name) !== undefined,
	);
	if (
		hasCredentialField ||
		advanceControls(snapshot).length > 0 ||
		challengedBy(snapshot) !== undefined
	) {
		return false;
	}
	if (submitted) return true;
	return snapshot.nodes.some(
		(node) =>
			!node.ignored &&
			["heading", "status", "link", "button"].includes(
				node.role.toLowerCase(),
			) &&
			SIGNED_IN_NAME.test(node.accessible_name),
	);
}

function fingerprint(snapshot: BrowserUseAccessibilitySnapshot): string {
	return JSON.stringify(
		snapshot.nodes.map((node) => [
			node.node_id,
			node.backend_node_id ?? null,
			node.role,
			node.accessible_name,
			node.ignored,
			node.properties.disabled ?? null,
		]),
	);
}

function blocked(cause: BrowserUseAuthBlockedCause): BrowserUseDeliveryBlocked {
	return {
		blocked_cause: cause,
		continuation: structuredClone(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
		),
		external_effect_possible: false,
		fields_cleared: false,
	};
}

function failed(
	reason: "blocked" | "human-challenge" | "no-progress",
	cause: BrowserUseAuthBlockedCause,
	trace: readonly BrowserUseLoginTraceEntry[],
): BrowserUseLoginEngineResult {
	return { ok: false, reason, blocked: blocked(cause), trace: [...trace] };
}

function normalizedOrigin(value: string): string | undefined {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.origin
			: undefined;
	} catch {
		return undefined;
	}
}

function originPolicyIsBound(input: BrowserUseLoginEngineInput): boolean {
	const bindingOrigins = new Set(
		input.binding.allowed_origins.flatMap((value) => {
			const origin = normalizedOrigin(value);
			return origin === undefined ? [] : [origin];
		}),
	);
	const declaredOrigins = input.allowed_origins.flatMap((value) => {
		const origin = normalizedOrigin(value);
		return origin === undefined ? [] : [origin];
	});
	const expectedOrigin = normalizedOrigin(input.expected_url);
	return (
		expectedOrigin !== undefined &&
		declaredOrigins.length === input.allowed_origins.length &&
		declaredOrigins.includes(expectedOrigin) &&
		declaredOrigins.every((origin) => bindingOrigins.has(origin))
	);
}

/**
 * Run the bounded snapshot, classify, deliver, and trusted-advance loop.
 *
 * Each credential classification is independently proven through U3, then
 * delivered through the existing custody choreography. The choreography
 * re-proves the target immediately before minting each opaque handle. Human
 * challenges, ambiguity, origin drift, and unchanged post-activation screens
 * all return a resumable continuation with no automatic retry.
 *
 * @param deps - Observer, U3 proof, opaque retrieval, and delivery-child seams
 * @param input - Binding, allowed origins, exact target, and run identity
 * @returns Signed-in truth or one fail-closed resumable outcome
 *
 * @example
 * ```typescript
 * const result = await runBrowserUseLoginEngine(deps, {
 *   lane_id: 'agent-browser',
 *   run_id: 'run-7',
 *   target_id: 'target-7',
 *   expected_url: 'https://portal.example/login',
 *   allowed_origins: ['https://portal.example'],
 *   binding,
 * })
 * ```
 */
export async function runBrowserUseLoginEngine(
	deps: BrowserUseLoginEngineDeps,
	input: BrowserUseLoginEngineInput,
): Promise<BrowserUseLoginEngineResult> {
	const trace: BrowserUseLoginTraceEntry[] = [];
	if (!originPolicyIsBound(input)) {
		return failed("blocked", "origin-mismatch", trace);
	}
	const deliveredBackendNodeIds = new Set<number>();
	const deliveredCredentialFields = new Set<BrowserUseOpCredentialField>();
	let activationFingerprint: string | undefined;
	let awaitingActivationTransition = false;
	let postActivationWaits = 0;
	let submitted = false;
	let awaitingSubmitOutcome = false;
	const deliveredSinceActivation = new Set<BrowserUseOpCredentialField>();
	const maxIterations = input.max_iterations ?? 16;
	const waitForActivationTransition = async (): Promise<boolean> => {
		if (
			!awaitingActivationTransition ||
			postActivationWaits >= 10 ||
			deps.waitForPostActivation === undefined
		) {
			return false;
		}
		postActivationWaits += 1;
		await deps.waitForPostActivation();
		return true;
	};

	for (let iteration = 0; iteration < maxIterations; iteration += 1) {
		const observed = await deps.observer.snapshot({
			target_id: input.target_id,
		});
		if (!observed.ok) {
			return failed("blocked", "target-proof-invalid", trace);
		}
		// Serialized only when a prior submit set a fingerprint to compare
		// against, or when a submit is about to record one (below).
		const currentFingerprint =
			activationFingerprint === undefined
				? undefined
				: fingerprint(observed.snapshot);
		if (authenticatedStateCandidate(observed.snapshot, submitted)) {
			if (awaitingSubmitOutcome) {
				const journaled = await deps.journal?.({
					type: "submit-outcome-observed",
					outcome: "success",
				});
				if (journaled?.ok === false) return failed("blocked", journaled.cause, trace);
				awaitingSubmitOutcome = false;
			}
			const transition = submitted ? "post-submit" : "pre-existing-session";
			const proof = await deps.proveAuthenticatedState?.({
				lane_id: input.lane_id,
				run_id: input.run_id,
				target_id: input.target_id,
				expected_url: input.expected_url,
				allowed_origins: input.allowed_origins,
				binding: input.binding,
				snapshot: observed.snapshot,
				transition,
			});
			if (proof?.proven !== true) {
				return failed(
					"human-challenge",
					proof?.cause ?? "human-identity-attestation-required",
					trace,
				);
			}
			return {
				ok: true,
				signed_in: true,
				authenticated_state: transition,
				proof: proof.proof,
				trace,
			};
		}
		if (
			activationFingerprint !== undefined &&
			activationFingerprint === currentFingerprint
		) {
			if (await waitForActivationTransition()) continue;
			return failed(
				"no-progress",
				"human-identity-attestation-required",
				trace,
			);
		}
		activationFingerprint = undefined;

		const classification = classifyBrowserUseLoginStep(
			observed.snapshot,
			deliveredBackendNodeIds,
			deliveredCredentialFields,
		);
		if (
			awaitingActivationTransition &&
			(classification.step === "unknown" || classification.step === "submit")
		) {
			if (await waitForActivationTransition()) continue;
			return failed(
				"no-progress",
				"human-identity-attestation-required",
				trace,
			);
		}
		awaitingActivationTransition = false;
		if (
			awaitingSubmitOutcome &&
			classification.step === "otp"
		) {
			const journaled = await deps.journal?.({
				type: "submit-outcome-observed",
				outcome: "otp-required",
			});
			if (journaled?.ok === false) return failed("blocked", journaled.cause, trace);
			awaitingSubmitOutcome = false;
		}
		if (
			awaitingSubmitOutcome &&
			classification.step === "submit" &&
			!(deliveredSinceActivation.has("password") || deliveredSinceActivation.has("otp-current"))
		) {
			// A username advance while still awaiting the submit outcome would map to
			// submit-username, an illegal transition in write-ahead-submission that the
			// journal rejects while awaitingSubmitOutcome never clears. Record the
			// unknown post-submit effect first, then block for inspection instead of
			// dispatching the illegal advance.
			const journaled = await deps.journal?.({
				type: "submit-outcome-observed",
				outcome: "timeout-unknown",
			});
			if (journaled?.ok === false) return failed("blocked", journaled.cause, trace);
			awaitingSubmitOutcome = false;
			return failed("human-challenge", "human-identity-attestation-required", trace);
		}
		if (classification.step === "challenge") {
			return failed("human-challenge", "user-presence-required", trace);
		}
		if (classification.step === "unknown") {
			return failed(
				"human-challenge",
				"human-identity-attestation-required",
				trace,
			);
		}
		if (classification.step === "submit") {
			const credentialSubmit =
				deliveredSinceActivation.has("password") ||
				deliveredSinceActivation.has("otp-current");
			const journaled = await deps.journal?.({
				type: credentialSubmit
					? "credential-submit-dispatching"
					: "username-advance-dispatching",
			});
			if (journaled?.ok === false) return failed("blocked", journaled.cause, trace);
			const activated = await deps.observer.activateControl({
				target_id: input.target_id,
				backend_node_id: classification.control_node.backend_node_id,
			});
			if (!activated.ok) {
				return failed("blocked", "target-proof-invalid", trace);
			}
			trace.push({
				step: "submit",
				backend_node_id: classification.control_node.backend_node_id,
			});
			submitted ||= credentialSubmit;
			awaitingSubmitOutcome = credentialSubmit;
			deliveredSinceActivation.clear();
			deliveredBackendNodeIds.clear();
			activationFingerprint =
				currentFingerprint ?? fingerprint(observed.snapshot);
			awaitingActivationTransition = true;
			postActivationWaits = 0;
			continue;
		}

		const proof = await deps.proveTarget({
			lane_id: input.lane_id,
			run_id: input.run_id,
			expected_url: input.expected_url,
			allowed_origins: input.allowed_origins,
			binding: input.binding,
			field: {
				role: classification.field_node.role,
				accessible_name: classification.field_node.accessible_name,
			},
		});
		if (!proof.ok) return failed("blocked", proof.cause, trace);
		if (
			proof.target.target_id !== input.target_id ||
			proof.target.field.backend_node_id !==
				classification.field_node.backend_node_id ||
			proof.target.field.role !== classification.field_node.role ||
			proof.target.field.accessible_name !==
				classification.field_node.accessible_name
		) {
			return failed("blocked", "target-proof-invalid", trace);
		}
		const delivered = await deliverConfidentialFields({
			binding: input.binding,
			target: proof.target,
			fields: [classification.field],
			tokenRetrieval: deps.tokenRetrieval,
			deliver: deps.deliver,
			reproveTarget: proof.reproveTarget,
		});
		if (!delivered.ok) {
			return {
				ok: false,
				reason: "blocked",
				blocked: delivered.blocked,
				trace,
			};
		}
		deliveredBackendNodeIds.add(
			classification.field_node.backend_node_id,
		);
		deliveredCredentialFields.add(classification.field);
		deliveredSinceActivation.add(classification.field);
		const journaled = await deps.journal?.({
			type: "credential-delivered",
			field: classification.field,
		});
		if (journaled?.ok === false) return failed("blocked", journaled.cause, trace);
		trace.push({
			step: classification.step,
			field: classification.field,
			backend_node_id: classification.field_node.backend_node_id,
		});
	}

	return failed(
		"no-progress",
		"human-identity-attestation-required",
		trace,
	);
}
