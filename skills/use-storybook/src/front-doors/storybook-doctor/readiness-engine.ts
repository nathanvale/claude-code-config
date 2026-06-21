import type { StorybookDoctorRuntime } from "./runtime.ts";
import type {
	NextSafeAction,
	ReadinessFinding,
	ReadinessResult,
	ReadinessStatus,
	SessionInfo,
} from "./readiness-model.ts";
import { type ResolvedTarget, resolveTarget } from "./target-discovery.ts";

const DEFAULT_STORYBOOK_URL = "http://localhost:6006";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MCP_PROBE_TIMEOUT_MS = 5_000;

export type CheckOptions = {
	readonly url?: string;
	readonly repo?: string;
};

export async function runCheck(
	runtime: StorybookDoctorRuntime,
	options: CheckOptions,
): Promise<ReadinessResult> {
	const target = resolveTarget(runtime, { repo: options.repo });
	const findings: ReadinessFinding[] = [];

	collectStaticFindings(target, findings);

	if (hasBlocker(findings)) {
		return buildResult(target, findings, null);
	}

	const sessionUrl = resolveSessionUrl(runtime, options.url);
	if (!isLoopbackUrl(sessionUrl)) {
		findings.push({
			id: "non_loopback_url",
			category: "safety_failure",
			severity: "blocked",
			message: `URL ${sessionUrl} is not a loopback address. Storybook doctor only probes loopback origins.`,
		});
		return buildResult(target, findings, null);
	}

	const session = await probeSession(runtime, sessionUrl, findings);
	collectHelperFindings(runtime, findings);

	return buildResult(target, findings, session);
}

function collectStaticFindings(
	target: ResolvedTarget,
	findings: ReadinessFinding[],
): void {
	if (!target.info.has_package_json) {
		findings.push({
			id: "no_package_json",
			category: "target_failure",
			severity: "blocked",
			message: `No package.json found at ${target.targetPath}.`,
		});
		return;
	}

	if (!target.info.has_storybook_config) {
		findings.push({
			id: "no_storybook_config",
			category: "setup_failure",
			severity: "blocked",
			message: "No .storybook/main.{js,ts,...} config found.",
		});
	}

	if (!target.info.has_storybook_dependency) {
		findings.push({
			id: "no_storybook_dependency",
			category: "setup_failure",
			severity: "blocked",
			message: "Storybook is not listed in package dependencies.",
		});
	}

	if (!target.info.has_mcp_addon_dependency) {
		findings.push({
			id: "no_mcp_addon_dependency",
			category: "mcp_setup_failure",
			severity: "blocked",
			message: "@storybook/addon-mcp is not listed in package dependencies.",
		});
	}

	if (
		target.info.has_storybook_config &&
		!target.info.has_mcp_addon_config
	) {
		findings.push({
			id: "no_mcp_addon_config",
			category: "mcp_setup_failure",
			severity: "blocked",
			message:
				"@storybook/addon-mcp is not listed in the Storybook main config addons array.",
		});
	}

	if (!target.info.has_storybook_script) {
		findings.push({
			id: "no_storybook_script",
			category: "setup_hint",
			severity: "degraded",
			message:
				"No storybook dev script found in package.json (checked storybook, dev:storybook, storybook:dev).",
		});
	}
}

function resolveSessionUrl(runtime: StorybookDoctorRuntime, urlOverride?: string): string {
	if (urlOverride) return urlOverride;
	return runtime.getEnv("STORYBOOK_URL") ?? DEFAULT_STORYBOOK_URL;
}

function isLoopbackUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return LOOPBACK_HOSTS.has(parsed.hostname);
	} catch {
		return false;
	}
}

async function probeSession(
	runtime: StorybookDoctorRuntime,
	sessionUrl: string,
	findings: ReadinessFinding[],
): Promise<SessionInfo> {
	const url = new URL(sessionUrl);
	const defaultPort = url.protocol === "https:" ? "443" : "80";
	const port = Number.parseInt(url.port || defaultPort, 10);
	const portOwner = runtime.lookupPortOwner(port);

	const managerReachable = await probeManager(runtime, sessionUrl);
	if (!managerReachable) {
		findings.push({
			id: "no_live_session",
			category: "live_readiness",
			severity: "blocked",
			message: `No running Storybook session at ${sessionUrl}.`,
			detail: portOwner
				? `Port ${port} owned by PID ${portOwner.pid} (${portOwner.command}).`
				: `No process listening on port ${port}.`,
		});
		return {
			url: sessionUrl,
			is_loopback: true,
			manager_reachable: false,
			mcp_reachable: false,
			mcp_tools_count: null,
			port_owner_pid: portOwner?.pid ?? null,
			port_owner_command: portOwner?.command ?? null,
		};
	}

	const mcpResult = await probeMcp(runtime, sessionUrl);
	if (!mcpResult.reachable) {
		findings.push({
			id: "manager_ok_mcp_missing",
			category: "mcp_failure",
			severity: "blocked",
			message: `Storybook manager reachable at ${sessionUrl} but /mcp endpoint is not responding.`,
		});
	} else {
		findings.push({
			id: "mcp_tools_ready",
			category: "mcp_proof",
			severity: "ready",
			message: `MCP endpoint ready with ${mcpResult.toolsCount} tools.`,
		});
	}

	return {
		url: sessionUrl,
		is_loopback: true,
		manager_reachable: true,
		mcp_reachable: mcpResult.reachable,
		mcp_tools_count: mcpResult.toolsCount,
		port_owner_pid: portOwner?.pid ?? null,
		port_owner_command: portOwner?.command ?? null,
	};
}

async function probeManager(
	runtime: StorybookDoctorRuntime,
	sessionUrl: string,
): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			MCP_PROBE_TIMEOUT_MS,
		);
		try {
			const response = await runtime.fetch(sessionUrl, {
				signal: controller.signal,
			});
			return response.ok;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return false;
	}
}

async function probeMcp(
	runtime: StorybookDoctorRuntime,
	sessionUrl: string,
): Promise<{ reachable: boolean; toolsCount: number | null }> {
	try {
		const mcpUrl = sessionUrl.replace(/\/$/, "") + "/mcp";
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			MCP_PROBE_TIMEOUT_MS,
		);
		try {
			const response = await runtime.fetch(mcpUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
				signal: controller.signal,
			});
			if (!response.ok) return { reachable: false, toolsCount: null };
			const body = await response.text();
			try {
				const parsed = JSON.parse(body);
				const toolsCount = Array.isArray(parsed.result?.tools)
					? parsed.result.tools.length
					: null;
				return { reachable: true, toolsCount };
			} catch {
				return { reachable: true, toolsCount: null };
			}
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return { reachable: false, toolsCount: null };
	}
}

function collectHelperFindings(
	runtime: StorybookDoctorRuntime,
	findings: ReadinessFinding[],
): void {
	const mcpReady = findings.some(
		(f) => f.id === "mcp_tools_ready" && f.severity === "ready",
	);

	if (mcpReady && !runtime.commandExists("mcporter")) {
		findings.push({
			id: "mcporter_missing_raw_mcp_ready",
			category: "helper_gap",
			severity: "degraded",
			message:
				"mcporter is not installed. Raw /mcp works but mcporter provides easier tool discovery.",
		});
	}

	if (!runtime.commandExists("tmux")) {
		findings.push({
			id: "tmux_missing_hint",
			category: "process_owner_hint",
			severity: "degraded",
			message:
				"tmux is not installed. It can keep a Storybook session alive across terminal sessions.",
			detail: "Install with: brew install tmux",
		});
	}
}

function hasBlocker(findings: readonly ReadinessFinding[]): boolean {
	return findings.some((f) => f.severity === "blocked");
}

export function aggregateStatus(
	findings: readonly ReadinessFinding[],
): ReadinessStatus {
	if (findings.some((f) => f.severity === "blocked")) return "blocked";
	if (findings.some((f) => f.severity === "degraded")) return "degraded";
	return "ready";
}

export function pickNextSafeAction(
	findings: readonly ReadinessFinding[],
): NextSafeAction {
	const firstBlocker = findings.find((f) => f.severity === "blocked");
	if (firstBlocker) {
		return nextActionForFinding(firstBlocker);
	}
	const firstDegraded = findings.find((f) => f.severity === "degraded");
	if (firstDegraded) {
		return nextActionForFinding(firstDegraded);
	}
	return { id: "none", summary: "Storybook is ready for MCP use." };
}

export function nextActionForFinding(finding: ReadinessFinding): NextSafeAction {
	switch (finding.id) {
		case "no_package_json":
			return {
				id: "create_package_json",
				summary: "Create a package.json in the target directory.",
			};
		case "no_storybook_config":
			return {
				id: "add_storybook_config",
				summary:
					"Add a .storybook/main.{js,ts} config with your framework and stories glob.",
			};
		case "no_storybook_dependency":
			return {
				id: "install_storybook",
				summary: "Install storybook as a dev dependency.",
			};
		case "no_mcp_addon_dependency":
			return {
				id: "install_mcp_addon",
				summary: "Install @storybook/addon-mcp as a dev dependency.",
			};
		case "no_mcp_addon_config":
			return {
				id: "configure_mcp_addon",
				summary:
					"Add @storybook/addon-mcp to the addons array in .storybook/main config.",
			};
		case "no_storybook_script":
			return {
				id: "add_storybook_script",
				summary:
					"Add a storybook dev script to package.json (e.g. storybook dev -p 6006).",
			};
		case "no_live_session":
			return {
				id: "start_storybook",
				summary: "Start a Storybook dev server before running diagnostics.",
			};
		case "non_loopback_url":
			return {
				id: "use_loopback_url",
				summary:
					"Use a loopback URL (localhost, 127.0.0.1, or [::1]) for Storybook.",
			};
		case "manager_ok_mcp_missing":
			return {
				id: "check_mcp_addon",
				summary:
					"Verify @storybook/addon-mcp is installed and listed in .storybook/main config addons.",
			};
		case "mcporter_missing_raw_mcp_ready":
			return {
				id: "install_mcporter",
				summary: "Install mcporter for easier MCP tool discovery.",
			};
		case "tmux_missing_hint":
			return {
				id: "install_tmux",
				summary: "Install tmux for persistent Storybook sessions.",
			};
		case "local_storybook_binary_missing":
			return {
				id: "install_local_storybook",
				summary: "Install storybook in the target project to enable deep diagnostics.",
			};
		case "storybook_doctor_nonzero":
			return {
				id: "fix_storybook_doctor_issues",
				summary: "Review and fix issues reported by local Storybook doctor.",
			};
		case "storybook_doctor_exec_failed":
			return {
				id: "fix_storybook_doctor_issues",
				summary:
					"Retry local Storybook doctor execution and resolve the reported runtime issues.",
			};
		default:
			return { id: "none", summary: "No specific action required." };
	}
}

function buildResult(
	target: ResolvedTarget,
	findings: readonly ReadinessFinding[],
	session: SessionInfo | null,
): ReadinessResult {
	return {
		status: aggregateStatus(findings),
		findings,
		next_safe_action: pickNextSafeAction(findings),
		target: target.info,
		session,
	};
}
