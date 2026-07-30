import { createHash } from "node:crypto";
import { isExactLiveCleanHandoffProof } from "./browser-connect-profile-posture";
import {
	BROWSER_CONNECT_ENVIRONMENT_NAME,
	BROWSER_CONNECT_ENVIRONMENT_PROFILE,
	BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
	BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
} from "./command-contract";

const MAX_BROWSER_CONNECT_STATUS_BYTES = 64 * 1024;

export type BrowserUseProfilePostureStatus =
	| {
			state: "live-clean";
			profile_posture_receipt_digest: string;
			observed_at_epoch_ms: number;
	  }
	| { state: "missing" | "unsafe" | "unproven" };

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function exactObject(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	const record = recordOf(value);
	if (record === undefined) return false;
	const keys = Object.keys(expected);
	return (
		Object.keys(record).length === keys.length &&
		keys.every((key) => record[key] === expected[key])
	);
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested) => {
		if (
			typeof nested !== "object" ||
			nested === null ||
			Array.isArray(nested)
		) {
			return nested;
		}
		const sorted: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(nested).sort()) sorted[key] = nested[key];
		return sorted;
	});
}

function receiptDigest(data: Record<string, unknown>): string {
	const proof = data.proof as Record<string, unknown>;
	return createHash("sha256")
		.update(
			canonicalJson({
				contract: "browser-use.auth-status.profile-posture-receipt",
				schema_version: "1",
				environment: data.environment,
				endpoint: data.endpoint,
				proof: {
					environment_contract_id: proof.environment_contract_id,
					environment_schema_version: proof.environment_schema_version,
					route_evidence: proof.route_evidence,
					profile_posture: proof.profile_posture,
				},
			}),
		)
		.digest("hex");
}

/**
 * Reduce Browser Connect's read-only check envelope to one bounded posture.
 *
 * Endpoint and profile bytes are digested, never returned. Browser Connect and
 * Warm Chrome remain the proof owners; Browser Use only validates the pinned
 * public envelope and composes its redacted state.
 */
export function parseBrowserConnectProfilePostureStatus(
	raw: string,
	exitCode: number,
	now: number,
): BrowserUseProfilePostureStatus {
	if (
		!Number.isSafeInteger(now) ||
		now < 0 ||
		Buffer.byteLength(raw, "utf8") < 1 ||
		Buffer.byteLength(raw, "utf8") > MAX_BROWSER_CONNECT_STATUS_BYTES
	) {
		return { state: "unproven" };
	}
	let envelope: Record<string, unknown> | undefined;
	try {
		envelope = recordOf(JSON.parse(raw));
	} catch {
		return { state: "unproven" };
	}
	const data = recordOf(envelope?.data);
	const error = recordOf(envelope?.error);
	if (
		data === undefined ||
		data.contract_id !== BROWSER_CONNECT_HANDOFF_CONTRACT_ID ||
		data.schema_version !== BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION
	) {
		return { state: "unproven" };
	}
	if (
		exitCode === 20 &&
		envelope?.status === "error" &&
		data.outcome === "failed" &&
		error?.exit_code === 20 &&
		(envelope.process_exit_code === undefined ||
			envelope.process_exit_code === 20)
	) {
		return data.failure_class === "environment-absent" &&
			error.code === "environment_absent"
			? { state: "missing" }
			: data.failure_class === "foreign-listener" &&
					error.code === "foreign_listener"
				? { state: "unsafe" }
				: { state: "unproven" };
	}
	if (
		exitCode !== 0 ||
		envelope?.status !== "ok" ||
		data.outcome !== "verified" ||
		data.browser_entry_mode !== "explicit-cdp" ||
		!exactObject(data.environment, {
			name: BROWSER_CONNECT_ENVIRONMENT_NAME,
			profile: BROWSER_CONNECT_ENVIRONMENT_PROFILE,
		}) ||
		!exactObject(data.attachment, {
			adapter_id: "none",
			route: "explicit-cdp",
			probe_executable: "none",
		}) ||
		!exactObject(data.launch, { launched: false }) ||
		!isExactLiveCleanHandoffProof(data)
	) {
		return { state: "unproven" };
	}
	const observedAt =
		data.proof.profile_posture.effective.observer.observed_at_ms;
	if (
		!Number.isSafeInteger(observedAt) ||
		observedAt > now ||
		now - observedAt > 60_000
	) {
		return { state: "unproven" };
	}
	return {
		state: "live-clean",
		profile_posture_receipt_digest: receiptDigest(data),
		observed_at_epoch_ms: observedAt,
	};
}
