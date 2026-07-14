import {
	BROWSER_CONNECT_ROUTES,
	type BrowserConnectEnvironmentName,
	type BrowserConnectRouteId,
} from "./model.ts";

/**
 * Route capabilities the Agent Chrome environment offers (R9). Slice one:
 * Agent Chrome exposes an explicit CDP endpoint only. Adding an environment or
 * route implementation grows this map without changing the envelope schema.
 *
 * Kept package-local (not imported from `model.ts`) because environment→route
 * support is engine policy, not envelope vocabulary — the model owns the route
 * *names*; compatibility owns which routes an environment *offers*.
 */
export const BROWSER_CONNECT_ENVIRONMENT_ROUTES = {
	"agent-chrome": ["explicit-cdp"],
} as const satisfies Record<
	BrowserConnectEnvironmentName,
	readonly BrowserConnectRouteId[]
>;

/**
 * Pure, total route-compatibility check (R6/R7): does a given environment
 * offer a given route? Total over the full route × environment space — every
 * `(route, environment)` pair from the model vocabulary resolves to a boolean,
 * never throws, no side effects.
 *
 * @param environment - Target environment name
 * @param route - Attachment route the adapter declares
 * @returns True when the environment offers the route
 */
export function isRouteCompatible(
	environment: BrowserConnectEnvironmentName,
	route: BrowserConnectRouteId,
): boolean {
	const offered: readonly BrowserConnectRouteId[] =
		BROWSER_CONNECT_ENVIRONMENT_ROUTES[environment];
	return offered.includes(route);
}

/**
 * Select the first route both the environment and the adapter support, in the
 * adapter's declared preference order. Pure and total: returns `undefined`
 * when no route is shared (the caller maps that to `route-incompatible`).
 *
 * @param environment - Target environment name
 * @param adapterRoutes - Routes the adapter declares, in preference order
 * @returns The first mutually supported route, or `undefined`
 */
export function selectCompatibleRoute(
	environment: BrowserConnectEnvironmentName,
	adapterRoutes: readonly BrowserConnectRouteId[],
): BrowserConnectRouteId | undefined {
	for (const route of adapterRoutes) {
		if (isRouteCompatible(environment, route)) return route;
	}
	return undefined;
}

/**
 * The full route × environment product, materialized for exhaustiveness tests
 * and for callers that project compatibility into the dashboard.
 */
export function enumerateRouteCompatibility(): ReadonlyArray<{
	environment: BrowserConnectEnvironmentName;
	route: BrowserConnectRouteId;
	compatible: boolean;
}> {
	const rows: Array<{
		environment: BrowserConnectEnvironmentName;
		route: BrowserConnectRouteId;
		compatible: boolean;
	}> = [];
	const environments = Object.keys(
		BROWSER_CONNECT_ENVIRONMENT_ROUTES,
	) as BrowserConnectEnvironmentName[];
	for (const environment of environments) {
		for (const route of BROWSER_CONNECT_ROUTES) {
			rows.push({
				environment,
				route,
				compatible: isRouteCompatible(environment, route),
			});
		}
	}
	return rows;
}
