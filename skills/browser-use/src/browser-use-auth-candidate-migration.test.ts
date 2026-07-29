import { describe, expect, test } from "bun:test";
import {
	type BrowserUseImportCandidate,
	screenImportCandidate,
	secretShapeFindingOf,
	validateImportCandidateShape,
} from "./browser-use-auth-bindings";
import {
	buildAuthCandidateMigration,
	type BrowserUseLoginNarrativeSource,
	transformLoginNarrativeToCandidate,
} from "./browser-use-auth-candidate-migration";

// Already-redacted stand-ins for the three Okta narratives plus the two
// login capabilities. No personal identity, credential source, port, profile
// path, cookie/sign-out recipe, or OTP command text is present by contract.
const ELLUCIAN: BrowserUseLoginNarrativeSource = {
	serviceId: "ellucian-sso",
	loginOrigin: "https://sso.ellucian.com",
	methodShapeHint: "password-totp-three-step",
	mfaSelectionStage: true,
	contextProse: null,
	sourceRelativePath: "domains/ellucian-okta/runbook-okta-login.md",
};
const MONASH: BrowserUseLoginNarrativeSource = {
	serviceId: "monash-okta",
	loginOrigin: "https://monashuni.okta.com",
	methodShapeHint: "password-totp-four-step",
	mfaSelectionStage: true,
	contextProse: null,
	sourceRelativePath: "domains/monash-edu/runbook-okta-login.md",
};
const MONASH_QA: BrowserUseLoginNarrativeSource = {
	serviceId: "monash-qa-okta",
	loginOrigin: "https://monashuniqa.oktapreview.com",
	methodShapeHint: "password-totp-three-step",
	mfaSelectionStage: false,
	contextProse: null,
	sourceRelativePath: "domains/monash-qa-experience/runbook-okta-login.md",
};
// Two capabilities that share one vendor origin — the duplicate/ambiguous
// service-binding scenario.
const CONFLUENCE: BrowserUseLoginNarrativeSource = {
	serviceId: "monash-confluence",
	loginOrigin: "https://monash-esol.atlassian.net",
	methodShapeHint: "delegated-vendor-login",
	mfaSelectionStage: true,
	contextProse: null,
	sourceRelativePath: "domains/monash-confluence/capabilities/login.yaml",
};
const JIRA: BrowserUseLoginNarrativeSource = {
	serviceId: "monash-jira",
	loginOrigin: "https://monash-esol.atlassian.net",
	methodShapeHint: "delegated-vendor-login",
	mfaSelectionStage: true,
	contextProse: null,
	sourceRelativePath: "domains/monash-jira/capabilities/login.yaml",
};

const ALL_SOURCES = [ELLUCIAN, MONASH, MONASH_QA, CONFLUENCE, JIRA] as const;

// Every forbidden token drawn from the legacy narratives: personal identity,
// credential sources, vault names, ports, profile paths, cookie/sign-out
// recipes, and OTP command text.
const FORBIDDEN_TOKENS: readonly RegExp[] = [
	/nathan/i,
	/vale/i,
	/@monash\.edu/i,
	/@ellucian\.me/i,
	/@idmqat/i,
	/op read/i,
	/op item/i,
	/API Credentials/i,
	/IDMQAT/i,
	/\b9222\b/,
	/user_data_dir/i,
	/chrome-agent/i,
	/cookies clear/i,
	/sign\s?out|signout/i,
	/--otp/i,
	/kill/i,
];

function assertRedacted(candidate: BrowserUseImportCandidate): void {
	const serialized = JSON.stringify(candidate);
	for (const pattern of FORBIDDEN_TOKENS) {
		expect(serialized).not.toMatch(pattern);
	}
	// Every emitted string field is secret-shape clean per the auth-bindings guard.
	for (const value of [
		candidate.candidate_id,
		candidate.service_id,
		candidate.auth_context,
		candidate.provenance,
		...candidate.proposed_origins,
		...(candidate.legacy_context_prose === null
			? []
			: [candidate.legacy_context_prose]),
	]) {
		expect(secretShapeFindingOf(value)).toBeUndefined();
	}
	expect(candidate.hint_item_id).toBeNull();
	expect(candidate.legacy_vault_name).toBeNull();
}

describe("login-narrative auth candidate migration (U7, R29-R30/AE10)", () => {
	test.each([
		["ellucian narrative", ELLUCIAN, "https://sso.ellucian.com"],
		["monash narrative", MONASH, "https://monashuni.okta.com"],
		["monash QA narrative", MONASH_QA, "https://monashuniqa.oktapreview.com"],
		["confluence capability", CONFLUENCE, "https://monash-esol.atlassian.net"],
		["jira capability", JIRA, "https://monash-esol.atlassian.net"],
	] as const)(
		"transforms the %s into one admissible, screened candidate",
		(_label, source, origin) => {
			const candidate = transformLoginNarrativeToCandidate(source);

			expect(validateImportCandidateShape(candidate)).toEqual([]);
			expect(screenImportCandidate(candidate)).toEqual({
				ok: true,
				candidate,
			});
			expect(candidate).toMatchObject({
				auth_context: "interactive-login",
				service_id: source.serviceId,
				proposed_origins: [origin],
				provenance: "legacy-auth-pointer",
			});
		},
	);

	test("redacts personal identity, credential source, port, and lifecycle recipes", () => {
		for (const source of ALL_SOURCES) {
			assertRedacted(transformLoginNarrativeToCandidate(source));
		}
	});

	test("MFA variation rides as a typed method-shape hint, not executable steps", () => {
		const withSelection = transformLoginNarrativeToCandidate(MONASH);
		const withoutSelection = transformLoginNarrativeToCandidate(MONASH_QA);

		expect(withSelection.legacy_context_prose).toBe(
			"password-totp-four-step; explicit MFA method-selection stage.",
		);
		expect(withoutSelection.legacy_context_prose).toBe(
			"password-totp-three-step; no MFA method-selection stage.",
		);
		// No executable step vocabulary leaks into the hint prose.
		for (const candidate of [withSelection, withoutSelection]) {
			expect(candidate.legacy_context_prose).not.toMatch(
				/click|button|textbox|verify|fill|snapshot/i,
			);
		}
	});

	test("builds one candidate and one provenance edge per source", () => {
		const migration = buildAuthCandidateMigration(ALL_SOURCES);

		expect(migration.candidates).toHaveLength(ALL_SOURCES.length);
		expect(migration.provenance).toHaveLength(ALL_SOURCES.length);
		for (const candidate of migration.candidates) {
			assertRedacted(candidate);
		}
		expect(migration.provenance).toEqual([
			{
				source_relative_path: "domains/ellucian-okta/runbook-okta-login.md",
				service_id: "ellucian-sso",
				method_shape_hint: "password-totp-three-step",
				disposition: "migrated",
			},
			{
				source_relative_path: "domains/monash-edu/runbook-okta-login.md",
				service_id: "monash-okta",
				method_shape_hint: "password-totp-four-step",
				disposition: "migrated",
			},
			{
				source_relative_path:
					"domains/monash-qa-experience/runbook-okta-login.md",
				service_id: "monash-qa-okta",
				method_shape_hint: "password-totp-three-step",
				disposition: "migrated",
			},
			{
				source_relative_path:
					"domains/monash-confluence/capabilities/login.yaml",
				service_id: "monash-confluence",
				method_shape_hint: "delegated-vendor-login",
				disposition: "migrated",
			},
			{
				source_relative_path: "domains/monash-jira/capabilities/login.yaml",
				service_id: "monash-jira",
				method_shape_hint: "delegated-vendor-login",
				disposition: "migrated",
			},
		]);
	});

	test("same-origin capabilities stay separate candidates, never a live binding", () => {
		const migration = buildAuthCandidateMigration([CONFLUENCE, JIRA]);

		// Both propose the same vendor origin but remain distinct candidates; the
		// transform never collapses them or grants live authority.
		expect(migration.candidates.map((candidate) => candidate.service_id)).toEqual([
			"monash-confluence",
			"monash-jira",
		]);
		for (const candidate of migration.candidates) {
			expect(candidate.proposed_origins).toEqual([
				"https://monash-esol.atlassian.net",
			]);
			expect(candidate.provenance).toBe("legacy-auth-pointer");
		}
		// Distinct candidate ids keep provenance one-to-one and unambiguous.
		const ids = migration.candidates.map((candidate) => candidate.candidate_id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("rejects duplicate service ids so provenance stays one-to-one", () => {
		expect(() => buildAuthCandidateMigration([CONFLUENCE, CONFLUENCE])).toThrow(
			"distinct",
		);
	});

	test.each([
		[
			"non-lowercase service id",
			{ serviceId: "Monash_Okta" },
			"lowercase opaque service id",
		],
		[
			"non-http(s) origin",
			{ loginOrigin: "ftp://sso.ellucian.com" },
			"exact HTTP(S) login origin",
		],
		[
			"unsafe source path",
			{ sourceRelativePath: "../login.md" },
			"safe relative source",
		],
		[
			"credential-naming context prose",
			{ contextProse: "reads the account password from the vault" },
			"credential-naming value",
		],
	] as const)("rejects %s", (_label, overrides, message) => {
		expect(() =>
			transformLoginNarrativeToCandidate({ ...ELLUCIAN, ...overrides }),
		).toThrow(message);
	});

	test("normalizes a path-bearing login URL to its bare origin proposal", () => {
		const candidate = transformLoginNarrativeToCandidate({
			...ELLUCIAN,
			loginOrigin: "https://sso.ellucian.com/app/global_redirect/login",
		});

		expect(candidate.proposed_origins).toEqual(["https://sso.ellucian.com"]);
		expect(validateImportCandidateShape(candidate)).toEqual([]);
	});

	test("rejects a secret-shaped context prose", () => {
		expect(() =>
			transformLoginNarrativeToCandidate({
				...ELLUCIAN,
				contextProse: "op://API Credentials/Ellucian/password",
			}),
		).toThrow("secret-shaped");
	});
});
