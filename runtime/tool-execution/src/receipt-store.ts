import {
	chmod,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	stat,
	unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	spawnTransportCommand,
	type TransportCommandInput,
	type TransportCommandResult,
} from "@side-quest/mcporter-transport";
import {
	RECEIPT_STATES,
	QUALIFICATION_LANES,
	TOOL_EXECUTION_ADAPTERS,
	TOOL_EXECUTION_SCHEMA_VERSION,
	type ApprovalBinding,
	type ExecutionReceipt,
	type PreparedRequest,
	type PreparedAdapterInvocation,
} from "./model.ts";
import { fingerprintValue } from "./pre-image.ts";
import { redactValue, summarizeClassification } from "./redaction.ts";
import {
	classifyProviderResult,
	type ProviderResultClassification,
} from "./result-classifier.ts";

const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECEIPT_FIELDS = new Set([
	"schema_version",
	"receipt_id",
	"attempt",
	"linked_receipt_id",
	"adapter",
	"route",
	"checkpoint_id",
	"qualification_cell",
	"request_fingerprint",
	"config_fingerprint",
	"state",
	"created_at",
	"updated_at",
	"approval",
	"provider_operation_id",
	"result",
	"terminal_reason",
]);
const PREPARED_REQUEST_FIELDS = new Set([
	"adapter",
	"route",
	"checkpoint_id",
	"qualification_cell",
	"request",
	"deadline_ms",
]);
const FIRECRAWL_REQUEST_FIELDS = new Set(["operation", "query", "options"]);
const MCPORTER_REQUEST_FIELDS = new Set(["server", "tool", "arguments"]);
const PROVIDER_OUTPUT_MAX_BYTES = 1024 * 1024;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_TRANSPORT_CODE = /^(?:command_resolution_failed|firecrawl_(?:operation_denied|options_unsupported)|mcporter_(?:selector_invalid|tool_denied)|malformed_provider_response|provider_(?:execution_interrupted|timeout|output_limit|exit_[0-9]+))$/;
const JSONRPC_CODE = /^-?(?:0|[1-9][0-9]*)$/;
const AUTHORITY_BEARING_FIELD = /(?:^|[_-])(?:api[_-]?key|token|secret|password|credential|auth(?:entication|orization)?|headers?|endpoint|base[_-]?url|api[_-]?url|url)(?:$|[_-])/i;
const DISPATCH_LOCK_INVALID_STALE_MS = 30_000;

const ADAPTER_BINDINGS = {
	"firecrawl-cli": {
		lane: "explicit_cli",
		client: "tool-execution",
		provider: "firecrawl",
		route: "firecrawl.search",
	},
	"mcporter-cli": {
		lane: "explicit_cli",
		client: "tool-execution",
		provider: "firecrawl",
		route: "mcporter.firecrawl.search",
	},
} as const;

export type ReceiptStore = {
	root: string;
	write(receipt: ExecutionReceipt): Promise<void>;
	read(receiptId: string): Promise<ExecutionReceipt | undefined>;
	list(): Promise<ExecutionReceipt[]>;
	claimPreparedDispatch(
		expected: ExecutionReceipt,
		updatedAt: string,
	): Promise<ExecutionReceipt>;
	replacePrepared(
		expected: ExecutionReceipt,
		replacement: ExecutionReceipt,
	): Promise<ExecutionReceipt>;
};

class DispatchClaimError extends Error {}

class OutcomeUnknownError extends Error {}

export function isOutcomeUnknownError(error: unknown): boolean {
	return error instanceof OutcomeUnknownError;
}

export function defaultReceiptRoot(): string {
	return join(
		process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
		"tool-execution",
		"receipts",
	);
}

export function createReceiptStore(
	root = defaultReceiptRoot(),
): ReceiptStore {
	return {
		root,
		async write(receipt) {
			validateExecutionReceipt(receipt);
			await writePrivateJsonAtomic(root, `${receipt.receipt_id}.json`, receipt);
		},
		async read(receiptId) {
			const path = receiptPath(root, receiptId);
			try {
				const receipt = JSON.parse(await readFile(path, "utf8")) as unknown;
				validateExecutionReceipt(receipt);
				return receipt;
			} catch (error) {
				if (isMissingFileError(error)) return undefined;
				throw error;
			}
		},
		async list() {
			await ensurePrivateDirectory(root);
			const names = (await readdir(root))
				.filter((name) => !name.startsWith(".") && name.endsWith(".json"))
				.sort();
			const receipts: ExecutionReceipt[] = [];
			for (const name of names) {
				const receipt = await this.read(name.slice(0, -".json".length));
				if (receipt) receipts.push(receipt);
			}
			return receipts;
		},
		async claimPreparedDispatch(expected, updatedAt) {
			return withPreparedReceiptLock(root, expected, this, async (current) => {
				const dispatched = markReceiptDispatched(current, updatedAt);
				await this.write(dispatched);
				return dispatched;
			});
		},
		async replacePrepared(expected, replacement) {
			validateExecutionReceipt(replacement);
			if (
				replacement.receipt_id !== expected.receipt_id ||
				(replacement.state !== "prepared" &&
					!(
						replacement.state === "terminal" &&
						replacement.terminal_reason === "approval_denied"
					))
			) {
				throw new DispatchClaimError("Prepared replacement is invalid.");
			}
			return withPreparedReceiptLock(root, expected, this, async () => {
				await this.write(replacement);
				return replacement;
			});
		},
	};
}

async function withPreparedReceiptLock<T>(
	root: string,
	expected: ExecutionReceipt,
	store: ReceiptStore,
	action: (current: ExecutionReceipt) => Promise<T>,
): Promise<T> {
	validateExecutionReceipt(expected);
	await ensurePrivateDirectory(root);
	const lockPath = join(root, `.${expected.receipt_id}.dispatch.lock`);
	let lock: Awaited<ReturnType<typeof open>> | undefined;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			lock = await open(lockPath, "wx", 0o600);
			break;
		} catch (error) {
			if (!hasErrorCode(error, "EEXIST")) throw error;
			const reaped =
				attempt === 0 &&
				(await reapAbandonedPreparedDispatchLock(lockPath, expected, store));
			if (!reaped) {
				throw new DispatchClaimError("Receipt transition is already being claimed.");
			}
		}
	}
	if (!lock) {
		throw new DispatchClaimError("Receipt transition could not be claimed.");
	}
	try {
		await lock.writeFile(
			`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`,
			"utf8",
		);
		await lock.sync();
		const current = await store.read(expected.receipt_id);
		if (!current || !sameDispatchCandidate(current, expected)) {
			throw new DispatchClaimError("Receipt is no longer dispatchable.");
		}
		return await action(current);
	} finally {
		await lock.close();
		await unlink(lockPath).catch((error) => {
			if (!isMissingFileError(error)) throw error;
		});
	}
}

export async function writePrivateJsonAtomic(
	root: string,
	filename: string,
	value: unknown,
): Promise<void> {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(filename)) {
		throw new Error("Private state filename is invalid.");
	}
	await ensurePrivateDirectory(root);
	const destination = join(root, filename);
	const temporary = join(root, `.${filename}.${randomUUID()}.tmp`);
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
		await file.sync();
	} finally {
		await file.close();
	}
	await chmod(temporary, 0o600);
	await rename(temporary, destination);
	await chmod(destination, 0o600);
}

export async function readPrivateJson(
	root: string,
	filename: string,
): Promise<unknown | undefined> {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(filename)) {
		throw new Error("Private state filename is invalid.");
	}
	try {
		return JSON.parse(await readFile(join(root, filename), "utf8")) as unknown;
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw error;
	}
}

export function validateExecutionReceipt(
	value: unknown,
): asserts value is ExecutionReceipt {
	if (!isRecord(value)) throw new Error("Receipt must be an object.");
	assertOnlyFields(value, RECEIPT_FIELDS, "Receipt");
	if (value.schema_version !== TOOL_EXECUTION_SCHEMA_VERSION) {
		throw new Error("Unsupported receipt schema version.");
	}
	if (
		typeof value.receipt_id !== "string" ||
		!RECEIPT_ID_PATTERN.test(value.receipt_id)
	) {
		throw new Error("Receipt id is invalid.");
	}
	if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1) {
		throw new Error("Receipt attempt must be a positive integer.");
	}
	if (!TOOL_EXECUTION_ADAPTERS.includes(value.adapter as never)) {
		throw new Error("Receipt adapter is invalid.");
	}
	if (!RECEIPT_STATES.includes(value.state as never)) {
		throw new Error("Receipt state is invalid.");
	}
	for (const key of [
		"route",
		"checkpoint_id",
		"request_fingerprint",
		"config_fingerprint",
		"created_at",
		"updated_at",
	] as const) {
		if (typeof value[key] !== "string" || value[key].trim() === "") {
			throw new Error(`Receipt ${key} is required.`);
		}
	}
	validateQualificationCell(value.qualification_cell);
	validateAdapterBinding(value.adapter, value.route, value.qualification_cell, "Receipt");
	validateFingerprint(value.request_fingerprint);
	validateFingerprint(value.config_fingerprint);
	for (const key of ["created_at", "updated_at"] as const) {
		if (Number.isNaN(Date.parse(String(value[key])))) {
			throw new Error(`Receipt ${key} must be a timestamp.`);
		}
	}
	if (
		value.linked_receipt_id !== undefined &&
		(typeof value.linked_receipt_id !== "string" ||
			!RECEIPT_ID_PATTERN.test(value.linked_receipt_id))
	) {
		throw new Error("Receipt linked id is invalid.");
	}
	if (value.approval !== undefined) {
		validateApprovalBinding(value.approval);
		if (
			value.approval.request_fingerprint !== value.request_fingerprint ||
			value.approval.route !== value.route ||
			value.approval.attempt !== value.attempt ||
			value.approval.checkpoint_id !== value.checkpoint_id
		) {
			throw new Error("Receipt approval binding is mismatched.");
		}
	}
	if (value.result !== undefined) validateResultSummary(value.result);
	for (const key of ["provider_operation_id", "terminal_reason"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw new Error(`Receipt ${key} must be a string.`);
		}
	}
	if (
		(value.state === "prepared" || value.state === "dispatched") &&
		(value.result !== undefined || value.terminal_reason !== undefined)
	) {
		throw new Error("Active receipt cannot contain a terminal result.");
	}
	if (value.state === "dispatched" && value.approval === undefined) {
		throw new Error("Dispatched receipt requires its approval binding.");
	}
	if (
		(value.state === "terminal" || value.state === "unknown") &&
		(typeof value.terminal_reason !== "string" || value.terminal_reason === "")
	) {
		throw new Error("Settled receipt requires a terminal reason.");
	}
}

export function validatePreparedRequest(
	value: unknown,
): asserts value is PreparedRequest {
	if (!isRecord(value)) throw new Error("Prepared request must be an object.");
	assertOnlyFields(value, PREPARED_REQUEST_FIELDS, "Prepared request");
	if (!TOOL_EXECUTION_ADAPTERS.includes(value.adapter as never)) {
		throw new Error("Prepared request adapter is invalid.");
	}
	for (const key of ["route", "checkpoint_id"] as const) {
		if (typeof value[key] !== "string" || value[key].trim() === "") {
			throw new Error(`Prepared request ${key} is required.`);
		}
	}
	if (!("request" in value)) throw new Error("Prepared request payload is required.");
	validateAdapterRequest(value.adapter, value.request);
	validateQualificationCell(value.qualification_cell);
	validateAdapterBinding(
		value.adapter,
		value.route,
		value.qualification_cell,
		"Prepared request",
	);
	if (
		value.deadline_ms !== undefined &&
		(!Number.isInteger(value.deadline_ms) || Number(value.deadline_ms) <= 0)
	) {
		throw new Error("Prepared request deadline must be a positive integer.");
	}
}

function validateAdapterRequest(adapter: unknown, request: unknown): void {
	if (!isRecord(request)) throw new Error("Adapter request must be an object.");
	if (adapter === "firecrawl-cli") {
		assertOnlyFields(request, FIRECRAWL_REQUEST_FIELDS, "Firecrawl request");
		if (request.operation !== "search") {
			throw new Error("Firecrawl request operation must be search.");
		}
		if (typeof request.query !== "string" || request.query.trim() === "") {
			throw new Error("Firecrawl request query must be a non-empty string.");
		}
		if (request.options !== undefined && !isRecord(request.options)) {
			throw new Error("Firecrawl request options must be a plain object.");
		}
		assertNoAuthorityBearingFields(request.options);
		return;
	}
	assertOnlyFields(request, MCPORTER_REQUEST_FIELDS, "MCPorter request");
	for (const key of ["server", "tool"] as const) {
		if (typeof request[key] !== "string" || request[key].trim() === "") {
			throw new Error(`MCPorter request ${key} must be a non-empty string.`);
		}
	}
	if (!isRecord(request.arguments)) {
		throw new Error("MCPorter request arguments must be a plain object.");
	}
	assertNoAuthorityBearingFields(request.arguments);
}

export function validatePreparedRequestBinding(
	receipt: ExecutionReceipt,
	request: PreparedRequest,
): { ok: true } | { ok: false; reason: "prepared_request_mismatched" } {
	validateExecutionReceipt(receipt);
	validatePreparedRequest(request);
	if (
		receipt.adapter !== request.adapter ||
		receipt.route !== request.route ||
		receipt.checkpoint_id !== request.checkpoint_id ||
		receipt.request_fingerprint !== fingerprintValue(request.request) ||
		!sameQualificationCell(receipt.qualification_cell, request.qualification_cell)
	) {
		return { ok: false, reason: "prepared_request_mismatched" };
	}
	return { ok: true };
}

export function createPreparedReceipt(
	request: PreparedRequest,
	input: {
		receiptId: string;
		now: string;
		configFingerprint: string;
		attempt?: number;
	},
): ExecutionReceipt {
	validatePreparedRequest(request);
	validateFingerprint(input.configFingerprint);
	const receipt: ExecutionReceipt = {
		schema_version: TOOL_EXECUTION_SCHEMA_VERSION,
		receipt_id: input.receiptId,
		attempt: input.attempt ?? 1,
		adapter: request.adapter,
		route: request.route,
		checkpoint_id: request.checkpoint_id,
		qualification_cell: { ...request.qualification_cell },
		request_fingerprint: fingerprintValue(request.request),
		config_fingerprint: input.configFingerprint,
		state: "prepared",
		created_at: input.now,
		updated_at: input.now,
	};
	validateExecutionReceipt(receipt);
	return receipt;
}

export function markReceiptDispatched(
	receipt: ExecutionReceipt,
	updatedAt: string,
): ExecutionReceipt {
	if (receipt.state !== "prepared") {
		throw new Error("Only a prepared receipt can be dispatched.");
	}
	return {
		...receipt,
		state: "dispatched",
		updated_at: updatedAt,
	};
}

export function settleIncompleteAttempt(
	receipt: ExecutionReceipt,
	input: { kind: "timeout" | "interruption" | "output_limit"; updatedAt: string },
): ExecutionReceipt {
	if (receipt.state !== "prepared" && receipt.state !== "dispatched") {
		throw new Error("Only prepared or dispatched work can settle incomplete.");
	}
	const postDispatch = receipt.state === "dispatched";
	return {
		...receipt,
		state: postDispatch ? "unknown" : "terminal",
		terminal_reason: `${postDispatch ? "post" : "pre"}_dispatch_${input.kind}`,
		updated_at: input.updatedAt,
	};
}

export function approvePreparedReceipt(
	receipt: ExecutionReceipt,
	input: {
		taskApproved: boolean;
		decision: "approve" | "deny";
		now: string;
		expiresAt: string;
	},
): ExecutionReceipt {
	if (receipt.state !== "prepared") {
		throw new Error("Only a prepared receipt can be approved.");
	}
	if (!input.taskApproved) {
		return receipt;
	}
	if (input.decision === "deny") {
		return {
			...receipt,
			state: "terminal",
			terminal_reason: "approval_denied",
			updated_at: input.now,
		};
	}
	if (Date.parse(input.expiresAt) <= Date.parse(input.now)) {
		throw new Error("Approval expiry must be after approval time.");
	}
	return {
		...receipt,
		updated_at: input.now,
		approval: {
			approval_surface: "task_policy",
			approved_at: input.now,
			expires_at: input.expiresAt,
			request_fingerprint: receipt.request_fingerprint,
			route: receipt.route,
			attempt: receipt.attempt,
			checkpoint_id: receipt.checkpoint_id,
		},
	};
}

export function validateDispatchApproval(
	receipt: ExecutionReceipt,
	input: {
		now: string;
		requestFingerprint: string;
		route: string;
		attempt: number;
		checkpointId: string;
	},
): { ok: true } | { ok: false; reason: string } {
	const approval = receipt.approval;
	if (!approval) return { ok: false, reason: "approval_missing" };
	if (Date.parse(approval.expires_at) <= Date.parse(input.now)) {
		return { ok: false, reason: "approval_stale" };
	}
	if (
		approval.approval_surface !== "task_policy" ||
		approval.request_fingerprint !== input.requestFingerprint ||
		approval.route !== input.route ||
		approval.attempt !== input.attempt ||
		approval.checkpoint_id !== input.checkpointId ||
		receipt.request_fingerprint !== input.requestFingerprint ||
		receipt.route !== input.route ||
		receipt.attempt !== input.attempt ||
		receipt.checkpoint_id !== input.checkpointId
	) {
		return { ok: false, reason: "approval_mismatched" };
	}
	return { ok: true };
}

export async function dispatchApprovedInvocation(input: {
	receipt: ExecutionReceipt;
	store: ReceiptStore;
	invocation: PreparedAdapterInvocation;
	requestFingerprint: string;
	now: () => string;
	timeoutMs: number;
	childEnv: Record<string, string>;
	spawn?: (input: TransportCommandInput) => Promise<TransportCommandResult>;
}): Promise<{
	receipt: ExecutionReceipt;
	classification: ProviderResultClassification;
	provider_data?: unknown;
}> {
	const approval = validateDispatchApproval(input.receipt, {
		now: input.now(),
		requestFingerprint: input.requestFingerprint,
		route: input.receipt.route,
		attempt: input.receipt.attempt,
		checkpointId: input.receipt.checkpoint_id,
	});
	if (!approval.ok) {
		throw new Error(`Dispatch refused: ${approval.reason}.`);
	}

	let durable = input.receipt;
	let crossedDispatch = false;
	const spawn = input.spawn ?? spawnTransportCommand;
	let result: TransportCommandResult;
	try {
		result = await spawn({
			command: input.invocation.command,
			args: input.invocation.args,
			...(input.invocation.stdinText === undefined
				? {}
				: { stdinText: input.invocation.stdinText }),
			env: input.childEnv,
			exactEnv: true,
			detached: true,
			timeoutMs: input.timeoutMs,
			maxOutputBytes: PROVIDER_OUTPUT_MAX_BYTES,
			beforeSpawn: async () => {
				durable = await input.store.claimPreparedDispatch(durable, input.now());
				crossedDispatch = true;
			},
		});
	} catch (error) {
		if (error instanceof DispatchClaimError) throw error;
		const classification: ProviderResultClassification = {
			class: "transport_or_client_policy_failure",
			code: "provider_execution_interrupted",
			message: "Provider execution did not produce a complete result.",
		};
		if (!crossedDispatch) {
			const current = await input.store.read(durable.receipt_id);
			if (current) durable = current;
		}
		durable = settleIncompleteAttempt(durable, {
			kind: "interruption",
			updatedAt: input.now(),
		});
		if (crossedDispatch) {
			await persistPostDispatchReceipt(input.store, durable);
		} else {
			await input.store.write(durable);
		}
		return { receipt: durable, classification };
	}

	if (result.timedOut) {
		const classification: ProviderResultClassification = {
			class: "transport_or_client_policy_failure",
			code: "provider_timeout",
			message: "Provider execution timed out after dispatch.",
		};
		durable = settleIncompleteAttempt(durable, {
			kind: "timeout",
			updatedAt: input.now(),
		});
		await persistPostDispatchReceipt(input.store, durable);
		return { receipt: durable, classification };
	}

	if (result.outputLimitExceeded) {
		const classification: ProviderResultClassification = {
			class: "transport_or_client_policy_failure",
			code: "provider_output_limit",
			message: "Provider output exceeded the controller byte ceiling.",
		};
		durable = settleIncompleteAttempt(durable, {
			kind: "output_limit",
			updatedAt: input.now(),
		});
		await persistPostDispatchReceipt(input.store, durable);
		return { receipt: durable, classification };
	}

	const parsed = parseProviderOutput(result);
	const classification = classifyProviderResult(parsed.observation);
	durable = settleTerminalResult(durable, classification, input.now());
	await persistPostDispatchReceipt(input.store, durable);
	return {
		receipt: durable,
		classification,
		...(parsed.providerData === undefined
			? {}
			: { provider_data: redactValue(parsed.providerData) }),
	};
}

async function persistPostDispatchReceipt(
	store: ReceiptStore,
	receipt: ExecutionReceipt,
): Promise<void> {
	try {
		await store.write(receipt);
	} catch {
		throw new OutcomeUnknownError(
			"Provider dispatch crossed the boundary but its settled receipt was not durable.",
		);
	}
}

export function settleTerminalResult(
	receipt: ExecutionReceipt,
	classification: ProviderResultClassification,
	updatedAt: string,
): ExecutionReceipt {
	if (receipt.state !== "dispatched" && receipt.state !== "prepared") {
		throw new Error("Only active work can settle terminal.");
	}
	return {
		...receipt,
		state: "terminal",
		result: summarizeClassification(classification),
		terminal_reason: classification.class,
		updated_at: updatedAt,
	};
}

function parseProviderOutput(result: TransportCommandResult): {
	observation:
		| { kind: "transport_failure"; code: string; message: string }
		| { kind: "response"; value: unknown };
	providerData?: unknown;
} {
	if (result.exitCode !== 0) {
		return {
			observation: {
				kind: "transport_failure",
				code: `provider_exit_${result.exitCode}`,
				message: "Provider process exited without a successful response.",
			},
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(result.stdout) as unknown;
	} catch {
		value = undefined;
	}
	const response =
		isRecord(value) &&
		("jsonrpc" in value || "result" in value || "error" in value)
			? value
			: { jsonrpc: "2.0", id: "local", result: value };
	return {
		observation: { kind: "response", value: response },
		providerData: value,
	};
}

async function ensurePrivateDirectory(root: string): Promise<void> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
}

function receiptPath(root: string, receiptId: string): string {
	if (!RECEIPT_ID_PATTERN.test(receiptId)) {
		throw new Error("Receipt id is invalid.");
	}
	return join(root, `${receiptId}.json`);
}

function isMissingFileError(error: unknown): boolean {
	return hasErrorCode(error, "ENOENT");
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

function sameDispatchCandidate(
	current: ExecutionReceipt,
	expected: ExecutionReceipt,
): boolean {
	return (
		current.state === "prepared" &&
		current.receipt_id === expected.receipt_id &&
		current.adapter === expected.adapter &&
		current.route === expected.route &&
		current.checkpoint_id === expected.checkpoint_id &&
		current.attempt === expected.attempt &&
		current.request_fingerprint === expected.request_fingerprint &&
		current.config_fingerprint === expected.config_fingerprint &&
		JSON.stringify(current.approval) === JSON.stringify(expected.approval)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	label: string,
): void {
	const unsupported = Object.keys(value).find((key) => !allowed.has(key));
	if (unsupported) throw new Error(`${label} has unsupported field: ${unsupported}.`);
}

export function validateQualificationCell(value: unknown): asserts value is PreparedRequest["qualification_cell"] {
	if (!isRecord(value)) throw new Error("Qualification cell must be an object.");
	assertOnlyFields(
		value,
		new Set(["lane", "client", "provider", "route"]),
		"Qualification cell",
	);
	if (!QUALIFICATION_LANES.includes(value.lane as never)) {
		throw new Error("Qualification cell lane is invalid.");
	}
	for (const key of ["client", "provider", "route"] as const) {
		if (typeof value[key] !== "string" || value[key].trim() === "") {
			throw new Error(`Qualification cell ${key} is required.`);
		}
	}
}

export function validateFingerprint(value: unknown): asserts value is string {
	if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
		throw new Error("Value must be a sha256 fingerprint.");
	}
}

function validateApprovalBinding(
	value: unknown,
): asserts value is ApprovalBinding {
	if (!isRecord(value)) throw new Error("Receipt approval must be an object.");
	assertOnlyFields(
		value,
		new Set([
			"approval_surface",
			"approved_at",
			"expires_at",
			"request_fingerprint",
			"route",
			"attempt",
			"checkpoint_id",
		]),
		"Receipt approval",
	);
	if (value.approval_surface !== "task_policy") {
		throw new Error("Receipt approval surface is invalid.");
	}
	for (const key of [
		"approved_at",
		"expires_at",
		"request_fingerprint",
		"route",
		"checkpoint_id",
	] as const) {
		if (typeof value[key] !== "string" || value[key].trim() === "") {
			throw new Error(`Receipt approval ${key} is required.`);
		}
	}
	validateFingerprint(value.request_fingerprint);
	for (const key of ["approved_at", "expires_at"] as const) {
		if (Number.isNaN(Date.parse(String(value[key])))) {
			throw new Error(`Receipt approval ${key} must be a timestamp.`);
		}
	}
	if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1) {
		throw new Error("Receipt approval attempt is invalid.");
	}
}

export function validateResultSummary(value: unknown): void {
	if (!isRecord(value)) throw new Error("Receipt result must be an object.");
	assertOnlyFields(
		value,
		new Set(["class", "code", "result_fingerprint"]),
		"Receipt result",
	);
	if (
		![
			"transport_or_client_policy_failure",
			"jsonrpc_protocol_or_server_error",
			"tool_error",
			"successful_tool_result",
		].includes(String(value.class))
	) {
		throw new Error("Receipt result class is invalid.");
	}
	for (const key of ["code", "result_fingerprint"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw new Error(`Receipt result ${key} must be a string.`);
		}
	}
	if (value.result_fingerprint !== undefined) {
		validateFingerprint(value.result_fingerprint);
	}
	if (value.code !== undefined) {
		const code = String(value.code);
		const valid =
			value.class === "jsonrpc_protocol_or_server_error"
				? JSONRPC_CODE.test(code)
				: value.class === "transport_or_client_policy_failure" &&
					SAFE_TRANSPORT_CODE.test(code);
		if (!valid) throw new Error("Receipt result code is invalid.");
	}
}

function validateAdapterBinding(
	adapter: unknown,
	route: unknown,
	cell: PreparedRequest["qualification_cell"],
	label: string,
): void {
	const expected = ADAPTER_BINDINGS[adapter as keyof typeof ADAPTER_BINDINGS];
	if (
		!expected ||
		route !== expected.route ||
		cell.lane !== expected.lane ||
		cell.client !== expected.client ||
		cell.provider !== expected.provider ||
		cell.route !== expected.route
	) {
		throw new Error(`${label} adapter binding is invalid.`);
	}
}

function assertNoAuthorityBearingFields(value: unknown): void {
	if (Array.isArray(value)) {
		for (const entry of value) assertNoAuthorityBearingFields(entry);
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, entry] of Object.entries(value)) {
		if (AUTHORITY_BEARING_FIELD.test(key)) {
			throw new Error(`Adapter request contains authority-bearing field: ${key}.`);
		}
		assertNoAuthorityBearingFields(entry);
	}
}

async function reapAbandonedPreparedDispatchLock(
	lockPath: string,
	expected: ExecutionReceipt,
	store: ReceiptStore,
): Promise<boolean> {
	let before: Awaited<ReturnType<typeof stat>>;
	let contents: string;
	try {
		[before, contents] = await Promise.all([
			stat(lockPath),
			readFile(lockPath, "utf8"),
		]);
	} catch (error) {
		if (isMissingFileError(error)) return true;
		throw error;
	}
	let abandoned = false;
	let validOwner = false;
	try {
		const owner = JSON.parse(contents) as unknown;
		if (
			isRecord(owner) &&
			Number.isInteger(owner.pid) &&
			Number(owner.pid) > 0 &&
			typeof owner.created_at === "string" &&
			!Number.isNaN(Date.parse(owner.created_at))
		) {
			validOwner = true;
			abandoned = !isProcessAlive(Number(owner.pid));
		}
	} catch {}
	if (!validOwner) {
		abandoned = Date.now() - before.mtimeMs >= DISPATCH_LOCK_INVALID_STALE_MS;
	}
	if (!abandoned) return false;
	const current = await store.read(expected.receipt_id);
	if (!current || !sameDispatchCandidate(current, expected)) return false;
	const after = await stat(lockPath).catch((error) => {
		if (isMissingFileError(error)) return undefined;
		throw error;
	});
	if (
		!after ||
		after.ino !== before.ino ||
		after.size !== before.size ||
		after.mtimeMs !== before.mtimeMs
	) {
		return false;
	}
	await unlink(lockPath);
	return true;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !hasErrorCode(error, "ESRCH");
	}
}

function sameQualificationCell(
	left: PreparedRequest["qualification_cell"],
	right: PreparedRequest["qualification_cell"],
): boolean {
	return (
		left.lane === right.lane &&
		left.client === right.client &&
		left.provider === right.provider &&
		left.route === right.route
	);
}
