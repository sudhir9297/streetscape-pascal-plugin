import { test, expect } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode, RoadStylePreset } from "../schema";
import { captureLegacyStreetProject } from "./street-project-store";
import { convertStreetProjectRoads } from "../street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
import { compileProjectLaneMovements } from "../lane-movement-graph";
import { acceptLaneMovementDecision } from "./lane-movement-command";
function setup() {
	const site = SiteNode.parse({
			id: "site_movements",
			children: ["building_movements"],
		}),
		building = BuildingNode.parse({
			id: "building_movements",
			parentId: site.id,
			children: ["level_movements"],
		}),
		level = LevelNode.parse({
			id: "level_movements",
			parentId: building.id,
			children: ["road-network_movements"],
		});
	const road = RoadNetworkNode.parse({
		id: "road-network_movements",
		parentId: level.id,
		graphNodes: {
			a: { id: "a", position: [-20, 0, 0] },
			j: { id: "j", position: [0, 0, 0] },
			b: { id: "b", position: [20, 0, 0] },
		},
		edges: {
			a: { id: "a", startNodeId: "a", endNodeId: "j", styleId: "s" },
			b: { id: "b", startNodeId: "j", endNodeId: "b", styleId: "s" },
		},
		stylePresets: { s: RoadStylePreset.parse({ id: "s", name: "Road" }) },
		activeStyleId: "s",
	});
	useScene.setState({
		nodes: Object.fromEntries(
			[site, building, level, road].map((n) => [n.id, n]),
		) as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	const captured = captureLegacyStreetProject(site.id, {
			id: "lane-project",
			name: "Lane project",
			baselineRevisionId: "baseline",
			acceptedAt: "2026-10-09T00:00:00Z",
		}),
		project = convertStreetProjectRoads(captured.project);
	const persisted = prepareStreetProjectPersistence(
		useScene.getState(),
		site.id,
		{ project, projection: captured.projection, expectedRevision: null },
	);
	useScene
		.getState()
		.applyNodeChanges({
			update: [{ id: site.id, data: { metadata: persisted.metadata } }],
		});
	clearSceneHistory();
	return {
		site,
		road,
		project,
		link: compileProjectLaneMovements(project).links[0]!,
	};
}
test("lane decision creates one undo step, preserves history and survives document hydration", () => {
	const { site, road, link, project } = setup(),
		before = useScene.getState().nodes;
	acceptLaneMovementDecision({
		siteId: site.id,
		expectedRevision: project.revision,
		fromLaneId: link.fromLaneId,
		toLaneId: link.toLaneId,
		status: "accepted",
		reason: "Reviewed destination lane",
	});
	const after = useScene.getState().nodes,
		stored = readStreetProjectFromSite(after[site.id])!;
	expect(after[road.id as AnyNodeId]).toEqual(before[road.id as AnyNodeId]);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	expect(
		compileProjectLaneMovements(stored.project).links.find(
			(l) => l.id === link.id,
		)!.status,
	).toBe("accepted");
	expect(
		stored.project.baselineRevisions.baseline!.laneMovementDecisions,
	).toBeUndefined();
	const hydrated = readStreetProjectFromSite(
		JSON.parse(JSON.stringify(after[site.id])),
	)!;
	expect(compileProjectLaneMovements(hydrated.project)).toEqual(
		compileProjectLaneMovements(stored.project),
	);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
	useScene.temporal.getState().redo();
	expect(useScene.getState().nodes).toEqual(after);
	const unchanged = useScene.getState().nodes;
	expect(() =>
		acceptLaneMovementDecision({
			siteId: site.id,
			expectedRevision: project.revision,
			fromLaneId: link.fromLaneId,
			toLaneId: link.toLaneId,
			status: "rejected",
			reason: "Stale review",
		}),
	).toThrow("revision conflict");
	expect(useScene.getState().nodes).toBe(unchanged);
});
