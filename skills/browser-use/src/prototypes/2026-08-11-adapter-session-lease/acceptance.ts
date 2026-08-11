// POST-BUILD ACCEPTANCE RECEIPT. Operator-run only: requires live Agent Chrome.
//
// Normal: exercises the built U3 task terminal seam and U4 discovery terminal
// seam. Both release through the U2 AdapterDefinition.releaseSession mechanic.
// Planted: skips terminal release, proves the absence assertion fails, then
// repairs through the same built U2 mechanic.
//
// Never run against default Chrome. Supply only a fresh schema-2 handoff minted
// by `browser-connect connect agent-browser --json`.

import { isAbsolute, resolve } from "node:path";
import {
	type AdapterCommandInput,
	findAdapterDefinition,
	spawnAdapterCommand,
} from "@side-quest/browser-connect/adapters";
import {
	executeAgentBrowserTask,
	type AgentBrowserVerifiedHandoff,
} from "../../browser-use-agent-browser";
import { deriveSessionName } from "../../browser-use-adapter-session-lease";
import {
	discoverPages,
	type EnvelopeTransportFacts,
} from "../../browser-use-discovery";
import { createDefaultBrowserUseRuntime } from "../../browser-use-runtime";

const PLANTED = process.argv.includes("--planted");
const MAX_RELEASE_INVENTORY_READS = 6;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
};

type HandoffInput = {
	runId: string;
	handoff: AgentBrowserVerifiedHandoff;
};

function argumentValue(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function requireString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} is missing from the verified handoff.`);
	}
}

async function readHandoff(path: string): Promise<HandoffInput> {
	const envelope = objectValue(JSON.parse(await Bun.file(path).text()));
	const data = objectValue(envelope?.data);
	const environment = objectValue(data?.environment);
	const attachment = objectValue(data?.attachment);
	const endpoint = objectValue(data?.endpoint);
	const proof = objectValue(data?.proof);
	const runId = envelope?.run_id;

	requireString(runId, "run_id");
	requireString(endpoint?.http, "data.endpoint.http");
	requireString(endpoint?.ws, "data.endpoint.ws");
	requireString(
		attachment?.probe_executable,
		"data.attachment.probe_executable",
	);
	if (
		data?.contract_id !== "browser-connect.verified-handoff" ||
		data?.schema_version !== "2" ||
		data?.outcome !== "verified" ||
		environment?.name !== "agent-chrome" ||
		data?.browser_entry_mode !== "explicit-cdp" ||
		attachment?.adapter_id !== "agent-browser" ||
		attachment?.route !== "explicit-cdp" ||
		proof?.route_evidence !== "verified-live" ||
		!isAbsolute(attachment.probe_executable)
	) {
		throw new Error(
			"Acceptance requires a verified agent-browser handoff for Agent Chrome.",
		);
	}
	return { runId, handoff: data as AgentBrowserVerifiedHandoff };
}

function pass(name: string, detail: string): void {
	console.log(`PASS  ${name}\n      ${detail}`);
}

function claim(name: string, condition: boolean, detail: string): void {
	if (!condition) throw new Error(`FAIL  ${name}: ${detail}`);
	pass(name, detail);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
	return (
		left.length === right.length &&
		left.every((member) => right.includes(member))
	);
}

async function run(
	command: string,
	args: readonly string[],
	timeoutMs = 30_000,
): Promise<CommandResult> {
	return spawnAdapterCommand({ command, args, timeoutMs });
}

function parseSuccess(result: CommandResult, label: string): Record<string, unknown> {
	if (result.exitCode !== 0 || result.timedOut === true) {
		throw new Error(
			`${label} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
		);
	}
	const envelope = objectValue(JSON.parse(result.stdout));
	if (envelope?.success !== true) {
		throw new Error(`${label} returned a non-success envelope.`);
	}
	return envelope;
}

function dataObject(
	envelope: Record<string, unknown>,
	label: string,
): Record<string, unknown> {
	const data = objectValue(envelope.data);
	if (!data) throw new Error(`${label} returned no data object.`);
	return data;
}

function releaseTraceClaims(
	label: string,
	inputs: readonly AdapterCommandInput[],
	sessionName: string,
): void {
	const close = inputs.filter(
		(input) =>
			JSON.stringify(input.args) ===
			JSON.stringify(["--session", sessionName, "close", "--json"]),
	);
	const inventory = inputs.filter(
		(input) =>
			JSON.stringify(input.args) ===
			JSON.stringify(["session", "list", "--json"]),
	);
	const releaseInputs = [...close, ...inventory];
	claim(
		`${label}: named close`,
		close.length === 1,
		`one close targeted ${sessionName}`,
	);
	claim(
		`${label}: no --cdp on release`,
		releaseInputs.every((input) => !input.args.includes("--cdp")),
		`${releaseInputs.length} release commands inspected`,
	);
	claim(
		`${label}: bounded inventory re-read`,
		inventory.length >= 1 && inventory.length <= MAX_RELEASE_INVENTORY_READS,
		`${inventory.length}/${MAX_RELEASE_INVENTORY_READS} inventory reads`,
	);
}

const handoffPath = argumentValue("--handoff");
if (!handoffPath) {
	throw new Error(
		"Usage: bun acceptance.ts --handoff <browser-connect-envelope.json> [--planted]",
	);
}

const { runId, handoff } = await readHandoff(resolve(handoffPath));
const sessionName = deriveSessionName(runId);
const executable = handoff.attachment.probe_executable;
const endpointWs = handoff.endpoint.ws;
const endpointHttp = handoff.endpoint.http;
const endpointPort = new URL(endpointHttp).port;
const observedInputs: AdapterCommandInput[] = [];
let sessionMayExist = false;

const capturedRunCommand = async (
	input: AdapterCommandInput,
): Promise<CommandResult> => {
	observedInputs.push(input);
	return spawnAdapterCommand(input);
};

const attached = async (args: readonly string[]): Promise<Record<string, unknown>> =>
	parseSuccess(
		await run(executable, [
			"--cdp",
			endpointWs,
			"--session",
			sessionName,
			...args,
			"--json",
		]),
		`agent-browser ${args.join(" ")}`,
	);

const sessions = async (): Promise<string[]> => {
	const envelope = parseSuccess(
		await run(executable, ["session", "list", "--json"]),
		"agent-browser session list",
	);
	const values = dataObject(envelope, "session list").sessions;
	if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) {
		throw new Error("Session inventory returned an invalid sessions array.");
	}
	return values;
};

const chromePid = async (): Promise<string> => {
	const result = await run("lsof", [
		"-nP",
		`-iTCP:${endpointPort}`,
		"-sTCP:LISTEN",
		"-Fp",
	]);
	if (result.exitCode !== 0) throw new Error("Could not read Agent Chrome PID.");
	return result.stdout.match(/^p(\d+)/m)?.[1] ?? "missing";
};

const pageCount = async (): Promise<number> => {
	const targets = (await (await fetch(`${endpointHttp}/json/list`)).json()) as {
		type?: unknown;
	}[];
	return targets.filter((target) => target.type === "page").length;
};

const builtRelease = async (): Promise<{
	released: boolean;
	inputs: AdapterCommandInput[];
}> => {
	const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
	if (!releaseSession) {
		throw new Error("Built agent-browser releaseSession mechanic is unavailable.");
	}
	const start = observedInputs.length;
	const result = await releaseSession(
		{
			env: { ...process.env },
			resolveExecutable: () => ({ resolved: true, path: executable }),
			runCommand: capturedRunCommand,
		},
		{ sessionName },
	);
	return {
		released: result.released,
		inputs: observedInputs.slice(start),
	};
};

const baselineSessions = await sessions();
const baselinePid = await chromePid();
const baselinePages = await pageCount();
claim(
	"fresh named scope",
	!baselineSessions.includes(sessionName),
	`${sessionName} absent from ${baselineSessions.length} baseline sessions`,
);
claim(
	"DDA-F26 Agent Chrome only",
	handoff.environment.name === "agent-chrome",
	`verified environment ${handoff.environment.name}; Chrome PID ${baselinePid}`,
);

const fixtureHtml = await Bun.file(resolve(import.meta.dir, "fixture.html")).text();
const server = Bun.serve({
	port: 0,
	fetch: () =>
		new Response(fixtureHtml, { headers: { "content-type": "text/html" } }),
});
const fixtureUrl = `http://localhost:${server.port}/fixture.html`;

try {
	sessionMayExist = true;
	await attached(["tab", "new"]);
	await attached(["open", fixtureUrl]);
	const probeA = String(
		dataObject(await attached(["eval", "window.__leaseProbe"]), "eval").result ??
			"",
	);
	const urlData = dataObject(await attached(["get", "url"]), "get url");
	const urlB = String(urlData.result ?? urlData.url ?? "");
	const probeB = String(
		dataObject(await attached(["eval", "window.__leaseProbe"]), "eval").result ??
			"",
	);
	claim(
		"owned session reused across invocations",
		urlB === fixtureUrl && probeA.startsWith("alive-") && probeB === probeA,
		`probe ${probeA} retained; fixture URL retained`,
	);

	const activeSessions = await sessions();
	claim(
		"owned session created without disturbing baseline",
		activeSessions.includes(sessionName) &&
			baselineSessions.every((name) => activeSessions.includes(name)),
		`${sessionName} present; ${baselineSessions.length} foreign sessions retained`,
	);

	if (PLANTED) {
		await attached(["tab", "close"]);
		const leakedSessions = await sessions();
		const absenceAssertion =
			!leakedSessions.includes(sessionName) &&
			sameMembers(leakedSessions, baselineSessions);
		claim(
			"planted regression fires",
			!absenceAssertion && leakedSessions.includes(sessionName),
			"release skipped; absence assertion failed with owned session visible",
		);
		const repair = await builtRelease();
		releaseTraceClaims("U2 planted repair", repair.inputs, sessionName);
		claim(
			"U2 planted repair reports released",
			repair.released,
			"built AdapterDefinition.releaseSession returned released=true",
		);
		sessionMayExist = !repair.released;
	} else {
		const tabEnvelope = await attached(["tab", "list"]);
		const tabs = dataObject(tabEnvelope, "tab list").tabs;
		if (!Array.isArray(tabs)) throw new Error("Tab list returned no tabs array.");
		const target = tabs
			.map(objectValue)
			.find((tab) => tab?.url === fixtureUrl);
		requireString(target?.tabId, "fixture tab id");

		const taskStart = observedInputs.length;
		const taskResult = await executeAgentBrowserTask(
			{ runCommand: capturedRunCommand },
			{
				handoff,
				run_id: runId,
				target_tab_id: target.tabId,
				expected_target_url: fixtureUrl,
				allowed_origins: [new URL(fixtureUrl).origin],
				steps: [{ kind: "snapshot", interactive: false }],
			},
		);
		const taskInputs = observedInputs.slice(taskStart);
		releaseTraceClaims("U3 task terminal seam", taskInputs, sessionName);
		claim(
			"U3 task terminal seam reports confirmed",
			taskResult.ok && taskResult.outcome === "confirmed" && !taskResult.release,
			"task truth retained; release debt absent",
		);
		sessionMayExist = !taskResult.ok || taskResult.release !== undefined;

		const afterTask = await sessions();
		claim(
			"U3 inventory returned to baseline",
			sameMembers(afterTask, baselineSessions),
			`${afterTask.length}/${baselineSessions.length} sessions`,
		);

		const discoveryFacts: EnvelopeTransportFacts = {
			adapter: "agent-browser",
			probeExecutable: executable,
			endpointHttp,
			endpointWs,
			runId,
		};
		const discoveryStart = observedInputs.length;
		sessionMayExist = true;
		const discovery = await discoverPages(
			createDefaultBrowserUseRuntime({ runCommand: capturedRunCommand }),
			discoveryFacts,
		);
		const discoveryInputs = observedInputs.slice(discoveryStart);
		releaseTraceClaims("U4 discovery terminal seam", discoveryInputs, sessionName);
		claim(
			"U4 discovery terminal seam releases",
			discovery.ok && discovery.release === undefined,
			discovery.ok
				? `${discovery.pages.length} pages observed; release debt absent`
				: "discovery did not complete successfully",
		);
		sessionMayExist = discovery.release !== undefined;
	}

	const finalSessions = await sessions();
	const finalPid = await chromePid();
	const finalPages = await pageCount();
	claim(
		"R7 named-scope only; inventory restored",
		sameMembers(finalSessions, baselineSessions),
		`${finalSessions.length}/${baselineSessions.length} sessions; all foreign names unchanged`,
	);
	claim(
		"Agent Chrome PID untouched",
		finalPid === baselinePid,
		`PID ${finalPid} remained stable`,
	);
	claim(
		"owned page target removed",
		finalPages === baselinePages,
		`${finalPages}/${baselinePages} page targets`,
	);
	console.log(PLANTED ? "\nPlanted acceptance receipt PASS." : "\nPost-build acceptance receipt PASS.");
} finally {
	try {
		server.stop();
	} catch (error) {
		console.error("Cleanup could not stop the fixture server.", error);
	}
	if (sessionMayExist) {
		try {
			const cleanup = await builtRelease();
			console.error(
				cleanup.released
					? `Cleanup released ${sessionName} through built releaseSession.`
					: `Cleanup could not release ${sessionName}; inspect Agent Browser inventory.`,
			);
		} catch (error) {
			console.error(
				`Cleanup failed while releasing ${sessionName}; inspect Agent Browser inventory.`,
				error,
			);
		}
	}
}
