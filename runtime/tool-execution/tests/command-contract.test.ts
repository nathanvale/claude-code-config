import { expect, test } from "bun:test";
import {
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
} from "@side-quest/cli-command-facade";
import {
	TOOL_EXECUTION_COMMANDS,
	TOOL_EXECUTION_COMMAND_CONTRACTS,
	TOOL_EXECUTION_DISCOVERY,
	TOOL_EXECUTION_INPUT_CONTRACTS,
} from "../src/command-contract.ts";
import { validatePreparedRequest } from "../src/receipt-store.ts";

test("command metadata and discovery expose the eight approved routes without drift", () => {
	expect(TOOL_EXECUTION_COMMANDS).toEqual([
		"contract",
		"checkpoint",
		"prepare",
		"approve",
		"call",
		"observe",
		"resume",
		"receipts",
	]);
	expect(findCommandFacadeMetadataDrift(TOOL_EXECUTION_COMMAND_CONTRACTS)).toEqual(
		[],
	);
	expect(findCommandDiscoveryTreeDrift(TOOL_EXECUTION_DISCOVERY)).toEqual([]);
	expect(TOOL_EXECUTION_COMMAND_CONTRACTS.approve).toMatchObject({
		audience: "operator",
		interactivity: "required",
	});
	expect(TOOL_EXECUTION_COMMAND_CONTRACTS.call).toMatchObject({
		audience: "operator",
		interactivity: "required",
	});
});

test("prepare discovery examples are accepted by the runtime parser", () => {
	for (const [adapter, example] of Object.entries(
		TOOL_EXECUTION_INPUT_CONTRACTS.prepare.redacted_examples,
	)) {
		const input = JSON.parse(
			JSON.stringify(example)
				.replaceAll("<active-checkpoint-id>", "u5")
				.replaceAll("<public-query>", "bounded public query"),
		);
		expect(() => validatePreparedRequest(input)).not.toThrow();
		expect(input.adapter).toBe(adapter);
	}
});
