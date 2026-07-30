import { describe, expect, test } from "bun:test";
import {
	REAL_CONNECT_FAILURE_ENVELOPE,
	connectFailureEnvelope,
	verifiedHandoffEnvelope,
} from "./browser-connect-handoff-fixtures";
import { parseBrowserConnectProfilePostureStatus } from "./browser-use-profile-posture";

type CheckEnvelopeFixture = {
	status: string;
	data: {
		attachment: Record<string, unknown>;
		endpoint: { http: string; ws: string };
		failure_class?: string;
		proof: {
			profile_posture: {
				state: string;
				disk: Record<string, unknown>;
				process: Record<string, unknown>;
				effective: {
					observer: {
						browser_pid: number;
						observed_at_ms: number;
					};
				};
			};
		};
	};
	error: { code: string; exit_code: number };
};

function verifiedCheckEnvelope(
	mutate?: (envelope: CheckEnvelopeFixture) => void,
): string {
	return verifiedHandoffEnvelope((envelope) => {
		envelope.data.attachment = {
			adapter_id: "none",
			route: "explicit-cdp",
			probe_executable: "none",
		};
		mutate?.(envelope as CheckEnvelopeFixture);
	});
}

describe("Browser Connect profile posture status adapter", () => {
	test("projects exact live-clean proof into one redacted digest", () => {
		expect(
			parseBrowserConnectProfilePostureStatus(
				verifiedCheckEnvelope(),
				0,
				1,
			),
		).toEqual({
			state: "live-clean",
			profile_posture_receipt_digest:
				expect.stringMatching(/^[a-f0-9]{64}$/),
			observed_at_epoch_ms: 1,
		});
	});

	test("the digest is stable across harmless JSON key ordering", () => {
		const baseline = parseBrowserConnectProfilePostureStatus(
			verifiedCheckEnvelope(),
			0,
			1,
		);
		const reordered = verifiedCheckEnvelope((envelope) => {
			envelope.data.proof.profile_posture = {
				effective: envelope.data.proof.profile_posture.effective,
				process: envelope.data.proof.profile_posture.process,
				disk: envelope.data.proof.profile_posture.disk,
				state: envelope.data.proof.profile_posture.state,
			};
		});

		expect(parseBrowserConnectProfilePostureStatus(reordered, 0, 1)).toEqual(
			baseline,
		);
	});

	test("missing and unsafe browser entry stay distinct", () => {
		expect(
			parseBrowserConnectProfilePostureStatus(
				connectFailureEnvelope((envelope) => {
					envelope.data.failure_class = "environment-absent";
					envelope.error.code = "environment_absent";
				}),
				20,
				1,
			),
		).toEqual({ state: "missing" });
		expect(
			parseBrowserConnectProfilePostureStatus(
				REAL_CONNECT_FAILURE_ENVELOPE,
				20,
				1,
			),
		).toEqual({ state: "unsafe" });
	});

	test("a contradictory exit-20 envelope stays unproven", () => {
		for (const raw of [
			connectFailureEnvelope((envelope) => {
				envelope.status = "ok";
			}),
			connectFailureEnvelope((envelope) => {
				envelope.error.code = "environment_absent";
			}),
			connectFailureEnvelope((envelope) => {
				envelope.error.exit_code = 1;
			}),
		]) {
			expect(
				parseBrowserConnectProfilePostureStatus(raw, 20, 1),
			).toEqual({ state: "unproven" });
		}
	});

	test("malformed, oversized, or endpoint-drifted proof remains unproven", () => {
		for (const raw of [
			"{",
			"x".repeat(65_537),
			verifiedCheckEnvelope((envelope) => {
				envelope.data.endpoint.http = "http://127.0.0.1:9444";
			}),
		]) {
			expect(parseBrowserConnectProfilePostureStatus(raw, 0, 1)).toEqual({
				state: "unproven",
			});
		}
	});

	test("future and stale effective observations fail closed", () => {
		for (const now of [0, 60_002]) {
			expect(
				parseBrowserConnectProfilePostureStatus(
					verifiedCheckEnvelope(),
					0,
					now,
				),
			).toEqual({ state: "unproven" });
		}
	});

	test("a new exact browser session changes the receipt without exposing it", () => {
		const baseline = parseBrowserConnectProfilePostureStatus(
			verifiedCheckEnvelope(),
			0,
			10,
		);
		const changed = parseBrowserConnectProfilePostureStatus(
			verifiedCheckEnvelope((envelope) => {
				envelope.data.endpoint.ws =
					"ws://127.0.0.1:9222/devtools/browser/11111111-2222-3333-4444-555555555555";
				envelope.data.proof.profile_posture.effective.observer.browser_pid =
					4343;
				envelope.data.proof.profile_posture.effective.observer.observed_at_ms =
					10;
			}),
			0,
			10,
		);

		expect(changed).not.toEqual(baseline);
		expect(JSON.stringify(changed)).not.toContain("devtools");
		expect(JSON.stringify(changed)).not.toContain("4343");
		expect(JSON.stringify(changed)).not.toContain("9222");
	});
});
