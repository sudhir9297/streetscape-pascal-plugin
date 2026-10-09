import { expect, test } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode, StreetLightNode } from "./schema";
import {
	prepareRoadEdgeDeletion,
	commitRoadEdgeDeletion,
} from "./road-edge-delete-command";
import { captureLegacyStreetProject } from "./host/street-project-store";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./host/street-project-persistence";
import {
	convertStreetProjectRoads,
	readResolvedCurrentRoad,
} from "./street-project-compatibility";

test("deleting a bridge edge splits scene and accepted ownership while retaining adjusted and detached assets", () => {
	const site = SiteNode.parse({
			id: "site_delete",
			children: ["building_delete"],
		}),
		building = BuildingNode.parse({
			id: "building_delete",
			parentId: site.id,
			children: ["level_delete"],
		}),
		level = LevelNode.parse({
			id: "level_delete",
			parentId: building.id,
			children: [
				"road-network_delete",
				"street-light_removed",
				"street-light_adjusted",
			],
		});
	const road = RoadNetworkNode.parse({
		id: "road-network_delete",
		parentId: level.id,
		graphNodes: Object.fromEntries(
			["a", "b", "c", "d"].map((id, i) => [
				id,
				{ id, position: [i * 10, 0, 0] },
			]),
		),
		edges: {
			ab: { id: "ab", startNodeId: "a", endNodeId: "b" },
			bc: { id: "bc", startNodeId: "b", endNodeId: "c" },
			cd: { id: "cd", startNodeId: "c", endNodeId: "d" },
		},
		attachments: {
			removed: {
				id: "removed",
				edgeId: "bc",
				assetNodeId: "street-light_removed",
				station: 5,
				lateralOffset: 4,
			},
			adjusted: {
				id: "adjusted",
				edgeId: "cd",
				assetNodeId: "street-light_adjusted",
				station: 5,
				lateralOffset: 4,
				placementMode: "adjusted",
			},
		},
	});
	const detached = StreetLightNode.parse({
			id: "street-light_removed",
			parentId: level.id,
			position: [15, 0, 4],
			roadAttachment: { networkNodeId: road.id, attachmentId: "removed" },
		}),
		adjusted = StreetLightNode.parse({
			id: "street-light_adjusted",
			parentId: level.id,
			position: [25, 0, 4],
			roadAttachment: { networkNodeId: road.id, attachmentId: "adjusted" },
		});
	useScene.setState({
		nodes: Object.fromEntries(
			[site, building, level, road, detached, adjusted].map((node) => [
				node.id,
				node,
			]),
		) as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	const captured = captureLegacyStreetProject(site.id, {
		id: "project_delete",
		name: "Deletion",
		baselineRevisionId: "original",
		acceptedAt: "2026-10-08T10:00:00Z",
	});
	const project = convertStreetProjectRoads(captured.project),
		stored = prepareStreetProjectPersistence(useScene.getState(), site.id, {
			project,
			projection: captured.projection,
			expectedRevision: null,
		});
	useScene
		.getState()
		.applyNodeChanges({
			update: [{ id: site.id, data: { metadata: stored.metadata } }],
		});
	clearSceneHistory();
	const before = useScene.getState().nodes;
	const plan = prepareRoadEdgeDeletion(road, "bc")!;
	expect(useScene.getState().nodes).toBe(before);
	expect(plan.create).toHaveLength(1);
	commitRoadEdgeDeletion(road, "bc");
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	const state = useScene.getState(),
		networks = Object.values(state.nodes)
			.filter((n) => (n.type as string) === "streetscape:road-network")
			.map((n) => RoadNetworkNode.parse(n));
	expect(networks).toHaveLength(2);
	expect(networks.flatMap((n) => Object.keys(n.edges)).sort()).toEqual([
		"ab",
		"cd",
	]);
	expect(
		StreetLightNode.parse(state.nodes[detached.id as AnyNodeId]).roadAttachment,
	).toBeUndefined();
	expect(
		StreetLightNode.parse(state.nodes[detached.id as AnyNodeId]).position,
	).toEqual([15, 0, 4]);
	const owner = networks.find((n) => n.attachments.adjusted)!;
	expect(owner.attachments.adjusted!.placementMode).toBe("adjusted");
	expect(owner.attachments.adjusted!.station).toBe(5);
	expect(
		StreetLightNode.parse(state.nodes[adjusted.id as AnyNodeId]).roadAttachment!
			.networkNodeId,
	).toBe(owner.id);
	const document = readStreetProjectFromSite(state.nodes[site.id])!;
	expect(document.project.baselineRevisions.original).toEqual(
		project.baselineRevisions.original,
	);
	expect(
		document.projection.bindings.filter((b) => b.category === "roads"),
	).toHaveLength(2);
	for (const binding of document.projection.bindings.filter(
		(b) => b.category === "roads",
	))
		expect(
			Object.keys(
				readResolvedCurrentRoad(
					document.project,
					document.project.activeBaselineRevisionId,
					binding.featureId,
				).edges,
			),
		).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
