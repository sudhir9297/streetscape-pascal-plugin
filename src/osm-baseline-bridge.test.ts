import { expect, test } from "bun:test";
import { RoadNetworkNode } from "./schema";
import {
	createLegacyStreetProject,
	convertStreetProjectRoads,
	readCurrentRoad,
	readResolvedCurrentRoad,
} from "./street-project-compatibility";
import { createOsmSourceSnapshot } from "./source/osm-source-snapshot";
import { parseOsmAcquisition } from "./source/osm-acquisition";
import {
	resolveOsmSnapshotBaseline,
	createImportedStreetProject,
	readImportedBaselineNetworks,
} from "./osm-baseline-bridge";
import { prepareOsmStreetImport, completeOsmStreetImport } from "./osm-import";
import { confirmStreetRegionalPolicy } from "./domain/street-sections";
import { parseStreetProject } from "./domain/street-project";
import { ResolvedStreetRoadData } from "./domain/resolved-street-road";
const acceptedAt = "2026-10-08T10:00:00Z";

test("dense connected imports keep compact deterministic component and evidence identities", async () => {
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 250, {
		loadTerrain: false,
		loadStreets: async () => Array.from({ length: 50 }, (_, i) => ({
			id: 1000000000 + i,
			tags: { highway: "residential" },
			points: [
				{ nodeId: i + 1, lat: 0, lon: -0.001 + i * 0.00004 },
				{ nodeId: i + 2, lat: 0, lon: -0.001 + (i + 1) * 0.00004 },
			],
		})),
	});
	prepared.regionalPolicy = confirmStreetRegionalPolicy(prepared.regionalPolicy, "right-driving");
	const result = await completeOsmStreetImport(prepared);
	const project = createImportedStreetProject(result, { acceptedAt });
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	expect(Object.keys(baseline.roads)).toHaveLength(1);
	const road = Object.values(baseline.roads)[0]!;
	expect(Object.keys(road.data.referenceLines as object)).toHaveLength(50);
	expect(road.id.length).toBeLessThan(200);
	expect(JSON.stringify(baseline.propertyEvidence).length).toBeLessThan(2_000_000);
	expect(createImportedStreetProject(result, { acceptedAt })).toEqual(project);
});
function network() {
	return RoadNetworkNode.parse({
		id: "road-network_preserved",
		parentId: "level_legacy",
		name: "Authored geometry",
		graphNodes: {
			a: { id: "a", position: [0, 1, 0] },
			b: { id: "b", position: [20, 2, 0] },
			c: { id: "c", position: [40, 1, 0] },
		},
		edges: {
			ab: {
				id: "ab",
				startNodeId: "a",
				endNodeId: "b",
				styleId: "local-street",
				alignment: [[10, 1.5, 3]],
			},
			bc: {
				id: "bc",
				startNodeId: "b",
				endNodeId: "c",
				styleId: "local-street",
			},
		},
		attachments: {
			lamp: {
				id: "lamp",
				edgeId: "ab",
				assetNodeId: "street-light_preserved",
				kind: "lamp",
				station: 4,
				lateralOffset: 6,
				placementMode: "adjusted",
			},
		},
		roadsideItemSuppressed: { keep: true },
		metadata: { authored: "keep" },
	});
}
function legacy() {
	return createLegacyStreetProject({
		id: "legacy",
		name: "Legacy",
		baselineRevisionId: "b",
		acceptedAt,
		roads: [network()],
	});
}

test("semantic conversion preserves authored geometry, styles, attachments and settings without fake source claims", () => {
	const input = legacy(),
		before = JSON.stringify(input),
		project = convertStreetProjectRoads(input),
		road = project.baselineRevisions.b!.roads[network().id]!;
	expect(road.representation).toBe("resolved-street-v1");
	expect(ResolvedStreetRoadData.parse(road.data).coordinateFrameId).toBeNull();
	expect(JSON.parse(JSON.stringify(readCurrentRoad(road)))).toEqual(
		JSON.parse(JSON.stringify(network())),
	);
	expect(project.sourceReferences).toEqual({});
	expect(
		Object.values(project.baselineRevisions.b!.propertyEvidence!).every((p) =>
			Object.values(p.claims).every((c) => c.origin.kind === "legacy-authored"),
		),
	).toBe(true);
	expect(JSON.stringify(input)).toBe(before);
	expect(convertStreetProjectRoads(project)).toEqual(project);
});

test("existing claims and scenario overrides migrate to every section sharing an authored style", () => {
	const input = legacy();
	input.baselineRevisions.b!.propertyEvidence = {
		width: {
			id: "width",
			target: {
				category: "roads",
				featureId: network().id,
				path: ["stylePresets", "local-street", "laneWidth"],
			},
			units: "metres",
			claims: {
				original: {
					id: "original",
					value: 3.25,
					origin: { kind: "legacy-authored" },
				},
			},
			rejectedClaims: [],
			accepted: { kind: "claim", claimId: "original" },
		},
	};
	input.scenarios.design = {
		id: "design",
		name: "Wider lanes",
		baselineRevisionId: "b",
		overrides: {
			width: { value: 3.8, reason: "Proposal", authoredAt: acceptedAt },
		},
	};
	const project = convertStreetProjectRoads(input),
		baseline = readResolvedCurrentRoad(project, "b", network().id),
		design = readResolvedCurrentRoad(project, "b", network().id, "design");
	expect(
		Object.keys(project.baselineRevisions.b!.propertyEvidence!),
	).toHaveLength(2);
	for (const edge of Object.values(baseline.edges))
		expect(baseline.stylePresets[edge.styleId]!.laneWidth).toBe(3.25);
	for (const edge of Object.values(design.edges))
		expect(design.stylePresets[edge.styleId]!.laneWidth).toBe(3.8);
	expect(design.attachments).toEqual(network().attachments);
	expect(input.scenarios.design.overrides).toHaveProperty("width");
});

test("Gate G1 replays one snapshot twice offline with identical identity, values and diagnostics", async () => {
	const capture = parseOsmAcquisition(
		await Bun.file(
			new URL("../docs/fixtures/osm-acquisition-v1.json", import.meta.url),
		).json(),
	);
	const snapshot = await createOsmSourceSnapshot(capture),
		before = JSON.stringify(snapshot),
		originalFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = Object.assign(
		async () => {
			requests++;
			throw Error("Offline replay attempted acquisition");
		},
		{ preconnect: originalFetch.preconnect },
	);
	try {
		const input = {
			snapshot,
			center: { lat: 0, lon: 0 },
			radiusMeters: 300,
			policy: confirmStreetRegionalPolicy(
				{
					id: "right-driving",
					version: 1,
					status: "proposed",
					basis: "fallback",
					evidence: null,
				},
				"right-driving",
			),
			acceptedAt,
		};
		const a = await resolveOsmSnapshotBaseline(input),
			b = await resolveOsmSnapshotBaseline(input);
		expect(a).toEqual(b);
		expect(requests).toBe(0);
		expect(JSON.stringify(snapshot)).toBe(before);
		expect(parseStreetProject(JSON.stringify(a))).toEqual(a);
		const baseline = a.baselineRevisions[a.activeBaselineRevisionId]!;
		expect(
			Object.values(baseline.roads).every(
				(r) => r.representation === "resolved-street-v1",
			),
		).toBe(true);
		expect(Object.values(baseline.roads)[0]!.data.referenceLines).toBeDefined();
		expect(baseline.diagnostics!.status).toBe("review-required");
		expect(
			baseline.diagnostics!.items.some(
				(item) =>
					item.severity === "review" &&
					item.property === "leftSidewalkPresence",
			),
		).toBe(true);
		const source = Object.values(a.sourceReferences)[0]!;
		expect(source.snapshot.status).toBe("embedded");
		expect(JSON.stringify(source.snapshot)).toContain("US:NY");
		const nodes = readImportedBaselineNetworks(a);
		expect(nodes[0]!.network.edges).toBeDefined();
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("experimental import blocks an unconfirmed policy and sparse data retains explicit estimates", async () => {
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [
			{
				id: 10,
				tags: { highway: "residential", width: "2" },
				points: [
					{ nodeId: 1, lat: 0, lon: -0.0005 },
					{ nodeId: 2, lat: 0, lon: 0.0005 },
				],
			},
		],
	});
	const unresolved = await completeOsmStreetImport(prepared);
	expect(() => createImportedStreetProject(unresolved, { acceptedAt })).toThrow(
		"Confirm",
	);
	const result = await completeOsmStreetImport({
			...prepared,
			regionalPolicy: confirmStreetRegionalPolicy(
				prepared.regionalPolicy,
				"left-driving",
			),
		}),
		project = createImportedStreetProject(result, { acceptedAt }),
		baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	expect(
		baseline.diagnostics!.items.find((item) => item.property === "laneWidth")!
			.evidence,
	).toHaveProperty("rawClaims.width", "2");
	const data = ResolvedStreetRoadData.parse(
		Object.values(baseline.roads)[0]!.data,
	);
	expect(
		Object.values(data.sections)[0]!.values.leftSidewalkPresence,
	).toHaveProperty("value", null);
	const width = Object.values(baseline.propertyEvidence!).find(
		(p) => p.target.path.at(-1) === "laneWidth",
	)!;
	expect(Object.values(width.claims)[0]!.origin.kind).toBe("inferred");
	expect(Object.values(project.sourceReferences)[0]!.snapshot.status).toBe(
		"unavailable",
	);
	const malformed = structuredClone(project);
	const road = Object.values(
		malformed.baselineRevisions["baseline-1"]!.roads,
	)[0]!;
	road.data.coordinateFrameId = "missing";
	expect(() => parseStreetProject(malformed)).toThrow("Road coordinate frame");
});

test("accepted individual sidewalk widths retain mapped and estimated provenance without overlapping targets", async () => {
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [
			{
				id: 10,
				tags: {
					highway: "residential",
					width: "6",
					lanes: "2",
					"sidewalk:left": "yes",
					"sidewalk:left:width": "2",
				},
				points: [
					{ nodeId: 1, lat: 0, lon: -0.0005 },
					{ nodeId: 2, lat: 0, lon: 0.0005 },
				],
			},
		],
	});
	prepared.regionalPolicy = confirmStreetRegionalPolicy(
		prepared.regionalPolicy,
		"right-driving",
	);
	const result = await completeOsmStreetImport(prepared);
	const project = createImportedStreetProject(result, { acceptedAt });
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const properties = Object.values(baseline.propertyEvidence!);
	const left = properties.find(
		(p) => p.target.path.slice(-2).join("/") === "leftSide/sidewalkWidth",
	)!;
	const right = properties.find(
		(p) => p.target.path.slice(-2).join("/") === "rightSide/sidewalkWidth",
	)!;
	expect(Object.values(left.claims)[0]!.origin.kind).toBe("source");
	expect(Object.values(left.claims)[0]!.value).toBe(2);
	expect(Object.values(right.claims)[0]!.origin.kind).toBe("inferred");
	expect(Object.values(right.claims)[0]!.value).toBe(1.8);
	expect(parseStreetProject(JSON.parse(JSON.stringify(project)))).toEqual(
		project,
	);
	expect(
		readImportedBaselineNetworks(project)[0]!.network.stylePresets,
	).toBeDefined();
});
