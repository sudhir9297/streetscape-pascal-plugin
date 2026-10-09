import { useScene, type AnyNode, type AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "./schema";
import { deleteRoadEdge } from "./road-network-graph-editing";
import { splitRoadGraphComponents } from "./road-network-topology";
import { reconcileRoadAttachments } from "./host/road-attachment-reconciliation";
import { createStreetCommandDraft } from "./host/street-command-draft";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./host/application-change-set";
import { getImportOwnerSite } from "./host/imported-baseline-persistence";
import { prepareRoadTopologyDocument } from "./host/road-topology-document";
import type { StreetApplicationChangeSet } from "./domain/application-change-set";

/** Delete and split ownership before committing, including retained standalone assets. */
export function prepareRoadEdgeDeletion(node: RoadNetworkNode, edgeId: string) {
	const deletion = deleteRoadEdge(node, edgeId);
	if (!deletion) return null;
	const state = useScene.getState(),
		siteId = getImportOwnerSite(state, node.id);
	const draft = createStreetCommandDraft(
		state.nodes,
		captureStreetChangePreconditions(siteId),
	);
	const components = deletion.empty
		? []
		: splitRoadGraphComponents({ ...node, ...deletion.patch });
	const networks = components.map((graph, index) =>
		RoadNetworkNode.parse({
			...node,
			...graph,
			...(index ? { id: undefined } : {}),
		}),
	);
	if (!networks.length) draft.deleteNode(node.id as AnyNodeId);
	for (let i = 0; i < networks.length; i++) {
		const network = networks[i]!;
		if (i === 0)
			draft.updateNode(
				node.id as AnyNodeId,
				network as unknown as Partial<AnyNode>,
			);
		else
			draft.createNode(
				network as unknown as AnyNode,
				node.parentId as AnyNodeId,
			);
	}
	for (const old of Object.values(node.attachments)) {
		const asset = draft.nodes[old.assetNodeId as AnyNodeId];
		if (!asset) continue;
		const owner = networks.find((network) =>
			Object.values(network.attachments).some(
				(a) => a.assetNodeId === asset.id,
			),
		);
		if (!owner) {
			draft.updateNode(asset.id, {
				roadAttachment: undefined,
			} as Partial<AnyNode>);
			continue;
		}
		const anchor = Object.values(owner.attachments).find(
			(a) => a.assetNodeId === asset.id,
		)!;
		draft.updateNode(asset.id, {
			roadAttachment: {
				networkNodeId: owner.id,
				attachmentId: anchor.id,
				side: anchor.side,
			},
		} as Partial<AnyNode>);
	}
	for (const network of networks) {
		const reconciled = reconcileRoadAttachments(network, draft.nodes);
		Object.assign(network, reconciled.network);
		draft.applyNodeChanges({
			update: [
				{
					id: network.id as AnyNodeId,
					data: {
						attachments: network.attachments,
						stylePresets: network.stylePresets,
						roadsideDecorations: network.roadsideDecorations,
					} as Partial<AnyNode>,
				},
				...reconciled.update,
			],
		});
	}
	const remaps: StreetApplicationChangeSet["identityRemaps"] = [];
	for (const [field, kind] of [
		["edges", "road-edge"],
		["graphNodes", "road-node"],
	] as const)
		for (const id of Object.keys(node[field]))
			remaps.push({
				from: { kind, networkId: node.id, id },
				to: networks
					.filter((network) => Object.hasOwn(network[field], id))
					.map((network) => ({ kind, networkId: network.id, id })),
			});
	if (!networks.length)
		remaps.push({ from: { kind: "host-node", id: node.id }, to: [] });
	const document = prepareRoadTopologyDocument({
		before: state,
		after: { ...state, nodes: draft.nodes },
		siteId,
		oldNetworks: [node],
		networks,
		identityRemaps: remaps,
	});
	if (document) {
		draft.applyNodeChanges({
			update: document.generatedItemUpdates as {
				id: AnyNodeId;
				data: Partial<AnyNode>;
			}[],
		});
		draft.updateNode(siteId as AnyNodeId, { metadata: document.metadata });
		remaps.push(...document.identityRemaps);
	}
	return draft.finish(
		`delete-edge:${node.id}:${edgeId}`,
		"Delete road edge and reconcile components and assets",
		remaps,
	);
}
export function commitRoadEdgeDeletion(node: RoadNetworkNode, edgeId: string) {
	const change = prepareRoadEdgeDeletion(node, edgeId);
	if (change) commitHostStreetChangeSet(change);
	return change;
}
