import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import type { RoadNetworkNode } from "../schema";
import { buildRoadsideDecorations } from "../roadside-decoration-rules";

/** Deterministic furnishing decisions evaluated inside an authored command. */
export function planRoadFurnishings(
	network: RoadNetworkNode,
	nodes: Record<AnyNodeId, AnyNode>,
) {
	const enabled =
		network.showRoadsideDecorations ||
		network.roadsideItemVisibility?.lamp === true ||
		network.roadsideItemVisibility?.sign === true;
	const styled = network;
	const decorations = enabled ? buildRoadsideDecorations(styled) : {};
	const road = { ...styled, roadsideDecorations: decorations };
	const update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = [];
	for (const node of Object.values(nodes)) {
		const metadata = node.metadata as Record<string, unknown> | undefined;
		if (
			metadata?.generatedBy !== "road-auto-infrastructure" ||
			metadata.roadNetworkId !== network.id
		)
			continue;
		const key =
			typeof metadata.roadsideItemKind === "string"
				? metadata.roadsideItemKind
				: (node.type as string);
		const visible = network.roadsideItemVisibility?.[key] === true;
		if (node.visible !== visible)
			update.push({
				id: node.id as AnyNodeId,
				data: { visible } as Partial<AnyNode>,
			});
	}
	return { network: road, update };
}
