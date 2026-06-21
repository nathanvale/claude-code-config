#!/usr/bin/env bun
// PROTOTYPE - throwaway Station Help renderer TUI. Delete or absorb after review.
//
// Question: does a Station Help Artifact Renderer make sense as a proof-help
// development tool when agents need to inspect promised CLI behavior before
// editing a facade-backed CLI?

import { emitKeypressEvents } from "node:readline";
import {
	createInitialPrototypeState,
	projectPrototypeFrame,
	reducePrototypeState,
	renderPrototypeMarkdown,
	type PrototypeAction,
	type PrototypeFrame,
	type PrototypeState,
} from "./prototype-station-help-model.ts";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CLEAR = "\x1b[2J\x1b[H";

const help = Bun.argv.includes("--help") || Bun.argv.includes("-h");
const demo = Bun.argv.includes("--demo");
const markdown = Bun.argv.includes("--markdown");

if (help) {
	process.stdout.write(renderHelp());
	process.exit(0);
}

if (markdown) {
	process.stdout.write(renderPrototypeMarkdown(createInitialPrototypeState()));
	process.exit(0);
}

if (demo || !process.stdin.isTTY) {
	runDemo();
	process.exit(0);
}

let state = createInitialPrototypeState();
render(state);
emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("keypress", (_chunk, key) => {
	if (key.name === "q" || (key.ctrl && key.name === "c")) {
		process.stdout.write(`${CLEAR}Prototype stopped.\n`);
		process.exit(0);
	}
	const action = actionForKey(key.name, key.sequence);
	if (!action) return;
	state = reducePrototypeState(state, action);
	render(state);
});

function runDemo(): void {
	const states: PrototypeState[] = [
		createInitialPrototypeState(),
		reducePrototypeState(createInitialPrototypeState(), "cycle-scenario"),
		{
			...reducePrototypeState(
				reducePrototypeState(createInitialPrototypeState(), "cycle-scenario"),
				"cycle-scenario",
			),
			viewMode: "findings",
		},
		{
			...reducePrototypeState(
				reducePrototypeState(
					reducePrototypeState(createInitialPrototypeState(), "cycle-surface"),
					"cycle-scenario",
				),
				"cycle-scenario",
			),
			viewMode: "station",
		},
	];
	for (const demoState of states) {
		render(demoState, { clear: false });
		process.stdout.write("\n--- demo frame ---\n\n");
	}
}

function render(nextState: PrototypeState, options: { clear?: boolean } = {}): void {
	const frame = projectPrototypeFrame(nextState);
	if (options.clear !== false) process.stdout.write(CLEAR);
	process.stdout.write(renderFrame(frame));
}

function renderFrame(frame: PrototypeFrame): string {
	return [
		`${BOLD}Station Proof Guide prototype${RESET}`,
		`${DIM}Throwaway logic prototype. State is in memory; no files are written.${RESET}`,
		"",
		`${BOLD}What this is${RESET}`,
		"A DX prototype for a generated proof guide around Storybook CLI behavior.",
		"",
		`${BOLD}Why it exists${RESET}`,
		"Help agents see what behavior is promised, what is proven, what is missing, and what to fix next.",
		"",
		`${BOLD}Current state${RESET}`,
		stateLine("fake proof state", frame.state.scenario),
		stateLine("CLI surface", frame.state.surfaceMode),
		stateLine("screen", screenLabel(frame.state.viewMode)),
		stateLine("command filter", frame.commandFilter),
		stateLine("behavior", `${frame.state.stationIndex + 1}/${Math.max(1, frame.stations.length)}`),
		stateLine(
			"proof summary",
			`surfaces=${frame.counts.surfaces} stations=${frame.counts.stations} missing=${frame.counts.missingRequired} drifted=${frame.counts.drifted} skipped=${frame.counts.skipped} unreachable=${frame.counts.unreachable} catalogDrift=${frame.counts.catalogDrift}`,
		),
		"",
		`${BOLD}Generated guide preview${RESET}`,
		trimPreview(frame.preview),
		"",
		`${BOLD}Keys${RESET}`,
		keyLine("s", "fake proof state", "cycle catalog-only -> covered -> mixed -> drift"),
		keyLine("f", "CLI surface", "cycle docs-loop -> doctor -> both"),
		keyLine("v", "screen", "cycle overview -> next actions -> behavior detail"),
		keyLine("]", "next command", "advance command filter"),
		keyLine("[", "prev command", "rewind command filter"),
		keyLine("n", "next behavior", "advance selected behavior"),
		keyLine("p", "prev behavior", "rewind selected behavior"),
		keyLine("q", "quit", "stop prototype"),
		"",
	].join("\n");
}

function renderHelp(): string {
	return [
		"Usage: bun run prototype:station-help [--help] [--demo] [--markdown]",
		"",
		"Prototype a generated Station Proof Guide for Storybook CLI development.",
		"",
		"Examples:",
		"  bun run prototype:station-help",
		"  bun run prototype:station-help --markdown",
		"  bun run prototype:station-help --demo",
		"",
		"This is a DX tool, not normal command help. It shows promised CLI behaviors,",
		"proof status, missing/drifted cases, and next actions an agent can take.",
		"",
		"Help is for orientation. Humans and agents can read it to decide whether this",
		"tool is relevant. Do not scrape help for proof state; use the generated guide",
		"output instead. A real CLI surface would add stable --json and/or --plain modes.",
		"",
		"Options:",
		"  -h, --help    Show this prototype help.",
		"  --demo        Print several non-interactive frames.",
		"  --markdown    Print the generated proof-guide markdown.",
		"",
		"Interactive keys:",
		"  s    Cycle fake proof state: catalog-only, covered, mixed, drift.",
		"  f    Cycle CLI surface: docs-loop, doctor, both.",
		"  v    Cycle screen: overview, next actions, behavior detail.",
		"  ]/[  Move command filter.",
		"  n/p  Move selected behavior.",
		"  q    Quit.",
		"",
	].join("\n");
}

function actionForKey(
	name: string | undefined,
	sequence: string | undefined,
): PrototypeAction | null {
	const value = sequence ?? name;
	if (name === "s") return "cycle-scenario";
	if (name === "f") return "cycle-surface";
	if (name === "v") return "cycle-view";
	if (value === "]" || name === "rightbracket") return "next-command";
	if (value === "[" || name === "leftbracket") return "previous-command";
	if (name === "n") return "next-station";
	if (name === "p") return "previous-station";
	return null;
}

function stateLine(label: string, value: string): string {
	return `${DIM}${label}${RESET}: ${value}`;
}

function keyLine(key: string, label: string, description: string): string {
	const display = key === "[" || key === "]" ? key : `[${key}]`;
	return `${BOLD}${display}${RESET} ${label} ${DIM}${description}${RESET}`;
}

function screenLabel(viewMode: string): string {
	if (viewMode === "findings") return "next actions";
	if (viewMode === "station") return "behavior detail";
	return viewMode;
}

function trimPreview(markdownPreview: string): string {
	const lines = markdownPreview.split("\n");
	return lines.slice(0, 24).join("\n");
}
