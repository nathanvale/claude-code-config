// ---------------------------------------------------------------------------
// Pure 1Password CLI (op) interaction model (auth plan U3a PR1; R7, R8,
// R11-R13, R16; ADR 0028, ADR 0029; KTD7, spec D1/D9).
//
// Command specs are data: an argv, an env spec carrying only the opaque
// token handle (the helper injects the value; the ambient environment is
// never inherited), and a capture mode. The injected executor is the ONLY
// place real op output ever lives — evidence escapes solely through
// fail-closed redacted projections, and secret capture escapes solely as an
// opaque BrowserUseSecretHandle. A JSON payload arriving where a secret
// handle was demanded is discarded unexamined. Every retrieval rejection
// maps to an EXISTING blocked cause with the cause table's continuation:
// missing native capability is a legal typed state, never a throw.
// No Date.now, no Math.random; time enters only through executor outcomes.
// ---------------------------------------------------------------------------

import {
	type BrowserUseItemBinding,
	type BrowserUseVaultItemEvidence,
	BROWSER_USE_BINDING_STALE_STATES,
	BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS,
	normalizeOrigin,
	secretShapeFindingOf,
} from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthContinuation,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";

// --- Environment as data (R7/R16) ----------------------------------------------

/** The one env key the helper populates from its own custody; specs name the key, never the value. */
export const BROWSER_USE_OP_TOKEN_ENV_KEY = "OP_SERVICE_ACCOUNT_TOKEN" as const;

/** Connect variables would silently change the acting principal (R7); their presence fails screening. */
export const BROWSER_USE_OP_FORBIDDEN_ENV_KEYS = [
	"OP_CONNECT_HOST",
	"OP_CONNECT_TOKEN",
] as const;

/**
 * Environment spec carried by every command: the token env key name, the
 * opaque handle naming the helper-held token, and a hard non-inherit flag.
 * No secret bytes are representable here.
 */
export type BrowserUseOpEnvSpec = {
	token_env_key: typeof BROWSER_USE_OP_TOKEN_ENV_KEY;
	token_handle_id: string;
	inherit: false;
};

// --- Typed issues -------------------------------------------------------------

/** Closed issue vocabulary for screening and projection failures. */
export const BROWSER_USE_OP_ISSUE_CODES = [
	"op_output_shape_invalid",
	"op_output_secret_shaped",
	"op_connect_principal_override",
	"op_env_token_exposure",
	"op_capture_mode_violated",
] as const;

/** Op issue code union. */
export type BrowserUseOpIssueCode = (typeof BROWSER_USE_OP_ISSUE_CODES)[number];

/** One typed op issue; messages name path/code only, never echo values. */
export type BrowserUseOpIssue = {
	code: BrowserUseOpIssueCode;
	path: string;
	message: string;
};

/**
 * Screen a proposed environment before any command is built (R7/R16). The
 * signature carries key names and presence flags only, so the screen itself
 * can never receive secret bytes. Connect variables are rejected on key
 * presence alone; a caller-supplied token value is rejected as exposure —
 * only the helper holds the token.
 *
 * @param entries - Proposed env entries as key names plus presence flags
 * @returns Empty array when the proposal is admissible
 */
export function screenOpEnvironmentProposal(
	entries: readonly { key: string; value_present: boolean }[],
): BrowserUseOpIssue[] {
	const issues: BrowserUseOpIssue[] = [];
	for (const entry of entries) {
		if (
			(BROWSER_USE_OP_FORBIDDEN_ENV_KEYS as readonly string[]).includes(
				entry.key,
			)
		) {
			issues.push({
				code: "op_connect_principal_override",
				path: `env.${entry.key}`,
				message:
					"Connect variables would change the acting principal; rejected.",
			});
			continue;
		}
		if (entry.key === BROWSER_USE_OP_TOKEN_ENV_KEY && entry.value_present) {
			issues.push({
				code: "op_env_token_exposure",
				path: `env.${entry.key}`,
				message:
					"a caller-supplied token value is exposure; only the helper holds the token.",
			});
		}
	}
	return issues;
}

// --- Command specs ------------------------------------------------------------

/** Capture modes: redacted JSON evidence, or an opaque secret handle. */
export const BROWSER_USE_OP_CAPTURE_MODES = [
	"json-evidence",
	"secret-handle",
] as const;

/** Capture mode union. */
export type BrowserUseOpCaptureMode =
	(typeof BROWSER_USE_OP_CAPTURE_MODES)[number];

/**
 * The only credential fields a spec can name. No "otp-seed" and no
 * "passkey": a seed or passkey request path is unrepresentable (R12/R13).
 */
export const BROWSER_USE_OP_CREDENTIAL_FIELDS = [
	"username",
	"password",
	"otp-current",
] as const;

/** Credential field union. */
export type BrowserUseOpCredentialField =
	(typeof BROWSER_USE_OP_CREDENTIAL_FIELDS)[number];

/** One op command as pure data; secrets are never piped, so stdin is always null. */
export type BrowserUseOpCommandSpec = {
	argv: readonly string[];
	env: BrowserUseOpEnvSpec;
	stdin: null;
	capture: BrowserUseOpCaptureMode;
	timeout_ms: number;
};

const DEFAULT_OP_TIMEOUT_MS = 10_000;

function envSpecOf(token_handle_id: string): BrowserUseOpEnvSpec {
	return {
		token_env_key: BROWSER_USE_OP_TOKEN_ENV_KEY,
		token_handle_id,
		inherit: false,
	};
}

/** Build the vault enumeration command (R8 scope proof input). */
export function buildVaultListCommand(input: {
	token_handle_id: string;
	timeout_ms?: number;
}): BrowserUseOpCommandSpec {
	return {
		argv: ["op", "vault", "list", "--format=json"],
		env: envSpecOf(input.token_handle_id),
		stdin: null,
		capture: "json-evidence",
		timeout_ms: input.timeout_ms ?? DEFAULT_OP_TIMEOUT_MS,
	};
}

/** Build the login-item enumeration command for the one proven vault. */
export function buildLoginItemListCommand(input: {
	token_handle_id: string;
	vault_id: string;
	timeout_ms?: number;
}): BrowserUseOpCommandSpec {
	return {
		argv: [
			"op",
			"item",
			"list",
			"--vault",
			input.vault_id,
			"--categories",
			"Login",
			"--format=json",
		],
		env: envSpecOf(input.token_handle_id),
		stdin: null,
		capture: "json-evidence",
		timeout_ms: input.timeout_ms ?? DEFAULT_OP_TIMEOUT_MS,
	};
}

/** Build an exact-binding item read — a targeted read, never a scan (R11). */
export function buildLoginItemGetCommand(input: {
	token_handle_id: string;
	vault_id: string;
	item_id: string;
	timeout_ms?: number;
}): BrowserUseOpCommandSpec {
	return {
		argv: [
			"op",
			"item",
			"get",
			input.item_id,
			"--vault",
			input.vault_id,
			"--format=json",
		],
		env: envSpecOf(input.token_handle_id),
		stdin: null,
		capture: "json-evidence",
		timeout_ms: input.timeout_ms ?? DEFAULT_OP_TIMEOUT_MS,
	};
}

// A field is retrievable only when the binding lists the method that owns it;
// "username" needs any allowed method at all. Fail-closed on unknown fields.
const REQUIRED_METHOD_BY_FIELD: Readonly<
	Record<BrowserUseOpCredentialField, "password" | "otp" | null>
> = {
	username: null,
	password: "password",
	"otp-current": "otp",
};

const FIELD_ARGS: Readonly<
	Record<BrowserUseOpCredentialField, readonly string[]>
> = {
	username: ["--fields", "label=username"],
	password: ["--fields", "label=password", "--reveal"],
	"otp-current": ["--otp"],
};

/**
 * Build a secret-capture command pinned to the exact binding (R11): argv is
 * fixed to the binding's vault_id + item_id, and the field must be permitted
 * by the binding's allowed auth methods.
 */
export function buildCredentialFieldCommand(input: {
	token_handle_id: string;
	binding: BrowserUseItemBinding;
	field: BrowserUseOpCredentialField;
	timeout_ms?: number;
}):
	| { ok: true; spec: BrowserUseOpCommandSpec }
	| { ok: false; rejection: { code: "field-not-permitted"; message: string } } {
	const required = REQUIRED_METHOD_BY_FIELD[input.field];
	const allowed = input.binding.allowed_auth_methods;
	const permitted =
		required === null ? allowed.length > 0 : allowed.includes(required);
	if (!permitted) {
		return {
			ok: false,
			rejection: {
				code: "field-not-permitted",
				message: `the item binding does not permit the "${input.field}" field.`,
			},
		};
	}
	return {
		ok: true,
		spec: {
			argv: [
				"op",
				"item",
				"get",
				input.binding.item_id,
				"--vault",
				input.binding.vault_id,
				...FIELD_ARGS[input.field],
			],
			env: envSpecOf(input.token_handle_id),
			stdin: null,
			capture: "secret-handle",
			timeout_ms: input.timeout_ms ?? DEFAULT_OP_TIMEOUT_MS,
		},
	};
}

// --- Execution seam (injected; the ONLY place real op output ever lives) --------

/** Opaque secret custody reference — never the secret bytes (spec D9). */
export type BrowserUseSecretHandle = {
	handle_id: string;
	field: BrowserUseOpCredentialField;
	expires_at_epoch_ms: number;
};

/**
 * Validate one field request and mint only its deferred delivery capability.
 *
 * This path builds the exact permitted command as an admission check, but it
 * never executes OP. The native delivery owner consumes the opaque handle.
 */
export function mintDeferredCredentialCapability(input: {
	binding: BrowserUseItemBinding;
	field: BrowserUseOpCredentialField;
	mint: (value: {
		binding: BrowserUseItemBinding;
		field: BrowserUseOpCredentialField;
	}) => BrowserUseSecretHandle;
}):
	| { ok: true; handle: BrowserUseSecretHandle }
	| {
			ok: false;
			rejection: { code: "field-not-permitted"; message: string };
	  } {
	const permitted = buildCredentialFieldCommand({
		token_handle_id: "deferred-environment-token",
		binding: input.binding,
		field: input.field,
	});
	if (!permitted.ok) return permitted;
	return {
		ok: true,
		handle: input.mint({ binding: input.binding, field: input.field }),
	};
}

/** Closed op failure vocabulary the executor reports. */
export const BROWSER_USE_OP_FAILURE_CODES = [
	"capability-missing",
	"pre-first-unlock",
	"item-missing",
	"entitlement-drift",
	"signing-drift",
	"token-invalid",
	"token-revoked",
	"timeout",
	"io-failure",
] as const;

/** Op failure code union. */
export type BrowserUseOpFailureCode =
	(typeof BROWSER_USE_OP_FAILURE_CODES)[number];

/** What an execution yields: raw JSON (pre-projection), a handle, or a typed failure. */
export type BrowserUseOpExecutionOutcome =
	| { kind: "json-evidence"; value: unknown }
	| { kind: "secret-handle"; handle: BrowserUseSecretHandle }
	| {
			kind: "op-failure";
			failure: { code: BrowserUseOpFailureCode; message: string };
	  };

/** The injected executor seam. */
export type BrowserUseOpExecute = (
	spec: BrowserUseOpCommandSpec,
) => Promise<BrowserUseOpExecutionOutcome>;

// --- Fail-closed output projection (redacted evidence only; KTD7) ---------------

/** Projection result: whitelisted redacted evidence, or typed issues — never partial. */
export type BrowserUseOpProjection<T> =
	| { ok: true; value: T }
	| { ok: false; issues: readonly BrowserUseOpIssue[] };

/** Redacted vault reference: the id only. */
export type BrowserUseOpVaultRef = { vault_id: string };

function shapeIssue(path: string, message: string): BrowserUseOpIssue {
	return { code: "op_output_shape_invalid", path, message };
}

function scanString(path: string, value: unknown): BrowserUseOpIssue | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return shapeIssue(path, "expected a non-empty string.");
	}
	const finding = secretShapeFindingOf(value);
	if (finding !== undefined) {
		return {
			code: "op_output_secret_shaped",
			path,
			message: `string is secret-shaped (${finding.reason}); projection fails closed.`,
		};
	}
	return undefined;
}

/**
 * Project vault-list JSON to id-only refs. Names and any other metadata are
 * never copied; a single secret-shaped or malformed row fails the whole
 * projection.
 */
export function projectVaultListOutput(
	value: unknown,
): BrowserUseOpProjection<readonly BrowserUseOpVaultRef[]> {
	if (!Array.isArray(value)) {
		return {
			ok: false,
			issues: [shapeIssue("vaults", "expected an array of vault rows.")],
		};
	}
	const issues: BrowserUseOpIssue[] = [];
	const vaults: BrowserUseOpVaultRef[] = [];
	value.forEach((row, index) => {
		const path = `vaults[${index}]`;
		if (typeof row !== "object" || row === null || Array.isArray(row)) {
			issues.push(shapeIssue(path, "expected a vault row object."));
			return;
		}
		const id = (row as Record<string, unknown>).id;
		const issue = scanString(`${path}.id`, id);
		if (issue !== undefined) {
			issues.push(issue);
			return;
		}
		vaults.push({ vault_id: id as string });
	});
	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, value: vaults };
}

// Defense in depth: after construction, sweep exactly the whitelisted
// evidence key set for secret-shaped strings so nothing projected can ever
// enter a fragment secret-shaped.
function evidenceSecretIssues(
	path: string,
	evidence: BrowserUseVaultItemEvidence,
): BrowserUseOpIssue[] {
	const issues: BrowserUseOpIssue[] = [];
	for (const key of BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS) {
		const value = evidence[key];
		const entries: readonly unknown[] =
			typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
		entries.forEach((entry, index) => {
			if (typeof entry !== "string") return;
			const finding = secretShapeFindingOf(entry);
			if (finding !== undefined) {
				issues.push({
					code: "op_output_secret_shaped",
					path: Array.isArray(value)
						? `${path}.${key}[${index}]`
						: `${path}.${key}`,
					message: `string is secret-shaped (${finding.reason}); projection fails closed.`,
				});
			}
		});
	}
	return issues;
}

function projectLoginItemRow(
	path: string,
	row: unknown,
): { evidence: BrowserUseVaultItemEvidence | null; issues: BrowserUseOpIssue[] } {
	if (typeof row !== "object" || row === null || Array.isArray(row)) {
		return {
			evidence: null,
			issues: [shapeIssue(path, "expected a login item row object.")],
		};
	}
	const candidate = row as Record<string, unknown>;
	const issues: BrowserUseOpIssue[] = [];

	const idIssue = scanString(`${path}.id`, candidate.id);
	if (idIssue !== undefined) issues.push(idIssue);

	let vaultId: unknown;
	const vault = candidate.vault;
	if (typeof vault !== "object" || vault === null || Array.isArray(vault)) {
		issues.push(shapeIssue(`${path}.vault`, "expected a vault reference object."));
	} else {
		vaultId = (vault as Record<string, unknown>).id;
		const vaultIssue = scanString(`${path}.vault.id`, vaultId);
		if (vaultIssue !== undefined) issues.push(vaultIssue);
	}

	if (candidate.category !== "LOGIN") {
		issues.push(shapeIssue(`${path}.category`, "expected the Login item category."));
	}

	const origins: string[] = [];
	const loginPaths: string[] = [];
	const urls = candidate.urls === undefined ? [] : candidate.urls;
	if (!Array.isArray(urls)) {
		issues.push(shapeIssue(`${path}.urls`, "expected an array of url rows."));
	} else {
		urls.forEach((entry, index) => {
			const urlPath = `${path}.urls[${index}]`;
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
				issues.push(shapeIssue(urlPath, "expected a url row object."));
				return;
			}
			const href = (entry as Record<string, unknown>).href;
			// Scan the RAW href before normalization so a secret-shaped
			// reference (op://...) reports as secret egress, not a parse issue.
			const hrefIssue = scanString(`${urlPath}.href`, href);
			if (hrefIssue !== undefined) {
				issues.push(hrefIssue);
				return;
			}
			const normalized = normalizeOrigin(href as string);
			if (!normalized.ok) {
				issues.push(
					shapeIssue(`${urlPath}.href`, "url is not a normalizable origin."),
				);
				return;
			}
			if (!origins.includes(normalized.origin)) origins.push(normalized.origin);
			let pathname = "/";
			try {
				pathname = new URL(href as string).pathname;
			} catch {
				pathname = "/";
			}
			if (pathname !== "/" && !loginPaths.includes(pathname)) {
				loginPaths.push(pathname);
			}
		});
	}

	const stateValue = candidate.state === undefined ? "active" : candidate.state;
	let state: BrowserUseVaultItemEvidence["state"] = "active";
	if (
		stateValue === "active" ||
		(typeof stateValue === "string" &&
			(BROWSER_USE_BINDING_STALE_STATES as readonly string[]).includes(
				stateValue,
			))
	) {
		state = stateValue as BrowserUseVaultItemEvidence["state"];
	} else {
		issues.push(
			shapeIssue(`${path}.state`, "expected active or a known stale state."),
		);
	}

	if (issues.length > 0) return { evidence: null, issues };
	const evidence: BrowserUseVaultItemEvidence = {
		item_id: candidate.id as string,
		vault_id: vaultId as string,
		origins,
		login_paths: loginPaths,
		// Category-derived (KTD7): the Login category is the only admitted
		// source of method claims; both CLI-retrievable methods derive from it.
		// DOCUMENTED PLACEHOLDER (PR2/U3b follow-up): op item-list output does
		// not expose per-item TOTP field presence, so "otp" membership is
		// category-constant here, not item-derived. An item without a TOTP
		// field admits an otp-current fetch that then fails at the op runtime
		// instead of at method admission. Derive "otp" from field evidence
		// once an exact-item field projection exists.
		supported_methods: ["password", "otp"],
		state,
	};
	const secretIssues = evidenceSecretIssues(path, evidence);
	if (secretIssues.length > 0) return { evidence: null, issues: secretIssues };
	return { evidence, issues: [] };
}

/**
 * Project login-item-list JSON to redacted evidence rows. Titles, usernames,
 * and notes are never copied; any secret-shaped string fails the WHOLE
 * projection with no partial evidence.
 */
export function projectLoginItemListOutput(
	value: unknown,
): BrowserUseOpProjection<readonly BrowserUseVaultItemEvidence[]> {
	if (!Array.isArray(value)) {
		return {
			ok: false,
			issues: [shapeIssue("items", "expected an array of login item rows.")],
		};
	}
	const issues: BrowserUseOpIssue[] = [];
	const items: BrowserUseVaultItemEvidence[] = [];
	value.forEach((row, index) => {
		const projected = projectLoginItemRow(`items[${index}]`, row);
		issues.push(...projected.issues);
		if (projected.evidence !== null) items.push(projected.evidence);
	});
	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, value: items };
}

/** Project a single exact-binding item read (R11) to redacted evidence. */
export function projectLoginItemGetOutput(
	value: unknown,
): BrowserUseOpProjection<BrowserUseVaultItemEvidence> {
	const projected = projectLoginItemRow("item", value);
	if (projected.evidence === null) {
		return {
			ok: false,
			issues:
				projected.issues.length > 0
					? projected.issues
					: [shapeIssue("item", "expected a login item row object.")],
		};
	}
	return { ok: true, value: projected.evidence };
}

// --- Vault-scope proof (R8) -----------------------------------------------------

/** Scope proof: exactly one visible vault, or a typed invalid-vault-scope block. */
export type BrowserUseVaultScopeProof =
	| { ok: true; vault_id: string }
	| {
			ok: false;
			blocked_cause: "invalid-vault-scope";
			continuation: BrowserUseAuthContinuation;
			visible_count: number;
	  };

/**
 * Prove the exactly-one-vault grant (R8) before any item discovery; the
 * provider enforces the ordering. Zero or multiple visible vaults block with
 * the existing repair-vault-grant continuation — no second approval system.
 */
export function proveVaultScope(
	vaults: readonly BrowserUseOpVaultRef[],
): BrowserUseVaultScopeProof {
	const only = vaults[0];
	if (vaults.length === 1 && only !== undefined) {
		return { ok: true, vault_id: only.vault_id };
	}
	return {
		ok: false,
		blocked_cause: "invalid-vault-scope",
		continuation: structuredClone(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["invalid-vault-scope"].continuation,
		),
		visible_count: vaults.length,
	};
}

// --- TokenRetrievalPort (declared here; spec D1) --------------------------------

/**
 * Rejection codes: op failures plus the port's own custody refusals.
 * "binding-shape-invalid" is minted by the PROVIDER's binding-admission gate,
 * never by the port: it names an injected binding that failed shape admission,
 * distinct from "output-shape-invalid" which names malformed op OUTPUT.
 */
export type BrowserUseTokenRetrievalRejectionCode =
	| BrowserUseOpFailureCode
	| "secret-egress-refused"
	| "output-shape-invalid"
	| "binding-shape-invalid"
	| "field-not-permitted";

/** Typed retrieval rejection; the message is always secret-free. */
export type BrowserUseTokenRetrievalRejection = {
	code: BrowserUseTokenRetrievalRejectionCode;
	message: string;
};

/**
 * Read-only, prompt-free token retrieval (type-level R7): no method can
 * express a presence prompt, an approval, or a raw secret return.
 * `getLoginItem` exists so the R11 repair path never enumerates.
 */
export type BrowserUseTokenRetrievalPort = {
	listVaults(): Promise<
		| { ok: true; vaults: readonly BrowserUseOpVaultRef[] }
		| { ok: false; rejection: BrowserUseTokenRetrievalRejection }
	>;
	listLoginItems(input: { vault_id: string }): Promise<
		| { ok: true; items: readonly BrowserUseVaultItemEvidence[] }
		| { ok: false; rejection: BrowserUseTokenRetrievalRejection }
	>;
	getLoginItem(input: { vault_id: string; item_id: string }): Promise<
		| { ok: true; item: BrowserUseVaultItemEvidence }
		| { ok: false; rejection: BrowserUseTokenRetrievalRejection }
	>;
	fetchCredentialField(input: {
		binding: BrowserUseItemBinding;
		field: BrowserUseOpCredentialField;
	}): Promise<
		| { ok: true; handle: BrowserUseSecretHandle }
		| { ok: false; rejection: BrowserUseTokenRetrievalRejection }
	>;
};

// --- Factory + blocked mapping --------------------------------------------------

/** Injected deps: the executor seam plus the opaque helper-held token handle. */
export type BrowserUseOpDeps = {
	execute: BrowserUseOpExecute;
	token_handle_id: string;
};

const EXECUTOR_CRASH = { kind: "executor-crash" } as const;

function sanitizedFailureMessage(message: string): string {
	// A failure message is display data; a secret-shaped one is withheld
	// entirely rather than partially redacted.
	if (message.length === 0 || secretShapeFindingOf(message) !== undefined) {
		return "op failure detail withheld; the reported detail was secret-shaped.";
	}
	return message;
}

function opFailureRejectionOf(failure: {
	code: BrowserUseOpFailureCode;
	message: string;
}): BrowserUseTokenRetrievalRejection {
	return { code: failure.code, message: sanitizedFailureMessage(failure.message) };
}

function ioFailureRejection(): {
	ok: false;
	rejection: BrowserUseTokenRetrievalRejection;
} {
	return {
		ok: false,
		rejection: {
			code: "io-failure",
			message: "the injected op executor crashed; no outcome was captured.",
		},
	};
}

function projectionRejectionOf(
	issues: readonly BrowserUseOpIssue[],
): BrowserUseTokenRetrievalRejection {
	const first = issues[0];
	// Issue messages never echo values, so naming code + path stays secret-free.
	const detail =
		first === undefined ? "unknown issue" : `${first.code} at ${first.path}`;
	return {
		code: "output-shape-invalid",
		message: `op output projection rejected (${detail}).`,
	};
}

function captureModeRejection(): BrowserUseTokenRetrievalRejection {
	// A real typed issue from the closed vocabulary, routed through the same
	// projection-rejection path as every other issue (no producer-less codes).
	return projectionRejectionOf([
		{
			code: "op_capture_mode_violated",
			path: "capture",
			message:
				"a secret handle arrived on the json-evidence path and was not surfaced.",
		},
	]);
}

/**
 * Build the concrete TokenRetrievalPort over the injected executor. Enforces
 * capture modes (JSON on a secret-handle spec is refused with the payload
 * discarded UNEXAMINED), projects evidence fail-closed, and converts every
 * executor throw or rejection into a typed io-failure — the port NEVER
 * rejects.
 */
export function createOpTokenRetrievalPort(
	deps: BrowserUseOpDeps,
): BrowserUseTokenRetrievalPort {
	const run = async (
		spec: BrowserUseOpCommandSpec,
	): Promise<BrowserUseOpExecutionOutcome | typeof EXECUTOR_CRASH> => {
		try {
			return await deps.execute(spec);
		} catch {
			return EXECUTOR_CRASH;
		}
	};

	const runEvidence = async (
		spec: BrowserUseOpCommandSpec,
	): Promise<
		| { ok: true; value: unknown }
		| { ok: false; rejection: BrowserUseTokenRetrievalRejection }
	> => {
		const outcome = await run(spec);
		if (outcome.kind === "executor-crash") return ioFailureRejection();
		if (outcome.kind === "op-failure") {
			return { ok: false, rejection: opFailureRejectionOf(outcome.failure) };
		}
		if (outcome.kind !== "json-evidence") {
			return { ok: false, rejection: captureModeRejection() };
		}
		return { ok: true, value: outcome.value };
	};

	return {
		async listVaults() {
			const spec = buildVaultListCommand({
				token_handle_id: deps.token_handle_id,
			});
			const evidence = await runEvidence(spec);
			if (!evidence.ok) return evidence;
			const projection = projectVaultListOutput(evidence.value);
			if (!projection.ok) {
				return { ok: false, rejection: projectionRejectionOf(projection.issues) };
			}
			return { ok: true, vaults: projection.value };
		},

		async listLoginItems(input) {
			const spec = buildLoginItemListCommand({
				token_handle_id: deps.token_handle_id,
				vault_id: input.vault_id,
			});
			const evidence = await runEvidence(spec);
			if (!evidence.ok) return evidence;
			const projection = projectLoginItemListOutput(evidence.value);
			if (!projection.ok) {
				return { ok: false, rejection: projectionRejectionOf(projection.issues) };
			}
			return { ok: true, items: projection.value };
		},

		async getLoginItem(input) {
			const spec = buildLoginItemGetCommand({
				token_handle_id: deps.token_handle_id,
				vault_id: input.vault_id,
				item_id: input.item_id,
			});
			const evidence = await runEvidence(spec);
			if (!evidence.ok) return evidence;
			const projection = projectLoginItemGetOutput(evidence.value);
			if (!projection.ok) {
				return { ok: false, rejection: projectionRejectionOf(projection.issues) };
			}
			return { ok: true, item: projection.value };
		},

		async fetchCredentialField(input) {
			const built = buildCredentialFieldCommand({
				token_handle_id: deps.token_handle_id,
				binding: input.binding,
				field: input.field,
			});
			if (!built.ok) {
				return {
					ok: false,
					rejection: {
						code: "field-not-permitted",
						message: built.rejection.message,
					},
				};
			}
			const outcome = await run(built.spec);
			if (outcome.kind === "executor-crash") return ioFailureRejection();
			if (outcome.kind === "op-failure") {
				return { ok: false, rejection: opFailureRejectionOf(outcome.failure) };
			}
			if (outcome.kind !== "secret-handle") {
				// The JSON payload is discarded UNEXAMINED (spec D9): it is never
				// read, logged, or echoed — only its arrival is reported.
				return {
					ok: false,
					rejection: {
						code: "secret-egress-refused",
						message:
							"json output arrived where a secret handle was demanded; the payload was discarded unexamined.",
					},
				};
			}
			return { ok: true, handle: outcome.handle };
		},
	};
}

/** A retrieval rejection mapped onto an existing blocked cause + continuation. */
export type BrowserUseOpBlock = {
	blocked_cause: Extract<
		BrowserUseAuthBlockedCause,
		"missing-token" | "revoked-binding" | "unsupported-method" | "capability-loss"
	>;
	continuation: BrowserUseAuthContinuation;
};

const BLOCK_CAUSE_BY_REJECTION: Readonly<
	Record<BrowserUseTokenRetrievalRejectionCode, BrowserUseOpBlock["blocked_cause"]>
> = {
	"capability-missing": "missing-token",
	"pre-first-unlock": "missing-token",
	"entitlement-drift": "missing-token",
	"signing-drift": "missing-token",
	"token-invalid": "missing-token",
	"token-revoked": "missing-token",
	"item-missing": "revoked-binding",
	"field-not-permitted": "unsupported-method",
	timeout: "capability-loss",
	"io-failure": "capability-loss",
	"secret-egress-refused": "capability-loss",
	"output-shape-invalid": "capability-loss",
	"binding-shape-invalid": "capability-loss",
};

/**
 * Map a retrieval rejection onto an EXISTING blocked cause (ADR 0028): every
 * token-lifecycle failure is the legal missing-token state with the
 * enroll-browser-automation-token continuation — never a throw. Continuations
 * are structured clones of the cause-table rows.
 */
export function blockOfRetrievalRejection(
	rejection: BrowserUseTokenRetrievalRejection,
): BrowserUseOpBlock {
	const cause = BLOCK_CAUSE_BY_REJECTION[rejection.code] ?? "capability-loss";
	return {
		blocked_cause: cause,
		continuation: structuredClone(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
		),
	};
}
