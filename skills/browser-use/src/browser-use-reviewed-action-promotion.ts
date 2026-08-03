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
const MAXIMUM_BROKER_OUTPUT_BYTES = 1_048_576;
// promote blocks on a human Touch ID prompt (generous); verifier is a fast read.
const BROKER_PROMOTE_TIMEOUT_MS = 5 * 60_000;
const BROKER_VERIFIER_TIMEOUT_MS = 30_000;

/** Operator broker surface: public identity discovery plus presence-backed issuance. */
export type BrowserUseReviewedActionOperatorBroker =
	BrowserUseReviewedActionPromotionBrokerPort & {
		readVerifierIdentity(): Promise<
			| { ok: true; identity: BrowserUseReviewedActionVerifierIdentity }
			| { ok: false; code: string; message: string }
		>;
	};

type NativeBrokerEnvelope =
	| { ok: true; verifier: BrowserUseReviewedActionVerifierIdentity }
	| { ok: true; receipt: BrowserUseReviewedActionPromotionReceipt }
	| { ok: false; code: string; message: string };

async function invokeNativeBroker(
	executablePath: string,
	command: "verifier" | "promote",
	input?: unknown,
): Promise<NativeBrokerEnvelope> {
	if (!isAbsolute(executablePath)) {
		return { ok: false, code: "broker-path-invalid", message: "the approval broker path must be absolute." };
	}
	try {
		const child = Bun.spawn([executablePath, command], {
			stdin: input === undefined ? "ignore" : "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
			// Bound execution: a runaway or hung broker is killed rather than
			// blocking forever. The promote path waits on a human Touch ID prompt,
			// so the window is generous; verifier is fast. maxBuffer caps runaway output.
			timeout: command === "promote" ? BROKER_PROMOTE_TIMEOUT_MS : BROKER_VERIFIER_TIMEOUT_MS,
			maxBuffer: MAXIMUM_BROKER_OUTPUT_BYTES,
		});
		if (input !== undefined) {
			if (child.stdin === undefined) {
				return { ok: false, code: "broker-failed", message: "the native approval broker stdin is unavailable." };
			}
			child.stdin.write(`${JSON.stringify(input)}\n`);
			child.stdin.end();
		}
		const [exitCode, stdout] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (
			exitCode !== 0 ||
			Buffer.byteLength(stdout, "utf8") > MAXIMUM_BROKER_OUTPUT_BYTES
		) {
			return { ok: false, code: "broker-failed", message: "the native approval broker failed closed." };
		}
		const parsed: unknown = JSON.parse(stdout);
		if (typeof parsed !== "object" || parsed === null || typeof (parsed as { ok?: unknown }).ok !== "boolean") {
			return { ok: false, code: "broker-failed", message: "the native approval broker returned a malformed envelope." };
		}
		return parsed as NativeBrokerEnvelope;
	} catch {
		return { ok: false, code: "broker-failed", message: "the native approval broker could not be invoked." };
	}
}

/** Create the subprocess adapter for the signed, OS-isolated approval broker. */
export function createNativeReviewedActionOperatorBroker(
	executablePath: string,
): BrowserUseReviewedActionOperatorBroker {
	return {
		async readVerifierIdentity() {
			const result = await invokeNativeBroker(executablePath, "verifier");
			if (!result.ok) return result;
			if (!("verifier" in result) || !reviewedActionVerifierIdentityIsValid(result.verifier)) {
				return { ok: false, code: "broker-verifier-invalid", message: "the native broker returned an invalid verifier identity." };
			}
			return { ok: true, identity: result.verifier };
		},
		async issueReviewedActionPromotion(input) {
			const result = await invokeNativeBroker(executablePath, "promote", input);
			if (!result.ok) {
				const code = result.code === "presence-cancelled" || result.code === "biometric-capability-missing" || result.code === "headless-environment"
					? result.code
					: "broker-failed";
				return { ok: false, rejection: { code, message: result.message } };
			}
			if (!("receipt" in result) || !reviewedActionPromotionReceiptIsValid(result.receipt)) {
				return { ok: false, rejection: { code: "broker-failed", message: "the native broker returned an invalid receipt." } };
			}
			return { ok: true, receipt: result.receipt };
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
