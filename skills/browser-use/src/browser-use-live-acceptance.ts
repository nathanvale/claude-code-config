import { createNativeAbsentRuntime } from "@side-quest/browser-use-security";

const LIVE_GATE = "BROWSER_USE_LIVE_ACCEPTANCE";

const HELP = `Browser Use live Runbook acceptance

Usage:
  BROWSER_USE_LIVE_ACCEPTANCE=1 bun run acceptance:live

Production Reviewed Action promotion is unavailable until the separately
reviewed Browser Use Security signed-product installation, admission, and repair
lifecycle exists. This command fails closed before temporary files, fixture
servers, native processes, verifier persistence, presence, or browser dispatch.
`;

type LiveOutput = { write(text: string): unknown };

function jsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/** Report live acceptance availability through the code-owned native admission runtime. */
export async function runBrowserUseLiveAcceptance(
	args: readonly string[],
	env: Record<string, string | undefined> = process.env,
	stdout: LiveOutput = process.stdout,
	stderr: LiveOutput = process.stderr,
): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		stdout.write(HELP);
		return 0;
	}
	if (env[LIVE_GATE] !== "1") {
		stderr.write(jsonLine({
			ok: false,
			code: "live-acceptance-disabled",
			message: `Set ${LIVE_GATE}=1 only on a host prepared for live acceptance.`,
		}));
		return 20;
	}

	const admission = await createNativeAbsentRuntime().verifyTarget("approval-broker");
	if (admission.verdict === "native-capability-absent") {
		stderr.write(jsonLine({
			ok: false,
			code: "native-capability-absent",
			message: "Browser Use Security has no admitted native ApprovalBroker capability.",
			repair: "install-and-admit-browser-use-security",
		}));
		return 20;
	}

	stderr.write(jsonLine({
		ok: false,
		code: "native-product-handle-unavailable",
		message: "Admission returned no code-owned ApprovalBroker handle.",
		repair: "install-and-admit-browser-use-security",
	}));
	return 20;
}

if (import.meta.main) {
	process.exitCode = await runBrowserUseLiveAcceptance(process.argv.slice(2));
}
