import { describe, expect, test } from "bun:test";
import {
	assertNoRuntimeContractFixtureLeaks,
	RUNTIME_CONTRACT_REDACTION_FIXTURES,
} from "@side-quest/cli-command-facade/testing";

import {
	BROWSER_CONNECT_CLI_NAME,
	BROWSER_CONNECT_CONTRACT_ID,
	BROWSER_CONNECT_ENVIRONMENT_NAMES,
	BROWSER_CONNECT_FAILURE_ACTION_IDS,
	BROWSER_CONNECT_FAILURE_CLASSES,
	BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS,
	BROWSER_CONNECT_RESULT_CONTRACT,
	BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES,
	BROWSER_CONNECT_ROUTES,
	BROWSER_CONNECT_SCHEMA_VERSION,
	BROWSER_CONNECT_SUCCESS_ACTION_IDS,
	browserConnectFailureActions,
	browserConnectSuccessActions,
	createBrowserConnectEnvelopeData,
	redactBrowserConnectText,
	sanitizeBrowserConnectUsageMessage,
	type BrowserConnectEnvelopePayload,
	type BrowserConnectFailureActionId,
	type BrowserConnectFailureClass,
	type BrowserConnectFailurePayload,
	type BrowserConnectHandoffPayload,
} from "../src/model.ts";

function fixture(label: string): string {
	const found = RUNTIME_CONTRACT_REDACTION_FIXTURES.find(
		(entry) => entry.label === label,
	);
	if (!found) throw new Error(`missing redaction fixture: ${label}`);
	return found.value;
}

const credentialFixture = fixture("credential");
const bearerFixture = fixture("bearer-token");
const cookieFixture = fixture("cookie");
const localPathFixture = fixture("local-path");
const opSecretFixture = fixture("op-secret-ref");
const wsUrlFixture = fixture("browser-debugger-url");

function verifiedHandoffPayload(): BrowserConnectHandoffPayload {
	return {
		outcome: "verified",
		environment: { name: "agent-chrome" },
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: "chrome-devtools-mcp",
			route: "explicit-cdp",
			probe_executable: "chrome-devtools-mcp",
		},
		endpoint: {
			http: "http://127.0.0.1:53712",
			ws: "ws://127.0.0.1:53712/devtools/browser/verified-id",
		},
		launch: { launched: false },
		proof: {
			environment_contract_id: "warm-chrome.browser-entry",
			environment_schema_version: "1",
			route_evidence: "verified-live",
		},
	};
}

function failurePayload(
	failureClass: BrowserConnectFailureClass,
	detail?: string,
): BrowserConnectFailurePayload {
	return {
		outcome: "failed",
		failure_class: failureClass,
		next_action_id: BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS[failureClass],
		environment: { name: "agent-chrome" },
		launch: { launched: false },
		...(detail === undefined ? {} : { detail }),
	};
}

describe("browser-connect model vocabulary", () => {
	test("contract constants are stable package-owned literals", () => {
		expect(BROWSER_CONNECT_CLI_NAME).toBe("browser-connect");
		expect(BROWSER_CONNECT_CONTRACT_ID).toBe("browser-connect.verified-handoff");
		expect(BROWSER_CONNECT_SCHEMA_VERSION).toBe("1");
		expect(BROWSER_CONNECT_RESULT_CONTRACT.id).toBe(
			BROWSER_CONNECT_CONTRACT_ID,
		);
		expect(BROWSER_CONNECT_RESULT_CONTRACT.schema_version).toBe(
			BROWSER_CONNECT_SCHEMA_VERSION,
		);
	});

	test("route vocabulary pins the KTD7 three-door model", () => {
		expect(BROWSER_CONNECT_ROUTES).toEqual([
			"explicit-cdp",
			"ui-consent",
			"extension",
		]);
		expect(BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES).toEqual([
			"verified-live",
			"documented",
			"candidate",
		]);
	});

	test("environment identity vocabulary names exactly one Agent Chrome in v1", () => {
		expect(BROWSER_CONNECT_ENVIRONMENT_NAMES).toEqual(["agent-chrome"]);
	});

	test("failure classes cover the station catalog failure families", () => {
		expect(BROWSER_CONNECT_FAILURE_CLASSES).toEqual([
			"usage-invalid",
			"run-missing-separator",
			"environment-absent",
			"foreign-listener",
			"launch-failed",
			"adapter-unknown",
			"adapter-not-installed",
			"route-incompatible",
			"attachment-failed",
			"preexec-connect-failed",
			"wrapped-command-not-found",
			"runtime-error-unexpected",
		]);
	});
});

describe("browser-connect affordance catalog (R2)", () => {
	// Compile-time exhaustiveness: the catalog is a Record over the full
	// failure-class union mapping to declared failure action ids.
	const _exhaustive: Record<
		BrowserConnectFailureClass,
		BrowserConnectFailureActionId
	> = BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS;
	void _exhaustive;

	test("every failure class resolves to exactly one declared affordance id", () => {
		const mappedClasses = Object.keys(BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS);
		expect(mappedClasses.toSorted()).toEqual(
			[...BROWSER_CONNECT_FAILURE_CLASSES].toSorted(),
		);
		for (const failureClass of BROWSER_CONNECT_FAILURE_CLASSES) {
			const actionId = BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS[failureClass];
			expect(typeof actionId).toBe("string");
			expect(BROWSER_CONNECT_FAILURE_ACTION_IDS).toContain(actionId);
		}
	});

	test("every failure action id carries exactly one affordance definition", () => {
		const definedIds = browserConnectFailureActions.map((action) => action.id);
		expect(definedIds.toSorted()).toEqual(
			[...BROWSER_CONNECT_FAILURE_ACTION_IDS].toSorted(),
		);
		expect(new Set(definedIds).size).toBe(definedIds.length);
	});

	test("success affordances are declared and unique", () => {
		const definedIds = browserConnectSuccessActions.map((action) => action.id);
		expect(definedIds).toEqual([...BROWSER_CONNECT_SUCCESS_ACTION_IDS]);
		expect(new Set(definedIds).size).toBe(definedIds.length);
	});

	test("affordance summaries are prose: no command strings, nothing redactable", () => {
		for (const action of [
			...browserConnectFailureActions,
			...browserConnectSuccessActions,
		]) {
			expect(action.summary.length).toBeGreaterThan(0);
			expect(action.summary).not.toContain("`");
			expect(action.summary).not.toContain("$(");
			// Prose must survive the redaction chokepoint unchanged: a summary
			// that gets redacted is smuggling a path, option value, or secret.
			expect(redactBrowserConnectText(action.summary)).toBe(action.summary);
			assertNoRuntimeContractFixtureLeaks(action.summary);
			expect(action.sideEffects.length).toBeGreaterThan(0);
		}
	});
});

describe("browser-connect envelope data (R2/R3/R16)", () => {
	test("verified handoff round-trips JSON with contract id and schema version", () => {
		const data = createBrowserConnectEnvelopeData(verifiedHandoffPayload());
		const roundTripped = JSON.parse(JSON.stringify(data));

		expect(roundTripped.contract_id).toBe(BROWSER_CONNECT_CONTRACT_ID);
		expect(roundTripped.schema_version).toBe(BROWSER_CONNECT_SCHEMA_VERSION);
		expect(roundTripped.outcome).toBe("verified");
		expect(roundTripped.browser_entry_mode).toBe("explicit-cdp");
		expect(roundTripped.attachment.adapter_id).toBe("chrome-devtools-mcp");
		// Verified endpoint forms stay verbatim (R13-style ok-envelope exemption).
		expect(roundTripped.endpoint.http).toBe("http://127.0.0.1:53712");
		expect(roundTripped.endpoint.ws).toBe(
			"ws://127.0.0.1:53712/devtools/browser/verified-id",
		);
		// Launch provenance is mandatory and structured (R3).
		expect(roundTripped.launch).toEqual({ launched: false });
	});

	test("failure envelope round-trips with failure class and single next action", () => {
		const data = createBrowserConnectEnvelopeData(
			failurePayload("environment-absent"),
		);
		const roundTripped = JSON.parse(JSON.stringify(data));

		expect(roundTripped.contract_id).toBe(BROWSER_CONNECT_CONTRACT_ID);
		expect(roundTripped.schema_version).toBe(BROWSER_CONNECT_SCHEMA_VERSION);
		expect(roundTripped.outcome).toBe("failed");
		expect(roundTripped.failure_class).toBe("environment-absent");
		expect(roundTripped.next_action_id).toBe(
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["environment-absent"],
		);
		expect(roundTripped.launch).toEqual({ launched: false });
	});

	test("a failure envelope refuses a next action the catalog did not authorize", () => {
		const payload = {
			...failurePayload("environment-absent"),
			next_action_id: "inspect_listener",
		} as BrowserConnectFailurePayload;

		expect(() => createBrowserConnectEnvelopeData(payload)).toThrow(
			/next_action_id/,
		);
	});

	test("reserved keys are rejected in payloads", () => {
		const withContractId = {
			...verifiedHandoffPayload(),
			contract_id: "spoofed",
		} as unknown as BrowserConnectEnvelopePayload;
		const withSchemaVersion = {
			...verifiedHandoffPayload(),
			schema_version: "99",
		} as unknown as BrowserConnectEnvelopePayload;

		expect(() => createBrowserConnectEnvelopeData(withContractId)).toThrow(
			/contract_id/,
		);
		expect(() => createBrowserConnectEnvelopeData(withSchemaVersion)).toThrow(
			/schema_version/,
		);
	});
});

describe("browser-connect redaction chokepoint (R14/KTD10)", () => {
	test("redaction fixtures never appear in a serialized failure envelope", () => {
		const hostileDetail = [
			`probe exec failed: --password=${credentialFixture}`,
			`Authorization: ${bearerFixture}`,
			cookieFixture,
			`state at ${localPathFixture}`,
			`vault ref ${opSecretFixture}`,
			`advertised ${wsUrlFixture}`,
		].join(" ");

		const data = createBrowserConnectEnvelopeData(
			failurePayload("attachment-failed", hostileDetail),
		);
		const serialized = JSON.stringify(data);

		assertNoRuntimeContractFixtureLeaks(serialized);
		expect(serialized).toContain("[redacted]");
	});

	test("redactBrowserConnectText scrubs each auth-bearing shape", () => {
		expect(redactBrowserConnectText(`--password=${credentialFixture}`)).toBe(
			"[redacted]",
		);
		expect(redactBrowserConnectText(`Authorization: ${bearerFixture}`)).toBe(
			"Authorization: [redacted]",
		);
		expect(redactBrowserConnectText(cookieFixture)).toBe("[redacted]");
		expect(redactBrowserConnectText(`state ${localPathFixture}`)).toBe(
			"state [redacted]",
		);
		expect(redactBrowserConnectText(`ref ${opSecretFixture}`)).toBe(
			"ref [redacted]",
		);
		expect(redactBrowserConnectText(`saw ${wsUrlFixture}`)).toBe(
			"saw [redacted]",
		);
	});

	test("redactBrowserConnectText leaves plain prose untouched", () => {
		const prose =
			"Launch Agent Chrome, then rerun the failed command with the verified endpoint.";
		expect(redactBrowserConnectText(prose)).toBe(prose);
	});

	test("sanitizeBrowserConnectUsageMessage redacts unsafe echoed values", () => {
		expect(
			sanitizeBrowserConnectUsageMessage(
				`unexpected argument: ${localPathFixture}`,
			),
		).toBe("unexpected argument: [redacted]");
		expect(
			sanitizeBrowserConnectUsageMessage("unknown option: --auth-token=abc"),
		).toBe("unknown option: [redacted]");
		expect(
			sanitizeBrowserConnectUsageMessage("unknown option: --bogus"),
		).toBe("unknown option: --bogus");
	});
});
