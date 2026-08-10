import { isAbsolute } from "node:path";
import type {
	BrowserUseBindingApprovalBrokerPort,
	BrowserUseApprovalPresenceRejection,
} from "./browser-use-auth-approval";
import {
	type BrowserUseBindingApprovalReceipt,
	secretShapeFindingOf,
	validateBindingApprovalReceiptShape,
} from "./browser-use-auth-bindings";
import type {
	BrowserUseBindingSelectionCeremonyPort,
	BrowserUseBindingSelectionGrant,
	BrowserUseBindingSelectionRejection,
	BrowserUseBindingSelectionRequest,
} from "./browser-use-binding-selection";
import { validateBindingSelectionGrantShape } from "./browser-use-binding-selection";

const MAXIMUM_BROKER_OUTPUT_BYTES = 1_048_576;
const BROKER_BIND_TIMEOUT_MS = 5 * 60_000;
const BROKER_SELECTION_TIMEOUT_MS = BROKER_BIND_TIMEOUT_MS + 15_000;
const MAXIMUM_NATIVE_FAILURE_MESSAGE_LENGTH = 1_024;

type NativeBindingEnvelope =
	| { ok: true; receipt: BrowserUseBindingApprovalReceipt }
	| { ok: false; code: string; message: string };

type NativeBindingSelectionEnvelope =
	| { ok: true; grant: BrowserUseBindingSelectionGrant }
	| { ok: false; code: string; message: string };

function rejectionOf(code: string, message: string): {
	ok: false;
	rejection: BrowserUseApprovalPresenceRejection;
} {
	const admitted = [
		"presence-cancelled",
		"biometric-capability-missing",
		"headless-environment",
	].includes(code)
		? (code as BrowserUseApprovalPresenceRejection["code"])
		: "broker-unavailable";
	return { ok: false, rejection: { code: admitted, message } };
}

/** Subprocess adapter for the signed broker's one-revision binding command. */
export function createNativeBindingApprovalBroker(
	executablePath: string,
): BrowserUseBindingApprovalBrokerPort {
	return {
		async issueBindingApproval(input) {
			if (!isAbsolute(executablePath)) {
				return rejectionOf(
					"broker-unavailable",
					"the approval broker path must be absolute.",
				);
			}
			try {
				const child = Bun.spawn([executablePath, "bind"], {
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
					env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
					timeout: BROKER_BIND_TIMEOUT_MS,
					maxBuffer: MAXIMUM_BROKER_OUTPUT_BYTES,
				});
				child.stdin.write(`${JSON.stringify(input)}\n`);
				child.stdin.end();
				const [exitCode, stdout] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				if (
					Buffer.byteLength(stdout, "utf8") > MAXIMUM_BROKER_OUTPUT_BYTES
				) {
					return rejectionOf("broker-unavailable", "the approval broker output exceeded its bound.");
				}
				const parsed = JSON.parse(stdout) as NativeBindingEnvelope;
				if (exitCode !== 0 || !parsed.ok) {
					return rejectionOf(
						parsed.ok ? "broker-unavailable" : parsed.code,
						parsed.ok ? "the approval broker failed closed." : parsed.message,
					);
				}
				if (validateBindingApprovalReceiptShape(parsed.receipt).length > 0) {
					return rejectionOf(
						"broker-unavailable",
						"the approval broker returned an invalid binding receipt.",
					);
				}
				return { ok: true, receipt: parsed.receipt };
			} catch {
				return rejectionOf(
					"broker-unavailable",
					"the approval broker could not issue a binding receipt.",
				);
			}
		},
	};
}

function selectionRejection(
	code: string,
	message: unknown,
): { ok: false; rejection: BrowserUseBindingSelectionRejection } {
	const admitted = [
		"biometric-capability-missing",
		"presence-cancelled",
		"headless-environment",
		"selection-no-response",
		"selection-ambiguous",
		"selection-candidates-drifted",
	].includes(code)
		? (code as BrowserUseBindingSelectionRejection["code"])
		: "broker-unavailable";
	return {
		ok: false,
		rejection: {
			code: admitted,
			message:
				typeof message === "string" &&
				message.length > 0 &&
				message.length <= MAXIMUM_NATIVE_FAILURE_MESSAGE_LENGTH &&
				!/[\u0000-\u001f\u007f]/.test(message) &&
				secretShapeFindingOf(message) === undefined
					? message
					: "the native binding selection failed closed.",
		},
	};
}

/** Subprocess adapter for one descriptor-private native binding selection ceremony. */
export function createNativeBindingSelectionCeremony(
	executablePath: string,
	privateOwner: {
		supervisorPath: string;
		opPath: string;
		configRoot: string;
	},
): BrowserUseBindingSelectionCeremonyPort {
	return {
		async requestBindingSelection(input: BrowserUseBindingSelectionRequest) {
			if (
				![
					executablePath,
					privateOwner.supervisorPath,
					privateOwner.opPath,
					privateOwner.configRoot,
				].every(isAbsolute)
			) {
				return selectionRejection(
					"broker-unavailable",
					"the native selection owner paths must be absolute.",
				);
			}
			try {
				const child = Bun.spawn([executablePath, "select-binding"], {
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
					env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
					timeout: BROKER_SELECTION_TIMEOUT_MS,
					maxBuffer: MAXIMUM_BROKER_OUTPUT_BYTES,
				});
				child.stdin.write(
					`${JSON.stringify({
						...input,
						private_owner: {
							supervisor_path: privateOwner.supervisorPath,
							op_path: privateOwner.opPath,
							config_root: privateOwner.configRoot,
						},
					})}\n`,
				);
				child.stdin.end();
				const [exitCode, stdout] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				if (Buffer.byteLength(stdout, "utf8") > MAXIMUM_BROKER_OUTPUT_BYTES) {
					return selectionRejection(
						"broker-unavailable",
						"the native selection output exceeded its bound.",
					);
				}
				const parsed = JSON.parse(stdout) as NativeBindingSelectionEnvelope;
				if (exitCode !== 0 || !parsed.ok) {
					return selectionRejection(
						parsed.ok ? "broker-unavailable" : parsed.code,
						parsed.ok
							? "the native binding selection failed closed."
							: parsed.message,
					);
				}
				if (validateBindingSelectionGrantShape(parsed.grant).length > 0) {
					return selectionRejection(
						"broker-unavailable",
						"the native selection owner returned an invalid grant.",
					);
				}
				return { ok: true, grant: parsed.grant };
			} catch {
				return selectionRejection(
					"broker-unavailable",
					"the native binding selection ceremony was unavailable.",
				);
			}
		},
	};
}
