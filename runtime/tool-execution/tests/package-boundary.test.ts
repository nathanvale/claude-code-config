import { expect, test } from "bun:test";
import {
	QUALIFICATION_LANES,
	TOOL_EXECUTION_ADAPTERS,
	TOOL_EXECUTION_COMMANDS,
	classifyProviderResult,
	createReceiptStore,
} from "../src/index.ts";

test("the public package exposes the fixed two-adapter and four-lane contract", () => {
	expect(TOOL_EXECUTION_ADAPTERS).toEqual(["firecrawl-cli", "mcporter-cli"]);
	expect(QUALIFICATION_LANES).toEqual([
		"claude_code_cli",
		"codex_cli_tui",
		"codex_desktop",
		"explicit_cli",
	]);
	expect(TOOL_EXECUTION_COMMANDS).toHaveLength(8);
	expect(typeof classifyProviderResult).toBe("function");
	expect(typeof createReceiptStore).toBe("function");
});
