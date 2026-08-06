import {
	COMMAND_FACADE_BASELINE_EXIT_CODES,
	type CommandFacadeMetadataDrift,
} from "./command-contract";

const BASELINE_EXIT_CODE_DRIFT = {
	"0": {
		category: "command-baseline-exit-success-missing",
		discoveryCategory: "command-discovery-baseline-exit-success-missing",
		meaning: "0 success",
	},
	"1": {
		category: "command-baseline-exit-failure-missing",
		discoveryCategory: "command-discovery-baseline-exit-failure-missing",
		meaning: "1 generic or runtime failure",
	},
	"2": {
		category: "command-baseline-exit-usage-missing",
		discoveryCategory: "command-discovery-baseline-exit-usage-missing",
		meaning: "2 invalid usage",
	},
} as const satisfies Record<
	(typeof COMMAND_FACADE_BASELINE_EXIT_CODES)[number],
	{ category: string; discoveryCategory: string; meaning: string }
>;

export function findBaselineExitCodeDrift(input: {
	command: string;
	path: string;
	exitCodes: Readonly<Record<string, string>>;
	discovery: boolean;
}): CommandFacadeMetadataDrift[] {
	return COMMAND_FACADE_BASELINE_EXIT_CODES.filter(
		(code) => !Object.hasOwn(input.exitCodes, code),
	).map((code) => {
		const { category, discoveryCategory, meaning } =
			BASELINE_EXIT_CODE_DRIFT[code];
		return {
			category: input.discovery ? discoveryCategory : category,
			path: input.path,
			action: `Declare baseline exit code "${code}" (${meaning}) for command ${input.command}.`,
		};
	});
}
