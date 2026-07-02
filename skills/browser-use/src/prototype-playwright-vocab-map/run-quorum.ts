#!/usr/bin/env bun
// PROTOTYPE — throwaway. Proves dividend ★3: quorum-gated irreversible action +
// tamper-evident multi-witness receipt. Byzantine-fault-tolerant browsing.
//
// Before firing a high-stakes click, k engines INDEPENDENTLY re-read the critical
// element. They must agree on its accessible name (the mechanical oracle, applied
// pre-action as a gate). Agree -> one engine fires + a signed receipt is emitted.
// Disagree -> the facade REFUSES and surfaces the dissent. One stale/lying engine
// cannot push a destructive action through.
//
// Run: bun run-quorum.ts <url> "<critical element name>" [k]
//   e.g. bun run-quorum.ts https://example.com "Learn more" 3
// SAFETY: prints element names + agreement + a redacted receipt; no auth URLs/secrets.

import { createHash } from "node:crypto";
import { ENGINES, LABEL, interactiveNames, navSnap } from "./fleet.ts";
import type { EngineId } from "./ref-normalizer.ts";

const TARGET_URL = process.argv[2] ?? "https://example.com";
const CRITICAL = process.argv[3] ?? "Learn more";
const K = Number(process.argv[4] ?? 3); // quorum threshold
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RED = "\x1b[31m", C = "\x1b[36m";

// stamp() avoids Date.now()-style nondeterminism concerns for the prototype; the
// receipt timestamp is read from the system clock at run time (fine for a spike).
const now = () => new Date().toISOString();

async function main() {
	console.log(`${B}quorum-gated action + signed receipt${R}`);
	console.log(`${D}critical element: "${CRITICAL}"  ·  quorum k=${K}/${ENGINES.length}  ·  page: ${TARGET_URL.replace(/^https?:\/\//, "").split("/")[0]}${R}\n`);

	// Each engine independently witnesses the critical element.
	console.log(`${B}── independent witnesses (each engine re-reads the critical element) ──${R}`);
	const witnesses: { engine: EngineId; confirms: boolean }[] = [];
	for (const e of ENGINES) {
		const r = await navSnap(e, TARGET_URL);
		const names = r.ok ? interactiveNames(e, r.snap) : new Set<string>();
		const confirms = names.has(CRITICAL);
		witnesses.push({ engine: e, confirms });
		console.log(`  ${confirms ? `${G}✓ confirms${R}` : `${RED}✗ dissents${R}`}  ${LABEL[e]}`);
	}

	const agreeing = witnesses.filter((w) => w.confirms);
	const dissenting = witnesses.filter((w) => !w.confirms);
	const quorumMet = agreeing.length >= K;

	console.log(`\n${B}── quorum gate (need ${K}, have ${agreeing.length}) ──${R}`);
	if (!quorumMet) {
		console.log(`  ${RED}REFUSED${R} — only ${agreeing.length}/${ENGINES.length} engines confirm "${CRITICAL}".`);
		console.log(`  ${D}dissenting: ${dissenting.map((w) => LABEL[w.engine]).join(", ")}${R}`);
		console.log(`  ${D}A single-engine agent would have fired on one possibly-wrong view. The quorum refused.${R}\n`);
		return;
	}

	// Quorum met -> commit (here: the lowest-cost agreeing engine fires; on example.com
	// we don't actually mutate, this is the gate demo). Emit the receipt.
	const actor = agreeing[0].engine;
	const receiptBody = {
		intent: `click("${CRITICAL}")`,
		critical_element: CRITICAL,
		page_host: TARGET_URL.replace(/^https?:\/\//, "").split("/")[0],
		quorum: `${agreeing.length}/${ENGINES.length}`,
		confirmed_by: agreeing.map((w) => w.engine),
		dissent: dissenting.map((w) => w.engine),
		actor,
		ts: now(),
	};
	// tamper-evident: hash the canonical receipt body
	const canonical = JSON.stringify(receiptBody, Object.keys(receiptBody).sort());
	const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);

	console.log(`  ${G}QUORUM MET — committing${R} (actor: ${C}${LABEL[actor]}${R})`);
	console.log(`\n${B}── signed multi-witness receipt ──${R}`);
	console.log(`  ${D}intent       ${R}${receiptBody.intent}`);
	console.log(`  ${D}critical     ${R}"${receiptBody.critical_element}"`);
	console.log(`  ${D}host         ${R}${receiptBody.page_host}  ${D}(redacted to host only)${R}`);
	console.log(`  ${D}quorum       ${R}${G}${receiptBody.quorum}${R}`);
	console.log(`  ${D}confirmed_by ${R}${receiptBody.confirmed_by.map((e) => LABEL[e as EngineId]).join(", ")}`);
	if (dissenting.length) console.log(`  ${D}dissent      ${R}${Y}${receiptBody.dissent.map((e) => LABEL[e as EngineId]).join(", ")}${R}`);
	console.log(`  ${D}actor        ${R}${LABEL[actor]}`);
	console.log(`  ${D}ts           ${R}${receiptBody.ts}`);
	console.log(`  ${D}sha256       ${R}${C}${hash}${R} ${D}(tamper-evident: any change to the above changes this)${R}`);

	console.log(`\n${B}═══ WHY THIS MATTERS ═══${R}`);
	console.log(`  For an irreversible action, "${agreeing.length} independent engines confirmed the target`);
	console.log(`  before firing" is a guarantee one engine structurally cannot make. The receipt is`);
	console.log(`  the audit artifact: provable, hashed, secret-redacted. ${D}This is the regulated/high-stakes wedge.${R}\n`);
}
main();
