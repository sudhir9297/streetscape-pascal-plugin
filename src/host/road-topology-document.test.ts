import { expect, test } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode } from "../schema";
import {
	createLegacyStreetProject,
	convertStreetProjectRoads,
	readResolvedCurrentRoad,
} from "../street-project-compatibility";
import { insertRoadSegment } from "../road-network-topology";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
import { prepareRoadTopologyDocument } from "./road-topology-document";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./application-change-set";
import { createStreetCommandDraft } from "./street-command-draft";
import type { StreetApplicationChangeSet } from "../domain/application-change-set";

test("crossing topology and document lineage commit together without rewriting historical evidence", () => {
	const site = SiteNode.parse({
			id: "site_topology",
			children: ["building_topology"],
		}),
		building = BuildingNode.parse({
			id: "building_topology",
			parentId: site.id,
			children: ["level_topology"],
		}),
		level = LevelNode.parse({
			id: "level_topology",
			parentId: building.id,
			children: ["road-network_topology"],
		});
	const road = RoadNetworkNode.parse({
		id: "road-network_topology",
		parentId: level.id,
		graphNodes: {
			a: { id: "a", position: [-20, 0, 0] },
			b: { id: "b", position: [20, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
	});
	useScene.setState({
		nodes: {
			[site.id]: site,
			[building.id]: building,
			[level.id]: level,
			[road.id]: road,
		} as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	const project = convertStreetProjectRoads(
		createLegacyStreetProject({
			id: "project_topology",
			name: "Topology",
			baselineRevisionId: "original",
			acceptedAt: "2026-10-08T10:00:00Z",
			roads: [road],
		}),
	);
	const stored = prepareStreetProjectPersistence(useScene.getState(), site.id, {
		project,
		projection: {
			baselineRevisionId: "original",
			scenarioId: null,
			bindings: [{ category: "roads", featureId: road.id, nodeIds: [road.id] }],
		},
		expectedRevision: null,
	});
	useScene
		.getState()
		.applyNodeChanges({
			update: [{ id: site.id, data: { metadata: stored.metadata } }],
		});
	clearSceneHistory();
	const before = useScene.getState(),
		original = before.nodes;
	const insertion = insertRoadSegment(road, [0, 0, -20], [0, 0, 20]);
	const next = RoadNetworkNode.parse({ ...road, ...insertion.graph });
	const remaps: StreetApplicationChangeSet["identityRemaps"] = [
		{
			from: { kind: "road-edge", networkId: road.id, id: "ab" },
			to: insertion.edgeIdRemap.ab!.map((id) => ({
				kind: "road-edge" as const,
				networkId: road.id,
				id,
			})),
		},
		...Object.keys(road.graphNodes).map((id) => ({
			from: { kind: "road-node" as const, networkId: road.id, id },
			to: [{ kind: "road-node" as const, networkId: road.id, id }],
		})),
	];
	const draft = createStreetCommandDraft(
		before.nodes,
		captureStreetChangePreconditions(site.id),
	);
	draft.updateNode(road.id as AnyNodeId, insertion.graph as Partial<AnyNode>);
	const prepared = prepareRoadTopologyDocument({
		before,
		after: { ...before, nodes: draft.nodes },
		siteId: site.id,
		oldNetworks: [road],
		networks: [next],
		identityRemaps: remaps,
	})!;
	expect(useScene.getState().nodes).toBe(original);
	expect(prepared.document.project.baselineRevisions.original).toEqual(
		project.baselineRevisions.original,
	);
	const baseline =
		prepared.document.project.baselineRevisions[
			prepared.document.project.activeBaselineRevisionId
		]!;
	expect(
		Object.keys(baseline.roads[road.id]!.data.sections as object),
	).toHaveLength(4);
	const oldProperties = Object.values(
		project.baselineRevisions.original!.propertyEvidence!,
	);
	expect(
		Object.values(baseline.propertyEvidence!).filter(
			(p) => p.target.path[0] === "sections",
		),
	).toHaveLength(oldProperties.length * 2);
	draft.updateNode(site.id, { metadata: prepared.metadata });
	commitHostStreetChangeSet(
		draft.finish("crossing-test", "Add crossing", [
			...remaps,
			...prepared.identityRemaps,
		]),
	);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	const document = readStreetProjectFromSite(
		useScene.getState().nodes[site.id],
	)!;
	expect(
		Object.keys(
			readResolvedCurrentRoad(
				document.project,
				document.project.activeBaselineRevisionId,
				road.id,
			).edges,
		),
	).toHaveLength(4);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(original);
});
