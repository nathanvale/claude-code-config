import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	type BrowserUseReviewedActionPromotionBrokerPort,
	type BrowserUseReviewedActionPromotionReceipt,
	type BrowserUseReviewedActionVerifierIdentity,
	REVIEWED_ACTION_VERIFIER_CONTRACT,
	REVIEWED_ACTION_VERIFIER_FILE,
	REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION,
	createP256ReviewedActionApprovalVerifier,
	createReviewedActionPromotionRouter,
	reviewedActionPromotionReceiptIsValid,
	reviewedActionVerifierIdentityIsValid,
} from "./browser-use-reviewed-action-approval";
import { promoteReviewedActionCandidate } from "./browser-use-reviewed-action-authoring";
import { resolveBrowserUsePaths } from "./browser-use-paths";

const VERIFIER_CONTRACT = REVIEWED_ACTION_VERIFIER_CONTRACT;
const VERIFIER_SCHEMA_VERSION = REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION;
const VERIFIER_FILE = REVIEWED_ACTION_VERIFIER_FILE;
const PROMOTION_REQUEST_CONTRACT =
	"browser-use.reviewed-action-promotion-request";
const PROMOTION_RESPONSE_CONTRACT =
	"browser-use.reviewed-action-promotion-response";
const PROMOTION_SCHEMA_VERSION = "1";
const MAXIMUM_BROKER_OUTPUT_BYTES = 1_048_576;
const BROKER_PROMOTE_TIMEOUT_MS = 5 * 60_000;
const BROKER_VERIFIER_TIMEOUT_MS = 30_000;
const SAFE_BROKER_CODE = /^[a-z0-9][a-z0-9-]{0,127}$/;

type PromotionRejectionCode =
	| "biometric-capability-missing"
	| "presence-cancelled"
	| "headless-environment"
	| "signing-key-missing"
	| "signing-key-already-enrolled"
	| "signing-key-custody-invalid"
	| "broker-response-unknown"
	| "broker-failed";

const PROMOTION_REJECTION_CODES = new Set<PromotionRejectionCode>([
	"biometric-capability-missing",
	"presence-cancelled",
	"headless-environment",
	"signing-key-missing",
	"signing-key-already-enrolled",
	"signing-key-custody-invalid",
	"broker-response-unknown",
	"broker-failed",
] as const);

/** Operator broker surface: public identity discovery plus presence-backed issuance. */
export type BrowserUseReviewedActionOperatorBroker =
	BrowserUseReviewedActionPromotionBrokerPort & {
		readVerifierIdentity(): Promise<
			| { ok: true; identity: BrowserUseReviewedActionVerifierIdentity }
			| { ok: false; code: string; message: string }
		>;
	};

type NativeBrokerOutput = {
	exitCode: number;
	stdout: string;
};

type NativePromotionResponse =
	| { ok: true; receipt: BrowserUseReviewedActionPromotionReceipt }
	| { ok: false; code: string; message: string };

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parsePromotionResponse(value: unknown): NativePromotionResponse | undefined {
	const response = recordOf(value);
	if (
		response === undefined ||
		response.contract !== PROMOTION_RESPONSE_CONTRACT ||
		response.schema_version !== PROMOTION_SCHEMA_VERSION ||
		typeof response.ok !== "boolean"
	) {
		return undefined;
	}
	if (response.ok) {
		return exactKeys(response, ["contract", "schema_version", "ok", "receipt"]) &&
			reviewedActionPromotionReceiptIsValid(response.receipt)
			? { ok: true, receipt: response.receipt }
			: undefined;
	}
	return exactKeys(response, [
		"contract",
		"schema_version",
		"ok",
		"code",
		"message",
	]) &&
		typeof response.code === "string" &&
		SAFE_BROKER_CODE.test(response.code) &&
		typeof response.message === "string" &&
		response.message.length > 0 &&
		Buffer.byteLength(response.message, "utf8") <= 4096
		? { ok: false, code: response.code, message: response.message }
		: undefined;
}

async function invokeNativeBroker(
	executablePath: string,
	command: "verifier" | "promote",
	input?: unknown,
): Promise<NativeBrokerOutput | undefined> {
	if (!isAbsolute(executablePath)) return undefined;
	try {
		const child = Bun.spawn([executablePath, command], {
			stdin: input === undefined ? "ignore" : "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
			timeout:
				command === "promote"
					? BROKER_PROMOTE_TIMEOUT_MS
					: BROKER_VERIFIER_TIMEOUT_MS,
			maxBuffer: MAXIMUM_BROKER_OUTPUT_BYTES,
		});
		if (input !== undefined) {
			if (child.stdin === undefined) return undefined;
			child.stdin.write(`${JSON.stringify(input)}\n`);
			child.stdin.end();
		}
		const [exitCode, stdout] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return Buffer.byteLength(stdout, "utf8") <= MAXIMUM_BROKER_OUTPUT_BYTES
			? { exitCode, stdout }
			: undefined;
	} catch {
		return undefined;
	}
}

function unknownPromotionResponse() {
	return {
		ok: false as const,
		rejection: {
			code: "broker-response-unknown" as const,
			message:
				"the broker may have dispatched signing; retry requires a fresh operator action",
		},
	};
}

/** Create the subprocess adapter for the signed, OS-isolated approval broker. */
export function createNativeReviewedActionOperatorBroker(
	executablePath: string,
): BrowserUseReviewedActionOperatorBroker {
	return {
		async readVerifierIdentity() {
			if (!isAbsolute(executablePath)) {
				return {
					ok: false,
					code: "broker-path-invalid",
					message: "the approval broker path must be absolute.",
				};
			}
			const result = await invokeNativeBroker(executablePath, "verifier");
			if (result === undefined || result.exitCode !== 0) {
				return {
					ok: false,
					code: "broker-failed",
					message: "the native approval broker failed closed.",
				};
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(result.stdout);
			} catch {
				parsed = undefined;
			}
			const envelope = recordOf(parsed);
			const identity = recordOf(envelope?.verifier);
			if (
				envelope === undefined ||
				!exactKeys(envelope, ["ok", "verifier"]) ||
				envelope.ok !== true ||
				identity === undefined ||
				!reviewedActionVerifierIdentityIsValid(
					identity as BrowserUseReviewedActionVerifierIdentity,
				)
			) {
				return {
					ok: false,
					code: "broker-verifier-invalid",
					message: "the native broker returned an invalid verifier identity.",
				};
			}
			return {
				ok: true,
				identity: identity as BrowserUseReviewedActionVerifierIdentity,
			};
		},
		async issueReviewedActionPromotion(input) {
			if (!isAbsolute(executablePath)) {
				return {
					ok: false,
					rejection: {
						code: "broker-failed",
						message: "the approval broker path must be absolute.",
					},
				};
			}
			const result = await invokeNativeBroker(executablePath, "promote", {
				contract: PROMOTION_REQUEST_CONTRACT,
				schema_version: PROMOTION_SCHEMA_VERSION,
				...input,
			});
			if (result === undefined) return unknownPromotionResponse();
			let parsed: unknown;
			try {
				parsed = JSON.parse(result.stdout);
			} catch {
				return unknownPromotionResponse();
			}
			const response = parsePromotionResponse(parsed);
			if (response === undefined || (response.ok && result.exitCode !== 0)) {
				return unknownPromotionResponse();
			}
			if (!response.ok) {
				const code = PROMOTION_REJECTION_CODES.has(
					response.code as PromotionRejectionCode,
				)
					? (response.code as PromotionRejectionCode)
					: "broker-failed";
				return {
					ok: false,
					rejection: { code, message: response.message },
				};
			}
			return { ok: true, receipt: response.receipt };
		},
	};
}

async function pinVerifierIdentity(
	env: Record<string, string | undefined>,
	identity: BrowserUseReviewedActionVerifierIdentity,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
	const resolved = resolveBrowserUsePaths(env);
	if (!resolved.ok) return { ok: false, code: resolved.refusal.code, message: resolved.refusal.message };
	const configRoot = resolved.resolution.roots.config;
	const path = join(configRoot, VERIFIER_FILE);
	try {
		await mkdir(configRoot, { recursive: true, mode: 0o700 });
		const rootStat = await lstat(configRoot);
		const uid = process.getuid?.();
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) !== 0 || (uid !== undefined && rootStat.uid !== uid)) {
			return { ok: false, code: "action_promotion_verifier_store_unsafe", message: "the Browser Use config root is not private and owner-controlled." };
		}
		const bytes = `${JSON.stringify({ contract: VERIFIER_CONTRACT, schema_version: VERIFIER_SCHEMA_VERSION, ...identity }, null, 2)}\n`;
		const existing = await readFile(path, "utf8").catch(() => undefined);
		if (existing !== undefined) {
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || existing !== bytes) {
				return { ok: false, code: "action_promotion_verifier_pin_mismatch", message: "the pinned Reviewed Action verifier differs from the admitted broker." };
			}
			return { ok: true };
		}
		const handle = await open(path, "wx", 0o600);
		try {
			await handle.writeFile(bytes, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		return { ok: true };
	} catch {
		return { ok: false, code: "action_promotion_verifier_store_unsafe", message: "the Reviewed Action verifier pin could not be persisted safely." };
	}
}

/** Run the complete operator-only, presence-backed promotion transaction. */
export async function runReviewedActionPromotionFrontDoor(input: {
	sourceRoot: string;
	actionId: string;
	approvalReference: string;
	env: Record<string, string | undefined>;
	broker: BrowserUseReviewedActionOperatorBroker;
}) {
	const identity = await input.broker.readVerifierIdentity();
	if (!identity.ok) return identity;
	const pinned = await pinVerifierIdentity(input.env, identity.identity);
	if (!pinned.ok) return pinned;
	const verifier = createP256ReviewedActionApprovalVerifier(identity.identity);
	return promoteReviewedActionCandidate({
		sourceRoot: input.sourceRoot,
		actionId: input.actionId,
		approvalReference: input.approvalReference,
		router: createReviewedActionPromotionRouter({ broker: input.broker, verifier }),
		verifier,
	});
}
