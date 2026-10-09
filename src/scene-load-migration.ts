import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "./schema";
import { roadRuntimeDefaultsPatch } from "./road-network-runtime-defaults";
import { planRoadAutoInfrastructureAttachmentMigration } from "./road-auto-infrastructure";
import {
	isStreetInfrastructureKind,
	type StreetInfrastructureNode,
} from "./street-infrastructure-config";
import {
	dedupeRoadSignChildIds,
	getRoadSignIds,
} from "./road-sign-scene-normalization";

/** Detached, idempotent compatibility migration. Never deletes user nodes. */
export function migrateStreetscapeScene(
	nodes: Record<AnyNodeId, AnyNode>,
): Record<AnyNodeId, AnyNode> {
	let result = nodes;
	const patch = (id: string, data: Record<string, unknown>) => {
		if (result === nodes) result = { ...nodes };
		result[id as AnyNodeId] = {
			...result[id as AnyNodeId],
			...data,
		} as AnyNode;
	};
	const signs = getRoadSignIds(nodes);
	for (const node of Object.values(nodes)) {
		if ("children" in node && Array.isArray(node.children)) {
			const children = dedupeRoadSignChildIds(node.children, signs);
			if (children.length !== node.children.length)
				patch(node.id, { children });
		}
		if ((node.type as string) !== "streetscape:road-network") continue;
		const parsed = RoadNetworkNode.safeParse(node);
		if (!parsed.success) continue; // Preserve invalid/unknown data for repair, rather than discard it.
		const defaults = roadRuntimeDefaultsPatch(
			node as unknown as RoadNetworkNode,
			parsed.data,
		);
		if (Object.keys(defaults).length) patch(node.id, defaults);
		const migration = planRoadAutoInfrastructureAttachmentMigration({
			network: parsed.data,
			nodes: Object.values(result).filter((candidate) =>
				isStreetInfrastructureKind(candidate.type as string),
			) as unknown as StreetInfrastructureNode[],
		});
		if (migration.nodeUpdates.length) {
			patch(node.id, {
				attachments: { ...parsed.data.attachments, ...migration.attachments },
			});
			for (const update of migration.nodeUpdates)
				patch(update.id, { roadAttachment: update.roadAttachment });
		}
	}
	return result;
}
