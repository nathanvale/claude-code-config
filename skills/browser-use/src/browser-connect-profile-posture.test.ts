import { describe, expect, test } from "bun:test";
import {
	LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
	REAL_VERIFIED_HANDOFF_ENVELOPE,
} from "./browser-connect-handoff-fixtures";
import {
	isExactLiveCleanHandoffProof,
	isExactLiveCleanProfilePosture,
} from "./browser-connect-profile-posture";

describe("Browser Connect profile posture admission", () => {
	test("admits only the exact schema-3 live-clean shape", () => {
		expect(
			isExactLiveCleanProfilePosture(LIVE_CLEAN_PROFILE_POSTURE_FIXTURE),
		).toBe(true);

		for (const refused of [
			undefined,
			{},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				state: "configuration-only",
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				effective: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective,
					save_prompt: "observed",
				},
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				effective: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective,
					fill_exposure: "source-present",
				},
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				effective: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective,
					observer: {
						...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective.observer,
						port: "localhost",
					},
				},
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				effective: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective,
					observer: {
						...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective.observer,
						browser_pid: 0,
					},
				},
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				untrusted_extension: true,
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				disk: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.disk,
					untrusted_extension: true,
				},
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				fill_capability: "disabled",
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				disk: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.disk,
					stored_login: "absent",
				},
			},
			{
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				process: {
					disable_sync_switch: "present",
				},
			},
		]) {
			expect(isExactLiveCleanProfilePosture(refused)).toBe(false);
		}
	});

	test("binds nested Warm Chrome provenance and observer port to both endpoints", () => {
		const verified = JSON.parse(REAL_VERIFIED_HANDOFF_ENVELOPE).data;
		expect(isExactLiveCleanHandoffProof(verified)).toBe(true);

		for (const mutate of [
			(value: typeof verified) => {
				value.proof.environment_contract_id = "foreign.contract";
			},
			(value: typeof verified) => {
				value.proof.environment_schema_version = "999";
			},
			(value: typeof verified) => {
				value.proof.profile_posture.effective.observer.port = "9243";
			},
			(value: typeof verified) => {
				value.endpoint.ws =
					"ws://127.0.0.1:9243/devtools/browser/foreign";
			},
			(value: typeof verified) => {
				value.endpoint.http = "http://localhost:9222";
			},
		]) {
			const refused = structuredClone(verified);
			mutate(refused);
			expect(isExactLiveCleanHandoffProof(refused)).toBe(false);
		}
	});
});
