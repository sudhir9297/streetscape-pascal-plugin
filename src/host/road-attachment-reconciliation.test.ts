import { expect, test } from "bun:test";
import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode, StreetLightNode } from "../schema";
import { reconcileRoadAttachments } from "./road-attachment-reconciliation";

function fixture() {
	const asset = StreetLightNode.parse({
		id: "street-light_reconcile",
		position: [8, 2, 5],
		rotation: [0, 0.4, 0],
	});
	const network = RoadNetworkNode.parse({
		id: "road-network_reconcile",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [20, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
		attachments: {
			lamp: {
				id: "lamp",
				assetNodeId: asset.id,
				edgeId: "ab",
				station: 4,
				lateralOffset: 3,
				placementMode: "generated",
				generatedKey: "generated-lamp",
			},
		},
	});
	return {
		network,
		asset,
		nodes: { [asset.id]: asset } as unknown as Record<AnyNodeId, AnyNode>,
	};
}

test("reconciliation plans final poses and generation baselines without mutating inputs", () => {
	const { network, nodes } = fixture();
	const before = JSON.stringify({ network, nodes });
	const result = reconcileRoadAttachments(network, nodes);
	const data = result.update[0]!.data as unknown as {
		position: number[];
		metadata: Record<string, unknown>;
		roadAttachment: { networkNodeId: string };
	};
	expect(data.position[0]).toBe(4);
	expect(data.metadata.roadAutoInfrastructureInitialPosition).toEqual(
		data.position,
	);
	expect(data.roadAttachment.networkNodeId).toBe(network.id);
	expect(JSON.stringify({ network, nodes })).toBe(before);
});

test("generic asset moves keep the authored pose and become adjusted anchors", () => {
	const { network, asset, nodes } = fixture();
	const result = reconcileRoadAttachments(network, nodes, new Set([asset.id]));
	expect(result.network.attachments.lamp!.placementMode).toBe("adjusted");
	expect(result.network.attachments.lamp!.station).toBeCloseTo(8);
	expect(result.update[0]!.data).not.toHaveProperty("position");
	const projected = reconcileRoadAttachments(result.network, nodes);
	expect(
		(projected.update[0]!.data as unknown as { position: number[] }).position,
	).toEqual(asset.position);
});

test("missing assets are pruned in the detached result", () => {
	const { network } = fixture();
	expect(reconcileRoadAttachments(network, {}).network.attachments).toEqual({});
	expect(Object.keys(network.attachments)).toEqual(["lamp"]);
});

test("reflow preserves the world pose of an accepted adjusted generated fixture", () => {
	const { network, asset, nodes } = fixture();
	const adjusted = reconcileRoadAttachments(
		network,
		nodes,
		new Set([asset.id]),
	).network;
	adjusted.graphNodes.b!.position = [40, 0, 15];
	const reflow = reconcileRoadAttachments(adjusted, nodes);
	expect(
		(reflow.update[0]!.data as unknown as { position: number[] }).position,
	).toEqual(asset.position);
	expect(
		(reflow.update[0]!.data as unknown as { rotation: number[] }).rotation,
	).toEqual(asset.rotation);
	expect(reflow.network.attachments.lamp!.placementMode).toBe("adjusted");
});
