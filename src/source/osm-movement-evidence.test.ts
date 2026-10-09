import { test, expect } from "bun:test";
import { normalizeOsmAcquisition } from "./osm-normalization";
import {
	resolveOsmMovementEvidence,
	isSupportedOsmMovementAllowed,
} from "./osm-movement-evidence";
import { buildOverpassQuery } from "./osm-acquisition";
import { prepareOsmStreetImport, completeOsmStreetImport } from "../osm-import";
import { createImportedStreetProject } from "../osm-baseline-bridge";
export function movementFixture(
	restriction = "no_right_turn",
	extra: Record<string, string> = {},
) {
	const way = (
		id: number,
		nodes: number[],
		coords: number[][],
		tags: Record<string, string> = {},
	) => ({
		type: "way",
		id,
		nodes,
		geometry: coords.map(([lat, lon]) => ({ lat, lon })),
		tags: { highway: "residential", lanes: "2", oneway: "yes", ...tags },
	});
	return {
		format: "osm-acquisition",
		schemaVersion: 1,
		bbox: { south: -0.01, west: -0.01, north: 0.01, east: 0.01 },
		diagnostics: [],
		responses: [
			{
				bbox: { south: -0.01, west: -0.01, north: 0.01, east: 0.01 },
				capture: {
					acquiredAt: "2026-10-09T00:00:00Z",
					query: "recorded",
					elementMetadataRequested: true,
					httpStatus: 200,
					contentType: "application/json",
					etag: null,
					lastModified: null,
				},
				payload: {
					elements: [
						way(
							10,
							[1, 2],
							[
								[0, -0.0005],
								[0, 0],
							],
							{ "turn:lanes": "through|right" },
						),
						way(
							20,
							[2, 3],
							[
								[0, 0],
								[0.0005, 0],
							],
						),
						way(
							30,
							[2, 4],
							[
								[0, 0],
								[0, 0.0005],
							],
						),
						{
							type: "relation",
							id: 100,
							tags: { type: "restriction", restriction, ...extra },
							members: [
								{ type: "way", ref: 10, role: "from" },
								{ type: "node", ref: 2, role: "via" },
								{ type: "way", ref: 20, role: "to" },
							],
						},
					],
				},
			},
		],
	} as any;
}
const movement = (toWayId = 20) => ({
	fromWayId: 10,
	toWayId,
	viaNodeId: 2,
	fromDirection: "forward" as const,
	toDirection: "forward" as const,
});
test("query acquires restrictions and member topology", () => {
	const q = buildOverpassQuery({ south: 0, west: 0, north: 1, east: 1 });
	expect(q).toContain("^restriction");
	expect(q).toContain("way(r.selected)");
});
test("no/only constraints retain source and enforce directed movements", () => {
	for (const kind of ["no_right_turn", "only_right_turn"]) {
		const input = movementFixture(kind),
			before = JSON.stringify(input),
			source = normalizeOsmAcquisition(input),
			r = resolveOsmMovementEvidence(source);
		expect(JSON.stringify(input)).toBe(before);
		expect(source.features.find((f) => f.id === 100)!.raw).toEqual(
			input.responses[0].payload.elements[3],
		);
		expect(r.constraints).toHaveLength(1);
		expect(r.roads[0]!.turnLanes["turn:lanes"]).toEqual([
			["through"],
			["right"],
		]);
		expect(isSupportedOsmMovementAllowed(r, movement())).toBe(
			kind.startsWith("only"),
		);
		expect(isSupportedOsmMovementAllowed(r, movement(30))).toBe(
			kind.startsWith("no"),
		);
		expect(
			isSupportedOsmMovementAllowed(r, {
				...movement(),
				fromDirection: "reverse",
			}),
		).toBe(false);
	}
});
test("conditional, excepted and via-way forms stay inspectable without enforcement", () => {
	for (const extra of [
		{ "restriction:conditional": "no_right_turn @ (Mo-Fr)" },
		{ except: "bicycle" },
		{ "restriction:hgv": "no_right_turn" },
	] as Record<string, string>[]) {
		const r = resolveOsmMovementEvidence(
			normalizeOsmAcquisition(movementFixture("no_right_turn", extra)),
		);
		expect(r.constraints).toHaveLength(0);
		expect(r.diagnostics[0]!.code).toBe("unsupported-restriction-scope");
	}
	const input = movementFixture();
	input.responses[0].payload.elements[3].members[1] = {
		type: "way",
		ref: 30,
		role: "via",
	};
	const source = normalizeOsmAcquisition(input),
		r = resolveOsmMovementEvidence(source);
	expect(r.constraints).toHaveLength(0);
	expect(r.diagnostics[0]!.code).toBe("unsupported-via-way");
	expect(source.features.find((f) => f.id === 100)!.geometry!.kind).toBe(
		"relation",
	);
});
test("connectivity parses lane changes and rejects malformed and out-of-range mappings", () => {
	for (const value of ["1:1,(2)|2:2", "1:x", "3:1", "1:1|1:2"]) {
		const input = movementFixture();
		input.responses[0].payload.elements[3].tags = {
			type: "connectivity",
			connectivity: value,
		};
		const r = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
		expect(r.constraints.length).toBe(value === "1:1,(2)|2:2" ? 1 : 0);
		if (r.constraints.length)
			expect(r.constraints[0]!.lanes[1]!.requiresLaneChange).toBe(true);
		else expect(r.diagnostics[0]!.code).toBe("malformed-connectivity");
	}
});
test("access specificity, incompatible direction and selection scope", () => {
	const input = movementFixture();
	input.responses[0].payload.elements[1].tags.access = "no";
	let r = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(isSupportedOsmMovementAllowed(r, movement())).toBe(false);
	input.responses[0].payload.elements[1].tags.motorcar = "yes";
	r = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(isSupportedOsmMovementAllowed(r, movement(30))).toBe(true);
	r = resolveOsmMovementEvidence(normalizeOsmAcquisition(input), new Set([10]));
	expect(r.constraints).toHaveLength(0);
	expect(r.diagnostics[0]!.code).toBe("outside-selected-scope");
	input.responses[0].payload.elements[1].tags.oneway = "-1";
	r = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(r.constraints).toHaveLength(0);
	expect(r.diagnostics[0]!.code).toBe("invalid-relation-direction");
});
test("offline import and portable baseline retain legal evidence", async () => {
	const p = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadAcquisition: async () => movementFixture(),
		loadTerrain: false,
	});
	const result = await completeOsmStreetImport({
		...p,
		regionalPolicy: {
			id: "right-driving",
			version: 1,
			status: "confirmed",
			basis: "manual",
			evidence: null,
		},
	});
	expect(result.movementEvidence!.constraints).toHaveLength(1);
	const project = createImportedStreetProject(result, {
		acceptedAt: "2026-10-09T00:00:00Z",
	});
	expect(
		JSON.parse(JSON.stringify(project)).baselineRevisions["baseline-1"]
			.resolutionEvidence.movements,
	).toEqual(result.movementEvidence);
});

test("directional vehicle and general access restrictions are respected", () => {
	const input = movementFixture("only_right_turn");
	input.responses[0]!.payload.elements[1]!.tags["vehicle:forward"] = "no";
	let report = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(isSupportedOsmMovementAllowed(report, movement())).toBe(false);
	delete input.responses[0]!.payload.elements[1]!.tags["vehicle:forward"];
	input.responses[0]!.payload.elements[1]!.tags["access:forward"] = "no";
	report = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(isSupportedOsmMovementAllowed(report, movement())).toBe(false);
	input.responses[0]!.payload.elements[1]!.tags.motorcar = "yes";
	report = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(isSupportedOsmMovementAllowed(report, movement())).toBe(true);
});

test("legacy timed restrictions remain reviewable without unconditional enforcement", () => {
	const input = movementFixture("no_right_turn", {
		hour_on: "07:00",
		hour_off: "09:00",
	});
	const report = resolveOsmMovementEvidence(normalizeOsmAcquisition(input));
	expect(report.constraints).toHaveLength(0);
	expect(
		report.diagnostics.some((d) => d.code === "unsupported-restriction-scope"),
	).toBe(true);
});

test("a context junction is not projected just because both ways cross the selected area", async () => {
	const input = movementFixture();
	input.responses[0]!.payload.elements[0]!.geometry = [
		{ lat: 0, lon: 0 },
		{ lat: 0, lon: 0.002 },
	];
	input.responses[0]!.payload.elements[1]!.geometry = [
		{ lat: 0, lon: 0.002 },
		{ lat: 0, lon: 0 },
	];
	input.responses[0]!.payload.elements[2]!.geometry = [
		{ lat: 0, lon: 0.002 },
		{ lat: 0.002, lon: 0.002 },
	];
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 60, {
		loadAcquisition: async () => input,
		loadTerrain: false,
	});
	const result = await completeOsmStreetImport({
		...prepared,
		regionalPolicy: {
			id: "right-driving",
			version: 1,
			status: "confirmed",
			basis: "manual",
			evidence: null,
		},
	});
	expect(
		result.graphs
			.flatMap((g) => Object.values(g.edges))
			.some((e) => e.osmSource?.wayId === 10),
	).toBe(true);
	expect(
		result.graphs
			.flatMap((g) => Object.values(g.edges))
			.some((e) => e.osmSource?.wayId === 20),
	).toBe(true);
	expect(result.movementEvidence!.constraints).toHaveLength(0);
	expect(
		result.movementEvidence!.diagnostics.some(
			(d) => d.code === "outside-selected-scope",
		),
	).toBe(true);
});
