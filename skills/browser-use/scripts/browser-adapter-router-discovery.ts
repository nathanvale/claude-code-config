import type {
	BrowserAdapterRouterDiagnosticCode,
	BrowserAdapterRouterReportSource,
} from "./command-contract";
import { BROWSER_ADAPTER_ROUTER_MANIFESTS } from "./browser-adapter-router-manifests";
import type {
	BrowserAdapterId,
	CapabilityReport,
} from "./browser-adapter-router-model";
import { isReportStale } from "./browser-adapter-router-engine";
import { validateCapabilityReport } from "./browser-adapter-router-report-validation";
export {
	isBrowserAdapter,
	isCapability,
	validateCapabilityReport,
} from "./browser-adapter-router-report-validation";
export type { ReportValidationResult } from "./browser-adapter-router-report-validation";

// ---------------------------------------------------------------------------
// report command (U0). Discover one adapter capability report: validated
// self-report (if the registry declares a command vector) over validated
// manifest. report performs check/network only; never browser action.
// ---------------------------------------------------------------------------

export type ReportDiscovery =
	| {
			found: true;
			source: BrowserAdapterRouterReportSource;
			report: CapabilityReport;
	  }
	| {
			found: false;
			code: Extract<
				BrowserAdapterRouterDiagnosticCode,
				"adapter_capability_unknown" | "adapter_capability_stale"
			>;
			diagnostics: string[];
	  };

export function discoverReport(
	adapter: BrowserAdapterId,
	evaluationDate: string,
	selfReport?: unknown,
): ReportDiscovery {
	// Validated self-report wins over manifest (plan Report source order).
	if (selfReport !== undefined) {
		const result = validateCapabilityReport(selfReport);
		if (result.ok && result.report.adapter_id === adapter) {
			return {
				found: true,
				source: "self_report",
				report: { ...result.report, report_source: "self_report" },
			};
		}
		// Malformed self-report -> unknown plus schema diagnostic (U0).
		return {
			found: false,
			code: "adapter_capability_unknown",
			diagnostics: result.ok
				? ["self-report adapter_id does not match requested adapter"]
				: result.diagnostics,
		};
	}

	const manifest = BROWSER_ADAPTER_ROUTER_MANIFESTS[adapter];
	if (!manifest) {
		return {
			found: false,
			code: "adapter_capability_unknown",
			diagnostics: ["no manifest-backed report exists for this adapter"],
		};
	}
	const result = validateCapabilityReport(manifest);
	if (!result.ok) {
		return {
			found: false,
			code: "adapter_capability_unknown",
			diagnostics: result.diagnostics,
		};
	}
	// Valid report past stale-after is stale, not unknown (U0).
	if (isReportStale(result.report.provenance, evaluationDate)) {
		return {
			found: false,
			code: "adapter_capability_stale",
			diagnostics: ["manifest report exceeded its freshness policy"],
		};
	}
	return { found: true, source: "manifest", report: result.report };
}
