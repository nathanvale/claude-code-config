import type { VaultGitEventType } from "./model.ts";

/** Stable refusal categories for semantic commit subjects. */
export type VaultCommitSubjectRefusalReason =
	| "invalid_conventional_subject"
	| "event_type_mismatch"
	| "sensitive_text"
	| "unsafe_text";

/** Validated Conventional Commit subject. */
export type VaultCommitSubjectValidation =
	| { readonly status: "accepted"; readonly subject: string }
	| {
			readonly status: "refused";
			readonly reason: VaultCommitSubjectRefusalReason;
	  };

/** Input for the manager-owned canonical commit message. */
export interface VaultCommitMessageInput {
	/** Caller-written semantic Conventional Commit subject. */
	readonly subject: string;
	/** Meaningful event bound at transaction admission. */
	readonly event: VaultGitEventType;
	/** Opaque remote-ledger transaction id. */
	readonly transactionId: string;
	/** Non-secret admitted Git actor label. */
	readonly actor: string;
}

const CONVENTIONAL_SUBJECT = /^(?<type>build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([a-z0-9][a-z0-9._/-]*\))?(?<breaking>!)?: (?<description>\S(?:.*\S)?)$/;
const SECRET_LIKE_TEXT = /(?:\b(?:api[_-]?key|access[_-]?token|token|auth(?:orization)?|password|passwd|secret|private[_-]?key)\b\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp|github_pat|sk|xox[baprs])_[A-Za-z0-9_-]{8,})/i;
const PRIVATE_PATH_TEXT = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders|tmp)\/|[A-Za-z]:\\Users\\|~\/|file:\/\/)/i;
const EVENT_COMMIT_TYPES: Readonly<Record<VaultGitEventType, ReadonlySet<string>>> = {
	project_created: new Set(["feat"]),
	goal_changed: new Set(["docs", "feat"]),
	scope_changed: new Set(["docs", "feat"]),
	owner_changed: new Set(["docs", "chore"]),
	decision_accepted: new Set(["docs"]),
	decision_superseded: new Set(["docs"]),
	note_created: new Set(["docs"]),
	document_completed: new Set(["docs"]),
	document_moved: new Set(["docs"]),
	document_renamed: new Set(["docs"]),
	document_archived: new Set(["docs"]),
	document_deleted: new Set(["docs"]),
	handoff_created: new Set(["docs"]),
	work_completed: new Set(["docs", "chore"]),
	work_reopened: new Set(["docs", "chore"]),
	hygiene: new Set(["chore", "docs", "style"]),
};

/**
 * Validate a caller-written subject without retaining sensitive text.
 *
 * @param subject - Candidate one-line Conventional Commit subject
 * @param event - Admitted meaningful event controlling the allowed commit type
 * @returns Accepted subject or one stable refusal category
 * @throws Never; unsafe caller text is represented as a refusal
 *
 * @example
 * ```typescript
 * validateVaultCommitSubject("docs(vault): record decision", "decision_accepted")
 * ```
 */
export function validateVaultCommitSubject(
	subject: string,
	event: VaultGitEventType,
): VaultCommitSubjectValidation {
	if (
		subject.length > 120 ||
		subject.trim() !== subject ||
		/[\r\n\0]/.test(subject) ||
		/\bVault-(?:Event|Transaction|Actor):/i.test(subject)
	) {
		return { status: "refused", reason: "unsafe_text" };
	}
	if (SECRET_LIKE_TEXT.test(subject) || PRIVATE_PATH_TEXT.test(subject)) {
		return { status: "refused", reason: "sensitive_text" };
	}
	const match = CONVENTIONAL_SUBJECT.exec(subject);
	if (!match?.groups) {
		return { status: "refused", reason: "invalid_conventional_subject" };
	}
	if (!EVENT_COMMIT_TYPES[event].has(match.groups.type ?? "")) {
		return { status: "refused", reason: "event_type_mismatch" };
	}
	return { status: "accepted", subject };
}

/**
 * Build the exact commit message owned by the transaction manager.
 *
 * @param input - Validated semantic subject and stable transaction binding
 * @returns Subject plus manager-owned trailers and one final newline
 * @throws {Error} When any caller-controlled field is unsafe or inconsistent
 *
 * @example
 * ```typescript
 * const message = buildVaultCommitMessage({
 *   subject: "docs(vault): record decision",
 *   event: "decision_accepted",
 *   transactionId: "txn_11111111111111111111111111111111",
 *   actor: "agent-a",
 * })
 * ```
 */
export function buildVaultCommitMessage(input: VaultCommitMessageInput): string {
	const validated = validateVaultCommitSubject(input.subject, input.event);
	if (validated.status === "refused") {
		throw new Error(`commit subject refused: ${validated.reason}`);
	}
	if (!/^txn_[0-9a-f]{32}$/.test(input.transactionId)) {
		throw new Error("transaction id is invalid");
	}
	if (
		input.actor.trim() !== input.actor ||
		input.actor.length === 0 ||
		input.actor.length > 80 ||
		/[\r\n\0]/.test(input.actor) ||
		SECRET_LIKE_TEXT.test(input.actor) ||
		PRIVATE_PATH_TEXT.test(input.actor)
	) {
		throw new Error("actor is unsafe for commit trailers");
	}
	return `${validated.subject}\n\nVault-Event: ${input.event}\nVault-Transaction: ${input.transactionId}\nVault-Actor: ${input.actor}\n`;
}

/**
 * Prove that one stored commit message exactly matches manager policy.
 *
 * @param message - Message read back from the candidate commit object
 * @param input - Original semantic input and admitted transaction binding
 * @returns Whether the object carries only the expected subject and trailers
 * @throws Never; malformed text simply fails proof
 *
 * @example
 * ```typescript
 * verifyVaultCommitMessage(message, input)
 * ```
 */
export function verifyVaultCommitMessage(
	message: string,
	input: VaultCommitMessageInput,
): boolean {
	try {
		return message === buildVaultCommitMessage(input);
	} catch {
		return false;
	}
}
