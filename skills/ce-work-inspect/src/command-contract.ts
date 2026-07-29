/**
 * Discoverable metadata for the read-only CE Work inspector.
 *
 * @example
 * ```typescript
 * console.log(CE_WORK_INSPECT_CONTRACT.purpose)
 * ```
 */
export const CE_WORK_INSPECT_CONTRACT = {
	name: "ce-work-inspect",
	purpose: "Inspect one CE Work run without changing it.",
	sideEffects: "read-only",
	usage:
		"ce-work-inspect --run-id <id> [--unit-id <id>] [--controller <path>] [--json]",
	options: [
		{
			id: "runId",
			flag: "--run-id",
			value: "<id>",
			aliases: [],
			summary: "CE Work controller run ID.",
		},
		{
			id: "unitId",
			flag: "--unit-id",
			value: "<id>",
			aliases: [],
			summary: "Show one unit from the run.",
		},
		{
			id: "controller",
			flag: "--controller",
			value: "<path>",
			aliases: [],
			summary: "Use this CE Work unit-workspace.py controller.",
		},
		{
			id: "json",
			flag: "--json",
			value: null,
			aliases: [],
			summary: "Emit stable machine-readable output.",
		},
		{
			id: "help",
			flag: "--help",
			value: null,
			aliases: ["-h"],
			summary: "Show this help.",
		},
	] as const,
} as const;

/**
 * Render CLI help from the same metadata that owns parser vocabulary.
 *
 * @returns Human-readable help text
 *
 * @example
 * ```typescript
 * process.stdout.write(renderHelp())
 * ```
 */
export function renderHelp(): string {
	const flagLines = CE_WORK_INSPECT_CONTRACT.options
		.map((option) => {
			const names = [...option.aliases, option.flag].join(", ");
			const syntax = option.value ? `${names} ${option.value}` : names;
			return `  ${syntax.padEnd(23)} ${option.summary}`;
		})
		.join("\n");
	return [
		CE_WORK_INSPECT_CONTRACT.purpose,
		"",
		`Usage: ${CE_WORK_INSPECT_CONTRACT.usage}`,
		"",
		"Options:",
		flagLines,
		"",
		`Side effects: ${CE_WORK_INSPECT_CONTRACT.sideEffects}`,
		"",
	].join("\n");
}
