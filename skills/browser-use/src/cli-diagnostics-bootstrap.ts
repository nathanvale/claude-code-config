// Shared CLI diagnostic-bootstrap lifecycle for the browser-use command entrypoints.
// Owns the configure -> try -> finally reset bracket and the quiet-writer selection
// that every entrypoint's parse-phase error path repeated. Each entrypoint keeps its
// own emit*Error inside the `run` thunk; this module owns only the scaffold.
//
// Not facade-owned: @side-quest/cli-command-facade CONTEXT.md defers a lifecycle
// wrapper pending an ADR and names browser-use a consuming-package surface.

import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	configureCliDiagnostics,
	resetCliDiagnostics,
} from "@side-quest/cli-command-facade";

// Drops diagnostic output when --quiet is set. Selected over stderr inside
// emitWithDiagnostics; also used directly by the dispatch-context blocks that this
// module deliberately does not wrap.
export const quietDiagnosticWriter: CliWriter = { write: () => true };

// Run a parse-phase error emit inside the diagnostic lifecycle: configure with the
// quiet-aware writer, run the caller's emit, reset in finally regardless of outcome.
// `run` is synchronous because every call site returns an emit*Error number directly.
export function emitWithDiagnostics(input: {
	categoryRoot: string;
	options: ParsedCliDiagnosticArgv["options"];
	stderr: CliWriter;
	run: () => number;
}): number {
	configureCliDiagnostics({
		categoryRoot: input.categoryRoot,
		options: input.options,
		diagnosticWriter: input.options.quiet ? quietDiagnosticWriter : input.stderr,
	});
	try {
		return input.run();
	} finally {
		resetCliDiagnostics();
	}
}
