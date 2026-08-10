import { expect, test } from "bun:test";
import type { NativeObservation } from "../src/model.ts";
import { validateNativeObservation } from "../src/native-observation.ts";

function observation(): NativeObservation {
	return {
		qualification_cell: {
			lane: "codex_desktop",
			client: "codex-desktop",
			provider: "firecrawl",
			route: "native.firecrawl.search",
		},
		client: "codex-desktop",
		process_identity: "fresh-process-1",
		invoked_at: "2026-08-09T00:00:30.000Z",
		query_fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		route: "native.firecrawl.search",
		evidence_source: "private-receipt-1",
		result: {
			class: "successful_tool_result",
			result_fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		},
	};
}

test("accepts native evidence only when every provenance binding matches", () => {
	expect(
		validateNativeObservation(observation(), {
			qualificationCell: observation().qualification_cell,
			client: "codex-desktop",
			processIdentity: "fresh-process-1",
			queryFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			configFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			route: "native.firecrawl.search",
			evidenceSource: "private-receipt-1",
			now: "2026-08-09T00:01:00.000Z",
			maxAgeMs: 60_000,
		}),
	).toEqual({ ok: true, observation: observation() });
});

test("rejects stale or cross-client native evidence", () => {
	const expected = {
		qualificationCell: observation().qualification_cell,
		client: "codex-desktop",
		processIdentity: "fresh-process-1",
		queryFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		configFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		route: "native.firecrawl.search",
		evidenceSource: "private-receipt-1",
		now: "2026-08-09T00:01:00.000Z",
		maxAgeMs: 60_000,
	};
	for (const changed of [
		{ ...observation(), client: "other-client" },
		{ ...observation(), process_identity: "old-process" },
		{ ...observation(), query_fingerprint: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
		{ ...observation(), config_fingerprint: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
		{ ...observation(), route: "native.other.search" },
		{ ...observation(), evidence_source: "private-receipt-2" },
		{
			...observation(),
			qualification_cell: {
				...observation().qualification_cell,
				lane: "codex_cli_tui" as const,
			},
		},
		{ ...observation(), invoked_at: "2026-08-08T23:00:00.000Z" },
	]) {
		expect(validateNativeObservation(changed, expected)).toEqual({
			ok: false,
			reason: "native_observation_stale_or_mismatched",
		});
	}
});

test("rejects undeclared fields and malformed result summaries", () => {
	const expected = {
		qualificationCell: observation().qualification_cell,
		client: "codex-desktop",
		processIdentity: "fresh-process-1",
		queryFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		configFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		route: "native.firecrawl.search",
		evidenceSource: "private-receipt-1",
		now: "2026-08-09T00:01:00.000Z",
		maxAgeMs: 60_000,
	};

	for (const changed of [
		{ ...observation(), raw_provider_payload: { token: "fixture" } },
		{ ...observation(), result: { class: "successful_tool_result", raw: {} } },
		{ ...observation(), result: { class: "not-a-result-class" } },
		{ ...observation(), query_fingerprint: "sha256:short" },
	]) {
		expect(validateNativeObservation(changed, expected)).toEqual({
			ok: false,
			reason: "native_observation_invalid",
		});
	}
});
