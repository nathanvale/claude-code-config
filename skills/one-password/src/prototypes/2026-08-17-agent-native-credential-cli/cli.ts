#!/usr/bin/env bun

import {
	prototypeHelp,
	renderPrototypeHuman,
	runPrototypeCommand,
} from "./engine";

const execution = runPrototypeCommand(Bun.argv.slice(2));

if (execution.help !== undefined) {
	if (execution.json) {
		console.log(JSON.stringify({ help: execution.help }));
	} else {
		console.log(execution.help);
	}
} else if (execution.version !== undefined) {
	console.log(execution.version);
} else if (execution.result !== undefined) {
	if (execution.json) {
		console.log(JSON.stringify(execution.result, null, 2));
	} else {
		console.log(renderPrototypeHuman(execution.result));
	}
} else {
	console.log(prototypeHelp());
}

if (execution.diagnostic !== undefined) {
	console.error(`credential prototype: ${execution.diagnostic}`);
}

process.exitCode = execution.exitCode;
