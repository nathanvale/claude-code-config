import type {
	BrowserUseConfidentialDeliveryQuarantine,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

type QuarantineState = "open" | "paused" | "cleaned" | "quarantined";
type QuarantineWriteState =
	| "blocked-before-write"
	| "write-outcome-unknown"
	| "delivered";

function targetsEqual(
	left: BrowserUseVerifiedTarget,
	right: BrowserUseVerifiedTarget,
): boolean {
	return (
		left.lane_id === right.lane_id &&
		left.run_id === right.run_id &&
		left.top_level_origin === right.top_level_origin &&
		left.frame_origin === right.frame_origin &&
		left.target_id === right.target_id &&
		left.page_id === right.page_id &&
		left.frame_id === right.frame_id &&
		left.account_ref === right.account_ref &&
		left.target_proof_digest === right.target_proof_digest
	);
}

function heldTargetIdentityContinues(
	left: BrowserUseVerifiedTarget,
	right: BrowserUseVerifiedTarget,
): boolean {
	return (
		left.lane_id === right.lane_id &&
		left.run_id === right.run_id &&
		left.target_id === right.target_id &&
		left.account_ref === right.account_ref &&
		right.top_level_origin === right.frame_origin
	);
}

/**
 * Gate every adapter command around one confidential native field write.
 *
 * Pause succeeds only when no capture command is active. Cleanup records the
 * native write state before resume. An unknown write is terminal for this
 * controller and keeps all later adapter commands quarantined.
 */
export function createBrowserUseConfidentialDeliveryQuarantine(input: {
	runCommand(
		command: McporterCommandInput,
	): Promise<McporterCommandResult>;
	approved_rebind_origins?: readonly string[];
}): {
	quarantine: BrowserUseConfidentialDeliveryQuarantine;
	runCommand(command: McporterCommandInput): Promise<McporterCommandResult>;
	rebind(input: {
		previous_target: BrowserUseVerifiedTarget;
		next_target: BrowserUseVerifiedTarget;
	}): { ok: true } | { ok: false };
	inspect(): {
		state: QuarantineState;
		write_state: QuarantineWriteState | null;
	};
} {
	const approvedRebindOrigins = new Set(input.approved_rebind_origins ?? []);
	let state: QuarantineState = "open";
	let target: BrowserUseVerifiedTarget | undefined;
	let writeState: QuarantineWriteState | null = null;
	let sensitiveEffect = false;
	let activeCommands = 0;

	const quarantine: BrowserUseConfidentialDeliveryQuarantine = {
		async pause(candidate) {
			if (activeCommands !== 0) return { ok: false };
			if (state === "open") {
				target = { ...candidate.target };
			} else if (
				state !== "cleaned" ||
				target === undefined ||
				!targetsEqual(target, candidate.target)
			) {
				return { ok: false };
			}
			writeState = null;
			state = "paused";
			return { ok: true };
		},
		async cleanup(candidate) {
			if (
				state !== "paused" ||
				target === undefined ||
				!targetsEqual(target, candidate.target) ||
				![
					"blocked-before-write",
					"write-outcome-unknown",
					"delivered",
				].includes(candidate.write_state)
			) {
				return { ok: false };
			}
			writeState = candidate.write_state;
			if (candidate.write_state === "delivered") {
				sensitiveEffect = true;
			}
			state =
				candidate.write_state === "write-outcome-unknown"
					? "quarantined"
					: "cleaned";
			return { ok: true };
		},
		async resume(candidate) {
			if (
				state !== "cleaned" ||
				target === undefined ||
				!targetsEqual(target, candidate.target) ||
				sensitiveEffect
			) {
				return { ok: false };
			}
			target = undefined;
			writeState = null;
			sensitiveEffect = false;
			state = "open";
			return { ok: true };
		},
	};

	return {
		quarantine,
		async runCommand(command) {
			if (state !== "open") {
				throw new Error("capture is quarantined");
			}
			activeCommands += 1;
			try {
				return await input.runCommand(command);
			} finally {
				activeCommands -= 1;
			}
		},
		rebind(candidate) {
			if (
				state !== "cleaned" ||
				activeCommands !== 0 ||
				target === undefined ||
				!targetsEqual(target, candidate.previous_target) ||
				!heldTargetIdentityContinues(
					candidate.previous_target,
					candidate.next_target,
				) ||
				!approvedRebindOrigins.has(candidate.next_target.top_level_origin)
			) {
				return { ok: false };
			}
			target = { ...candidate.next_target };
			return { ok: true };
		},
		inspect: () => ({ state, write_state: writeState }),
	};
}
