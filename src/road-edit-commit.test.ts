import { beforeEach, expect, test } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNodeId,
	type AnyNode,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode } from "./schema";
import { createSiteFrame } from "./domain/site-frame";
import { createMapImportMetadata } from "./osm-import-deduplication";
import {
	createLegacyStreetProject,
	convertStreetProjectRoads,
	readResolvedCurrentRoad,
} from "./street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./host/street-project-persistence";
import {
	captureRoadEditPreconditions,
	prepareRoadGeometryEdit,
	commitRoadGeometryEdit,
} from "./road-edit-commit";

const site = SiteNode.parse({ id: "site_edit", children: ["building_edit"] });
const building = BuildingNode.parse({
	id: "building_edit",
	parentId: site.id,
	children: ["level_edit"],
});
const level = LevelNode.parse({
	id: "level_edit",
	parentId: building.id,
	children: ["road-network_edit"],
});
const road = RoadNetworkNode.parse({
	id: "road-network_edit",
	parentId: level.id,
	graphNodes: {
		a: { id: "a", position: [0, 0, 0] },
		b: { id: "b", position: [20, 0, 0] },
	},
	edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
});
const patch = {
	graphNodes: {
		...road.graphNodes,
		b: {
			...road.graphNodes.b!,
			position: [30, 0, 0] as [number, number, number],
		},
	},
};
beforeEach(() => {
	useScene.setState({
		nodes: Object.fromEntries(
			[site, building, level, road].map((n) => [n.id, n]),
		) as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	clearSceneHistory();
});
test("road commands prepare without writes and commit as one undo entry", () => {
	const before = useScene.getState().nodes;
	const command = prepareRoadGeometryEdit(road, patch);
	expect(command.expected.siteId).toBe(site.id);
	expect(useScene.getState().nodes).toBe(before);
	commitRoadGeometryEdit(road, patch, command.expected);
	expect(
		RoadNetworkNode.parse(useScene.getState().nodes[road.id as AnyNodeId])
			.graphNodes.b!.position,
	).toEqual([30, 0, 0]);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
test("drag preconditions prevent overwriting an edit made during the preview", () => {
	const expected = captureRoadEditPreconditions(road);
	useScene.getState().applyNodeChanges({
		update: [{ id: level.id, data: { name: "Concurrent edit" } }],
	});
	const before = useScene.getState().nodes;
	expect(() => commitRoadGeometryEdit(road, patch, expected)).toThrow(
		"Scene changed",
	);
	expect(useScene.getState().nodes).toBe(before);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
});

test("geometry and accepted document advance together while historical baseline stays immutable", () => {
	const project = convertStreetProjectRoads(
		createLegacyStreetProject({
			id: "project_edit",
			name: "Road edits",
			baselineRevisionId: "original",
			acceptedAt: "2026-10-08T10:00:00Z",
			roads: [road],
		}),
	);
	const prepared = prepareStreetProjectPersistence(
		useScene.getState(),
		site.id,
		{
			project,
			projection: {
				baselineRevisionId: "original",
				scenarioId: null,
				bindings: [
					{ category: "roads", featureId: road.id, nodeIds: [road.id] },
				],
			},
			expectedRevision: null,
		},
	);
	useScene.getState().applyNodeChanges({
		update: [{ id: site.id, data: { metadata: prepared.metadata } }],
	});
	clearSceneHistory();
	const before = useScene.getState().nodes;
	const command = prepareRoadGeometryEdit(road, patch);
	expect(useScene.getState().nodes).toBe(before);
	expect(command.update).toHaveLength(2);
	commitRoadGeometryEdit(road, patch, command.expected);
	const stored = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
	expect(stored.project.revision).toBe(project.revision + 1);
	expect(stored.project.baselineRevisions.original).toEqual(
		project.baselineRevisions.original,
	);
	const resolved = readResolvedCurrentRoad(
		stored.project,
		stored.project.activeBaselineRevisionId,
		road.id,
	);
	expect(resolved.graphNodes.b!.position).toEqual([30, 0, 0]);
	expect(
		Object.values(
			stored.project.baselineRevisions[stored.project.activeBaselineRevisionId]!
				.propertyEvidence!,
		).some(
			(p) =>
				p.target.path.join("/") === "referenceNodes/b/position" &&
				p.accepted.kind === "claim" &&
				p.claims[p.accepted.claimId]!.origin.kind === "authored",
		),
	).toBe(true);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});

test("georeferenced geometry edits keep host display lift out of accepted site heights", () => {
	const frame = createSiteFrame({
		id: "edit-frame",
		origin: { lat: 0, lon: 0 },
	});
	const project = convertStreetProjectRoads(
		createLegacyStreetProject({
			id: "project_lift",
			name: "Display lift",
			baselineRevisionId: "original",
			acceptedAt: "2026-10-08T10:00:00Z",
			roads: [road],
		}),
	);
	project.siteFrames[frame.id] = frame;
	project.siteFrameId = frame.id;
	project.baselineRevisions.original!.roads[road.id]!.data.coordinateFrameId =
		frame.id;
	const projected = RoadNetworkNode.parse({
		...road,
		metadata: createMapImportMetadata(
			undefined,
			{ center: { lat: 0, lon: 0 }, baseElevation: 0 },
			0.4,
		),
		graphNodes: {
			a: { ...road.graphNodes.a, position: [0, 0.4, 0] },
			b: { ...road.graphNodes.b, position: [20, 0.4, 0] },
		},
	});
	useScene.getState().applyNodeChanges({
		update: [
			{
				id: road.id as AnyNodeId,
				data: projected as unknown as Partial<AnyNode>,
			},
		],
	});
	const stored = prepareStreetProjectPersistence(useScene.getState(), site.id, {
		project,
		projection: {
			baselineRevisionId: "original",
			scenarioId: null,
			bindings: [{ category: "roads", featureId: road.id, nodeIds: [road.id] }],
		},
		expectedRevision: null,
	});
	useScene.getState().applyNodeChanges({
		update: [{ id: site.id, data: { metadata: stored.metadata } }],
	});
	clearSceneHistory();
	commitRoadGeometryEdit(projected, {
		graphNodes: {
			...projected.graphNodes,
			b: { ...projected.graphNodes.b!, position: [30, 2.4, 0] },
		},
	});
	const accepted = readStreetProjectFromSite(
		useScene.getState().nodes[site.id],
	)!;
	expect(
		readResolvedCurrentRoad(
			accepted.project,
			accepted.project.activeBaselineRevisionId,
			road.id,
		).graphNodes.b!.position,
	).toEqual([30, 2, 0]);
	expect(
		RoadNetworkNode.parse(useScene.getState().nodes[road.id as AnyNodeId])
			.graphNodes.b!.position,
	).toEqual([30, 2.4, 0]);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
});

import {
	prepareBaselineRoadCorrection,
	commitBaselineRoadCorrection,
} from "./baseline-road-correction";
import {
	editRoadEdgeRoadway,
	editRoadEdgeSide,
} from "./road-network-style-editing";
function installCorrectionBaseline(scenario = false) {
	const project = convertStreetProjectRoads(
		createLegacyStreetProject({
			id: "project_edit",
			name: "Corrections",
			baselineRevisionId: "original",
			acceptedAt: "2026-10-08T10:00:00Z",
			roads: [road],
		}),
	);
	if (scenario) {
		project.scenarios.proposal = {
			id: "proposal",
			name: "Proposal",
			baselineRevisionId: project.activeBaselineRevisionId,
			overrides: {},
		};
		project.activeScenarioId = "proposal";
	}
	const saved = prepareStreetProjectPersistence(useScene.getState(), site.id, {
		project,
		projection: {
			baselineRevisionId: project.activeBaselineRevisionId,
			scenarioId: project.activeScenarioId,
			bindings: [{ category: "roads", featureId: road.id, nodeIds: [road.id] }],
		},
		expectedRevision: null,
	});
	useScene.getState().applyNodeChanges({
		update: [{ id: site.id, data: { metadata: saved.metadata } }],
	});
	clearSceneHistory();
	return project;
}
test("explicit baseline correction preserves history, records measurements, styles and alignment atomically", () => {
	const original = installCorrectionBaseline();
	const lane = editRoadEdgeRoadway(road, "ab", "laneWidth", 4)!;
	const draft = RoadNetworkNode.parse({ ...road, ...lane });
	const side = editRoadEdgeSide(draft, "ab", "left", "sidewalkWidth", 0)!;
	const command = prepareBaselineRoadCorrection(
		road,
		{ ...lane, ...side, ...patch },
		{
			reason: "Surveyed street correction",
			observations: [
				{
					id: "survey",
					description: "Measured lane and absent sidewalk",
					observedAt: null,
					sourceReferenceId: null,
					sourceFeatureId: null,
					referenceUri: null,
				},
			],
			observationIds: [],
		},
	);
	const before = useScene.getState().nodes;
	expect(useScene.getState().nodes).toBe(before);
	commitBaselineRoadCorrection(command);
	const saved = readStreetProjectFromSite(
		useScene.getState().nodes[site.id],
	)!.project;
	expect(saved.baselineRevisions.original).toEqual(
		original.baselineRevisions.original,
	);
	expect(saved.activeBaselineRevisionId).toContain(":correction:");
	expect(saved.observations!.survey!.description).toContain("Measured");
	const baseline = saved.baselineRevisions[saved.activeBaselineRevisionId]!;
	expect(
		Object.values(baseline.propertyEvidence!).some(
			(p) =>
				p.accepted.kind === "correction" &&
				p.accepted.reason === "Surveyed street correction" &&
				p.accepted.observationIds.includes("survey"),
		),
	).toBe(true);
	const resolved = readResolvedCurrentRoad(saved, baseline.id, road.id);
	const style = resolved.stylePresets[resolved.edges.ab!.styleId]!;
	expect(resolved.applyStyleToAll).toBe(false);
	expect(style.laneWidth).toBe(4);
	expect(style.leftSide!.sidewalkWidth).toBe(0);
	expect(resolved.graphNodes.b!.position).toEqual([30, 0, 0]);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
test("correction rejects active scenarios, missing observations and topology edits without writes", () => {
	installCorrectionBaseline(true);
	const before = useScene.getState().nodes;
	expect(() =>
		prepareBaselineRoadCorrection(road, patch, {
			reason: "Correction",
			observations: [],
			observationIds: [],
		}),
	).toThrow("baseline");
	expect(useScene.getState().nodes).toBe(before);
});

test("baseline material and junction corrections retain new-target observation provenance", () => {
	installCorrectionBaseline();
	const node = RoadNetworkNode.parse({
		...road,
		junctions: { b: { nodeId: "b", kind: "tee", treatment: "auto" } },
	});
	useScene.setState({
		nodes: {
			...useScene.getState().nodes,
			[road.id]: node as unknown as AnyNode,
		},
	});
	clearSceneHistory();
	const update = prepareBaselineRoadCorrection(
		node,
		{
			stylePresets: {
				...node.stylePresets,
				"local-street": {
					...node.stylePresets["local-street"]!,
					surfaceMaterial: "concrete",
				},
			},
			junctions: {
				...node.junctions,
				b: { ...node.junctions.b!, treatment: "stop" },
			},
		},
		{
			reason: "Observed concrete and stop control",
			observations: [
				{
					id: "junction-survey",
					description: "Site visit confirmed concrete and stop control",
					observedAt: null,
					sourceReferenceId: null,
					sourceFeatureId: null,
					referenceUri: null,
				},
			],
			observationIds: [],
		},
	);
	commitBaselineRoadCorrection(update);
	const saved = readStreetProjectFromSite(
		useScene.getState().nodes[site.id],
	)!.project;
	const baseline = saved.baselineRevisions[saved.activeBaselineRevisionId]!;
	const properties = Object.values(baseline.propertyEvidence!);
	expect(
		properties.some(
			(p) =>
				p.target.path.includes("junctions") &&
				p.accepted.kind === "correction" &&
				p.accepted.observationIds.includes("junction-survey"),
		),
	).toBe(true);
	expect(
		properties.some(
			(p) =>
				p.target.path.at(-1) === "surfaceMaterial" &&
				p.accepted.kind === "correction" &&
				p.accepted.value === "concrete",
		),
	).toBe(true);
});
test("baseline correction rejects unknown observations and removed topology atomically", () => {
	installCorrectionBaseline();
	const before = useScene.getState().nodes;
	expect(() =>
		prepareBaselineRoadCorrection(road, patch, {
			reason: "Correct alignment",
			observations: [],
			observationIds: ["missing"],
		}),
	).toThrow("observation");
	expect(() =>
		prepareBaselineRoadCorrection(
			road,
			{ edges: {} },
			{ reason: "Remove road", observations: [], observationIds: [] },
		),
	).toThrow("topology");
	expect(useScene.getState().nodes).toBe(before);
	expect(useScene.temporal.getState().pastStates).toHaveLength(0);
});
