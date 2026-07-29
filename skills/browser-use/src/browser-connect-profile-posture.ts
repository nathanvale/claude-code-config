import type {
	BrowserConnectHandoffPayload,
	BrowserConnectProfilePostureProof,
} from "@side-quest/browser-connect/contract";

const ENVIRONMENT_CONTRACT_ID = "warm-chrome.browser-entry";
const ENVIRONMENT_SCHEMA_VERSION = "2";

/**
 * Admit only the exact live-clean posture shape Browser Connect schema 3 owns.
 *
 * Keeping one strict predicate prevents native executors from drifting back to
 * legacy handoffs that carried configuration evidence but no effective browser
 * observation.
 *
 * @param value - Untrusted profile posture from a Browser Connect handoff
 * @returns True only for the exact live-clean posture contract
 *
 * @example
 * ```typescript
 * if (!isExactLiveCleanProfilePosture(handoff.proof.profile_posture)) {
 *   return refuseHandoff()
 * }
 * ```
 */
export function isExactLiveCleanProfilePosture(
	value: unknown,
): value is BrowserConnectProfilePostureProof {
	if (!hasExactKeys(value, ["state", "disk", "process", "effective"])) {
		return false;
	}
	return (
		value.state === "live-clean" &&
		hasExactKeys(value.disk, [
			"save_setting",
			"auto_signin_setting",
			"sync_setting",
			"stored_login",
		]) &&
		value.disk.save_setting === "disabled" &&
		value.disk.auto_signin_setting === "disabled" &&
		value.disk.sync_setting === "disabled" &&
		value.disk.stored_login === "live-observed-absent" &&
		hasExactKeys(value.process, [
			"disable_sync_switch",
			"disable_extensions_switch",
		]) &&
		value.process.disable_sync_switch === "present" &&
		value.process.disable_extensions_switch === "present" &&
		hasExactKeys(value.effective, [
			"observation",
			"save_capability",
			"fill_exposure",
			"sync_state",
			"save_prompt",
			"observer",
		]) &&
		value.effective.observation === "running-chrome" &&
		value.effective.save_capability === "disabled" &&
		value.effective.fill_exposure === "no-source" &&
		value.effective.sync_state === "disabled" &&
		value.effective.save_prompt === "suppressed" &&
		hasExactKeys(value.effective.observer, [
			"source",
			"browser_pid",
			"port",
			"profile_match",
			"observed_at_ms",
		]) &&
		value.effective.observer.source === "chrome-webui" &&
		isPositiveInteger(value.effective.observer.browser_pid) &&
		isNumericPort(value.effective.observer.port) &&
		value.effective.observer.profile_match === "exact" &&
		isNonNegativeFiniteNumber(value.effective.observer.observed_at_ms)
	);
}

/**
 * Bind exact live-clean posture to its Warm Chrome provenance and CDP endpoint.
 *
 * Native executors are public entry points, so they repeat this small authority
 * check even when the Browser Use front door already parsed the handoff.
 *
 * @param value - Untrusted Browser Connect handoff payload
 * @returns True only when nested proof and endpoint identify one exact browser
 */
export function isExactLiveCleanHandoffProof(
	value: unknown,
): value is BrowserConnectHandoffPayload {
	if (!isRecord(value)) return false;
	const proof = value.proof;
	const endpoint = value.endpoint;
	if (
		!hasExactKeys(proof, [
			"environment_contract_id",
			"environment_schema_version",
			"route_evidence",
			"profile_posture",
		]) ||
		proof.environment_contract_id !== ENVIRONMENT_CONTRACT_ID ||
		proof.environment_schema_version !== ENVIRONMENT_SCHEMA_VERSION ||
		proof.route_evidence !== "verified-live" ||
		!isExactLiveCleanProfilePosture(proof.profile_posture) ||
		!hasExactKeys(endpoint, ["http", "ws"])
	) {
		return false;
	}
	const httpPort = readExactLoopbackPort(endpoint.http, "http:");
	const wsPort = readExactLoopbackPort(endpoint.ws, "ws:");
	return (
		httpPort !== null &&
		httpPort === wsPort &&
		proof.profile_posture.effective.observer.port === httpPort
	);
}

function readExactLoopbackPort(
	value: unknown,
	protocol: "http:" | "ws:",
): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		if (
			url.protocol !== protocol ||
			url.hostname !== "127.0.0.1" ||
			url.username !== "" ||
			url.password !== "" ||
			url.search !== "" ||
			url.hash !== "" ||
			!isNumericPort(url.port)
		) {
			return null;
		}
		if (
			protocol === "http:" &&
			url.pathname !== "/" ||
			protocol === "ws:" &&
				!url.pathname.startsWith("/devtools/browser/")
		) {
			return null;
		}
		return url.port;
	} catch {
		return null;
	}
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNumericPort(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return false;
	const port = Number(value);
	return port >= 1 && port <= 65_535;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasExactKeys<K extends string>(
	value: unknown,
	keys: readonly K[],
): value is Record<K, unknown> {
	if (!isRecord(value)) return false;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
