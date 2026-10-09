import { planRoadFurnishings } from "./road-furnishing-command-plan";
import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import type { RoadNetworkNode } from "../schema";
import {
	pruneOrphanedRoadAttachments,
	reanchorRoadAttachment,
	resolveRoadAttachmentTransform,
	synchronizeRoadAttachmentOpening,
} from "../road-edge-attachments";

/** Detached reconciliation shared by commands and the host edit adapter. */
export function reconcileRoadAttachments(
	network: RoadNetworkNode,
	nodes: Record<AnyNodeId, AnyNode>,
	adjustedAssetIds: ReadonlySet<string> = new Set(),
) {
	const furnishings = planRoadFurnishings(network, nodes);
	network = furnishings.network;
	const attachments = {
		...pruneOrphanedRoadAttachments(
			network.attachments,
			new Set(Object.keys(nodes)),
		),
	};
	const update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = [
		...furnishings.update,
	];
	for (const [id, previous] of Object.entries(attachments)) {
		const asset = nodes[previous.assetNodeId as AnyNodeId];
		if (!asset) continue;
		const pose = asset as unknown as Parameters<
			typeof resolveRoadAttachmentTransform
		>[2];
		const anchored =
			adjustedAssetIds.has(asset.id) ||
			(previous.placementMode === "adjusted" && previous.generatedKey)
				? reanchorRoadAttachment(network, previous, pose)
				: previous;
		if (!anchored)
			throw Error(`Cannot reanchor adjusted road asset: ${asset.id}`);
		const attachment = synchronizeRoadAttachmentOpening(
			network,
			anchored,
			pose,
		);
		attachments[id] = attachment;
		const transform = resolveRoadAttachmentTransform(network, attachment, pose);
		const data = {
			roadAttachment: {
				networkNodeId: network.id,
				attachmentId: id,
				side: attachment.side,
			},
			...(!adjustedAssetIds.has(asset.id) && transform
				? {
						position:
							attachment.placementMode === "adjusted" && attachment.generatedKey
								? pose.position
								: transform.position,
						rotation:
							attachment.placementMode === "adjusted" && attachment.generatedKey
								? pose.rotation
								: transform.rotation,
						...(attachment.generatedKey &&
						attachment.placementMode !== "adjusted"
							? {
									metadata: {
										...asset.metadata,
										roadAutoInfrastructureInitialPosition: transform.position,
										roadAutoInfrastructureInitialRotation: transform.rotation,
									},
								}
							: {}),
					}
				: {}),
		} as Partial<AnyNode>;
		update.push({ id: asset.id, data });
	}
	const merged = new Map<AnyNodeId, Partial<AnyNode>>();
	for (const op of update)
		merged.set(op.id, { ...merged.get(op.id), ...op.data } as Partial<AnyNode>);
	return {
		network: { ...network, attachments },
		update: [...merged].map(([id, data]) => ({ id, data })),
	};
}
