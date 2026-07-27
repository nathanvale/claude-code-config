import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_ADAPTER_LANE_TABLE,
	BROWSER_USE_LANE_AUTH_METHODS,
	type BrowserUseLaneImplementationIntegrity,
} from "./browser-use-adapter-model";
import {
	BROWSER_USE_CONFORMANCE_DIMENSIONS,
	BROWSER_USE_CONFORMANCE_GATE_TABLE,
	BROWSER_USE_CONFORMANCE_GATES,
	BROWSER_USE_CONFORMANCE_METHOD_DIMENSIONS,
	type BrowserUseConformanceCell,
	type BrowserUseConformanceDimension,
	conformanceEvidenceClaims,
	runAuthConformanceMatrix,
} from "./browser-use-auth-conformance";

// ---------------------------------------------------------------------------
// Auth plan 2026-07-21-003 U9 / release R22 / success criterion L190: the
// cross-lane conformance matrix decides exactly one typed verdict per lane ×
// dimension, proves contract-level checks now with fakes, and holds live-only
// dimensions at an honest `unproven` behind an exact operator gate. It never
// fabricates conformance, and it publishes only conformant delivery
// dimensions as adapter-registry auth evidence.
// ---------------------------------------------------------------------------

const AT = 1_700_000_000_000;

function cellFor(
	cells: readonly BrowserUseConformanceCell[],
	laneId: string,
	dimension: BrowserUseConformanceDimension,
): BrowserUseConformanceCell {
	const found = cells.find(
		(cell) => cell.lane_id === laneId && cell.dimension === dimension,
	);
	if (!found) throw new Error(`missing cell ${laneId}/${dimension}`);
	return found;
}

describe("conformance matrix — shape and completeness", () => {
	test("every lane × every dimension gets exactly one cell", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		expect(matrix.cells).toHaveLength(
			BROWSER_USE_ADAPTER_LANE_IDS.length *
				BROWSER_USE_CONFORMANCE_DIMENSIONS.length,
		);
		for (const laneId of BROWSER_USE_ADAPTER_LANE_IDS) {
			for (const dimension of BROWSER_USE_CONFORMANCE_DIMENSIONS) {
				const matches = matrix.cells.filter(
					(cell) => cell.lane_id === laneId && cell.dimension === dimension,
				);
				expect(matches).toHaveLength(1);
			}
		}
	});

	test("matrix exposes the lane and dimension axes it composed", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		expect(matrix.lanes).toEqual([...BROWSER_USE_ADAPTER_LANE_IDS]);
		expect(matrix.dimensions).toEqual([...BROWSER_USE_CONFORMANCE_DIMENSIONS]);
	});

	test("every verdict is one of the three typed states", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		for (const cell of matrix.cells) {
			expect(["conformant", "nonconformant", "unproven"]).toContain(
				cell.verdict,
			);
		}
	});
});

describe("conformance matrix — contract-provable safety dimensions", () => {
	// For a lane with a native Implementation, the safety dimensions decide now.
	const provableLanes = BROWSER_USE_ADAPTER_LANE_IDS.filter(
		(laneId) =>
			BROWSER_USE_ADAPTER_LANE_TABLE[laneId].native_implementation.implemented,
	);

	test("restart-resume is conformant on every contract-provable lane", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		for (const laneId of provableLanes) {
			const cell = cellFor(matrix.cells, laneId, "restart-resume");
			expect(cell.verdict).toBe("conformant");
			if (cell.verdict === "conformant") {
				expect(cell.evidence.proof_kind).toBe("restart-resume-rule");
				expect(cell.evidence.evaluated_at_epoch_ms).toBe(AT);
				expect(cell.evidence.implementation_integrity_digest).toMatch(
					/^[0-9a-f]{64}$/,
				);
			}
		}
	});

	test("cleanup, revocation, and lane-resume are conformant on provable lanes", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		for (const laneId of provableLanes) {
			for (const dimension of ["cleanup", "revocation", "lane-resume"] as const) {
				const cell = cellFor(matrix.cells, laneId, dimension);
				expect(cell.verdict).toBe("conformant");
			}
		}
	});
});

describe("conformance matrix — honest unproven states", () => {
	test("delivery dimensions on a provable lane are unproven behind a live gate", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		const laneId = "agent-browser";
		for (const dimension of [
			"password-delivery",
			"current-otp-delivery",
			"session-reuse",
			"human-continuation",
		] as const) {
			const cell = cellFor(matrix.cells, laneId, dimension);
			expect(cell.verdict).toBe("unproven");
			if (cell.verdict === "unproven") {
				expect(BROWSER_USE_CONFORMANCE_GATES).toContain(cell.gate);
				// The gate carries the exact operator next action, never a blank.
				expect(cell.next_action).toBe(
					BROWSER_USE_CONFORMANCE_GATE_TABLE[cell.gate],
				);
				expect(cell.next_action.length).toBeGreaterThan(0);
			}
		}
	});

	test("session-reuse delivery is gated on a live portal, not on the FSM", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		const cell = cellFor(matrix.cells, "agent-browser", "session-reuse");
		expect(cell.verdict).toBe("unproven");
		if (cell.verdict === "unproven") {
			expect(cell.gate).toBe("live-portal-required");
		}
	});

	test("a lane without a native Implementation is unproven on EVERY dimension", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		// playwright-cdp is typed not-installed in this release (operator gate).
		const laneId = "playwright-cdp";
		expect(
			BROWSER_USE_ADAPTER_LANE_TABLE[laneId].native_implementation.implemented,
		).toBe(false);
		for (const dimension of BROWSER_USE_CONFORMANCE_DIMENSIONS) {
			const cell = cellFor(matrix.cells, laneId, dimension);
			expect(cell.verdict).toBe("unproven");
			if (cell.verdict === "unproven") {
				expect(cell.gate).toBe("playwright-not-installed");
			}
		}
	});
});

describe("conformance matrix — never fabricates conformance", () => {
	test("no delivery dimension is ever silently conformant at contract level", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		const deliveryDimensions = Object.keys(
			BROWSER_USE_CONFORMANCE_METHOD_DIMENSIONS,
		) as BrowserUseConformanceDimension[];
		for (const cell of matrix.cells) {
			if (deliveryDimensions.includes(cell.dimension)) {
				expect(cell.verdict).not.toBe("conformant");
			}
		}
	});

	test("no lane advertises any auth method from contract-level conformance today", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		for (const laneId of BROWSER_USE_ADAPTER_LANE_IDS) {
			expect(conformanceEvidenceClaims(matrix, laneId)).toEqual([]);
		}
	});
});

describe("conformance matrix — evidence binding", () => {
	test("decided cells bind to the lane's live integrity digest", () => {
		const integrityA: BrowserUseLaneImplementationIntegrity = {
			executable_realpath: "/live/agent-browser",
			content_digest: "live-content-A",
			dependency_lock_identity: "lock-A",
			protocol_fingerprint: "proto-A",
			platform: "darwin",
			security_policy_revision: "policy-A",
		};
		const integrityB: BrowserUseLaneImplementationIntegrity = {
			...integrityA,
			content_digest: "live-content-B",
		};
		const matrixA = runAuthConformanceMatrix({
			at_epoch_ms: AT,
			integrity_by_lane: { "agent-browser": integrityA },
		});
		const matrixB = runAuthConformanceMatrix({
			at_epoch_ms: AT,
			integrity_by_lane: { "agent-browser": integrityB },
		});
		const cellA = cellFor(matrixA.cells, "agent-browser", "restart-resume");
		const cellB = cellFor(matrixB.cells, "agent-browser", "restart-resume");
		if (cellA.verdict === "conformant" && cellB.verdict === "conformant") {
			// A same-version replacement changes the integrity digest, so the
			// bound evidence differs — a silent swap cannot reuse a verdict.
			expect(cellA.evidence.implementation_integrity_digest).not.toBe(
				cellB.evidence.implementation_integrity_digest,
			);
		} else {
			throw new Error("expected conformant restart-resume cells");
		}
	});
});

describe("conformance matrix — deterministic digest", () => {
	test("same verdicts produce the same digest across runs (clock excluded)", () => {
		const a = runAuthConformanceMatrix({ at_epoch_ms: AT });
		const b = runAuthConformanceMatrix({ at_epoch_ms: AT + 999_999 });
		expect(a.matrix_digest).toBe(b.matrix_digest);
		expect(a.matrix_digest).toMatch(/^[0-9a-f]{32}$/);
	});

	test("a different lane integrity changes the digest", () => {
		const base = runAuthConformanceMatrix({ at_epoch_ms: AT });
		const swapped = runAuthConformanceMatrix({
			at_epoch_ms: AT,
			integrity_by_lane: {
				"agent-browser": {
					executable_realpath: "/other",
					content_digest: "other",
					dependency_lock_identity: "other",
					protocol_fingerprint: "other",
					platform: "other",
					security_policy_revision: "other",
				},
			},
		});
		expect(base.matrix_digest).not.toBe(swapped.matrix_digest);
	});
});

describe("conformance matrix — publishing to the registry", () => {
	test("conformanceEvidenceClaims only draws from the registry auth-method vocabulary", () => {
		const matrix = runAuthConformanceMatrix({ at_epoch_ms: AT });
		for (const laneId of BROWSER_USE_ADAPTER_LANE_IDS) {
			for (const method of conformanceEvidenceClaims(matrix, laneId)) {
				expect(BROWSER_USE_LANE_AUTH_METHODS).toContain(method);
			}
		}
	});

	test("method dimensions map onto known registry auth methods", () => {
		for (const method of Object.values(
			BROWSER_USE_CONFORMANCE_METHOD_DIMENSIONS,
		)) {
			expect(BROWSER_USE_LANE_AUTH_METHODS).toContain(method);
		}
	});
});
