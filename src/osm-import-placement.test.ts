import { createLegacyStreetProject } from "./street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./host/street-project-persistence";
import { captureOsmImportPreconditions } from "./osm-import-placement";
import { ResolvedStreetRoadData } from "./domain/resolved-street-road";
import { prepareOsmStreetImport, completeOsmStreetImport } from "./osm-import";
import { confirmStreetRegionalPolicy } from "./domain/street-sections";
import { parseNormalizedOsmSource } from "./source/osm-normalization";
import { parseTerrainEvidence } from "./domain/terrain-evidence";
import { createOsmImportScope } from "./osm-import-scope";
import {
	geographicToSite,
	createOsmSiteFrame,
	createSiteFrame,
} from "./domain/site-frame";
import {
	reviewOsmImport,
	createMapImportMetadata,
} from "./osm-import-deduplication";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	clearSceneHistory,
	LevelNode,
	SiteNode,
	BuildingNode,
	SlabNode,
	type AnyNodeId,
	useScene,
} from "@pascal-app/core";
import {
	createEmptyRoadGraph,
	insertRoadSegment,
} from "./road-network-topology";
import {
	localToGeo,
	importStreetsFromOsm,
	type OsmImportResult,
} from "./osm-import";
import { RoadNetworkNode } from "./schema";
import {
	getImportedStreetFocus,
	getOsmImportFloorOffset,
	getOsmImportSceneContext,
	placeOsmImport,
} from "./osm-import-placement";

const LEVEL_ID = "level_map-import" as AnyNodeId;
const SLAB_ID = "slab_map-import" as AnyNodeId;

test("import completion rejects stale scene preconditions without partial additions", () => {
	const expected = captureOsmImportPreconditions(LEVEL_ID);
	useScene.getState().applyNodeChanges({
		update: [{ id: LEVEL_ID, data: { name: "Newer level edit" } }],
	});
	const before = useScene.getState().nodes,
		count = useScene.temporal.getState().pastStates.length;
	expect(() =>
		placeOsmImport(importResult(2), LEVEL_ID, undefined, { expected }),
	).toThrow("Scene changed");
	expect(useScene.getState().nodes).toBe(before);
	expect(useScene.temporal.getState().pastStates.length).toBe(count);
});

function importResult(graphCount: number): OsmImportResult {
	return {
		assets: [],
		graphs: Array.from({ length: graphCount }, () => createEmptyRoadGraph()),
		source: {
			baseElevation: 0,
			center: { lat: 0, lon: 0 },
			provider: "openstreetmap",
			radiusMeters: 250,
		},
		stats: {
			ways: graphCount,
			edges: 0,
			junctions: 0,
			components: graphCount,
			droppedComponents: 0,
			failedElevationTiles: 0,
		},
	};
}

beforeEach(() => {
	const level = LevelNode.parse({ id: LEVEL_ID, children: [SLAB_ID] });
	const slab = SlabNode.parse({
		id: SLAB_ID,
		parentId: LEVEL_ID,
		polygon: [
			[-50, -50],
			[50, -50],
			[50, 50],
			[-50, 50],
		],
		elevation: 0.35,
		thickness: 0.1,
	});
	useScene.setState({
		nodes: { [LEVEL_ID]: level, [SLAB_ID]: slab },
		rootNodeIds: [LEVEL_ID],
		dirtyNodes: new Set(),
		collections: {},
		materials: {},
		readOnly: false,
	});
	clearSceneHistory();
});

describe("placeOsmImport", () => {
	test("persists one normalization report including rejected inputs for a multi-component import", async () => {
		const center = { lat: 0, lon: 0 },
			bbox = { south: -0.01, west: -0.01, north: 0.01, east: 0.01 };
		const raw = (id: number, z: number) => ({
			type: "way",
			id,
			tags: { highway: "residential", source: "US:NY" },
			nodes: [id * 10, id * 10 + 1],
			geometry: [localToGeo([-40, z], center), localToGeo([40, z], center)],
		});
		const result = await importStreetsFromOsm(center, 100, {
			loadAcquisition: async () => ({
				format: "osm-acquisition",
				schemaVersion: 1,
				bbox,
				responses: [
					{
						bbox,
						payload: {
							elements: [
								raw(10, 0),
								raw(20, 50),
								{ ...raw(30, 60), geometry: [null, null] },
							],
						},
					},
				],
				diagnostics: [],
			}),
		});
		const ids = placeOsmImport(result, LEVEL_ID);
		const reports = ids
			.map(
				(id) =>
					RoadNetworkNode.parse(useScene.getState().nodes[id])
						.metadata as Record<string, unknown>,
			)
			.filter((metadata) => metadata.osmNormalizationReport);
		expect(reports).toHaveLength(1);
		const saved = parseNormalizedOsmSource(reports[0]!.osmNormalizationReport);
		expect(saved).toEqual(result.normalization!);
		expect(
			saved.features.find((feature) => feature.id === 30)?.disposition,
		).toBe("rejected");
		expect(saved.features[0]!.raw.tags).toMatchObject({ source: "US:NY" });
	});

	test("persists terrain coverage and raw mapped claims without modifying source evidence", async () => {
		const center = { lat: 0, lon: 0 };
		const result = await importStreetsFromOsm(center, 100, {
			loadStreets: async () => [
				{
					id: 9,
					tags: { highway: "residential", ele: "110" },
					points: [
						{ nodeId: 1, ...localToGeo([-50, 0], center) },
						{ nodeId: 2, ...localToGeo([50, 0], center) },
					],
				},
			],
		});
		const before = JSON.stringify(result.terrainEvidence);
		const ids = placeOsmImport(result, LEVEL_ID);
		const metadata = RoadNetworkNode.parse(useScene.getState().nodes[ids[0]!])
			.metadata as Record<string, unknown>;
		expect(parseTerrainEvidence(metadata.osmTerrainEvidence)).toEqual(
			result.terrainEvidence!,
		);
		expect(JSON.stringify(result.terrainEvidence)).toBe(before);
		expect(
			parseTerrainEvidence(
				JSON.parse(JSON.stringify(metadata)).osmTerrainEvidence,
			).roads[0]!.mappedElevation!.raw,
		).toBe("110");
	});
	test("persists selected scope without placing supporting graphs", () => {
		const result = importResult(1);
		const scope = createOsmImportScope(result.source.center, 250);
		result.context = {
			scope,
			coordinateFrame: createOsmSiteFrame({
				center: scope.center,
				baseElevation: null,
			}),
			graphs: [createEmptyRoadGraph(), createEmptyRoadGraph()],
		};
		const ids = placeOsmImport(result, LEVEL_ID);
		expect(ids).toHaveLength(1);
		expect(
			RoadNetworkNode.parse(useScene.getState().nodes[ids[0]!]).metadata,
		).toMatchObject({ osmImportScope: scope });
	});

	test("raises imported map geometry above the active floor surface", () => {
		expect(getOsmImportFloorOffset(LEVEL_ID)).toBeCloseTo(0.4);
	});

	test("adds every disconnected road component to the active level", () => {
		const ids = placeOsmImport(importResult(2), LEVEL_ID);
		const scene = useScene.getState();

		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
		expect(
			ids.every(
				(id) =>
					(scene.nodes[id] as unknown as { type?: string })?.type ===
					"streetscape:road-network",
			),
		).toBe(true);
		expect(
			(scene.nodes[LEVEL_ID] as unknown as { children?: AnyNodeId[] }).children,
		).toEqual([SLAB_ID, ...ids]);
		expect(getOsmImportSceneContext(LEVEL_ID).networks).toHaveLength(2);
		expect(
			ids.every(
				(id) => !RoadNetworkNode.parse(scene.nodes[id]).applyStyleToAll,
			),
		).toBe(true);
		expect(
			getOsmImportSceneContext(LEVEL_ID).networks[0]?.metadata,
		).toMatchObject({
			streetscapeMapImport: {
				origin: { lat: 0, lon: 0 },
				originElevation: 0,
				provider: "openstreetmap",
			},
		});
	});

	test("records the complete import as one undo step", () => {
		placeOsmImport(importResult(3), LEVEL_ID);
		expect(useScene.temporal.getState().pastStates).toHaveLength(1);

		useScene.temporal.getState().undo();
		expect(
			(
				useScene.getState().nodes[LEVEL_ID] as unknown as {
					children?: AnyNodeId[];
				}
			).children,
		).toEqual([SLAB_ID]);
		expect(
			Object.values(useScene.getState().nodes).filter(
				(node) =>
					(node as unknown as { type?: string }).type ===
					"streetscape:road-network",
			),
		).toHaveLength(0);
	});

	test("places mapped lamps, signals, and signs with source metadata in the same undo step", () => {
		const result = importResult(1);
		result.assets = [
			{
				height: 7,
				kind: "street-lamp",
				position: [10, 1, 20],
				rotationY: 0.2,
				sourceId: "node/11",
			},
			{
				kind: "traffic-signal",
				position: [30, 2, 40],
				rotationY: 0.4,
				sourceId: "node/12",
			},
			{
				kind: "road-sign",
				position: [50, 3, 60],
				rotationY: 0.6,
				signId: "speed-limit",
				sourceId: "node/13",
				text: "40",
			},
		];

		const ids = placeOsmImport(result, LEVEL_ID);
		const placed = ids.map(
			(id) =>
				useScene.getState().nodes[id] as unknown as {
					metadata?: unknown;
					position?: number[];
					type?: string;
				},
		);

		expect(placed.map((node) => node.type)).toEqual([
			"streetscape:road-network",
			"streetscape:street-light",
			"streetscape:traffic-signal",
			"streetscape:road-sign",
		]);
		expect(placed[1]?.position).toEqual([10, 1.4, 20]);
		expect(placed[1]?.metadata).toMatchObject({
			streetscapeOsmFeature: { kind: "street-lamp", sourceId: "node/11" },
		});
		expect(getOsmImportSceneContext(LEVEL_ID).featureSourceIds).toEqual(
			new Set(["node/11", "node/12", "node/13"]),
		);
		expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	});

	test("stores corridor associations, crossing ownership, and connectivity on the matched network", () => {
		const result = importResult(1);
		result.graphs = [
			insertRoadSegment(createEmptyRoadGraph(), [-20, 0, 0], [20, 0, 0]).graph,
		];
		const edge = Object.values(result.graphs[0]!.edges)[0]!;
		edge.osmSource = {
			wayId: 42,
			nodeIds: [1, 2],
			tags: { highway: "residential" },
		};
		result.mappedSurfaces = [
			{
				id: 50,
				kind: "sidewalk",
				tags: { highway: "footway", footway: "sidewalk", width: "2.2" },
				points: [-15, 15].map((x, index) => ({
					...localToGeo([x, 3], result.source.center),
					nodeId: index + 10,
				})),
			},
		];
		result.crossings = [
			{
				id: 51,
				point: localToGeo([0, 0], result.source.center),
				tags: { highway: "crossing" },
			},
		];
		result.laneConnectivity = [
			{
				id: 52,
				tags: { type: "connectivity" },
				members: [{ type: "way", ref: 42, role: "from" }],
			},
		];

		const [networkId] = placeOsmImport(result, LEVEL_ID);
		const network = RoadNetworkNode.parse(
			useScene.getState().nodes[networkId!],
		);
		expect(network.osmMappedSurfaces[0]).toMatchObject({
			associatedEdgeIds: [edge.id],
			confidence: "high",
			side: "left",
			widthMeters: 2.2,
			widthSource: "mapped",
		});
		expect(network.osmCrossings[0]).toMatchObject({
			associatedEdgeId: edge.id,
		});
		expect(network.osmLaneConnectivity).toHaveLength(1);
	});
});

describe("getImportedStreetFocus", () => {
	test("fits every imported graph with padding for the 2D editor", () => {
		const result = importResult(2);
		result.graphs[0]!.graphNodes.west = {
			id: "west",
			position: [-100, 0, -20],
			level: 0,
			elevationMode: "ground",
			terminal: false,
		};
		result.graphs[1]!.graphNodes.east = {
			id: "east",
			position: [140, 0, 80],
			level: 0,
			elevationMode: "ground",
			terminal: false,
		};

		expect(getImportedStreetFocus(result)).toEqual({
			center: [20, 30],
			max: [140, 80],
			min: [-100, -20],
			size: [240, 100],
			viewWidth: 288,
		});
	});

	test("returns world-space bounds for a rotated building", () => {
		const result = importResult(1);
		result.graphs[0]!.graphNodes.start = {
			id: "start",
			position: [0, 0, 0],
			level: 0,
			elevationMode: "ground",
			terminal: false,
		};
		result.graphs[0]!.graphNodes.end = {
			id: "end",
			position: [20, 0, 10],
			level: 0,
			elevationMode: "ground",
			terminal: false,
		};

		const focus = getImportedStreetFocus(result, {
			position: [100, 4, 200],
			rotationY: Math.PI / 2,
		});

		expect(focus?.center[0]).toBeCloseTo(105);
		expect(focus?.center[1]).toBeCloseTo(190);
		expect(focus?.size[0]).toBeCloseTo(10);
		expect(focus?.size[1]).toBeCloseTo(20);
	});

	test("returns null when the import has no centerline points", () => {
		expect(getImportedStreetFocus(importResult(0))).toBeNull();
	});

	test("includes mapped objects when fitting the imported scene", () => {
		const result = importResult(0);
		result.assets = [
			{
				kind: "street-lamp",
				position: [75, 0, -25],
				rotationY: 0,
				sourceId: "node/20",
			},
		];
		expect(getImportedStreetFocus(result)).toMatchObject({
			center: [75, -25],
			max: [75, -25],
			min: [75, -25],
		});
	});
});

describe("shared site-frame placement", () => {
	test("display lift is applied once to nodes, assets and designed profiles without mutating the import", () => {
		const result = importResult(1);
		result.graphs = [
			insertRoadSegment(createEmptyRoadGraph(), [-20, 2, 0], [20, 4, 0]).graph,
		];
		const edge = Object.values(result.graphs[0]!.edges)[0]!;
		edge.profileMode = "designed";
		edge.verticalProfile = [
			{ id: "profile", station: 20, elevation: 5, curveLength: 0 },
		];
		result.assets = [
			{
				kind: "street-lamp",
				sourceId: "node/lamp",
				position: [0, 3, 5],
				rotationY: 0,
			},
		];
		const before = JSON.stringify(result);
		for (let attempt = 0; attempt < 2; attempt++) {
			const ids = placeOsmImport(result, LEVEL_ID);
			const network = RoadNetworkNode.parse(useScene.getState().nodes[ids[0]!]);
			expect(
				Object.values(network.edges)[0]!.verticalProfile[0]!.elevation,
			).toBeCloseTo(5.4);
			expect(Object.values(network.graphNodes)[0]!.position[1]).toBeCloseTo(
				2.4,
			);
			const lamp = useScene.getState().nodes[ids[1]!] as unknown as {
				position: number[];
			};
			expect(lamp.position[1]).toBeCloseTo(3.4);
			const semantic = getOsmImportSceneContext(LEVEL_ID).networks.at(-1)!;
			expect(
				Object.values(semantic.edges)[0]!.verticalProfile[0]!.elevation,
			).toBeCloseTo(5);
			expect(Object.values(semantic.graphNodes)[0]!.position[1]).toBeCloseTo(2);
			expect(JSON.stringify(result)).toBe(before);
		}
		const review = reviewOsmImport(result, getOsmImportSceneContext(LEVEL_ID));
		expect(review.newSegments).toBe(0);
		expect(review.newAssets).toBe(0);
	});
	test("adjacent imports share one frame for roads, lamps, surfaces, crossings and profile heights", () => {
		const origin = { center: { lat: 60, lon: 12 }, baseElevation: 100 };
		const center = localToGeo([100, -200], origin.center);
		const existing = RoadNetworkNode.parse({
			...insertRoadSegment(createEmptyRoadGraph(), [-500, 0, 0], [-450, 0, 0])
				.graph,
			metadata: createMapImportMetadata(undefined, origin),
		});
		const result = importResult(1);
		result.source = { ...result.source, center, baseElevation: 110 };
		result.graphs = [
			insertRoadSegment(createEmptyRoadGraph(), [-20, 2, 0], [20, 4, 0]).graph,
		];
		const edge = Object.values(result.graphs[0]!.edges)[0]!;
		edge.profileMode = "designed";
		edge.verticalProfile = [
			{ id: "p", station: 20, elevation: 5, curveLength: 0 },
		];
		result.assets = [
			{
				kind: "street-lamp",
				sourceId: "node/new-lamp",
				position: [0, 3, 5],
				rotationY: 0,
			},
		];
		result.mappedSurfaces = [
			{
				id: 50,
				kind: "sidewalk",
				tags: { highway: "footway", footway: "sidewalk" },
				points: [-15, 15].map((x, index) => ({
					...localToGeo([x, 3], center),
					nodeId: index + 1,
				})),
			},
		];
		result.crossings = [
			{ id: 51, point: center, tags: { highway: "crossing" } },
		];
		const before = JSON.stringify(result);
		const reviewed = reviewOsmImport(result, {
			networks: [existing],
			featureSourceIds: new Set(),
		});
		expect(reviewed.verticalAlignment).toBe("aligned");
		const twice = reviewOsmImport(reviewed.result, {
			networks: [existing],
			featureSourceIds: new Set(),
		});
		const first = Object.values(reviewed.result.graphs[0]!.graphNodes)[0]!
			.position;
		const second = Object.values(twice.result.graphs[0]!.graphNodes)[0]!
			.position;
		for (let i = 0; i < 3; i++) expect(second[i]!).toBeCloseTo(first[i]!, 6);
		const ids = placeOsmImport(reviewed.result, LEVEL_ID, reviewed.origin);
		const placed = RoadNetworkNode.parse(useScene.getState().nodes[ids[0]!]);
		const expected = geographicToSite(center, createOsmSiteFrame(origin));
		expect(placed.osmMappedSurfaces).toHaveLength(1);
		expect(placed.osmCrossings).toHaveLength(1);
		const semantic = RoadNetworkNode.parse(
			getOsmImportSceneContext(LEVEL_ID).networks.at(-1),
		);
		expect(semantic.osmCrossings[0]!.point[1]).toBeCloseTo(
			placed.osmCrossings[0]!.point[1] - 0.4,
		);
		expect(semantic.osmMappedSurfaces[0]!.points[0]![1]).toBeCloseTo(
			placed.osmMappedSurfaces[0]!.points[0]![1] - 0.4,
		);
		expect(placed.osmCrossings[0]!.point[0]).toBeCloseTo(expected[0], 6);
		expect(placed.osmCrossings[0]!.point[2]).toBeCloseTo(expected[1], 6);
		expect(
			Object.values(placed.edges)[0]!.verticalProfile[0]!.elevation,
		).toBeCloseTo(15.4);
		expect(JSON.stringify(result)).toBe(before);
	});
	test("records unknown vertical alignment as estimated instead of applying an arbitrary absolute offset", () => {
		const result = importResult(1);
		result.graphs = [
			insertRoadSegment(createEmptyRoadGraph(), [0, 2, 0], [20, 3, 0]).graph,
		];
		Object.values(result.graphs[0]!.edges)[0]!.verticalSource = {
			kind: "terrain",
		};
		result.source.baseElevation = 100;
		result.assets = [
			{
				kind: "street-lamp",
				sourceId: "node/a",
				position: [1, 2, 3],
				rotationY: 0,
				elevationSource: "terrain",
			},
		];
		const origin = { center: { lat: 0, lon: 0 }, baseElevation: null };
		const existing = RoadNetworkNode.parse({
			...insertRoadSegment(createEmptyRoadGraph(), [-100, 0, 0], [-50, 0, 0])
				.graph,
			metadata: createMapImportMetadata(undefined, origin),
		});
		const review = reviewOsmImport(result, {
			networks: [existing],
			featureSourceIds: new Set(),
		});
		expect(review.verticalAlignment).toBe("estimated");
		expect(review.result.assets[0]!.position[1]).toBe(2);
		expect(review.result.assets[0]!.elevationSource).toBe("estimated");
		expect(
			Object.values(review.result.graphs[0]!.edges)[0]!.verticalSource?.kind,
		).toBe("estimated");
	});
});

test("review rotates mapped fixture headings with their coordinate frame", () => {
	const origin = { center: { lat: 0, lon: 0 }, baseElevation: 0 };
	const result = importResult(1);
	result.graphs = [
		insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [20, 0, 0]).graph,
	];
	result.coordinateFrame = createSiteFrame({
		...createOsmSiteFrame(origin),
		orientationRadians: Math.PI / 2,
	});
	result.assets = [
		{
			kind: "street-lamp",
			sourceId: "node/rotated",
			position: [10, 2, 0],
			rotationY: 0,
		},
	];
	const existing = RoadNetworkNode.parse({
		...insertRoadSegment(createEmptyRoadGraph(), [-100, 0, 0], [-50, 0, 0])
			.graph,
		metadata: createMapImportMetadata(undefined, origin),
	});
	const review = reviewOsmImport(result, {
		networks: [existing],
		featureSourceIds: new Set(),
	});
	expect(review.result.assets[0]!.position[0]).toBeCloseTo(0, 8);
	expect(review.result.assets[0]!.position[2]).toBeCloseTo(-10, 8);
	expect(review.result.assets[0]!.rotationY).toBeCloseTo(Math.PI / 2, 8);
});

test("import fails clearly before changing a read-only scene or missing level", () => {
	const result = importResult(1),
		original = useScene.getState().nodes;
	useScene.setState({ readOnly: true });
	expect(() => placeOsmImport(result, LEVEL_ID)).toThrow("read-only");
	expect(useScene.getState().nodes).toBe(original);
	useScene.setState({ readOnly: false });
	expect(() => placeOsmImport(result, "level_missing" as AnyNodeId)).toThrow(
		"selected level no longer exists",
	);
	expect(useScene.getState().nodes).toBe(original);
});

test.each([
	true,
	false,
])("import retains a site-owned semantic baseline and road projection in one undo (opt-in %s)", async (resolveBaseline) => {
	const site = SiteNode.parse({
			id: "site_baseline",
			children: ["building_baseline"],
		}),
		building = BuildingNode.parse({
			id: "building_baseline",
			parentId: site.id,
			children: [LEVEL_ID],
		});
	const old = useScene.getState();
	const level = LevelNode.parse({
		...old.nodes[LEVEL_ID],
		parentId: building.id,
	});
	useScene.setState({
		nodes: {
			...old.nodes,
			[site.id]: site,
			[building.id]: building,
			[LEVEL_ID]: level,
		},
		rootNodeIds: [site.id],
	});
	clearSceneHistory();
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [
			{
				id: 10,
				tags: { highway: "residential", source: "US:NY" },
				points: [
					{ nodeId: 1, lat: 0, lon: -0.0005 },
					{ nodeId: 2, lat: 0, lon: 0.0005 },
				],
			},
		],
	});
	const result = await completeOsmStreetImport({
		...prepared,
		regionalPolicy: confirmStreetRegionalPolicy(
			prepared.regionalPolicy,
			"right-driving",
		),
	});
	if (!resolveBaseline) {
		const previous = createLegacyStreetProject({
			id: "project_already-retained",
			name: "Retained",
			baselineRevisionId: "old",
			acceptedAt: "2026-10-08T09:00:00Z",
			roads: [],
		});
		const seeded = prepareStreetProjectPersistence(
			useScene.getState(),
			site.id,
			{
				project: previous,
				projection: {
					baselineRevisionId: "old",
					scenarioId: null,
					bindings: [],
				},
				expectedRevision: null,
			},
		);
		useScene
			.getState()
			.applyNodeChanges({
				update: [{ id: site.id, data: { metadata: seeded.metadata } }],
			});
	}
	const before = useScene.getState().nodes,
		count = useScene.temporal.getState().pastStates.length;
	const ids = placeOsmImport(result, LEVEL_ID, undefined, {
		resolveBaseline,
		acceptedAt: "2026-10-08T10:00:00Z",
	});
	const stored = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
	expect(stored).not.toBeNull();
	const baseline =
		stored.project.baselineRevisions[stored.project.activeBaselineRevisionId]!;
	expect(Object.values(baseline.roads)[0]!.representation).toBe(
		"resolved-street-v1",
	);
	expect(
		ResolvedStreetRoadData.parse(Object.values(baseline.roads)[0]!.data)
			.referenceLines,
	).toBeDefined();
	expect(stored.projection.bindings[0]!.nodeIds).toEqual(ids);
	expect(useScene.temporal.getState().pastStates.length - count).toBe(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
