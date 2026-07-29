#!/usr/bin/env bun

import {
	CE_WORK_INSPECT_CONTRACT,
	renderHelp,
} from "./command-contract.ts";
import {
	buildFailureResult,
	failureExitCode,
	InspectionError,
	inspectCeWorkStatus,
	type InspectionResult,
} from "./ce-work-status.ts";

const args = process.argv.slice(2);
const helpOption = CE_WORK_INSPECT_CONTRACT.options.find(
	(option) => option.id === "help",
);

if (
	args.length === 0 ||
	helpOption === undefined ||
	args.some(
		(arg) => arg === helpOption.flag || helpOption.aliases.includes(arg as "-h"),
	)
) {
	process.stdout.write(renderHelp());
	process.exit(0);
}

interface ParsedArgs {
	runId: string;
	unitId?: string;
	controllerPath: string;
	json: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	let runId: string | undefined;
	let unitId: string | undefined;
	let controllerPath: string | undefined;
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const option = CE_WORK_INSPECT_CONTRACT.options.find(
			(candidate) =>
				candidate.flag === arg ||
				candidate.aliases.some((alias) => alias === arg),
		);
		if (!option || option.id === "help") {
			throw new InspectionError("usage_error", `unknown argument: ${arg}`);
		}
		if (option.id === "json") {
			json = true;
			continue;
		}
		if (option.value) {
			const value = argv[index + 1];
			if (!value || value.startsWith("-")) {
				throw new InspectionError(
					"usage_error",
					`${option.flag} needs a value`,
				);
			}
			index += 1;
			if (option.id === "runId") {
				runId = value;
			} else if (option.id === "unitId") {
				unitId = value;
			} else {
				controllerPath = value;
			}
			continue;
		}
	}
	if (!runId) {
		throw new InspectionError("usage_error", "--run-id is required");
	}
	if (!controllerPath) {
		throw new InspectionError("usage_error", "--controller is required");
	}
	return { runId, unitId, controllerPath, json };
}

function renderHuman(result: InspectionResult): string {
	const lines = [
		`CE Work run ${result.run.run_id} (revision ${result.run.revision})`,
		`Run verification: ${result.verification.run}`,
	];
	for (const wave of result.waves) {
		lines.push(`Wave ${wave.wave_id}: ${wave.unit_ids.join(", ")}`);
	}
	for (const unit of result.units) {
		const workspace = unit.worktree_path
			? `owner ${unit.ownership}; worktree ${unit.worktree_path}`
			: `owner ${unit.ownership}; worktree none`;
		lines.push(
			`${unit.unit_id}: ${unit.state}; worker ${unit.process_state}; ${workspace}; verification ${unit.verification}; next ${unit.next_action}`,
		);
	}
	lines.push(`Next: ${result.next_action.id}`);
	return `${lines.join("\n")}\n`;
}

try {
	const parsed = parseArgs(args);
	const result = inspectCeWorkStatus({
		runId: parsed.runId,
		unitId: parsed.unitId,
		controllerPath: parsed.controllerPath,
		environment: process.env,
	});
	process.stdout.write(
		parsed.json ? `${JSON.stringify(result)}\n` : renderHuman(result),
	);
} catch (error) {
	if (error instanceof InspectionError) {
		const jsonOption = CE_WORK_INSPECT_CONTRACT.options.find(
			(option) => option.id === "json",
		);
		if (jsonOption && args.includes(jsonOption.flag)) {
			process.stdout.write(`${JSON.stringify(buildFailureResult(error))}\n`);
			process.exit(failureExitCode(error.code));
		}
		process.stderr.write(`ce-work-inspect: ${error.message}\n`);
		process.exit(failureExitCode(error.code));
	}
	process.stderr.write("ce-work-inspect: unexpected inspection failure\n");
	process.exit(1);
}
