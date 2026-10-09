import { test, expect } from "bun:test";
import { useScene, type AnyNode, type AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode, StreetLightNode } from "../schema";
import { planRoadFurnishings } from "./road-furnishing-command-plan";
import { reconcileRoadAttachments } from "./road-attachment-reconciliation";
import { beginStreetViewMutationCheck } from "./street-view-mutation-check";

test("furnishing plan is deterministic, isolated and combines visibility with attachment poses", () => {
	const asset = StreetLightNode.parse({
		id: "street-light_furnishing",
		metadata: {
			generatedBy: "road-auto-infrastructure",
			roadNetworkId: "road-network_furnishing",
			roadsideItemKind: "lamp",
		},
		visible: false,
	});
	const road = RoadNetworkNode.parse({
		id: "road-network_furnishing",
		roadsideItemVisibility: { lamp: true },
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [80, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
		attachments: {
			lamp: {
				id: "lamp",
				edgeId: "ab",
				assetNodeId: asset.id,
				station: 10,
				lateralOffset: 4,
			},
		},
	});
	const nodes = { [asset.id]: asset } as unknown as Record<AnyNodeId, AnyNode>;
	const before = JSON.stringify({ road, nodes });
	const first = planRoadFurnishings(road, nodes);
	expect(first.network.stylePresets).toEqual(road.stylePresets);
	expect(Object.keys(first.network.roadsideDecorations).length).toBeGreaterThan(
		0,
	);
	expect(planRoadFurnishings(road, nodes)).toEqual(first);
	expect(JSON.stringify({ road, nodes })).toBe(before);
	const combined = reconcileRoadAttachments(road, nodes);
	expect(combined.update).toHaveLength(1);
	expect(combined.update[0]!.data).toHaveProperty("visible", true);
	expect(combined.update[0]!.data).toHaveProperty("position");
});

test("view mutation check ignores transient state and catches write followed by restoration", () => {
	const original = useScene.getState();
	const clean = beginStreetViewMutationCheck();
	useScene.setState({ dirtyNodes: new Set() as typeof original.dirtyNodes });
	expect(clean.assertUnchanged()).toEqual({
		unchanged: true,
		persistentWrites: 0,
		changes: [],
	});
	const changed = beginStreetViewMutationCheck();
	useScene.setState({ rootNodeIds: [] });
	useScene.setState({ rootNodeIds: original.rootNodeIds });
	// If original roots were empty use a synthetic root to exercise the intermediate write.
	if (original.rootNodeIds.length === 0) {
		useScene.setState({ rootNodeIds: ["site_probe" as AnyNodeId] });
		useScene.setState({ rootNodeIds: [] });
	}
	expect(changed.finish().unchanged).toBe(false);
	useScene.setState(original);
});
