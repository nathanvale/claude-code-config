/**
 * Reviewed Action authoring contract — throwaway logic spike (no browser).
 *
 * Falsifies whether an agent can discover, author, validate, and apply custom
 * business JavaScript while an EXTERNAL human promotion remains the sole
 * authority that makes the exact digest referenceable by a Runbook (ADR 0033).
 *
 * Reuses the SHIPPED action mechanics (content-addressing digest + mechanical
 * effect audit) rather than reinventing them — proving the authoring contract
 * layers cleanly on top of `browser-use-runbook-actions.ts`.
 *
 * Run: `bun run prototype:reviewed-action-authoring`
 */

import {
	actionAssetDigest,
	actionDigestIsValid,
	auditActionEffectClass,
	BROWSER_USE_ACTION_EFFECT_CLASSES,
	ONCORE_DRAFT_VERIFICATION_ACTION_BYTES,
	type BrowserUseActionEffectClass,
} from "../../browser-use-runbook-actions";

// ---------------------------------------------------------------------------
// Machine-readable action authoring schema (`action schema --json`).
// ---------------------------------------------------------------------------

const ACTION_SCHEMA = {
	contract_id: "browser-use.reviewed-action-authoring",
	schema_version: "1",
	wrapper_shape: "async ({ inputs }) => <result>",
	fields: {
		action_id: { pattern: "^[a-z0-9][a-z0-9-]{0,63}$", required: true },
		origin: { description: "exact allowed origin this action runs against", required: true },
		effect_class: { values: BROWSER_USE_ACTION_EFFECT_CLASSES, derived: "mechanical audit, not declared" },
		input_schema: { required: true },
		result_schema: { required: true },
		postcondition: { description: "observable proof the action succeeded", required: true },
	},
	inline_javascript_in_runbook: "forbidden",
	credentials: "forbidden (actions never receive credential values)",
	promotion: "external human only; agent/self promotion refused",
	minimal_example: {
		action_id: "count-rows",
		origin: "https://fasttrack.example",
		bytes: "async ({ inputs }) => ({ rows: document.querySelectorAll('tr').length });",
		input_schema: { kind: "object", fields: {} },
		result_schema: { kind: "object", fields: { rows: { schema: { kind: "number" }, required: true } } },
		postcondition: "rows >= 0",
	},
} as const;

// ---------------------------------------------------------------------------
// Authoring model.
// ---------------------------------------------------------------------------

const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

type AuthoredCandidate = {
	action_id: string;
	origin: string;
	bytes: string;
	digest: string; // content digest of the exact bytes (shipped sha256)
	effect_class: BrowserUseActionEffectClass; // mechanically audited
	promoted: null; // never promoted at authoring time
};

type PromotionRecord = {
	action_id: string;
	promoted_digest: string; // binds EXACT bytes
	origin: string;
	effect_class: BrowserUseActionEffectClass;
	postcondition: string;
	approval_reference: string; // external human approval id
};

type ValidateResult =
	| { ok: true; digest: string; effect_class: BrowserUseActionEffectClass }
	| { ok: false; problems: string[]; repair: string };

// Credential/login shapes an action must never contain (ADR 0033).
const CREDENTIAL_FINGERPRINTS: readonly RegExp[] = [
	/\bpassword\b/i,
	/\botp\b/i,
	/\bone[-\s]?time[-\s]?code\b/i,
	/\btype\s*=\s*["']password["']/i,
	/\b1password\b/i,
	/\bop\s+(?:read|item)\b/i,
];

function validateActionBytes(action: { action_id: string; origin: string; bytes: string }): ValidateResult {
	const problems: string[] = [];
	if (!SAFE_ACTION_ID.test(action.action_id)) problems.push(`action_id ${action.action_id} not [a-z0-9-]{1,64}`);
	if (!action.origin.startsWith("https://") && !action.origin.startsWith("http://")) {
		problems.push("origin must be an exact http(s) origin");
	}
	if (action.bytes.trim().length === 0) problems.push("empty action bytes");
	if (!/=>/.test(action.bytes)) problems.push("action must be an `async ({ inputs }) => ...` wrapper");
	for (const pattern of CREDENTIAL_FINGERPRINTS) {
		if (pattern.test(action.bytes)) problems.push(`credential/login content forbidden (${pattern})`);
	}
	if (problems.length > 0) {
		return { ok: false, problems, repair: "Fix the named issues; actions carry business logic only, never credentials or login." };
	}
	return {
		ok: true,
		digest: actionAssetDigest(action.bytes),
		effect_class: auditActionEffectClass(action.bytes),
	};
}

class ActionFrontDoor {
	// Private-source authored candidates, keyed by action id.
	readonly candidates = new Map<string, AuthoredCandidate>();
	// Human-promoted records, keyed by action id.
	readonly promotions = new Map<string, PromotionRecord>();

	apply(input: { action_id: string; origin: string; bytes: string }): { status: string; changed: boolean; message: string; digest?: string; effect_class?: string } {
		const validation = validateActionBytes(input);
		if (!validation.ok) {
			return { status: "refused", changed: false, message: validation.problems.join("; ") };
		}
		const candidate: AuthoredCandidate = {
			action_id: input.action_id,
			origin: input.origin,
			bytes: input.bytes,
			digest: validation.digest,
			effect_class: validation.effect_class,
			promoted: null,
		};
		this.candidates.set(input.action_id, candidate);
		// Any byte change invalidates a prior promotion for this id.
		const priorPromotion = this.promotions.get(input.action_id);
		if (priorPromotion && priorPromotion.promoted_digest !== candidate.digest) {
			this.promotions.delete(input.action_id);
			return {
				status: "ok",
				changed: true,
				message: `Wrote unpromoted candidate ${input.action_id}@${candidate.digest.slice(0, 12)} (effect ${candidate.effect_class}); prior promotion invalidated by byte change.`,
				digest: candidate.digest,
				effect_class: candidate.effect_class,
			};
		}
		return {
			status: "ok",
			changed: true,
			message: `Wrote unpromoted candidate ${input.action_id}@${candidate.digest.slice(0, 12)} (effect ${candidate.effect_class}).`,
			digest: candidate.digest,
			effect_class: candidate.effect_class,
		};
	}

	/** Agent/self promotion — always refused (external human is the sole authority). */
	selfPromote(action_id: string): { status: string; message: string } {
		return {
			status: "refused",
			message: `Agent/self promotion of ${action_id} refused; only external human approval can promote.`,
		};
	}

	/** External human promotion binds the EXACT current bytes. */
	humanPromote(action_id: string, approval_reference: string, postcondition: string): { status: string; message: string } {
		const candidate = this.candidates.get(action_id);
		if (!candidate) return { status: "refused", message: `no authored candidate ${action_id}` };
		this.promotions.set(action_id, {
			action_id,
			promoted_digest: candidate.digest,
			origin: candidate.origin,
			effect_class: candidate.effect_class,
			postcondition,
			approval_reference,
		});
		return { status: "ok", message: `Promoted ${action_id}@${candidate.digest.slice(0, 12)} (approval ${approval_reference}).` };
	}

	/** Runbook reference resolution: id + exact promoted digest, matching origin. */
	resolveReference(ref: { action_id: string; expected_digest: string; origin: string; auth_capable?: boolean }): { ok: boolean; code: string } {
		if (ref.auth_capable) return { ok: false, code: "auth-capable-action-refused" };
		if (!actionDigestIsValid(ref.expected_digest)) return { ok: false, code: "invalid-digest-form" };
		const promotion = this.promotions.get(ref.action_id);
		const candidate = this.candidates.get(ref.action_id);
		if (!candidate) return { ok: false, code: "action-absent" };
		if (!promotion) return { ok: false, code: "action-unpromoted" };
		if (promotion.promoted_digest !== ref.expected_digest) return { ok: false, code: "digest-stale" };
		if (promotion.origin !== ref.origin) return { ok: false, code: "wrong-origin" };
		return { ok: true, code: "resolved" };
	}

	state(): unknown {
		return {
			candidates: [...this.candidates.values()].map((c) => ({ id: c.action_id, digest: c.digest.slice(0, 12), effect: c.effect_class, promoted: false })),
			promotions: [...this.promotions.values()].map((p) => ({ id: p.action_id, digest: p.promoted_digest.slice(0, 12), approval: p.approval_reference })),
		};
	}
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

const door = new ActionFrontDoor();
const results: Record<string, unknown> = {};

function show(label: string, outcome: unknown): void {
	console.log(`\n# ${label}`);
	console.log(`  -> ${JSON.stringify(outcome)}`);
	console.log(`  state: ${JSON.stringify(door.state())}`);
}

console.log("== action schema --json ==");
console.log(JSON.stringify(ACTION_SCHEMA, null, 2));

// Author a valid observational action (reuses the shipped Oncore read proof).
const readAction = { action_id: "oncore-draft-verify", origin: "https://oncore.example", bytes: ONCORE_DRAFT_VERIFICATION_ACTION_BYTES };
const validateRead = validateActionBytes(readAction);
results.valid_action_validates = validateRead.ok && validateRead.effect_class === "read";
show("validate valid observational action", validateRead);

// Author an invalid action carrying a credential -> precise repair.
const credentialAction = { action_id: "sneaky", origin: "https://x.example", bytes: "async ({ inputs }) => { const password = op.read('vault'); return { password }; }" };
const validateCred = validateActionBytes(credentialAction);
results.credential_action_refused = !validateCred.ok;
show("validate action carrying credentials -> refuse w/ repair", validateCred);

// Apply writes an unpromoted candidate with a content digest.
const applied = door.apply(readAction);
results.apply_writes_unpromoted = applied.status === "ok" && applied.digest !== undefined && door.promotions.size === 0;
show("apply -> unpromoted candidate written with content digest", applied);

// Agent/self promotion refused.
const selfPromote = door.selfPromote("oncore-draft-verify");
results.self_promotion_refused = selfPromote.status === "refused";
show("agent/self promotion -> refused", selfPromote);

// Runbook reference before promotion -> refused (unpromoted).
const beforePromotion = door.resolveReference({ action_id: "oncore-draft-verify", expected_digest: applied.digest ?? "", origin: "https://oncore.example" });
results.reference_before_promotion_refused = !beforePromotion.ok && beforePromotion.code === "action-unpromoted";
show("runbook reference before promotion -> refuse (unpromoted)", beforePromotion);

// External human promotion binds exact digest, origin, effect, postcondition, approval.
const promote = door.humanPromote("oncore-draft-verify", "approval-2026-08-02-001", "verification == oncore-draft-preserved-v1");
results.human_promotion_binds = promote.status === "ok";
show("external human promotion -> binds exact digest + approval", promote);

// Runbook reference by id + exact promoted digest -> passes.
const promotedDigest = door.promotions.get("oncore-draft-verify")?.promoted_digest ?? "";
const validRef = door.resolveReference({ action_id: "oncore-draft-verify", expected_digest: promotedDigest, origin: "https://oncore.example" });
results.valid_reference_resolves = validRef.ok;
show("runbook reference id + exact promoted digest -> resolves", validRef);

// Changed bytes invalidate the old promotion.
const editedAction = { action_id: "oncore-draft-verify", origin: "https://oncore.example", bytes: `${ONCORE_DRAFT_VERIFICATION_ACTION_BYTES}\n// edit` };
const reapplied = door.apply(editedAction);
results.byte_change_invalidates_promotion = reapplied.changed === true && door.promotions.size === 0;
show("re-apply changed bytes -> prior promotion invalidated", reapplied);

// After the byte change, the OLD promoted digest no longer resolves.
const staleRef = door.resolveReference({ action_id: "oncore-draft-verify", expected_digest: promotedDigest, origin: "https://oncore.example" });
results.stale_reference_refused = !staleRef.ok && staleRef.code === "action-unpromoted";
show("reference OLD digest after byte change -> refuse", staleRef);

// Reference refusals: absent, wrong-origin, auth-capable.
door.humanPromote("oncore-draft-verify", "approval-2026-08-02-002", "verification == oncore-draft-preserved-v1");
const newDigest = door.promotions.get("oncore-draft-verify")?.promoted_digest ?? "";
const absentRef = door.resolveReference({ action_id: "ghost", expected_digest: newDigest, origin: "https://oncore.example" });
const wrongOriginRef = door.resolveReference({ action_id: "oncore-draft-verify", expected_digest: newDigest, origin: "https://evil.example" });
const authCapableRef = door.resolveReference({ action_id: "oncore-draft-verify", expected_digest: newDigest, origin: "https://oncore.example", auth_capable: true });
results.absent_reference_refused = !absentRef.ok && absentRef.code === "action-absent";
results.wrong_origin_refused = !wrongOriginRef.ok && wrongOriginRef.code === "wrong-origin";
results.auth_capable_refused = !authCapableRef.ok && authCapableRef.code === "auth-capable-action-refused";
show("reference refusals: absent / wrong-origin / auth-capable", { absentRef, wrongOriginRef, authCapableRef });

const passed = Object.values(results).every(Boolean);
console.log(`\n== VERDICT: ${passed ? "PASS" : "FAIL"} ==`);
console.log(JSON.stringify(results));
if (!passed) process.exitCode = 1;
