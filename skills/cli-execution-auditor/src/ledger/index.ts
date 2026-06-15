// ledger — auditor-local findings ledger (plan U1, KTD2).
//
// Owns the findings-table SUBSET of skill-self-audit-loop's documented template:
// the Open Findings / Finding History sections, finding states, signature
// dedupe, and never-delete history. It does NOT model the convergence-journal
// sections (Pass Ledger, Candidate Shapes, Research Anchors) — those stay the
// concern of skill-self-audit-loop. Format stays Markdown so a produced ledger
// reads as valid against that documented template (R6 = reuse by reference).
//
// A shared @side-quest/findings-ledger module is deferred until a genuine second
// CODE consumer exists (KTD2); this writer is format-compatible so that
// extraction is mechanical when warranted.

import {
	renderInvocation,
	signature,
	type StationFindingSignatureInput,
} from "./signature.ts";

// --- finding model ---

/** Finding lifecycle states (the findings-table subset of R6). */
export type FindingStatus = "open" | "resolved" | "rejected" | "duplicate" | "superseded";
export type FindingKind = "static" | "surface" | "station";

/** Active findings live in Open Findings; everything else in Finding History. */
const ACTIVE_STATUSES: ReadonlySet<FindingStatus> = new Set(["open"]);

interface ClauseFindingRecheck {
	clauseId: string;
	/** Canonical invocation argv; [] for a static clause. */
	argv: readonly string[];
}

interface StationFindingRecheck {
	clauseId: string;
	argv: readonly [];
	station: StationFindingSignatureInput;
}

/**
 * Structured re-check anchor: clause + invocation for lane findings, or station
 * id + command + finding kind for Station Map findings.
 */
export type FindingRecheck = ClauseFindingRecheck | StationFindingRecheck;

interface BaseFinding {
	/** Stable dedupe key (clause id + canonical invocation). */
	signature: string;
	clauseId: string;
	status: FindingStatus;
	summary: string;
	/** Structured re-check anchor, serialized as a reference. */
	recheck: FindingRecheck;
	/** Resolution evidence or reason — required when status is not open (R6). */
	resolution?: string;
	/** For duplicate findings, the signature of the canonical finding (R6). */
	duplicateOf?: string;
}

export type Finding =
	| (BaseFinding & {
			kind: "static" | "surface";
			recheck: ClauseFindingRecheck;
	  })
	| (BaseFinding & {
			kind: "station";
			recheck: StationFindingRecheck;
	  });

type DraftFinding = Omit<BaseFinding, "recheck"> & {
	kind: FindingKind;
	recheck: FindingRecheck;
};

/** What a caller upserts: a clause violation it just observed. */
export type FindingInput =
	| {
			clauseId: string;
			kind: "static" | "surface";
			summary: string;
			/** Invocation that surfaced it; [] for a static clause. */
			argv?: readonly string[];
			station?: never;
	  }
	| {
			clauseId: string;
			kind: "station";
			summary: string;
			station: StationFindingSignatureInput;
			argv?: never;
	  };

// --- in-memory ledger (read → mutate → write) ---

export interface LedgerState {
	skillName: string;
	/** All findings, keyed by signature. Never deletes (R6). */
	findings: Map<string, Finding>;
}

export function createLedger(skillName: string): LedgerState {
	return { skillName, findings: new Map() };
}

function recheckOf(input: FindingInput): FindingRecheck {
	if (input.kind === "station") {
		return {
			clauseId: input.clauseId,
			argv: [],
			station: input.station,
		};
	}
	return {
		clauseId: input.clauseId,
		argv: [...(input.argv ?? [])],
	};
}

/**
 * Upsert a finding by signature.
 * - New signature → inserted as `open`.
 * - Existing signature → deduped: the summary refreshes, status/history are
 *   preserved (a still-open finding stays open; a resolved one is NOT silently
 *   reopened — re-running the clause assertion is the only thing that reopens).
 * Returns the resulting finding.
 */
export function upsertFinding(ledger: LedgerState, input: FindingInput): Finding {
	assertValidFindingInput(input);
	const sig = signature({
		clauseId: input.clauseId,
		...(input.kind === "station"
			? { station: input.station }
			: { argv: input.argv ?? [] }),
	});
	const existing = ledger.findings.get(sig);
	if (existing) {
		// Dedupe: refresh the human summary, keep state + history intact.
		existing.summary = input.summary;
		return existing;
	}
	const finding: Finding = {
		signature: sig,
		clauseId: input.clauseId,
		kind: input.kind,
		status: "open",
		summary: input.summary,
		recheck: recheckOf(input),
	} as Finding;
	ledger.findings.set(sig, finding);
	return finding;
}

function assertValidFindingInput(input: FindingInput): void {
	const raw = input as {
		kind?: FindingKind;
		station?: StationFindingSignatureInput;
		argv?: readonly string[];
	};
	if (raw.kind !== "static" && raw.kind !== "surface" && raw.kind !== "station") {
		throw new Error("finding kind must be static, surface, or station");
	}
	if (raw.kind === "station") {
		if (!raw.station) throw new Error("station finding requires a station anchor");
		if (raw.argv !== undefined) throw new Error("station finding cannot include argv");
		return;
	}
	if (raw.station !== undefined) {
		throw new Error("clause finding cannot include a station anchor");
	}
}

/**
 * Transition a finding to a non-active state, preserving the row (never-delete,
 * R6). `resolution` carries repair evidence or a reason; `duplicateOf` links a
 * duplicate to its canonical signature.
 */
export function transitionFinding(
	ledger: LedgerState,
	sig: string,
	status: Exclude<FindingStatus, "open">,
	details: { resolution?: string; duplicateOf?: string } = {},
): Finding {
	const finding = ledger.findings.get(sig);
	if (!finding) {
		throw new Error(`cannot transition unknown finding: ${sig}`);
	}
	finding.status = status;
	if (details.resolution !== undefined) finding.resolution = details.resolution;
	if (details.duplicateOf !== undefined) finding.duplicateOf = details.duplicateOf;
	return finding;
}

export function openFindings(ledger: LedgerState): Finding[] {
	return [...ledger.findings.values()]
		.filter((f) => ACTIVE_STATUSES.has(f.status))
		.sort(bySignature);
}

export function historyFindings(ledger: LedgerState): Finding[] {
	return [...ledger.findings.values()]
		.filter((f) => !ACTIVE_STATUSES.has(f.status))
		.sort(bySignature);
}

function bySignature(a: Finding, b: Finding): number {
	return a.signature.localeCompare(b.signature);
}

// --- Markdown serialization (findings-table subset; format-compatible R6) ---

function serializeRecheck(recheck: FindingRecheck): string {
	if (isStationRecheck(recheck)) {
		return `station=${encodeStationToken(recheck.station.stationId)} command=${encodeStationToken(recheck.station.command)} finding=${encodeStationToken(recheck.station.findingKind)}`;
	}
	// A structured reference, not free text: clause id + canonical invocation.
	return `clause=${recheck.clauseId} invocation=\`${renderInvocation(recheck.argv)}\``;
}

function isStationRecheck(recheck: FindingRecheck): recheck is StationFindingRecheck {
	return "station" in recheck;
}

function encodeStationToken(value: string): string {
	return encodeURIComponent(value);
}

function decodeStationToken(value: string): string {
	return decodeURIComponent(value);
}

function serializeFinding(finding: Finding): string {
	const lines = [
		`- **${finding.clauseId}** (${finding.kind}) \`${finding.signature}\` — status: ${finding.status}`,
		`  - summary: ${finding.summary}`,
		`  - recheck: ${serializeRecheck(finding.recheck)}`,
	];
	if (finding.resolution) lines.push(`  - resolution: ${finding.resolution}`);
	if (finding.duplicateOf) lines.push(`  - duplicate of: \`${finding.duplicateOf}\``);
	return lines.join("\n");
}

function serializeSection(title: string, findings: Finding[]): string {
	if (findings.length === 0) return `## ${title}\n\n- None yet.\n`;
	return `## ${title}\n\n${findings.map(serializeFinding).join("\n")}\n`;
}

/** Render the ledger as Markdown, format-compatible with the audit-loop template. */
export function renderLedger(ledger: LedgerState): string {
	const open = openFindings(ledger);
	const history = historyFindings(ledger);
	return [
		"---",
		`target_cli: ${ledger.skillName}`,
		`status: ${open.length > 0 ? "active" : "converged"}`,
		"---",
		"",
		`# CLI Execution Audit: ${ledger.skillName}`,
		"",
		"## Truth Stance",
		"",
		"- This file is audit state, not canonical CLI instruction.",
		"- Findings derive from lane-contract clause assertions, not free-text review.",
		"- A finding closes only when its clause re-check passes against the post-fix CLI.",
		"",
		serializeSection("Open Findings", open),
		"",
		serializeSection("Finding History", history),
	].join("\n");
}

// --- Markdown parse (read an existing ledger back) ---

const FINDING_HEADER =
	/^- \*\*(?<clauseId>[^*]+)\*\* \((?<kind>static|surface|station)\) `(?<signature>sig_[0-9a-f]+)` — status: (?<status>open|resolved|rejected|duplicate|superseded)$/;

/**
 * Parse a rendered ledger back into state. Tolerant of the documented
 * findings-table sections; ignores foreign sections so a richer skill-self-audit
 * journal would not break the reader. Round-trips the findings this writer
 * produces (renderLedger ∘ parseLedger is identity on findings).
 */
export function parseLedger(skillName: string, markdown: string): LedgerState {
	const ledger = createLedger(skillName);
	const lines = markdown.split("\n");
	let current: DraftFinding | null = null;
	const commit = () => {
		const finding = findingFromDraft(current);
		if (finding) ledger.findings.set(finding.signature, finding);
		current = null;
	};
	for (const line of lines) {
		const header = line.match(FINDING_HEADER);
		if (header?.groups) {
			commit();
			current = {
				signature: header.groups.signature,
				clauseId: header.groups.clauseId,
				kind: header.groups.kind as FindingKind,
				status: header.groups.status as FindingStatus,
				summary: "",
				recheck: { clauseId: header.groups.clauseId, argv: [] },
			};
			continue;
		}
		if (!current) continue;
		const summary = line.match(/^ {2}- summary: (?<v>.*)$/);
		if (summary?.groups) current.summary = summary.groups.v;
		const recheck = line.match(/^ {2}- recheck: clause=(?<c>\S+) invocation=`(?<inv>.*)`$/);
		if (recheck?.groups) {
			const inv = recheck.groups.inv;
			current.recheck = {
				clauseId: recheck.groups.c,
				argv: inv === "(static — no invocation)" ? [] : inv.split(" "),
			};
		}
		const stationRecheck = line.match(
			/^ {2}- recheck: station=(?<stationId>\S+) command=(?<command>\S+) finding=(?<findingKind>\S+)$/,
		);
		if (stationRecheck?.groups) {
			current.recheck = {
				clauseId: current.clauseId,
				argv: [],
				station: {
					stationId: decodeStationToken(stationRecheck.groups.stationId),
					command: decodeStationToken(stationRecheck.groups.command),
					findingKind: decodeStationToken(stationRecheck.groups.findingKind),
				},
			};
		}
		const resolution = line.match(/^ {2}- resolution: (?<v>.*)$/);
		if (resolution?.groups) current.resolution = resolution.groups.v;
		const dup = line.match(/^ {2}- duplicate of: `(?<v>sig_[0-9a-f]+)`$/);
		if (dup?.groups) current.duplicateOf = dup.groups.v;
	}
	commit();
	return ledger;
}

function findingFromDraft(draft: DraftFinding | null): Finding | null {
	if (!draft) return null;
	if (draft.kind === "station") {
		if (!isStationRecheck(draft.recheck)) return null;
		return { ...draft, kind: "station", recheck: draft.recheck };
	}
	if (isStationRecheck(draft.recheck)) return null;
	return { ...draft, kind: draft.kind, recheck: draft.recheck };
}

// --- filesystem (Bun built-ins only, so the skill travels as a standalone zip) ---

export async function writeLedgerFile(path: string, ledger: LedgerState): Promise<void> {
	await Bun.write(path, renderLedger(ledger));
}

export async function readLedgerFile(path: string, skillName: string): Promise<LedgerState> {
	const file = Bun.file(path);
	if (!(await file.exists())) return createLedger(skillName);
	return parseLedger(skillName, await file.text());
}
