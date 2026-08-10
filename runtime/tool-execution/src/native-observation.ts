import { homedir } from "node:os";
import { join } from "node:path";
import type {
	NativeObservation,
	QualificationCell,
} from "./model.ts";
import {
	readPrivateJson,
	validateFingerprint,
	validateQualificationCell,
	validateResultSummary,
	writePrivateJsonAtomic,
} from "./receipt-store.ts";

const NATIVE_OBSERVATION_FIELDS = new Set([
	"qualification_cell",
	"client",
	"process_identity",
	"invoked_at",
	"query_fingerprint",
	"config_fingerprint",
	"route",
	"evidence_source",
	"result",
]);

export type NativeObservationExpectation = {
	qualificationCell: QualificationCell;
	client: string;
	processIdentity: string;
	queryFingerprint: string;
	configFingerprint: string;
	route: string;
	evidenceSource: string;
	now: string;
	maxAgeMs: number;
};

export function validateNativeObservation(
	value: unknown,
	expected: NativeObservationExpectation,
):
	| { ok: true; observation: NativeObservation }
	| { ok: false; reason: string } {
	let observation: NativeObservation;
	try {
		observation = validateNativeObservationShape(value);
	} catch {
		return { ok: false, reason: "native_observation_invalid" };
	}
	const age = Date.parse(expected.now) - Date.parse(observation.invoked_at);
	if (
		!sameCell(observation.qualification_cell, expected.qualificationCell) ||
		observation.client !== expected.client ||
		observation.process_identity !== expected.processIdentity ||
		observation.query_fingerprint !== expected.queryFingerprint ||
		observation.config_fingerprint !== expected.configFingerprint ||
		observation.route !== expected.route ||
		observation.evidence_source !== expected.evidenceSource ||
		!Number.isFinite(age) ||
		age < 0 ||
		age > expected.maxAgeMs
	) {
		return { ok: false, reason: "native_observation_stale_or_mismatched" };
	}
	return { ok: true, observation };
}

function validateNativeObservationShape(value: unknown): NativeObservation {
	if (!isRecord(value)) throw new Error("Native observation must be an object.");
	const unsupported = Object.keys(value).find(
		(key) => !NATIVE_OBSERVATION_FIELDS.has(key),
	);
	if (unsupported) throw new Error("Native observation field is unsupported.");
	validateQualificationCell(value.qualification_cell);
	for (const key of [
		"client",
		"process_identity",
		"invoked_at",
		"query_fingerprint",
		"config_fingerprint",
		"route",
		"evidence_source",
	] as const) {
		if (typeof value[key] !== "string" || value[key].trim() === "") {
			throw new Error(`Native observation ${key} is required.`);
		}
	}
	if (Number.isNaN(Date.parse(value.invoked_at as string))) {
		throw new Error("Native observation invoked_at must be a timestamp.");
	}
	validateFingerprint(value.query_fingerprint);
	validateFingerprint(value.config_fingerprint);
	validateResultSummary(value.result);
	return {
		qualification_cell: { ...value.qualification_cell },
		client: value.client as string,
		process_identity: value.process_identity as string,
		invoked_at: value.invoked_at as string,
		query_fingerprint: value.query_fingerprint as string,
		config_fingerprint: value.config_fingerprint as string,
		route: value.route as string,
		evidence_source: value.evidence_source as string,
		result: { ...(value.result as NativeObservation["result"]) },
	};
}

function sameCell(a: QualificationCell, b: QualificationCell): boolean {
	return (
		a.lane === b.lane &&
		a.client === b.client &&
		a.provider === b.provider &&
		a.route === b.route
	);
}

export function defaultNativeObservationRoot(): string {
	return join(
		process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
		"tool-execution",
		"observations",
	);
}

export async function writeNativeObservation(
	id: string,
	observation: unknown,
	root = defaultNativeObservationRoot(),
): Promise<void> {
	await writePrivateJsonAtomic(
		root,
		`${id}.json`,
		validateNativeObservationShape(observation),
	);
}

export async function readNativeObservation(
	id: string,
	root = defaultNativeObservationRoot(),
): Promise<NativeObservation | undefined> {
	const value = await readPrivateJson(root, `${id}.json`);
	return value === undefined ? undefined : validateNativeObservationShape(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
