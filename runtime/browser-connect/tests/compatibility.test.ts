import { describe, expect, test } from "bun:test";
import {
	BROWSER_CONNECT_ENVIRONMENT_NAMES,
	BROWSER_CONNECT_ROUTES,
	type BrowserConnectEnvironmentName,
	type BrowserConnectRouteId,
} from "../src/model.ts";
import {
	BROWSER_CONNECT_ENVIRONMENT_ROUTES,
	enumerateRouteCompatibility,
	isRouteCompatible,
	selectCompatibleRoute,
} from "../src/compatibility.ts";

describe("isRouteCompatible", () => {
	test("is total over route × environment (never throws, always boolean)", () => {
		for (const environment of BROWSER_CONNECT_ENVIRONMENT_NAMES) {
			for (const route of BROWSER_CONNECT_ROUTES) {
				const result = isRouteCompatible(environment, route);
				expect(typeof result).toBe("boolean");
			}
		}
	});

	test("agent-chrome offers explicit-cdp only in slice one", () => {
		expect(isRouteCompatible("agent-chrome", "explicit-cdp")).toBe(true);
		expect(isRouteCompatible("agent-chrome", "ui-consent")).toBe(false);
		expect(isRouteCompatible("agent-chrome", "extension")).toBe(false);
	});

	test("is pure — repeated calls return the same value", () => {
		expect(isRouteCompatible("agent-chrome", "explicit-cdp")).toBe(
			isRouteCompatible("agent-chrome", "explicit-cdp"),
		);
	});

	test("environment→route map is declared for every environment name", () => {
		for (const environment of BROWSER_CONNECT_ENVIRONMENT_NAMES) {
			expect(BROWSER_CONNECT_ENVIRONMENT_ROUTES[environment]).toBeDefined();
		}
	});
});

describe("enumerateRouteCompatibility", () => {
	test("materializes the full route × environment product", () => {
		const rows = enumerateRouteCompatibility();
		expect(rows.length).toBe(
			BROWSER_CONNECT_ENVIRONMENT_NAMES.length * BROWSER_CONNECT_ROUTES.length,
		);
		// Every (environment, route) pair present exactly once.
		const seen = new Set(rows.map((r) => `${r.environment}::${r.route}`));
		expect(seen.size).toBe(rows.length);
	});

	test("compatible flag matches isRouteCompatible for every row", () => {
		for (const row of enumerateRouteCompatibility()) {
			expect(row.compatible).toBe(
				isRouteCompatible(row.environment, row.route),
			);
		}
	});
});

describe("selectCompatibleRoute", () => {
	test("returns the first shared route in adapter preference order", () => {
		const route = selectCompatibleRoute("agent-chrome", [
			"ui-consent",
			"explicit-cdp",
		]);
		expect(route).toBe("explicit-cdp");
	});

	test("returns undefined when no route is shared (→ route-incompatible)", () => {
		const route = selectCompatibleRoute("agent-chrome", [
			"ui-consent",
			"extension",
		]);
		expect(route).toBeUndefined();
	});

	test("is total: any adapter-route list resolves without throwing", () => {
		const allRouteLists: BrowserConnectRouteId[][] = [
			[],
			["explicit-cdp"],
			["ui-consent"],
			["extension"],
			[...BROWSER_CONNECT_ROUTES],
		];
		for (const environment of BROWSER_CONNECT_ENVIRONMENT_NAMES) {
			for (const list of allRouteLists) {
				expect(() => selectCompatibleRoute(environment, list)).not.toThrow();
			}
		}
	});
});

// Type-level assertion: the environment name union stays closed. If a new
// environment name lands without a route declaration, this fails to compile.
const _exhaustiveEnvironmentRoutes: Record<
	BrowserConnectEnvironmentName,
	readonly BrowserConnectRouteId[]
> = BROWSER_CONNECT_ENVIRONMENT_ROUTES;
void _exhaustiveEnvironmentRoutes;
