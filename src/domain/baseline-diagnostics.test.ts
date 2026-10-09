import { test, expect } from "bun:test";
import {
	buildBaselineDiagnosticReport,
	parseBaselineDiagnosticReport,
} from "./baseline-diagnostics";
import {
	prepareOsmStreetImport,
	completeOsmStreetImport,
	getPreparedBaselineDiagnostics,
} from "../osm-import";
import { confirmStreetRegionalPolicy } from "./street-sections";
const road = {
	id: 10,
	tags: { highway: "residential", width: "2" },
	points: [
		{ nodeId: 1, lat: 0, lon: -0.0005 },
		{ nodeId: 2, lat: 0, lon: 0.0005 },
	],
};
test("regional confirmation removes a blocker without hiding estimated dimensions", async () => {
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [road],
	});
	const report = getPreparedBaselineDiagnostics(prepared);
	expect(report.status).toBe("blocked");
	expect(report.items.some((i) => i.code === "policy-unconfirmed")).toBe(true);
	const policy = confirmStreetRegionalPolicy(
		prepared.regionalPolicy,
		"right-driving",
	);
	const confirmed = {
		...prepared,
		regionalPolicy: policy,
		sectionReport: { ...prepared.sectionReport, policy },
	};
	const result = await completeOsmStreetImport(confirmed),
		resolved = result.baselineDiagnostics!;
	expect(resolved.status).toBe("review-required");
	expect(
		resolved.items.some(
			(i) => i.property === "laneWidth" && i.severity === "review",
		),
	).toBe(true);
	expect(
		resolved.items.find((i) => i.property === "laneWidth")!.evidence,
	).toHaveProperty("rawClaims.width", "2");
	expect(resolved.items.some((i) => i.category === "elevation")).toBe(true);
	expect(parseBaselineDiagnosticReport(JSON.stringify(resolved))).toEqual(
		resolved,
	);
	expect(buildBaselineDiagnosticReport(result)).toEqual(resolved);
});
test("missing and invalid topology are blocking and future report versions fail", () => {
	const empty = buildBaselineDiagnosticReport({ graphs: [] });
	expect(empty.status).toBe("blocked");
	expect(empty.items.some((i) => i.code === "no-accepted-roads")).toBe(true);
	expect(() =>
		parseBaselineDiagnosticReport({ ...empty, status: "ready" }),
	).toThrow();
	expect(() =>
		parseBaselineDiagnosticReport({ ...empty, schemaVersion: 2 }),
	).toThrow();
});
