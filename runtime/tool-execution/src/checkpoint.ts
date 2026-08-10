import { homedir } from "node:os";
import { join } from "node:path";
import type { CheckpointCard } from "./model.ts";
import {
	readPrivateJson,
	validateFingerprint,
	validateQualificationCell,
	writePrivateJsonAtomic,
} from "./receipt-store.ts";

const CHECKPOINT_FIELDS = new Set([
	"schema_version",
	"id",
	"position",
	"total",
	"objective",
	"owner",
	"expected",
	"stop",
	"rollback",
	"next",
	"active",
	"native_observation_binding",
]);
const NATIVE_BINDING_FIELDS = new Set([
	"qualification_cell",
	"client",
	"process_identity",
	"query_fingerprint",
	"config_fingerprint",
	"route",
	"evidence_source",
	"max_age_ms",
]);

export function defineCheckpoint(value: unknown): CheckpointCard {
	if (!isRecord(value)) throw new Error("Checkpoint must be an object.");
	const unsupported = Object.keys(value).find((key) => !CHECKPOINT_FIELDS.has(key));
	if (unsupported) {
		throw new Error(`Checkpoint has unsupported field: ${unsupported}.`);
	}
	const card = value as Record<string, unknown>;
	if (card.schema_version !== 1) {
		throw new Error("Unsupported checkpoint schema version.");
	}
	if (!Number.isInteger(card.position) || Number(card.position) < 1) {
		throw new Error("Checkpoint position must be a positive integer.");
	}
	if (!Number.isInteger(card.total) || Number(card.total) < Number(card.position)) {
		throw new Error("Checkpoint total must include the active position.");
	}
	for (const key of [
		"id",
		"objective",
		"owner",
		"expected",
		"stop",
		"rollback",
		"next",
	] as const) {
		if (typeof card[key] !== "string" || card[key].trim() === "") {
			throw new Error(`Checkpoint ${key} must be a non-empty string.`);
		}
	}
	if (typeof card.active !== "boolean") {
		throw new Error("Checkpoint active must be a boolean.");
	}
	const binding = card.native_observation_binding;
	if (binding !== undefined) {
		if (!isRecord(binding)) {
			throw new Error("Native observation binding is invalid.");
		}
		const bindingUnsupported = Object.keys(binding).find(
			(key) => !NATIVE_BINDING_FIELDS.has(key),
		);
		if (bindingUnsupported) {
			throw new Error(
				`Native observation binding has unsupported field: ${bindingUnsupported}.`,
			);
		}
		validateQualificationCell(binding.qualification_cell);
		if (
			binding.qualification_cell.client !== binding.client ||
			binding.qualification_cell.route !== binding.route ||
			!Number.isInteger(binding.max_age_ms) ||
			Number(binding.max_age_ms) < 1
		) {
			throw new Error("Native observation binding is invalid.");
		}
		for (const value of [
			binding.client,
			binding.process_identity,
			binding.query_fingerprint,
			binding.config_fingerprint,
			binding.route,
			binding.evidence_source,
		]) {
			if (typeof value !== "string" || value.trim() === "") {
				throw new Error("Native observation binding is incomplete.");
			}
		}
		try {
			validateFingerprint(binding.query_fingerprint);
			validateFingerprint(binding.config_fingerprint);
		} catch {
			throw new Error("Native observation binding is invalid.");
		}
	}
	return { ...value } as CheckpointCard;
}

export function renderCheckpoint(card: CheckpointCard): string {
	return [
		`Checkpoint: ${card.position} of ${card.total}`,
		`Objective: ${card.objective}`,
		`Owner: ${card.owner}`,
		`Expected: ${card.expected}`,
		`Stop: ${card.stop}`,
		`Rollback: ${card.rollback}`,
		`Next: ${card.next}`,
	].join("\n");
}

export function defaultCheckpointRoot(): string {
	return join(
		process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
		"tool-execution",
		"checkpoints",
	);
}

export async function writeActiveCheckpoint(
	card: CheckpointCard,
	root = defaultCheckpointRoot(),
): Promise<void> {
	const defined = defineCheckpoint(card);
	if (!defined.active) {
		throw new Error("Active checkpoint storage requires an active card.");
	}
	await writePrivateJsonAtomic(root, "active.json", defined);
}

export async function readActiveCheckpoint(
	root = defaultCheckpointRoot(),
): Promise<CheckpointCard | undefined> {
	const value = await readPrivateJson(root, "active.json");
	if (value === undefined) return undefined;
	const card = defineCheckpoint(value);
	return card.active ? card : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
