import { expect, test } from "bun:test";
import { TerrainSampler, decodeTerrariumPixels } from "./osm-elevation";
import { importStreetsFromOsm, localToGeo } from "./osm-import";
import {
	parseTerrainEvidence,
	parseMappedElevation,
	type TerrainSource,
} from "./domain/terrain-evidence";
import {
	reviewOsmImport,
	createMapImportMetadata,
} from "./osm-import-deduplication";
import { createEmptyRoadGraph } from "./road-network-topology";
import { RoadNetworkNode } from "./schema";
const center = { lat: 0, lon: 0 },
	bounds = { south: -0.001, west: -0.001, north: 0.001, east: 0.001 };
const source: TerrainSource = {
	provider: "fixture",
	dataset: "dem-v1",
	encoding: "decoded-grid",
	units: "metres",
	verticalReference: { kind: "datum", datumId: "datum-a" },
};
const road = (tags: Record<string, string> = {}) => ({
	id: 10,
	tags: { highway: "residential", ...tags },
	points: [
		{ nodeId: 1, ...localToGeo([-50, 0], center) },
		{ nodeId: 2, ...localToGeo([50, 0], center) },
	],
});
const sampler = (value = 100) =>
	new TerrainSampler(
		15,
		async () => ({
			width: 1,
			height: 1,
			elevations: new Float32Array([value]),
		}),
		{
			source,
			now: () => "2026-10-08T00:00:00.000Z",
			tileUrl: (z, x, y) => `/fixture/${z}/${x}/${y}`,
		},
	);

test("coverage preserves source, requested bounds, tile captures and measured zero", async () => {
	const terrain = sampler(0);
	await terrain.prefetch(bounds);
	const coverage = terrain.getCoverage(bounds);
	expect(coverage.requestedBounds).toEqual(bounds);
	expect(
		coverage.tiles.every(
			(tile) =>
				tile.status === "available" &&
				tile.acquiredAt === "2026-10-08T00:00:00.000Z" &&
				tile.url?.startsWith("/fixture/"),
		),
	).toBe(true);
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: terrain,
		loadStreets: async () => [road()],
	});
	expect(result.terrainEvidence!.source).toEqual(source);
	expect(
		result.terrainEvidence!.samples.every(
			(sample) =>
				sample.elevationMeters === 0 && sample.appliedHeightMeters === 0,
		),
	).toBe(true);
	expect(
		parseTerrainEvidence(JSON.parse(JSON.stringify(result.terrainEvidence))),
	).toEqual(result.terrainEvidence!);
	coverage.tiles[0]!.status = "unavailable";
	expect(terrain.getCoverage(bounds).tiles[0]!.status).toBe("available");
});
test("missing tiles and origin leave reviewable null observations and estimated heights", async () => {
	const terrain = new TerrainSampler(15, async (_z, x) =>
		x === 16384
			? null
			: { width: 1, height: 1, elevations: new Float32Array([100]) },
	);
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: terrain,
		loadStreets: async () => [road()],
	});
	const evidence = result.terrainEvidence!;
	expect(evidence.diagnostics.map((item) => item.code)).toContain(
		"tile-unavailable",
	);
	expect(evidence.diagnostics.map((item) => item.code)).toContain(
		"missing-origin",
	);
	expect(
		evidence.samples.some(
			(sample) =>
				sample.elevationMeters === 100 && sample.appliedHeightMeters === null,
		),
	).toBe(true);
	expect(
		evidence.samples.some((sample) => sample.elevationMeters === null),
	).toBe(true);
	expect(
		Object.values(result.graphs[0]!.graphNodes).every(
			(node) => node.position[1] === 0,
		),
	).toBe(true);
});
test("invalid grids, no-data and thrown tile loads do not masquerade as valid ground coverage", async () => {
	for (const loader of [
		async () => ({ width: 2, height: 2, elevations: new Float32Array([1]) }),
		async () => ({ width: 1, height: 1, elevations: new Float32Array([NaN]) }),
		async () => {
			throw Error("offline");
		},
	]) {
		const terrain = new TerrainSampler(15, loader);
		await terrain.prefetch(bounds);
		expect(terrain.sampleElevationAt(center)).toBeNull();
		expect(terrain.successfulTiles).toBe(0);
		expect(
			terrain
				.getCoverage(bounds)
				.tiles.every(
					(tile) => tile.status === "unavailable" && tile.reason !== null,
				),
		).toBe(true);
	}
	const partial = new TerrainSampler(15, async () => ({
		width: 2,
		height: 2,
		elevations: new Float32Array([0, 0, 0, NaN]),
	}));
	await partial.prefetch(bounds);
	expect(
		partial
			.getCoverage(bounds)
			.tiles.every((tile) => tile.status === "partial"),
	).toBe(true);
	expect(partial.sampleElevationAt(center)).toBeNull();
	expect(
		Number.isNaN(
			decodeTerrariumPixels(new Uint8ClampedArray([128, 0, 0, 0]), 1, 1)[0],
		),
	).toBe(true);
});
test("unknown and incompatible mapped elevation references retain claims without applying heights", async () => {
	for (const mappedElevationDatumId of [undefined, "datum-b"]) {
		const result = await importStreetsFromOsm(center, 100, {
			loadTerrain: true,
			terrainSampler: sampler(),
			mappedElevationDatumId,
			loadStreets: async () => [road({ ele: "110", layer: "8" })],
		});
		const claim = result.terrainEvidence!.roads[0]!.mappedElevation!;
		expect(claim.valueMeters).toBe(110);
		expect(claim.applied).toBe(false);
		expect(claim.reason).toBe(
			mappedElevationDatumId ? "reference-incompatible" : "reference-unknown",
		);
		expect(
			Object.values(result.graphs[0]!.graphNodes).every(
				(node) => node.position[1] === 0,
			),
		).toBe(true);
		expect(Object.values(result.graphs[0]!.edges)[0]!.osmVertical?.layer).toBe(
			8,
		);
	}
});
test("explicit compatible datum applies mapped claim while ground samples stay separate", async () => {
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: sampler(),
		mappedElevationDatumId: "datum-a",
		loadStreets: async () => [road({ ele: "110 m" })],
	});
	expect(result.terrainEvidence!.roads[0]!.mappedElevation?.applied).toBe(true);
	expect(
		result.terrainEvidence!.samples.every(
			(sample) =>
				sample.elevationMeters === 100 && sample.appliedHeightMeters === 0,
		),
	).toBe(true);
	expect(
		Object.values(result.graphs[0]!.graphNodes).every(
			(node) => node.position[1] === 10,
		),
	).toBe(true);
});
test("malformed ele remains raw evidence and disabled sampling is explicit", async () => {
	const result = await importStreetsFromOsm(center, 100, {
		loadStreets: async () => [road({ ele: "110 yards", bridge: "yes" })],
	});
	expect(result.terrainEvidence!.sampling).toBe("disabled");
	expect(result.terrainEvidence!.roads[0]!.mappedElevation).toMatchObject({
		raw: "110 yards",
		valueMeters: null,
		applied: false,
		reason: "invalid",
	});
	expect(result.terrainEvidence!.roads[0]!.structure?.basis).toBe(
		"endpoint-interpolation-v1",
	);
	expect(
		result.terrainEvidence!.diagnostics.map((item) => item.code),
	).toContain("structure-estimated");
	expect(parseMappedElevation("12.5")).toBe(12.5);
	expect(parseMappedElevation("12 rubbish")).toBeNull();
});
test("site reference incompatibility is retained in reviewed evidence", async () => {
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: sampler(),
		loadStreets: async () => [road()],
	});
	const existing = RoadNetworkNode.parse({
		...createEmptyRoadGraph(),
		metadata: createMapImportMetadata(undefined, {
			center,
			baseElevation: 20,
			verticalDatumId: "datum-b",
		}),
	});
	const reviewed = reviewOsmImport(result, {
		networks: [existing],
		featureSourceIds: new Set(),
	});
	expect(reviewed.verticalAlignment).toBe("estimated");
	expect(
		reviewed.result.terrainEvidence!.diagnostics.some(
			(item) => item.code === "reference-incompatible",
		),
	).toBe(true);
	expect(reviewed.result.terrainEvidence!.sourceFrame.relativeReferenceId).toBe(
		"datum-a",
	);
});
test("terrain evidence rejects future versions and missing sample references", async () => {
	const result = await importStreetsFromOsm(center, 100, {
		loadStreets: async () => [road()],
	});
	expect(() => parseTerrainEvidence({ schemaVersion: 2 })).toThrow(
		"Unsupported terrain evidence",
	);
	const invalid = structuredClone(result.terrainEvidence!);
	invalid.roads[0]!.groundSampleIds.push("missing");
	expect(() => parseTerrainEvidence(invalid)).toThrow(
		"Missing terrain sample reference",
	);
});

test("terrain evidence rejects contradictory applied heights and claims", async () => {
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: sampler(),
		loadStreets: async () => [road({ ele: "110" })],
	});
	const invalid = structuredClone(result.terrainEvidence!);
	invalid.samples[0]!.appliedHeightMeters = 999;
	expect(() => parseTerrainEvidence(invalid)).toThrow(
		"Ground sample relative height",
	);
	const invalidClaim = structuredClone(result.terrainEvidence!);
	invalidClaim.roads[0]!.mappedElevation!.applied = true;
	expect(() => parseTerrainEvidence(invalidClaim)).toThrow(
		"Applied mapped elevation lacks compatible",
	);
});
test("encoded host frame metadata preserves explicit namespaced datum identity", async () => {
	const frameSource = {
		...source,
		verticalReference: { kind: "datum" as const, datumId: "EPSG:5773" },
	};
	const terrain = new TerrainSampler(
		15,
		async () => ({ width: 1, height: 1, elevations: new Float32Array([100]) }),
		{ source: frameSource },
	);
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: terrain,
		loadStreets: async () => [road({ ele: "110" })],
	});
	const origin = { center, baseElevation: 100, verticalDatumId: "EPSG:5773" };
	const metadata = createMapImportMetadata(undefined, origin);
	expect(JSON.stringify(metadata)).not.toContain('"EPSG:5773"');
	const existing = RoadNetworkNode.parse({
		...createEmptyRoadGraph(),
		metadata,
	});
	const reviewed = reviewOsmImport(result, {
		networks: [existing],
		featureSourceIds: new Set(),
	});
	expect(reviewed.verticalAlignment).toBe("aligned");
	expect(reviewed.origin.verticalDatumId).toBe("EPSG:5773");
	expect(
		parseTerrainEvidence(JSON.stringify(result.terrainEvidence)).source
			?.verticalReference,
	).toEqual(frameSource.verticalReference);
});

test("bridge clearance estimates stay separate from terrain samples and layer ordering", async () => {
	const bridge = {
		id: 11,
		tags: { highway: "primary", bridge: "yes", layer: "9" },
		points: [
			{ nodeId: 3, ...localToGeo([0, -60], center) },
			{ nodeId: 4, ...localToGeo([0, 60], center) },
		],
	};
	const result = await importStreetsFromOsm(center, 100, {
		loadTerrain: true,
		terrainSampler: sampler(),
		loadStreets: async () => [road(), bridge],
	});
	const estimate = result.terrainEvidence!.roads.find(
		(road) => road.wayId === 11,
	)!.structure!;
	expect(estimate.basis).toBe("estimated-clearance-v1");
	expect(estimate.clearanceMeters).toBe(4.5);
	expect(
		result.terrainEvidence!.samples.every(
			(sample) =>
				sample.elevationMeters === 100 && sample.appliedHeightMeters === 0,
		),
	).toBe(true);
});
