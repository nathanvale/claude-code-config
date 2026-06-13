#!/usr/bin/env bun
/**
 * PROTOTYPE - throwaway TUI.
 *
 * Run with:
 *   bun run prototype:review-result-contract
 *
 * This shell is intentionally disposable. The portable logic lives in
 * review-result-contract-contenders.logic.ts.
 */

import { emitKeypressEvents } from "node:readline";
import {
	contenders,
	evaluateAllScenarios,
	evaluateScenario,
	scenarios,
	type ContenderResult,
} from "./review-result-contract-contenders.logic";

type AppState = {
	scenarioIndex: number;
	focusIndex: number;
	showAll: boolean;
	lastAction: string;
};

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const cyan = "\x1b[36m";

const state: AppState = {
	scenarioIndex: 0,
	focusIndex: 0,
	showAll: false,
	lastAction: "initial render",
};

if (process.argv.includes("--demo")) {
	render();
	process.exit(0);
}

emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("keypress", (_str, key) => {
	if (key.ctrl && key.name === "c") process.exit(0);
	handleKey(key.name ?? "");
});

render();

function handleKey(key: string): void {
	if (key === "q") process.exit(0);
	if (key === "a") {
		state.showAll = !state.showAll;
		state.lastAction = state.showAll ? "show aggregate judge board" : "show scenario board";
		render();
		return;
	}
	if (key === "n" || key === "right") {
		state.scenarioIndex = (state.scenarioIndex + 1) % scenarios.length;
		state.lastAction = "next scenario";
		render();
		return;
	}
	if (key === "p" || key === "left") {
		state.scenarioIndex =
			(state.scenarioIndex - 1 + scenarios.length) % scenarios.length;
		state.lastAction = "previous scenario";
		render();
		return;
	}
	if (key === "c") {
		state.focusIndex = (state.focusIndex + 1) % contenders.length;
		state.lastAction = "cycle contender focus";
		render();
		return;
	}
	if (/^[1-4]$/.test(key)) {
		state.scenarioIndex = Number(key) - 1;
		state.showAll = false;
		state.lastAction = `jump to scenario ${key}`;
		render();
	}
}

function render(): void {
	console.clear();
	const scenario = scenarios[state.scenarioIndex];
	const results = evaluateScenario(scenario);
	const focus = results[state.focusIndex];
	const aggregate = evaluateAllScenarios();
	const winner = [...results].sort((a, b) => b.score.total - a.score.total)[0];
	const aggregateWinner = Object.entries(aggregate).sort((a, b) => b[1] - a[1])[0];

	line(`${bold}PROTOTYPE: ReviewResultData v2 contract contenders${reset}`);
	line(`${dim}Question: Which top contender earns the Interface at the reducer Seam?${reset}`);
	line(`${dim}Last action: ${state.lastAction}${reset}`);
	line("");

	if (state.showAll) {
		line(`${bold}Aggregate staff-engineer judge board${reset}`);
		for (const contender of contenders) {
			const score = aggregate[contender.id];
			const marker = contender.id === aggregateWinner[0] ? `${green}winner${reset}` : "";
			line(`  ${pad(contender.name, 38)} ${scoreLine(score)} ${marker}`);
		}
		line("");
		line(`${bold}Scenario spread${reset}`);
		for (const item of scenarios) {
			const scenarioResults = evaluateScenario(item);
			const scenarioWinner = [...scenarioResults].sort(
				(a, b) => b.score.total - a.score.total,
			)[0];
			line(`  ${pad(item.name, 44)} ${cyan}${scenarioWinner.contender.name}${reset}`);
		}
		line("");
		line(shortcuts());
		return;
	}

	line(`${bold}Scenario ${state.scenarioIndex + 1}/${scenarios.length}: ${scenario.name}${reset}`);
	line(`${dim}${scenario.question}${reset}`);
	line(`Expected guard: ${scenario.expectedGuards.join(", ")}`);
	line("");

	line(`${bold}Contender scores${reset}`);
	for (const result of results) {
		const selected = result.contender.id === focus.contender.id ? ">" : " ";
		const marker = result.contender.id === winner.contender.id ? `${green}winner${reset}` : "";
		line(
			`${selected} ${pad(result.contender.name, 38)} ${scoreLine(result.score.total)} ` +
				`guards ${guardLine(result)} ${marker}`,
		);
	}
	line("");

	line(`${bold}Focused contender: ${focus.contender.name}${reset}`);
	line(`${dim}${focus.contender.pitch}${reset}`);
	line("");
	renderStateBlock("Review units", focus.reviewUnits);
	renderStateBlock("Ledger entries", focus.ledgerEntries);
	renderStateBlock("Anchor-miss telemetry", focus.anchorMissTelemetry);
	renderStateBlock("Readiness", focus.readiness);
	renderStateBlock("Score", focus.score);
	line("");
	line(shortcuts());
}

function renderStateBlock(label: string, value: unknown): void {
	line(`${bold}${label}${reset}`);
	const json = JSON.stringify(value, null, 2)
		.split("\n")
		.map((row) => `  ${row}`)
		.join("\n");
	line(json);
	line("");
}

function guardLine(result: ContenderResult): string {
	if (result.leaks.length === 0) return `${green}clean${reset}`;
	return `${red}leaks ${result.leaks.join(",")}${reset}`;
}

function scoreLine(score: number): string {
	if (score >= 12) return `${green}${String(score).padStart(3)}${reset}`;
	if (score >= 8) return `${yellow}${String(score).padStart(3)}${reset}`;
	return `${red}${String(score).padStart(3)}${reset}`;
}

function shortcuts(): string {
	return [
		`${bold}[1-4]${reset} ${dim}scenario${reset}`,
		`${bold}[n/p]${reset} ${dim}next/prev${reset}`,
		`${bold}[c]${reset} ${dim}focus contender${reset}`,
		`${bold}[a]${reset} ${dim}aggregate${reset}`,
		`${bold}[q]${reset} ${dim}quit${reset}`,
	].join("  ");
}

function pad(value: string, length: number): string {
	return value.padEnd(length).slice(0, length);
}

function line(value: string): void {
	process.stdout.write(`${value}\n`);
}
