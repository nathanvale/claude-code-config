// U6 dashboard: the bare, no-arg read-only projection (R15).
//
// A STATELESS projection of the adapter registry: per-adapter install/provenance
// status, declared route evidence, and route compatibility per adapter against
// the Agent Chrome environment. It NEVER probes attachment, proves an
// environment, launches Agent Chrome, or reads persisted run state (there is no
// state file). One read lets an agent pick a valid adapter + route without a
// trial connection (R16).
//
// The projection calls each Adapter Definition's provenance check
// (`checkProvenance`) — installed / version — but NEVER its attachment probe
// (`probeAttachment`). Compatibility comes from the pure route-compatibility
// function, not from any live environment read.

import {
	BROWSER_CONNECT_ENVIRONMENT_ROUTES,
	isRouteCompatible,
} from "./compatibility.ts";
import type {
	BrowserConnectEnvironmentName,
	BrowserConnectRouteEvidenceStatus,
	BrowserConnectRouteId,
} from "./model.ts";
import { BROWSER_CONNECT_ENVIRONMENT_NAMES } from "./model.ts";
import type { AdapterDefinition, AdapterRuntime } from "./adapters/registry.ts";

/**
 * The single environment the slice-one dashboard projects compatibility
 * against (R10): Agent Chrome. Declared here rather than probed — the dashboard
 * never reads live environment state.
 */
const DASHBOARD_ENVIRONMENT: BrowserConnectEnvironmentName =
	BROWSER_CONNECT_ENVIRONMENT_NAMES[0];

/**
 * One declared route capability projected for an adapter row: the route, its
 * adapter-declared evidence status, whether the adapter implements it in this
 * slice, and whether the dashboard environment offers a matching route.
 */
export type DashboardRouteProjection = {
	route: BrowserConnectRouteId;
	evidence: BrowserConnectRouteEvidenceStatus;
	implemented: boolean;
	/** True when {@link DASHBOARD_ENVIRONMENT} offers this route (pure check). */
	environment_compatible: boolean;
};

/**
 * The install/provenance status of one adapter, without any attachment probe.
 * `installed` reflects only the provenance check (executable resolvable +
 * version match); a not-installed row carries the install affordance id (R15/
 * AE5) so it is shown as unavailable, never advertised as connectable.
 */
export type DashboardAdapterProjection = {
	adapter_id: string;
	display_name: string;
	installed: boolean;
	/** Present only when not installed — the redacted provenance reason. */
	provenance_detail?: string;
	routes: readonly DashboardRouteProjection[];
	/**
	 * True when the adapter is installed AND shares at least one route with the
	 * dashboard environment: the one-read "connectable" verdict (R16). No probe
	 * fires to compute this.
	 */
	connectable: boolean;
};

/**
 * The full read-only dashboard projection (R15/R16): the environment it is
 * projected against and one row per registered adapter. Decision-complete in
 * one read — an agent picks a connectable adapter + a compatible route without a
 * trial connection.
 */
export type BrowserConnectDashboard = {
	environment: BrowserConnectEnvironmentName;
	environment_routes: readonly BrowserConnectRouteId[];
	adapters: readonly DashboardAdapterProjection[];
};

/**
 * Injectable dependencies for the dashboard projection. Tests inject a fake
 * `adapterRuntime` (so provenance resolves against scripted fakes, never a real
 * binary) and the registry accessor (so an "uninstalled" adapter is simulated
 * without editing the registry).
 */
export type DashboardDeps = {
	/** Adapter runtime seam — `resolveExecutable`/`runCommand` for provenance. */
	adapterRuntime: AdapterRuntime;
	/** Registry accessor; defaults to the real registry in production. */
	listAdapterDefinitions: () => readonly AdapterDefinition[];
};

/**
 * Project the read-only dashboard (R15).
 *
 * Runs each adapter's provenance check ONLY — never its attachment probe, never
 * an environment proof, never a launch. Route compatibility comes from the pure
 * compatibility function. The result is a one-read adapter/route decision
 * surface (R16).
 *
 * @param deps - Adapter runtime seam and registry accessor
 * @returns The stateless dashboard projection
 */
export async function projectBrowserConnectDashboard(
	deps: DashboardDeps,
): Promise<BrowserConnectDashboard> {
	const environmentRoutes: readonly BrowserConnectRouteId[] =
		BROWSER_CONNECT_ENVIRONMENT_ROUTES[DASHBOARD_ENVIRONMENT];

	const adapters: DashboardAdapterProjection[] = [];
	for (const definition of deps.listAdapterDefinitions()) {
		// Provenance ONLY — attachment probe is never invoked by the dashboard.
		const provenance = await definition.checkProvenance(deps.adapterRuntime);
		const installed = provenance.installed;

		const routes: DashboardRouteProjection[] = definition.routes.map(
			(capability) => ({
				route: capability.route,
				evidence: capability.evidence,
				implemented: capability.implemented,
				environment_compatible: isRouteCompatible(
					DASHBOARD_ENVIRONMENT,
					capability.route,
				),
			}),
		);

		const sharesRoute = routes.some((route) => route.environment_compatible);

		adapters.push({
			adapter_id: definition.id,
			display_name: definition.displayName,
			installed,
			...(provenance.installed
				? {}
				: { provenance_detail: provenance.detail }),
			routes,
			connectable: installed && sharesRoute,
		});
	}

	return {
		environment: DASHBOARD_ENVIRONMENT,
		environment_routes: environmentRoutes,
		adapters,
	};
}
