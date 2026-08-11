import {
	isTerminalState,
	type BrowserUseRunState,
} from "./browser-use-run-model";

/** Derive the Agent Browser adapter session owned by one Browser Use run. */
export function deriveSessionName(runId: string): string {
	return `browser-use-${runId}`;
}

/** Release an Adapter Session Lease only after its run ends or is absent. */
export function shouldRelease(state: BrowserUseRunState | undefined): boolean {
	return state === undefined || isTerminalState(state);
}
