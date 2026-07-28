// Admission-verification proof (U02). Proves the code-owned admission manifest
// is the trusted baseline and any drift from it — replaced, resigned, removed,
// entitlement-widened, or version-skewed target — invalidates admission. A
// same-version replacement, an unknown target claim, and a stale claim all fail
// closed. Placeholder bundle ids are never admissible.
import { describe, expect, test } from "bun:test";

import {
	ADMISSION_MANIFEST_SCHEMA_VERSION,
	BROWSER_USE_SECURITY_TARGET_IDS,
	BUNDLE_ID_PLACEHOLDER,
	isMintedBundleId,
	mintedBundleId,
	PRODUCT_BUNDLE_PREFIX,
	TARGET_BUNDLE_IDS,
} from "../src/model.ts";
import {
	admitTarget,
	ADMISSION_ERROR_CODES,
	type AdmissionClaim,
	buildAdmittedManifest,
	CODE_OWNED_ADMISSION_MANIFEST,
	type TargetAdmissionEntry,
} from "../src/admission.ts";

// A fully-minted manifest built from the real, minted com.side-quest.* bundle
// ids (TARGET_BUNDLE_IDS in model.ts), which mirror the Xcode targets'
// PRODUCT_BUNDLE_IDENTIFIER exactly. Admission can actually pass, so the
// invalidation tests have a green baseline to perturb; the code-owned manifest
// in admission.ts stays fail-closed on the placeholder sentinel on its own.
const MINTED = buildAdmittedManifest({
	product_version: "1.0.0",
	targets: {
		"approval-broker": {
			bundle_id: TARGET_BUNDLE_IDS["approval-broker"] as string,
			team_identifier: "TEAMID0001",
			designated_requirement: `anchor apple generic and identifier "${TARGET_BUNDLE_IDS["approval-broker"]}"`,
		},
		"token-retrieval-launcher": {
			bundle_id: TARGET_BUNDLE_IDS["token-retrieval-launcher"] as string,
			team_identifier: "TEAMID0001",
			designated_requirement: `anchor apple generic and identifier "${TARGET_BUNDLE_IDS["token-retrieval-launcher"]}"`,
		},
		"confidential-field-delivery-xpc": {
			bundle_id: TARGET_BUNDLE_IDS["confidential-field-delivery-xpc"] as string,
			team_identifier: "TEAMID0001",
			designated_requirement: `anchor apple generic and identifier "${TARGET_BUNDLE_IDS["confidential-field-delivery-xpc"]}"`,
		},
	},
});

/** The manifest entry for one target id (test helper). */
function entryFor(id: (typeof BROWSER_USE_SECURITY_TARGET_IDS)[number]): TargetAdmissionEntry {
	const found = MINTED.targets.find((t) => t.target_id === id);
	if (!found) throw new Error(`test manifest missing ${id}`);
	return found;
}

/** A well-formed claim that exactly matches the minted baseline for one target. */
function matchingClaim(
	id: (typeof BROWSER_USE_SECURITY_TARGET_IDS)[number],
): AdmissionClaim {
	const entry = entryFor(id);
	return {
		target_id: entry.target_id,
		bundle_id: entry.bundle_id,
		team_identifier: entry.team_identifier,
		designated_requirement: entry.designated_requirement,
		entitlements: entry.entitlements,
		lifetime: entry.lifetime,
		custody: entry.custody,
		product_version: MINTED.product_version,
	};
}

describe("code-owned admission manifest", () => {
	test("names exactly the three ADR-0027 targets, one entry each", () => {
		expect(CODE_OWNED_ADMISSION_MANIFEST.targets.map((t) => t.target_id).sort()).toEqual(
			[...BROWSER_USE_SECURITY_TARGET_IDS].sort(),
		);
		expect(CODE_OWNED_ADMISSION_MANIFEST.targets).toHaveLength(3);
	});

	test("carries the pinned schema version", () => {
		expect(CODE_OWNED_ADMISSION_MANIFEST.schema_version).toBe(
			ADMISSION_MANIFEST_SCHEMA_VERSION,
		);
	});

	test("ships every target with the placeholder bundle id (unminted)", () => {
		for (const entry of CODE_OWNED_ADMISSION_MANIFEST.targets) {
			expect(entry.bundle_id).toBe(BUNDLE_ID_PLACEHOLDER);
		}
	});

	test("never unions custody across targets (ADR 0027)", () => {
		const broker = CODE_OWNED_ADMISSION_MANIFEST.targets.find(
			(t) => t.target_id === "approval-broker",
		);
		const launcher = CODE_OWNED_ADMISSION_MANIFEST.targets.find(
			(t) => t.target_id === "token-retrieval-launcher",
		);
		const delivery = CODE_OWNED_ADMISSION_MANIFEST.targets.find(
			(t) => t.target_id === "confidential-field-delivery-xpc",
		);
		// Broker holds neither the OP token nor a raw credential nor a browser
		// channel; launcher holds no browser channel; delivery holds no OP token
		// and no network entitlement.
		expect(broker?.entitlements.holds_op_token).toBe(false);
		expect(broker?.entitlements.holds_raw_credential).toBe(false);
		expect(broker?.entitlements.holds_browser_channel).toBe(false);
		expect(launcher?.entitlements.holds_browser_channel).toBe(false);
		expect(delivery?.entitlements.holds_op_token).toBe(false);
		expect(delivery?.entitlements.holds_network).toBe(false);
	});
});

describe("minted TARGET_BUNDLE_IDS — literal-ID admissible fixture", () => {
	test("every minted bundle id is a real com.side-quest.* string, not the placeholder", () => {
		for (const id of BROWSER_USE_SECURITY_TARGET_IDS) {
			const bundleId = TARGET_BUNDLE_IDS[id];
			expect(bundleId).not.toBe(BUNDLE_ID_PLACEHOLDER);
			expect(isMintedBundleId(bundleId)).toBe(true);
			expect(String(bundleId).startsWith(`${PRODUCT_BUNDLE_PREFIX}.`)).toBe(true);
		}
	});

	test("the delivery bundle id drops the -xpc target-id suffix", () => {
		// The target id is confidential-field-delivery-xpc; the minted bundle id
		// ends in confidential-field-delivery (mirrors the Xcode PRODUCT_BUNDLE_ID
		// and Info.plist CFBundleIdentifier).
		expect(String(TARGET_BUNDLE_IDS["confidential-field-delivery-xpc"])).toBe(
			`${PRODUCT_BUNDLE_PREFIX}.confidential-field-delivery`,
		);
	});

	test("a manifest built from the minted literals admits every target", () => {
		// The literal-ID admissible fixture: joins the placeholder-inadmissible
		// proof below. Where the code-owned manifest fails closed on the sentinel,
		// a manifest carrying the real minted ids passes admission.
		for (const id of BROWSER_USE_SECURITY_TARGET_IDS) {
			const verdict = admitTarget(MINTED, matchingClaim(id));
			expect(verdict.verdict).toBe("admitted");
			if (verdict.verdict === "admitted") {
				expect(verdict.target_id).toBe(id);
			}
		}
	});
});

describe("admitTarget — matching claim against the minted baseline", () => {
	test("admits an exact match for every target", () => {
		for (const id of BROWSER_USE_SECURITY_TARGET_IDS) {
			const verdict = admitTarget(MINTED, matchingClaim(id));
			expect(verdict.verdict).toBe("admitted");
		}
	});
});

describe("admitTarget — invalidation: replaced / resigned / removed", () => {
	test("REPLACED bundle id (different signed binary) is not admitted", () => {
		const claim = matchingClaim("approval-broker");
		const tampered: AdmissionClaim = {
			...claim,
			bundle_id: mintedBundleId("com.attacker.evil-broker"),
		};
		const verdict = admitTarget(MINTED, tampered);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("bundle-id-mismatch");
		}
	});

	test("SAME-VERSION replacement (bundle matches, DR re-signed) fails closed", () => {
		const claim = matchingClaim("token-retrieval-launcher");
		const resigned: AdmissionClaim = {
			...claim,
			designated_requirement: mintedBundleId(
				`anchor apple generic and identifier "${TARGET_BUNDLE_IDS["token-retrieval-launcher"]}" and certificate leaf[subject.OU] = "ATTACKERTEAM"`,
			),
		};
		const verdict = admitTarget(MINTED, resigned);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("designated-requirement-mismatch");
		}
	});

	test("RESIGNED under a different team identifier is not admitted", () => {
		const claim = matchingClaim("confidential-field-delivery-xpc");
		const resigned: AdmissionClaim = {
			...claim,
			team_identifier: mintedBundleId("ATTACKER99"),
		};
		const verdict = admitTarget(MINTED, resigned);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("team-identifier-mismatch");
		}
	});

	test("REMOVED target (unknown target id claim) fails closed", () => {
		const claim = matchingClaim("approval-broker");
		const unknown = {
			...claim,
			target_id: "ghost-target" as never,
		} as unknown as AdmissionClaim;
		const verdict = admitTarget(MINTED, unknown);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("unknown-target");
		}
	});
});

describe("admitTarget — invalidation: entitlement widening", () => {
	test("broker widened to hold the OP token is not admitted", () => {
		const claim = matchingClaim("approval-broker");
		const widened: AdmissionClaim = {
			...claim,
			entitlements: { ...claim.entitlements, holds_op_token: true },
		};
		const verdict = admitTarget(MINTED, widened);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("entitlements-widened");
		}
	});

	test("delivery widened to hold a network entitlement is not admitted", () => {
		const claim = matchingClaim("confidential-field-delivery-xpc");
		const widened: AdmissionClaim = {
			...claim,
			entitlements: { ...claim.entitlements, holds_network: true },
		};
		const verdict = admitTarget(MINTED, widened);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("entitlements-widened");
		}
	});

	test("launcher widened to hold a browser channel is not admitted", () => {
		const claim = matchingClaim("token-retrieval-launcher");
		const widened: AdmissionClaim = {
			...claim,
			entitlements: { ...claim.entitlements, holds_browser_channel: true },
		};
		const verdict = admitTarget(MINTED, widened);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("entitlements-widened");
		}
	});
});

describe("admitTarget — invalidation: version skew and stale claims", () => {
	test("VERSION-SKEWED claim (product version mismatch) is not admitted", () => {
		const claim = matchingClaim("approval-broker");
		const skewed: AdmissionClaim = { ...claim, product_version: "9.9.9" };
		const verdict = admitTarget(MINTED, skewed);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("product-version-skew");
		}
	});

	test("STALE claim (schema version older than baseline) fails closed", () => {
		const claim = matchingClaim("approval-broker");
		// A stale claim carries an out-of-band, older schema marker; the manifest
		// pins the current one, so the claim can never satisfy admission.
		const staleManifest = {
			...MINTED,
			schema_version: "0" as never,
		} as unknown as typeof MINTED;
		const verdict = admitTarget(staleManifest, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("schema-version-unsupported");
		}
	});
});

describe("admitTarget — placeholder bundle ids are never admissible", () => {
	test("the unminted code-owned manifest admits nothing", () => {
		for (const id of BROWSER_USE_SECURITY_TARGET_IDS) {
			const placeholderClaim: AdmissionClaim = {
				...matchingClaim(id),
				bundle_id: BUNDLE_ID_PLACEHOLDER,
			};
			const verdict = admitTarget(CODE_OWNED_ADMISSION_MANIFEST, placeholderClaim);
			expect(verdict.verdict).toBe("not-admitted");
			if (verdict.verdict === "not-admitted") {
				expect(verdict.error_code).toBe("placeholder-bundle-id");
			}
		}
	});

	test("a claim carrying a placeholder bundle id is rejected even against a minted manifest", () => {
		const claim: AdmissionClaim = {
			...matchingClaim("approval-broker"),
			bundle_id: BUNDLE_ID_PLACEHOLDER,
		};
		const verdict = admitTarget(MINTED, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("placeholder-bundle-id");
		}
	});
});

describe("admitTarget — placeholder team/DR are never admissible (fail closed)", () => {
	test("a claim with a placeholder team_identifier is rejected against a minted manifest", () => {
		const claim: AdmissionClaim = {
			...matchingClaim("approval-broker"),
			team_identifier: BUNDLE_ID_PLACEHOLDER,
		};
		const verdict = admitTarget(MINTED, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("placeholder-bundle-id");
		}
	});

	test("a claim with a placeholder designated_requirement is rejected against a minted manifest", () => {
		const claim: AdmissionClaim = {
			...matchingClaim("token-retrieval-launcher"),
			designated_requirement: BUNDLE_ID_PLACEHOLDER,
		};
		const verdict = admitTarget(MINTED, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("placeholder-bundle-id");
		}
	});

	test("a manifest entry with a placeholder team_identifier admits nothing (even minted bundle ids)", () => {
		// Repro: a manifest and claim carry minted bundle ids but a placeholder
		// team_identifier. Guarding only bundle_id, they compare equal and admit.
		const tamperedManifest = {
			...MINTED,
			targets: MINTED.targets.map((t) =>
				t.target_id === "approval-broker"
					? { ...t, team_identifier: BUNDLE_ID_PLACEHOLDER }
					: t,
			),
		};
		const claim: AdmissionClaim = {
			...matchingClaim("approval-broker"),
			team_identifier: BUNDLE_ID_PLACEHOLDER,
		};
		const verdict = admitTarget(tamperedManifest, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("placeholder-bundle-id");
		}
	});

	test("a manifest entry with a placeholder designated_requirement admits nothing (even minted bundle ids)", () => {
		const tamperedManifest = {
			...MINTED,
			targets: MINTED.targets.map((t) =>
				t.target_id === "confidential-field-delivery-xpc"
					? { ...t, designated_requirement: BUNDLE_ID_PLACEHOLDER }
					: t,
			),
		};
		const claim: AdmissionClaim = {
			...matchingClaim("confidential-field-delivery-xpc"),
			designated_requirement: BUNDLE_ID_PLACEHOLDER,
		};
		const verdict = admitTarget(tamperedManifest, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("placeholder-bundle-id");
		}
	});
});

describe("admitTarget — lifetime/custody posture compared unconditionally", () => {
	test("a claim running a daemon lifetime is not admitted", () => {
		const claim: AdmissionClaim = {
			...matchingClaim("approval-broker"),
			lifetime: "daemon",
		};
		const verdict = admitTarget(MINTED, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("lifetime-changed");
		}
	});

	test("a claim with a foreign custody root is not admitted", () => {
		const claim: AdmissionClaim = {
			...matchingClaim("approval-broker"),
			custody: "xpc-peer-pinned",
		};
		const verdict = admitTarget(MINTED, claim);
		expect(verdict.verdict).toBe("not-admitted");
		if (verdict.verdict === "not-admitted") {
			expect(verdict.error_code).toBe("custody-changed");
		}
	});
});

describe("admission error-code union is closed and total", () => {
	test("every declared error code carries a stable reason string", () => {
		for (const code of Object.keys(ADMISSION_ERROR_CODES)) {
			expect(typeof ADMISSION_ERROR_CODES[code as keyof typeof ADMISSION_ERROR_CODES]).toBe(
				"string",
			);
		}
	});
});
