import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import {
	StreetApplicationChangeSet,
	type StreetIdentityReference,
} from "../domain/application-change-set";

/** Local planning graph: these methods never call the host store. */
export function createStreetCommandDraft(
	input: Record<AnyNodeId, AnyNode>,
	expected: StreetApplicationChangeSet["expected"],
) {
	const nodes = { ...input };
	const changed = new Set<AnyNodeId>();
	const draft = {
		nodes,
		updateNode(id: AnyNodeId, data: Partial<AnyNode>) {
			if (!nodes[id]) throw Error(`Missing command node: ${id}`);
			nodes[id] = { ...nodes[id], ...data } as AnyNode;
			changed.add(id);
		},
		createNode(node: AnyNode, parentId: AnyNodeId) {
			if (nodes[node.id])
				throw Error(`Command node identity collision: ${node.id}`);
			nodes[node.id] = { ...node, parentId } as AnyNode;
			changed.add(node.id);
		},
		deleteNode(id: AnyNodeId) {
			delete nodes[id];
			changed.add(id);
		},
		applyNodeChanges(batch: {
			create?: { node: AnyNode; parentId: AnyNodeId }[];
			update?: { id: AnyNodeId; data: Partial<AnyNode> }[];
			delete?: AnyNodeId[];
		}) {
			for (const id of batch.delete ?? []) draft.deleteNode(id);
			for (const op of batch.update ?? []) draft.updateNode(op.id, op.data);
			for (const op of batch.create ?? [])
				draft.createNode(op.node, op.parentId);
		},
		finish(
			id: string,
			reason: string,
			identityRemaps: {
				from: StreetIdentityReference;
				to: StreetIdentityReference[];
			}[] = [],
		) {
			const create = [],
				update = [],
				removed = [],
				affectedGeometry = [];
			for (const nodeId of changed) {
				const before = input[nodeId],
					after = nodes[nodeId];
				if (!before && !after) continue;
				affectedGeometry.push(nodeId);
				if (!before && after)
					create.push({ node: after, parentId: after.parentId ?? null });
				else if (!after) removed.push(nodeId);
				else {
					const { id: _, type: __, ...data } = after;
					const unset = Object.keys(before!).filter(
						(field) =>
							!["id", "type"].includes(field) &&
							(before as unknown as Record<string, unknown>)[field] !==
								undefined &&
							(after as unknown as Record<string, unknown>)[field] ===
								undefined,
					);
					update.push({ id: nodeId, data, unset });
				}
			}
			return StreetApplicationChangeSet.parse(
				JSON.parse(
					JSON.stringify({
						format: "street-application-change-set",
						schemaVersion: 1,
						id,
						reason,
						expected,
						create,
						update,
						delete: removed,
						identityRemaps,
						affectedGeometry,
					}),
				),
			);
		},
	};
	return draft;
}
