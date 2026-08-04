import { emitKeypressEvents } from "node:readline";
import {
	initialPrototypeState,
	reducePrototype,
	type PrototypeAction,
	type PrototypeState,
} from "./model";

const bold = "\u001b[1m";
const dim = "\u001b[2m";
const reset = "\u001b[0m";

const keyActions: Readonly<Record<string, PrototypeAction>> = {
	v: "toggle-variant",
	1: "create-minimal",
	2: "create-valid",
	3: "edit-summary",
	4: "replace-origins",
	5: "clear-auth-context",
	6: "delete-preview",
	7: "delete-force",
	r: "reset",
};

let state = initialPrototypeState();

function render(next: PrototypeState): void {
	console.clear();
	console.log(`${bold}Runbook CRUD contract prototype${reset}`);
	console.log(`${bold}Variant:${reset} ${next.variant}`);
	console.log(
		`${bold}Catalog:${reset}\n${JSON.stringify(next.runbook ?? null, null, 2)}`,
	);
	console.log(
		`${bold}Last outcome:${reset}\n${JSON.stringify(next.lastOutcome ?? null, null, 2)}`,
	);
	console.log();
	console.log(
		`${bold}[v]${reset} ${dim}toggle plan/resolved${reset}  ${bold}[1]${reset} ${dim}minimal create${reset}  ${bold}[2]${reset} ${dim}valid create${reset}`,
	);
	console.log(
		`${bold}[3]${reset} ${dim}edit summary${reset}  ${bold}[4]${reset} ${dim}replace origins${reset}  ${bold}[5]${reset} ${dim}clear auth${reset}`,
	);
	console.log(
		`${bold}[6]${reset} ${dim}delete preview${reset}  ${bold}[7]${reset} ${dim}delete force${reset}  ${bold}[r]${reset} ${dim}reset${reset}  ${bold}[q]${reset} ${dim}quit${reset}`,
	);
}

if (!process.stdin.isTTY) {
	console.error("Run this prototype in a terminal so each state transition stays visible.");
	process.exit(2);
}

emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
render(state);

process.stdin.on("keypress", (_text, key: { name?: string; ctrl?: boolean }) => {
	if (key.name === "q" || (key.ctrl && key.name === "c")) {
		process.stdin.setRawMode(false);
		process.stdin.pause();
		console.clear();
		process.exit(0);
	}
	const action = key.name ? keyActions[key.name] : undefined;
	if (!action) return;
	state = reducePrototype(state, action);
	render(state);
});
