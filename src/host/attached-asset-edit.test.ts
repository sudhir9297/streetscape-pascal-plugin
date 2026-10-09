import { test, expect } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode, StreetLightNode } from "../schema";
import { captureLegacyStreetProject } from "./street-project-store";
import { convertStreetProjectRoads } from "../street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
import { prepareAttachedAssetEdits } from "./attached-asset-edit";
import { commitHostStreetChangeSet } from "./application-change-set";

function fixture() {
	const site = SiteNode.parse({
		id: "site_asset-batch",
		children: ["building_asset-batch"],
	});
	const building = BuildingNode.parse({
		id: "building_asset-batch",
		parentId: site.id,
		children: ["level_asset-batch"],
	});
	const level = LevelNode.parse({
		id: "level_asset-batch",
		parentId: building.id,
		children: [
			"road-network_asset-batch",
			"street-light_batch-a",
			"street-light_batch-b",
		],
	});
	const road = RoadNetworkNode.parse({
		id: "road-network_asset-batch",
		parentId: level.id,
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [30, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
		attachments: Object.fromEntries(
			["a", "b"].map((id, i) => [
				id,
				{
					id,
					edgeId: "ab",
					assetNodeId: `street-light_batch-${id}`,
					station: 5 + i * 10,
					lateralOffset: 4,
				},
			]),
		),
	});
	const assets = ["a", "b"].map((id, i) =>
		StreetLightNode.parse({
			id: `street-light_batch-${id}`,
			parentId: level.id,
			position: [5 + i * 10, 0, 4],
			roadAttachment: { networkNodeId: road.id, attachmentId: id },
		}),
	);
	useScene.setState({
		nodes: Object.fromEntries(
			[site, building, level, road, ...assets].map((n) => [n.id, n]),
		) as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	const captured = captureLegacyStreetProject(site.id, {
		id: "asset-batch-project",
		name: "Asset batch",
		baselineRevisionId: "original",
		acceptedAt: "2026-10-08T12:00:00Z",
	});
	const project = convertStreetProjectRoads(captured.project);
	const stored = prepareStreetProjectPersistence(useScene.getState(), site.id, {
		project,
		projection: captured.projection,
		expectedRevision: null,
	});
	useScene.getState().applyNodeChanges({
		update: [{ id: site.id, data: { metadata: stored.metadata } }],
	});
	clearSceneHistory();
	return { site, road, assets, project };
}

test("multi-asset gesture accepts one document revision and one undo action", () => {
	const { site, road, assets, project } = fixture();
	const before = useScene.getState().nodes;
	const changes = assets.map((a, i) => ({
		id: a.id as AnyNodeId,
		data: { position: [8 + i * 10, 2, 6] } as Partial<AnyNode>,
	}));
	const planned = prepareAttachedAssetEdits(changes);
	expect(useScene.getState().nodes).toBe(before);
	commitHostStreetChangeSet(planned);
	const after = useScene.getState();
	const anchors = (
		after.nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode
	).attachments;
	expect(anchors.a!.placementMode).toBe("adjusted");
	expect(anchors.b!.placementMode).toBe("adjusted");
	expect(anchors.a!.station).toBeCloseTo(8);
	expect(anchors.b!.station).toBeCloseTo(18);
	const doc = readStreetProjectFromSite(after.nodes[site.id])!;
	expect(doc.project.revision).toBe(project.revision + 1);
	expect(doc.project.baselineRevisions.original).toEqual(
		project.baselineRevisions.original,
	);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});

test("repeated pending edits merge before reanchoring and invalid batches never write", () => {
	const { assets } = fixture();
	const before = useScene.getState().nodes;
	const id = assets[0]!.id as AnyNodeId;
	const planned = prepareAttachedAssetEdits([
		{ id, data: { position: [9, 2, 6] } as Partial<AnyNode> },
		{ id, data: { rotation: [0, 0.7, 0] } as Partial<AnyNode> },
	]);
	const update = planned.update.find((op) => op.id === id)!;
	expect(update.data.position).toEqual([9, 2, 6]);
	expect(update.data.rotation).toEqual([0, 0.7, 0]);
	expect(() =>
		prepareAttachedAssetEdits([
			{ id: "street-light_missing" as AnyNodeId, data: {} },
		]),
	).toThrow("Missing edited asset");
	expect(useScene.getState().nodes).toBe(before);
	expect(useScene.temporal.getState().pastStates).toHaveLength(0);
});

test("host adapter intercepts updateNode, updateNodes and update batches without recursive commands", async () => {
	const { installAttachedAssetHostAdapter } = await import(
		"./attached-asset-host-adapter"
	);
	for (const method of [
		"updateNode",
		"updateNodes",
		"applyNodeChanges",
	] as const) {
		const { assets, site, project } = fixture();
		const before = useScene.getState().nodes;
		const dispose = installAttachedAssetHostAdapter();
		try {
			expect(installAttachedAssetHostAdapter()).toBe(dispose);
			const update = {
				id: assets[0]!.id as AnyNodeId,
				data: { position: [9, 2, 6] } as Partial<AnyNode>,
			};
			const state = useScene.getState();
			if (method === "updateNode") state.updateNode(update.id, update.data);
			else if (method === "updateNodes") state.updateNodes([update]);
			else state.applyNodeChanges({ update: [update] });
			expect(
				(
					useScene.getState().nodes[update.id] as unknown as {
						position: number[];
					}
				).position,
			).toEqual([9, 2, 6]);
			expect(
				readStreetProjectFromSite(useScene.getState().nodes[site.id])!.project
					.revision,
			).toBe(project.revision + 1);
			expect(useScene.temporal.getState().pastStates).toHaveLength(1);
			useScene.temporal.getState().undo();
			expect(useScene.getState().nodes).toEqual(before);
		} finally {
			dispose();
		}
	}
});

test("generic host road edits split disconnected ownership in the same action", async () => {
	const { installAttachedAssetHostAdapter } = await import(
		"./attached-asset-host-adapter"
	);
	const { road, site, project } = fixture();
	const before = useScene.getState().nodes;
	const dispose = installAttachedAssetHostAdapter();
	try {
		useScene.getState().updateNode(
			road.id as AnyNodeId,
			{
				graphNodes: {
					...road.graphNodes,
					c: { id: "c", position: [40, 0, 0] },
					d: { id: "d", position: [60, 0, 0] },
				},
				edges: {
					...road.edges,
					cd: { id: "cd", startNodeId: "c", endNodeId: "d" },
				},
			} as Partial<AnyNode>,
		);
		const state = useScene.getState();
		const roads = Object.values(state.nodes).filter(
			(n) => (n.type as string) === "streetscape:road-network",
		);
		expect(roads).toHaveLength(2);
		expect(
			readStreetProjectFromSite(
				state.nodes[site.id],
			)!.projection.bindings.filter((b) => b.category === "roads"),
		).toHaveLength(2);
		expect(
			readStreetProjectFromSite(state.nodes[site.id])!.project.revision,
		).toBe(project.revision + 1);
		expect(useScene.temporal.getState().pastStates).toHaveLength(1);
		useScene.temporal.getState().undo();
		expect(useScene.getState().nodes).toEqual(before);
	} finally {
		dispose();
	}
});

test("host placement batches create assets and anchors atomically", async () => {
	const { installAttachedAssetHostAdapter } = await import(
		"./attached-asset-host-adapter"
	);
	const { road, assets, site } = fixture();
	const before = useScene.getState().nodes;
	const added = StreetLightNode.parse({
		...assets[0],
		id: "street-light_batch-created",
		roadAttachment: { networkNodeId: road.id, attachmentId: "added" },
	});
	const dispose = installAttachedAssetHostAdapter();
	try {
		useScene.getState().applyNodeChanges({
			create: [
				{
					node: added as unknown as AnyNode,
					parentId: added.parentId as AnyNodeId,
				},
			],
			update: [
				{
					id: road.id as AnyNodeId,
					data: {
						attachments: {
							...road.attachments,
							added: {
								...road.attachments.a,
								id: "added",
								assetNodeId: added.id,
							},
						},
					} as Partial<AnyNode>,
				},
			],
		});
		expect(useScene.getState().nodes[added.id as AnyNodeId]).toBeDefined();
		expect(
			readStreetProjectFromSite(
				useScene.getState().nodes[site.id],
			)!.projection.bindings.some((b) => b.nodeIds.includes(added.id)),
		).toBe(true);
		expect(useScene.temporal.getState().pastStates).toHaveLength(1);
		useScene.temporal.getState().undo();
		expect(useScene.getState().nodes).toEqual(before);
	} finally {
		dispose();
	}
});

test("ordinary host deletion persists generated suppression and undo restores the fixture", async () => {
	const { installAttachedAssetHostAdapter } = await import(
		"./attached-asset-host-adapter"
	);
	const { generatedSlotIdentity } = await import(
		"../domain/generated-item-history"
	);
	const { site, road, assets } = fixture();
	const asset = assets[0]!;
	const key = generatedSlotIdentity(
		"regular-lighting",
		"ab",
		"right",
		"none-0",
	);
	useScene.getState().applyNodeChanges({
		update: [
			{
				id: asset.id as AnyNodeId,
				data: {
					metadata: {
						generatedBy: "road-auto-infrastructure",
						roadAutoInfrastructureKey: key,
						roadNetworkId: road.id,
					},
				},
			},
		],
	});
	clearSceneHistory();
	const before = useScene.getState().nodes;
	const dispose = installAttachedAssetHostAdapter();
	try {
		useScene
			.getState()
			.updateNode(asset.id as AnyNodeId, { position: [9, 0, 6] });
		const live = useScene.getState().nodes[
			road.id as AnyNodeId
		] as unknown as RoadNetworkNode;
		expect(live.generatedItemHistory[key]!.status).toBe("accepted");
		expect(live.generatedItemHistory[key]!.position).toEqual([9, 0, 6]);
		clearSceneHistory();
		const moved = useScene.getState().nodes;
		useScene.getState().deleteNode(asset.id as AnyNodeId);
		expect(useScene.getState().nodes[asset.id as AnyNodeId]).toBeUndefined();
		const suppressed = useScene.getState().nodes[
			road.id as AnyNodeId
		] as unknown as RoadNetworkNode;
		expect(suppressed.generatedItemHistory[key]!.status).toBe("suppressed");
		const persisted = readStreetProjectFromSite(
			useScene.getState().nodes[site.id],
		)!;
		expect(JSON.stringify(persisted.project)).toContain(
			'"status":"suppressed"',
		);
		const savedNodes = JSON.parse(JSON.stringify(useScene.getState().nodes));
		const reopened = readStreetProjectFromSite(savedNodes[site.id])!;
		expect(reopened.project).toEqual(persisted.project);
		expect(savedNodes[road.id].generatedItemHistory[key].status).toBe(
			"suppressed",
		);
		expect(useScene.temporal.getState().pastStates).toHaveLength(1);
		useScene.temporal.getState().undo();
		expect(useScene.getState().nodes).toEqual(moved);
	} finally {
		dispose();
	}
	expect(before[asset.id as AnyNodeId]).toBeDefined();
});
