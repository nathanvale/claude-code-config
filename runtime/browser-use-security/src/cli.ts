// The `./cli` subpath export. No FACADE-BACKED CLI contract is minted yet — a
// later unit owns the real front door via `cli-author` (discovery metadata,
// rendered help, parser acceptance, runtime semantics). This module owns the
// in-process `main(argv, deps)` consumption seam (browser-connect precedent):
// an injectable admission runtime plus writers, so admission can be driven
// end-to-end in-process with either the prod placeholder or the in-memory fake,
// with no real signed product and no real Chrome. It stays fail-closed and
// never crashes; native-capability absence is a legal verdict, not an error.
import type { AdmissionVerdict } from "./model.ts";
import {
	type AdmissionRuntime,
	createNativeAbsentRuntime,
	type ProductAdmissionResult,
} from "./runtime.ts";

/** Minimal writer the seam emits through; `process.stdout` satisfies it. */
export interface CliWriter {
	write(chunk: string): boolean;
}

/**
 * Injectable dependencies for {@link main}. Tests replace the writers and the
 * admission runtime so the entrypoint runs in-process with fakes — no signed
 * product, no filesystem, no real Chrome.
 */
export interface BrowserUseSecurityMainDeps {
	stdout?: CliWriter;
	stderr?: CliWriter;
	/** The admission runtime seam; production wires the native-absent placeholder. */
	runtime?: AdmissionRuntime;
}

/** Exit codes. Usage failures exit 2; a fail-closed not-admitted exits 20. */
const USAGE_EXIT_CODE = 2;
const NOT_ADMITTED_EXIT_CODE = 20;

/**
 * In-process consumption seam for admission verification (browser-connect
 * `main(argv, deps)` precedent).
 *
 * Commands:
 * - bare / no args — renders the typed product posture (exit 0).
 * - `verify` — runs the injected runtime's product verification and emits the
 *   verdict as one JSON line. `admitted` and `native-capability-absent` exit 0;
 *   `not-admitted` exits 20 (fail closed). Never throws.
 *
 * An unknown command is a usage rejection (exit 2). Absence of native
 * capability is a legal verdict emitted on stdout, not an error on stderr.
 *
 * @param argv - Process argv tail after the executable name
 * @param deps - Writers and the admission runtime; production wires the
 *   native-absent placeholder at the bottom of this file
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * const code = await main(["verify"], { runtime: createNativeAbsentRuntime() })
 * ```
 */
export async function main(
	argv: readonly string[],
	deps: BrowserUseSecurityMainDeps = {},
): Promise<number> {
	const stdout = deps.stdout ?? process.stdout;
	const stderr = deps.stderr ?? process.stderr;
	const runtime = deps.runtime ?? createNativeAbsentRuntime();

	const command = argv[0];

	if (command === undefined) {
		// Bare invocation: render the typed product posture without mutating state.
		const result = await runtime.verifyProduct();
		stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	}

	if (command === "verify") {
		const result: ProductAdmissionResult = await runtime.verifyProduct();
		stdout.write(`${JSON.stringify(result)}\n`);
		return result.verdict === "not-admitted" ? NOT_ADMITTED_EXIT_CODE : 0;
	}

	// Unknown command: usage rejection, fail closed, no throw.
	stderr.write(
		`${JSON.stringify({ error: "unknown-command", command })}\n`,
	);
	return USAGE_EXIT_CODE;
}

/**
 * Typed posture for the not-yet-minted facade CLI surface.
 *
 * Returns the fail-closed `native-capability-absent` verdict (ADR 0028): with
 * no facade contract and no installed native product, the front door admits
 * nothing and never crashes. Retained alongside {@link main} for callers that
 * only need the scalar posture; a later unit replaces both with the real
 * facade-backed command surface.
 *
 * @returns The `native-capability-absent` admission verdict
 *
 * @example
 * ```typescript
 * cliPlaceholderVerdict() // 'native-capability-absent'
 * ```
 */
export function cliPlaceholderVerdict(): AdmissionVerdict {
	return "native-capability-absent";
}
