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
import { acceptStreetSourceMerge } from "./street-source-merge-command";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
function fixture(attached: boolean) {
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
		attachments: !attached
			? {}
			: Object.fromEntries(
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
			roadAttachment: attached
				? { networkNodeId: road.id, attachmentId: id }
				: undefined,
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

function merged(project: ReturnType<typeof fixture>["project"]) {
	const p = structuredClone(project),
		b = structuredClone(p.baselineRevisions[p.activeBaselineRevisionId]!);
	b.id = "refreshed";
	b.parentRevisionId = p.activeBaselineRevisionId;
	p.baselineRevisions.refreshed = b;
	p.activeBaselineRevisionId = b.id;
	p.revision++;
	return p;
}
test("source merge acceptance updates projection and document in one undo step", () => {
	const { site, project, road } = fixture(false),
		before = structuredClone(useScene.getState().nodes),
		p = merged(project);
	const id = Object.keys(p.baselineRevisions.refreshed!.roads)[0]!;
	const data = p.baselineRevisions.refreshed!.roads[id]!.data as any;
	data.sections["section:ab"].style.laneWidth = 4;
	for (const evidence of Object.values(
		p.baselineRevisions.refreshed!.propertyEvidence ?? {},
	)) {
		if (
			evidence.target.path.at(-1) === "laneWidth" &&
			evidence.accepted.kind === "claim"
		)
			evidence.claims[evidence.accepted.claimId]!.value = 4;
	}
	acceptStreetSourceMerge(site.id, canonicalSourceJson(project), p);
	expect(
		readStreetProjectFromSite(useScene.getState().nodes[site.id])!.project
			.activeBaselineRevisionId,
	).toBe("refreshed");
	const projected = useScene.getState().nodes[road.id as AnyNodeId] as any;
	expect(projected.stylePresets[projected.edges.ab.styleId].laneWidth).toBe(4);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
test("acceptance rejects stale work and read-only scenes without any mutation", () => {
	const { site, project } = fixture(false),
		before = structuredClone(useScene.getState().nodes),
		p = merged(project);
	expect(() => acceptStreetSourceMerge(site.id, "stale", p)).toThrow("changed");
	expect(useScene.getState().nodes).toEqual(before);
	useScene.setState({ readOnly: true });
	expect(() =>
		acceptStreetSourceMerge(site.id, canonicalSourceJson(project), p),
	).toThrow("read-only");
	expect(useScene.getState().nodes).toEqual(before);
	useScene.setState({ readOnly: false });
});
test("creating and removing source assets updates hierarchy atomically and undoes cleanly", () => {
	const { site, project, assets } = fixture(false),
		before = structuredClone(useScene.getState().nodes),
		p = merged(project),
		b = p.baselineRevisions.refreshed!;
	delete b.features[assets[0]!.id];
	b.features["new-lamp"] = {
		id: "new-lamp",
		kind: "point-asset",
		origin: "authored",
		sourceReferenceIds: [],
		sourceFeatureId: null,
		representation: "osm-import-v1",
		data: {
			kind: "street-lamp",
			sourceId: "node/999",
			height: 7,
			position: [20, 0, 5],
			rotationY: 0,
		},
	};
	acceptStreetSourceMerge(site.id, canonicalSourceJson(project), p);
	expect(useScene.getState().nodes[assets[0]!.id as AnyNodeId]).toBeUndefined();
	const doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!,
		binding = doc.projection.bindings.find((b) => b.featureId === "new-lamp")!;
	expect(
		(useScene.getState().nodes[binding.nodeIds[0]! as AnyNodeId] as any).height,
	).toBe(7);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
