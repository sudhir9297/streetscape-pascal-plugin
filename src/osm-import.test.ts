import { describe, expect, test } from "bun:test";
import {
	applyElevations,
	applyOsmStructureClearances,
	buildOverpassQuery,
	buildRoadGraphFromSegments,
	buildSegmentsFromWays,
	computeBoundingBox,
	completeOsmStreetImport,
	ensureSimpleSegments,
	fetchOsmMapData,
	getPreparedOsmStreetImportResult,
	importStreetsFromOsm,
	localToGeo,
	mapOsmTags,
	mergeOsmMapData,
	normalizeOsmTags,
	parseOverpassResponse,
	parseOsmMappedSurfaces,
	parseOsmLaneConnectivity,
	parseOsmCrossingFeatures,
	parseOsmMapResponse,
	prepareOsmStreetImport,
	projectToLocal,
	simplifyPolyline,
	splitOsmBoundingBox,
	type OsmWay,
} from "./osm-import";
import { reconcileRoadJunctions } from "./road-network-topology";
import { validateRoadGraph } from "./road-network-validation";

const CENTER = { lat: 0, lon: 0 };

function way(
	id: number,
	tags: Record<string, string>,
	points: Array<[nodeId: number, lat: number, lon: number]>,
): OsmWay {
	return {
		id,
		tags,
		points: points.map(([nodeId, lat, lon]) => ({ nodeId, lat, lon })),
	};
}

describe("mapOsmTags", () => {
	test("maps highway classes to road classes and style presets", () => {
		expect(mapOsmTags({ highway: "residential" })).toMatchObject({
			roadClass: "local",
			styleId: "local-street",
		});
		expect(mapOsmTags({ highway: "primary" })).toMatchObject({
			roadClass: "arterial",
			styleId: "arterial",
		});
		expect(mapOsmTags({ highway: "tertiary" })).toMatchObject({
			roadClass: "collector",
			styleId: "collector",
		});
		expect(mapOsmTags({ highway: "motorway_link" })).toMatchObject({
			roadClass: "highway",
			styleId: "highway",
		});
		expect(mapOsmTags({ highway: "service" })).toMatchObject({
			roadClass: "service",
			styleId: "alley",
		});
	});

	test("ignores non-road highway values", () => {
		expect(mapOsmTags({ highway: "footway" })).toBeNull();
		expect(mapOsmTags({ highway: "cycleway" })).toBeNull();
		expect(mapOsmTags({})).toBeNull();
	});

	test("maps oneway and roundabout tags to edge direction", () => {
		expect(mapOsmTags({ highway: "primary", oneway: "yes" })?.direction).toBe(
			"forward",
		);
		expect(mapOsmTags({ highway: "primary", oneway: "-1" })?.direction).toBe(
			"reverse",
		);
		expect(mapOsmTags({ highway: "primary" })?.direction).toBe("both");
		expect(
			mapOsmTags({ highway: "primary", junction: "roundabout" })?.direction,
		).toBe("forward");
	});

	test("honors explicit two-way tags before implied motorway or roundabout direction", () => {
		expect(mapOsmTags({ highway: "motorway" })?.direction).toBe("forward");
		expect(mapOsmTags({ highway: "motorway", oneway: "no" })?.direction).toBe(
			"both",
		);
		expect(
			mapOsmTags({
				highway: "residential",
				junction: "roundabout",
				oneway: "no",
			})?.direction,
		).toBe("both");
	});

	test("maps bridge and layer tags", () => {
		const bridge = mapOsmTags({
			highway: "primary",
			bridge: "yes",
			layer: "1",
		});
		expect(bridge).toMatchObject({
			isBridge: true,
			stackLevel: 1,
			osmVertical: { bridge: true, layer: 1 },
		});
		const tunnel = mapOsmTags({
			highway: "primary",
			layer: "-2",
			tunnel: "yes",
			ele: "4.5",
		});
		expect(tunnel?.stackLevel).toBe(0);
		expect(tunnel?.osmVertical).toEqual({ layer: -2, ele: 4.5, tunnel: true });
		expect(mapOsmTags({ highway: "primary" })?.isBridge).toBe(false);
	});
});

describe("normalizeOsmTags", () => {
	test("turns OSM wikipedia references into persistable HTTPS URLs", () => {
		expect(
			normalizeOsmTags({ wikipedia: "en:Times_Square", network: "US:NY" }),
		).toEqual({
			network: "US%3ANY",
			wikipedia: "https://en.wikipedia.org/wiki/Times_Square",
		});
		expect(
			normalizeOsmTags({
				wikipedia: "not a valid reference",
				highway: "primary",
			}),
		).toEqual({
			highway: "primary",
		});
	});
});

describe("projection", () => {
	test("round-trips and preserves distances near the center", () => {
		const point = { lat: 51.5008, lon: -0.1247 };
		const local = projectToLocal({ lat: 51.5017, lon: -0.1233 }, point);
		const back = localToGeo(local, point);
		expect(back.lat).toBeCloseTo(51.5017, 6);
		expect(back.lon).toBeCloseTo(-0.1233, 6);
	});

	test("x grows east and z shrinks north", () => {
		const east = projectToLocal({ lat: 0, lon: 0.001 }, CENTER);
		expect(east[0]).toBeCloseTo(111.32, 1);
		expect(east[1]).toBeCloseTo(0, 5);
		const north = projectToLocal({ lat: 0.001, lon: 0 }, CENTER);
		expect(north[1]).toBeCloseTo(-111.32, 1);
	});
});

describe("computeBoundingBox and query", () => {
	test("bounding box widens with latitude", () => {
		const equator = computeBoundingBox({ lat: 0, lon: 0 }, 500);
		const nordic = computeBoundingBox({ lat: 60, lon: 0 }, 500);
		expect(equator.north - equator.south).toBeCloseTo(
			nordic.north - nordic.south,
			8,
		);
		expect(nordic.east - nordic.west).toBeGreaterThan(
			equator.east - equator.west,
		);
	});

	test("overpass query filters road classes within the bbox", () => {
		const query = buildOverpassQuery({ south: 1, west: 2, north: 3, east: 4 });
		expect(query).toContain('way["highway"~');
		expect(query).toContain('["area"!="yes"]');
		expect(query).toContain("(1,2,3,4)");
		expect(query).toContain("out meta geom");
		expect(query).toContain("residential");
		expect(query).toContain("area:highway");
		expect(query).toContain("footway");
		expect(query).toContain('node["highway"="street_lamp"]');
		expect(query).toContain('node["highway"="traffic_signals"]');
		expect(query).toContain('node["traffic_sign"]');
		expect(query).toContain("cycleway");
	});
});

describe("resilient OSM requests", () => {
	test("splits a failed bounding box into four exact quadrants", () => {
		expect(
			splitOsmBoundingBox({ south: 0, west: 10, north: 4, east: 18 }),
		).toEqual([
			{ south: 0, west: 10, north: 2, east: 14 },
			{ south: 0, west: 14, north: 2, east: 18 },
			{ south: 2, west: 10, north: 4, east: 14 },
			{ south: 2, west: 14, north: 4, east: 18 },
		]);
	});

	test("deduplicates ways and mapped features returned by adjacent chunks", () => {
		const sharedWay = way(200, { highway: "residential" }, [
			[1, 0, 0],
			[2, 0, 0.001],
		]);
		const merged = mergeOsmMapData(
			[0, 1].map(() => ({
				ways: [sharedWay],
				pointFeatures: [
					{
						kind: "street-lamp" as const,
						point: { lat: 0, lon: 0 },
						sourceId: "node/9",
						height: 6,
						tags: {},
					},
				],
				mappedSurfaces: [
					{
						id: 201,
						kind: "sidewalk" as const,
						sourceType: "way" as const,
						tags: {},
						points: sharedWay.points,
					},
				],
				crossings: [{ id: 202, point: { lat: 0, lon: 0 }, tags: {} }],
				laneConnectivity: [
					{ id: 203, tags: { type: "connectivity" }, members: [] },
				],
			})),
		);
		expect(merged.ways).toHaveLength(1);
		expect(merged.pointFeatures).toHaveLength(1);
		expect(merged.mappedSurfaces).toHaveLength(1);
		expect(merged.crossings).toHaveLength(1);
		expect(merged.laneConnectivity).toHaveLength(1);
	});

	test("retries a gateway timeout as four smaller requests", async () => {
		const originalFetch = globalThis.fetch;
		let requests = 0;
		globalThis.fetch = (async () => {
			requests += 1;
			if (requests === 1) return new Response("", { status: 504 });
			return new Response(JSON.stringify({ elements: [] }), { status: 200 });
		}) as unknown as typeof fetch;
		try {
			await fetchOsmMapData({ south: 0, west: 0, north: 1, east: 1 });
			expect(requests).toBe(5);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("terrain and explicit vertical reconstruction", () => {
	const terrainSampler = {
		failedTiles: 0,
		successfulTiles: 1,
		prefetch: async () => {},
		elevationAt: (point: { lat: number; lon: number }) =>
			100 + point.lon * 1000,
	};

	test("imports terrain as elevation relative to the selected origin", async () => {
		const result = await importStreetsFromOsm(CENTER, 100, {
			loadTerrain: true,
			terrainSampler,
			loadStreets: async () => [
				way(300, { highway: "residential" }, [
					[1, 0, -0.0005],
					[2, 0, 0.0005],
				]),
			],
		});
		const nodes = Object.values(result.graphs[0]!.graphNodes).sort(
			(first, second) => first.position[0] - second.position[0],
		);
		expect(result.source.baseElevation).toBe(100);
		expect(nodes[0]!.position[1]).toBeLessThan(0);
		expect(nodes[1]!.position[1]).toBeGreaterThan(0);
	});

	test("uses OSM ele only with explicit compatible vertical datum evidence", async () => {
		const result = await importStreetsFromOsm(CENTER, 100, {
			loadTerrain: true,
			terrainSampler: {
				...terrainSampler,
				source: {
					provider: "fixture",
					dataset: "fixture-dem",
					encoding: "decoded-grid",
					units: "metres",
					verticalReference: { kind: "datum", datumId: "fixture-datum" },
				},
			},
			mappedElevationDatumId: "fixture-datum",
			loadStreets: async () => [
				way(301, { highway: "primary", ele: "110" }, [
					[1, 0, -0.0005],
					[2, 0, 0.0005],
				]),
			],
		});
		const graph = result.graphs[0]!;
		const edge = Object.values(graph.edges)[0]!;
		expect(
			Object.values(graph.graphNodes).every(
				(node) => Math.abs(node.position[1] - 10) < 1e-6,
			),
		).toBe(true);
		expect(edge.profileMode).toBe("designed");
	});

	test("keeps a flat local datum when the terrain tile at the origin is unavailable", async () => {
		const result = await importStreetsFromOsm(CENTER, 100, {
			loadTerrain: true,
			terrainSampler: {
				failedTiles: 1,
				successfulTiles: 1,
				hasElevationAt: () => false,
				prefetch: async () => {},
				elevationAt: () => 250,
			},
			loadStreets: async () => [
				way(302, { highway: "residential" }, [
					[1, 0, -0.0005],
					[2, 0, 0.0005],
				]),
			],
		});
		expect(result.source.baseElevation).toBeNull();
		expect(
			Object.values(result.graphs[0]!.graphNodes).every(
				(node) => node.position[1] === 0,
			),
		).toBe(true);
	});

	test("adds estimated clearance only for bridge and tunnel crossings", () => {
		const makeSegment = (
			id: string,
			startId: string,
			endId: string,
			tags: Record<string, string>,
		) => ({
			startId,
			endId,
			interior: [],
			props: mapOsmTags({ highway: "primary", ...tags })!,
			osmVertical: mapOsmTags({ highway: "primary", ...tags })!.osmVertical,
		});
		const nodePositions = new Map<string, readonly [number, number]>([
			["west", [-20, 0]],
			["east", [20, 0]],
			["north", [0, -20]],
			["south", [0, 20]],
		]);
		const { graph } = buildRoadGraphFromSegments(
			[
				makeSegment("bridge", "west", "east", { bridge: "yes", layer: "1" }),
				makeSegment("ground", "north", "south", {}),
			],
			nodePositions as Map<string, [number, number]>,
		);
		applyOsmStructureClearances(graph);
		const bridge = Object.values(graph.edges).find(
			(edge) => edge.osmVertical?.bridge,
		)!;
		expect(bridge.profileMode).toBe("designed");
		expect(bridge.verticalSource).toEqual({
			kind: "estimated",
			clearanceMeters: 4.5,
		});
		expect(bridge.verticalProfile[0]!.elevation).toBeCloseTo(4.5);

		const ordinary = Object.values(graph.edges).find(
			(edge) => !edge.osmVertical?.bridge,
		)!;
		ordinary.osmVertical = { layer: 10 };
		applyOsmStructureClearances(graph);
		expect(ordinary.profileMode).toBe("legacy");
	});
});

describe("parseOverpassResponse", () => {
	test("parses ways and ignores malformed elements", () => {
		const ways = parseOverpassResponse({
			elements: [
				{ type: "node", id: 1, lat: 0, lon: 0 },
				{
					type: "way",
					id: 10,
					tags: { highway: "residential" },
					nodes: [1, 2],
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 0.001, lon: 0 },
					],
				},
				{
					type: "way",
					id: 11,
					tags: { highway: "primary" },
					nodes: [1, 2, 3],
					geometry: [{ lat: 0, lon: 0 }],
				},
				{
					type: "way",
					id: 12,
					nodes: [1, 2],
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 1, lon: 1 },
					],
				},
			],
		});
		expect(ways).toHaveLength(1);
		expect(ways[0]).toMatchObject({ id: 10 });
		expect(ways[0]!.points).toHaveLength(2);
	});

	test("returns empty for junk payloads", () => {
		expect(parseOverpassResponse(null)).toEqual([]);
		expect(parseOverpassResponse({ remark: "timeout" })).toEqual([]);
	});

	test("does not import closed highway areas as centerline roads", () => {
		const elements = [
			{
				type: "way",
				id: 13,
				tags: { highway: "service", area: "yes" },
				nodes: [1, 2, 3, 1],
				geometry: [
					{ lat: 0, lon: 0 },
					{ lat: 0, lon: 0.001 },
					{ lat: 0.001, lon: 0 },
					{ lat: 0, lon: 0 },
				],
			},
		];
		expect(parseOverpassResponse({ elements })).toEqual([]);
	});

	test("parses roads and supported point objects from one response", () => {
		const payload = {
			elements: [
				{
					type: "way",
					id: 10,
					tags: { highway: "residential" },
					nodes: [1, 2],
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 0, lon: 0.001 },
					],
				},
				{
					type: "node",
					id: 30,
					lat: 0,
					lon: 0.0001,
					tags: { highway: "street_lamp" },
				},
			],
		};
		const parsed = parseOsmMapResponse(payload);
		expect(parsed.ways).toHaveLength(1);
		expect(parsed.pointFeatures).toMatchObject([
			{ kind: "street-lamp", sourceId: "node/30" },
		]);
	});

	test("extracts mapped road areas and supplemental street edges", () => {
		const payload = {
			elements: [
				{
					type: "way",
					id: 20,
					tags: { "area:highway": "pedestrian" },
					nodes: [1, 2, 3, 1],
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 0, lon: 0.001 },
						{ lat: 0.001, lon: 0.001 },
						{ lat: 0, lon: 0 },
					],
				},
				{
					type: "way",
					id: 21,
					tags: { highway: "cycleway" },
					nodes: [4, 5],
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 0.001, lon: 0 },
					],
				},
			],
		};
		const surfaces = parseOsmMappedSurfaces(payload);
		expect(surfaces.map((surface) => surface.kind)).toEqual([
			"road-area",
			"cycleway",
		]);
		expect(surfaces[0]!.points).toHaveLength(4);
	});

	test("does not misclassify generic paths, tracks, or steps as sidewalks", () => {
		const elements = ["path", "track", "steps"].map((highway, index) => ({
			type: "way",
			id: 100 + index,
			tags: { highway },
			nodes: [1, 2],
			geometry: [
				{ lat: 0, lon: 0 },
				{ lat: 0, lon: 0.001 },
			],
		}));
		expect(parseOsmMappedSurfaces({ elements })).toEqual([]);
	});

	test("parses explicit sidewalk and crossing ways", () => {
		const elements = [
			{
				type: "way",
				id: 110,
				tags: { highway: "footway", footway: "sidewalk" },
				nodes: [1, 2],
				geometry: [
					{ lat: 0, lon: 0 },
					{ lat: 0, lon: 0.001 },
				],
			},
			{
				type: "way",
				id: 111,
				tags: { highway: "footway", footway: "crossing" },
				nodes: [3, 4],
				geometry: [
					{ lat: 0, lon: 0 },
					{ lat: 0.001, lon: 0 },
				],
			},
		];
		expect(
			parseOsmMappedSurfaces({ elements }).map((surface) => surface.kind),
		).toEqual(["sidewalk", "crossing"]);
	});

	test("stitches outer members and retains holes from area highway relations", () => {
		const relation = {
			type: "relation",
			id: 120,
			tags: { type: "multipolygon", "area:highway": "residential" },
			members: [
				{
					type: "way",
					role: "outer",
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 0, lon: 0.001 },
						{ lat: 0.001, lon: 0.001 },
					],
				},
				{
					type: "way",
					role: "outer",
					geometry: [
						{ lat: 0.001, lon: 0.001 },
						{ lat: 0.001, lon: 0 },
						{ lat: 0, lon: 0 },
					],
				},
				{
					type: "way",
					role: "inner",
					geometry: [
						{ lat: 0.0002, lon: 0.0002 },
						{ lat: 0.0002, lon: 0.0004 },
						{ lat: 0.0004, lon: 0.0004 },
					],
				},
				{
					type: "way",
					role: "inner",
					geometry: [
						{ lat: 0.0004, lon: 0.0004 },
						{ lat: 0.0004, lon: 0.0002 },
						{ lat: 0.0002, lon: 0.0002 },
					],
				},
			],
		};
		expect(parseOsmMappedSurfaces({ elements: [relation] })).toMatchObject([
			{
				id: 120,
				kind: "road-area",
				partIndex: 0,
				sourceType: "relation",
				holes: [[{}, {}, {}, {}, {}]],
			},
		]);
	});

	test("keeps every disjoint outer ring in a multipolygon relation", () => {
		const square = (west: number) => [
			{ lat: 0, lon: west },
			{ lat: 0, lon: west + 0.001 },
			{ lat: 0.001, lon: west + 0.001 },
			{ lat: 0.001, lon: west },
			{ lat: 0, lon: west },
		];
		const surfaces = parseOsmMappedSurfaces({
			elements: [
				{
					type: "relation",
					id: 121,
					tags: { type: "multipolygon", "area:highway": "service" },
					members: [
						{ type: "way", role: "outer", geometry: square(0) },
						{ type: "way", role: "outer", geometry: square(0.01) },
					],
				},
			],
		});
		expect(surfaces.map((surface) => surface.partIndex)).toEqual([0, 1]);
	});

	test("preserves lane connectivity relation members", () => {
		const relations = parseOsmLaneConnectivity({
			elements: [
				{
					type: "relation",
					id: 130,
					tags: { type: "connectivity", connectivity: "1:1" },
					members: [
						{ type: "way", ref: 10, role: "from" },
						{ type: "node", ref: 20, role: "via" },
						{ type: "way", ref: 30, role: "to" },
					],
				},
			],
		});
		expect(relations).toEqual([
			{
				id: 130,
				tags: { type: "connectivity", connectivity: "1:1" },
				members: [
					{ type: "way", ref: 10, role: "from" },
					{ type: "node", ref: 20, role: "via" },
					{ type: "way", ref: 30, role: "to" },
				],
			},
		]);
	});

	test("extracts crossing nodes with kerb metadata", () => {
		const crossings = parseOsmCrossingFeatures({
			elements: [
				{
					type: "node",
					id: 44,
					lat: 40,
					lon: -73,
					tags: {
						highway: "crossing",
						crossing: "zebra",
						kerb: "lowered",
						tactile_paving: "yes",
					},
				},
			],
		});
		expect(crossings).toEqual([
			{
				id: 44,
				kind: "crossing",
				point: { lat: 40, lon: -73 },
				tags: {
					highway: "crossing",
					crossing: "zebra",
					kerb: "lowered",
					tactile_paving: "yes",
				},
			},
		]);
	});

	test("retains lowered kerb nodes even when the crossing is mapped separately", () => {
		expect(
			parseOsmCrossingFeatures({
				elements: [
					{
						type: "node",
						id: 45,
						lat: 40,
						lon: -73,
						tags: { barrier: "kerb", kerb: "lowered", tactile_paving: "yes" },
					},
					{
						type: "node",
						id: 46,
						lat: 40,
						lon: -73,
						tags: { barrier: "kerb", kerb: "raised" },
					},
				],
			}),
		).toMatchObject([{ id: 45, kind: "kerb" }]);
	});
});

describe("simplifyPolyline", () => {
	test("removes collinear points and keeps deviations", () => {
		const collinear = simplifyPolyline([
			[0, 0],
			[5, 0.01],
			[10, 0],
			[15, 0.02],
			[20, 0],
		]);
		expect(collinear).toHaveLength(2);
		const bent = simplifyPolyline([
			[0, 0],
			[10, 8],
			[20, 0],
		]);
		expect(bent).toHaveLength(3);
	});
});

describe("buildSegmentsFromWays", () => {
	test("splits crossing ways at their shared node", () => {
		const ways = [
			way(1, { highway: "residential" }, [
				[1, 0, -0.001],
				[2, 0, 0],
				[3, 0, 0.001],
			]),
			way(2, { highway: "residential" }, [
				[4, -0.001, 0],
				[2, 0, 0],
				[5, 0.001, 0],
			]),
		];
		const { segments, nodePositions } = buildSegmentsFromWays(
			ways,
			CENTER,
			300,
		);
		expect(segments).toHaveLength(4);
		expect(segments.every((s) => s.startId === "n2" || s.endId === "n2")).toBe(
			true,
		);
		expect(nodePositions.get("n2")![0]).toBeCloseTo(0, 6);
		expect(nodePositions.get("n2")![1]).toBeCloseTo(0, 6);
	});

	test("clips ways to the import radius with boundary endpoints", () => {
		const ways = [
			way(1, { highway: "residential" }, [
				[1, 0, -0.01],
				[2, 0, 0],
				[3, 0, 0.01],
			]),
		];
		const { segments, nodePositions } = buildSegmentsFromWays(
			ways,
			CENTER,
			200,
		);
		expect(segments).toHaveLength(1);
		const segment = segments[0]!;
		const start = nodePositions.get(segment.startId)!;
		const end = nodePositions.get(segment.endId)!;
		expect(Math.hypot(start[0], start[1])).toBeCloseTo(200, 0);
		expect(Math.hypot(end[0], end[1])).toBeCloseTo(200, 0);
	});

	test("drops ways entirely outside the radius", () => {
		const ways = [
			way(1, { highway: "residential" }, [
				[1, 0.01, 0.01],
				[2, 0.011, 0.01],
			]),
		];
		expect(buildSegmentsFromWays(ways, CENTER, 200).segments).toHaveLength(0);
	});

	test("preserves oneway direction on produced segments", () => {
		const ways = [
			way(1, { highway: "primary", oneway: "yes" }, [
				[1, 0, -0.001],
				[2, 0, 0.001],
			]),
		];
		const { segments } = buildSegmentsFromWays(ways, CENTER, 300);
		expect(segments[0]!.props.direction).toBe("forward");
	});
});

describe("ensureSimpleSegments", () => {
	const props = mapOsmTags({ highway: "residential" })!;

	test("splits closed loops so no self-edges remain", () => {
		const nodePositions = new Map<string, readonly [number, number]>([
			["nA", [0, 0]],
		]);
		const segments = ensureSimpleSegments(
			[
				{
					startId: "nA",
					endId: "nA",
					interior: [
						[10, 0],
						[10, 10],
						[0, 10],
					],
					props,
				},
			],
			nodePositions as Map<string, [number, number]>,
		);
		expect(segments.length).toBeGreaterThanOrEqual(2);
		expect(segments.every((s) => s.startId !== s.endId)).toBe(true);
		const pairs = segments.map((s) => [s.startId, s.endId].sort().join("|"));
		expect(new Set(pairs).size).toBe(pairs.length);
	});

	test("splits duplicate node pairs apart", () => {
		const nodePositions = new Map<string, [number, number]>([
			["nA", [0, 0]],
			["nB", [20, 0]],
		]);
		const segments = ensureSimpleSegments(
			[
				{ startId: "nA", endId: "nB", interior: [], props },
				{ startId: "nA", endId: "nB", interior: [[10, 15]], props },
			],
			nodePositions,
		);
		expect(segments).toHaveLength(3);
		const pairs = segments.map((s) => [s.startId, s.endId].sort().join("|"));
		expect(new Set(pairs).size).toBe(pairs.length);
	});

	test("merges sub-5cm stubs by aliasing their endpoints", () => {
		const nodePositions = new Map<string, [number, number]>([
			["nA", [0, 0]],
			["nB", [0.01, 0]],
			["nC", [30, 0]],
		]);
		const segments = ensureSimpleSegments(
			[
				{ startId: "nA", endId: "nB", interior: [], props },
				{ startId: "nB", endId: "nC", interior: [], props },
			],
			nodePositions,
		);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({ startId: "nA", endId: "nC" });
	});

	test("survives mutual tiny stubs without alias cycles", () => {
		const nodePositions = new Map<string, [number, number]>([
			["nA", [0, 0]],
			["nB", [0.01, 0]],
			["nC", [30, 0]],
		]);
		const segments = ensureSimpleSegments(
			[
				{ startId: "nA", endId: "nB", interior: [], props },
				{ startId: "nB", endId: "nA", interior: [], props },
				{ startId: "nA", endId: "nC", interior: [], props },
			],
			nodePositions,
		);
		expect(segments).toHaveLength(1);
		expect(segments[0]!.endId).toBe("nC");
	});
});

describe("graph assembly", () => {
	test("produces a valid road graph with a junction at the crossing", () => {
		const ways = [
			way(1, { highway: "primary", oneway: "yes" }, [
				[1, 0, -0.001],
				[2, 0, 0],
				[3, 0, 0.001],
			]),
			way(2, { highway: "residential" }, [
				[4, -0.001, 0],
				[2, 0, 0],
				[5, 0.001, 0],
			]),
		];
		const { segments, nodePositions } = buildSegmentsFromWays(
			ways,
			CENTER,
			300,
		);
		const simple = ensureSimpleSegments(segments, nodePositions);
		const { graph } = buildRoadGraphFromSegments(simple, nodePositions);
		reconcileRoadJunctions(graph);
		const errors = validateRoadGraph(graph).filter(
			(issue) => issue.severity === "error",
		);
		expect(errors).toEqual([]);
		expect(graph.junctions.n2).toBeDefined();
		expect(Object.keys(graph.edges)).toHaveLength(4);
		const primaryEdges = Object.values(graph.edges).filter(
			(edge) => edge.roadClass === "arterial",
		);
		expect(primaryEdges).toHaveLength(2);
		expect(primaryEdges.every((edge) => edge.direction === "forward")).toBe(
			true,
		);
	});

	test("marks bridge-only nodes and interpolates bridge alignment elevation", () => {
		const props = mapOsmTags({ highway: "primary", bridge: "yes" })!;
		const groundProps = mapOsmTags({ highway: "primary" })!;
		const nodePositions = new Map<string, [number, number]>([
			["nA", [0, 0]],
			["nB", [100, 0]],
			["nC", [200, 0]],
		]);
		const { graph, bridgeEdgeIds } = buildRoadGraphFromSegments(
			[
				{ startId: "nA", endId: "nB", interior: [[50, 0]], props },
				{
					startId: "nB",
					endId: "nC",
					interior: [[150, 0]],
					props: groundProps,
				},
			],
			nodePositions,
		);
		expect(graph.graphNodes.nA!.elevationMode).toBe("bridge");
		expect(graph.graphNodes.nB!.elevationMode).toBe("ground");
		expect(bridgeEdgeIds.size).toBe(1);
		applyElevations(graph, bridgeEdgeIds, (x) => x);
		const bridgeEdge = Object.values(graph.edges).find((e) =>
			bridgeEdgeIds.has(e.id),
		)!;
		const groundEdge = Object.values(graph.edges).find(
			(e) => !bridgeEdgeIds.has(e.id),
		)!;
		expect(bridgeEdge.alignment[0]![1]).toBeCloseTo(50, 5);
		expect(groundEdge.alignment[0]![1]).toBeCloseTo(150, 5);
		expect(graph.graphNodes.nB!.position[1]).toBeCloseTo(100, 5);
	});
});

describe("importStreetsFromOsm", () => {
	const ways = [
		way(1, { highway: "residential" }, [
			[1, 0, -0.001],
			[2, 0, 0],
			[3, 0, 0.001],
		]),
		way(2, { highway: "residential" }, [
			[4, -0.001, 0],
			[2, 0, 0],
			[5, 0.001, 0],
		]),
	];

	test("returns validated graphs and stats", async () => {
		const result = await importStreetsFromOsm(CENTER, 300, {
			loadStreets: async () => ways,
		});
		expect(result.graphs).toHaveLength(1);
		expect(result.stats).toMatchObject({ ways: 2, edges: 4, junctions: 1 });
		const graph = result.graphs[0]!;
		for (const node of Object.values(graph.graphNodes)) {
			expect(node.position[1]).toBeCloseTo(0, 5);
		}
		expect(
			validateRoadGraph(graph).filter((issue) => issue.severity === "error"),
		).toEqual([]);
	});

	test("prepares clipped preview paths and completes without fetching streets again", async () => {
		let streetLoads = 0;
		const prepared = await prepareOsmStreetImport(CENTER, 300, {
			loadStreets: async () => {
				streetLoads += 1;
				return ways;
			},
		});
		expect(prepared.preview).toMatchObject({
			segmentCount: 4,
			wayCount: 2,
		});
		expect(prepared.preview.paths).toHaveLength(4);
		expect(getPreparedOsmStreetImportResult(prepared)).toMatchObject({
			source: {
				baseElevation: null,
				center: CENTER,
				provider: "openstreetmap",
				radiusMeters: 300,
			},
			stats: { edges: 4 },
		});
		for (const path of prepared.preview.paths) {
			expect(path.points.length).toBeGreaterThanOrEqual(2);
			for (const point of path.points) {
				const local = projectToLocal(point, CENTER);
				expect(Math.hypot(local[0], local[1])).toBeLessThanOrEqual(300.01);
			}
		}

		const phases: string[] = [];
		const result = await completeOsmStreetImport(prepared, {
			onPhase: (phase) => phases.push(phase),
		});
		expect(streetLoads).toBe(1);
		expect(phases).toEqual(["building"]);
		expect(result.stats.edges).toBe(4);
	});

	test("previews mapped lamps, signals, and signs from the same request", async () => {
		const prepared = await prepareOsmStreetImport(CENTER, 300, {
			loadMapData: async (): Promise<
				ReturnType<typeof parseOsmMapResponse>
			> => ({
				pointFeatures: [
					{
						kind: "street-lamp",
						point: { lat: 0, lon: 0.0001 },
						sourceId: "node/101",
						tags: { height: "8", highway: "street_lamp" },
					},
					{
						kind: "traffic-signal",
						point: { lat: 0, lon: 0.0002 },
						sourceId: "node/102",
						tags: { highway: "traffic_signals" },
					},
					{
						kind: "road-sign",
						point: { lat: 0, lon: 0.0003 },
						sourceId: "node/103",
						tags: { maxspeed: "30", traffic_sign: "maxspeed" },
					},
				],
				ways,
			}),
		});
		expect(prepared.preview.assetCounts).toEqual({
			roadSigns: 1,
			streetLamps: 1,
			trafficSignals: 1,
		});
		expect(getPreparedOsmStreetImportResult(prepared).assets).toHaveLength(3);

		const result = await completeOsmStreetImport(prepared, {});
		expect(result.assets).toHaveLength(3);
		expect(result.assets.map((asset) => asset.kind)).toEqual([
			"street-lamp",
			"traffic-signal",
			"road-sign",
		]);
		expect(
			result.assets.every((asset) => Math.abs(asset.position[1]) < 1e-6),
		).toBe(true);
		expect(result.assets[2]).toMatchObject({
			signId: "speed-limit",
			text: "30",
		});
	});

	test("omits short fragments from both the preview and final edge count", async () => {
		const prepared = await prepareOsmStreetImport(CENTER, 300, {
			loadStreets: async () => [
				way(1, { highway: "residential" }, [
					[1, 0, -0.001],
					[2, 0, 0.001],
				]),
				way(2, { highway: "service" }, [
					[3, 0.001, 0],
					[4, 0.001, 0.00002],
				]),
			],
		});
		expect(prepared.preview.segmentCount).toBe(1);
		expect(prepared.preview.paths).toHaveLength(1);

		const result = await completeOsmStreetImport(prepared, {});
		expect(result.stats.edges).toBe(1);
		expect(result.stats.droppedComponents).toBe(1);
	});

	test("reports phases in order", async () => {
		const phases: string[] = [];
		await importStreetsFromOsm(CENTER, 300, {
			loadStreets: async () => ways,
			onPhase: (phase) => phases.push(phase),
		});
		expect(phases).toEqual(["streets", "building"]);
	});

	test("throws a friendly error when the area has no streets", async () => {
		await expect(
			importStreetsFromOsm(CENTER, 300, {
				loadStreets: async () => [],
			}),
		).rejects.toThrow(/No streets were found/);
	});

	test("stops before loading streets when already cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		let loaded = false;
		await expect(
			importStreetsFromOsm(CENTER, 300, {
				loadStreets: async () => {
					loaded = true;
					return ways;
				},
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(loaded).toBe(false);
	});

	test("passes cancellation to the street loader", async () => {
		const controller = new AbortController();
		await expect(
			importStreetsFromOsm(CENTER, 300, {
				loadStreets: async (_bbox, signal) => {
					expect(signal).toBe(controller.signal);
					controller.abort();
					signal?.throwIfAborted();
					return ways;
				},
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("imported point asset elevation", () => {
	test("uses the road terrain datum for lamps, signals and signs, including valid zero", async () => {
		const result = await importStreetsFromOsm(CENTER, 100, {
			loadTerrain: true,
			terrainSampler: {
				failedTiles: 0,
				successfulTiles: 1,
				prefetch: async () => {},
				hasElevationAt: () => true,
				elevationAt: (p) => (p.lon === 0 ? 100 : p.lon > 0 ? 103 : 100),
			},
			loadMapData: async () => ({
				ways: [
					way(901, { highway: "residential" }, [
						[1, 0, -0.0005],
						[2, 0, 0.0005],
					]),
				],
				pointFeatures: ["street-lamp", "traffic-signal", "road-sign"].map(
					(kind, i) => ({
						kind: kind as "street-lamp" | "traffic-signal" | "road-sign",
						sourceId: `node/${901 + i}`,
						point: { lat: 0, lon: i === 0 ? -0.0001 : 0.0001 },
						tags: { traffic_sign: "stop" },
					}),
				),
			}),
		});
		expect(result.assets.map((a) => a.position[1])).toEqual([0, 3, 3]);
		expect(result.assets.every((a) => a.elevationSource === "terrain")).toBe(
			true,
		);
	});
	test("marks partial coverage as estimated instead of measured sea level", async () => {
		const result = await importStreetsFromOsm(CENTER, 100, {
			loadTerrain: true,
			terrainSampler: {
				failedTiles: 1,
				successfulTiles: 1,
				prefetch: async () => {},
				hasElevationAt: (p) => p.lon <= 0,
				elevationAt: () => 100,
			},
			loadMapData: async () => ({
				ways: [
					way(902, { highway: "residential" }, [
						[1, 0, -0.0005],
						[2, 0, 0.0005],
					]),
				],
				pointFeatures: [
					{
						kind: "street-lamp",
						sourceId: "node/950",
						point: { lat: 0, lon: 0.0001 },
						tags: {},
					},
				],
			}),
		});
		expect(result.assets[0]!.position[1]).toBe(0);
		expect(result.assets[0]!.elevationSource).toBe("estimated");
		expect(
			Object.values(result.graphs[0]!.edges)[0]!.verticalSource?.kind,
		).toBe("estimated");
	});
});
