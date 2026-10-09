import { captureGeneratedItemAcceptance } from "../generated-item-acceptance";
import { planRoadFurnishings } from "./road-furnishing-command-plan";
import { splitRoadGraphComponents } from "../road-network-topology";
import type { StreetApplicationChangeSet } from "../domain/application-change-set";
import { useScene, type AnyNode, type AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "../schema";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./application-change-set";
import { getImportOwnerSite } from "./imported-baseline-persistence";
import { createStreetCommandDraft } from "./street-command-draft";
import { reconcileRoadAttachments } from "./road-attachment-reconciliation";
import { prepareRoadTopologyDocument } from "./road-topology-document";

/** Translate an entire host gesture before any scene writes occur. */
export function prepareAttachedAssetEdits(
	updates: readonly { id: AnyNodeId; data: Partial<AnyNode> }[],
	companions: {
		create?: { node: AnyNode; parentId?: AnyNodeId }[];
		delete?: AnyNodeId[];
	} = {},
) {
	const state = useScene.getState();
	const pendingNodes = { ...state.nodes };
	for (const op of companions.create ?? []) {
		if (pendingNodes[op.node.id])
			throw Error(`Asset creation identity collision: ${op.node.id}`);
		pendingNodes[op.node.id] = {
			...op.node,
			...(op.parentId ? { parentId: op.parentId } : {}),
		} as AnyNode;
	}
	const owners = new Map<string, RoadNetworkNode>();
	const sites = new Set<string>();
	const moved = new Set<string>();
	for (const { id, data } of updates) {
		const asset = pendingNodes[id];
		if (!asset) throw Error(`Missing edited asset: ${id}`);
		if ((asset.type as string) === "streetscape:road-network")
			owners.set(asset.id, RoadNetworkNode.parse(asset));
		const ref = (
			asset as unknown as {
				roadAttachment?: { networkNodeId: string; attachmentId: string };
			}
		).roadAttachment;
		if (ref) {
			const network = RoadNetworkNode.parse(
				state.nodes[ref.networkNodeId as AnyNodeId],
			);
			if (network.attachments[ref.attachmentId]?.assetNodeId !== id)
				throw Error(`Asset attachment ownership disagrees: ${id}`);
			owners.set(network.id, network);
			if (Object.hasOwn(data, "position") || Object.hasOwn(data, "rotation"))
				moved.add(id);
		}
		sites.add(getImportOwnerSite({ ...state, nodes: pendingNodes }, id));
	}
	for (const id of companions.delete ?? []) {
		const asset = state.nodes[id] as unknown as
			| { roadAttachment?: { networkNodeId: string } }
			| undefined;
		if (asset?.roadAttachment) {
			const network = RoadNetworkNode.parse(
				state.nodes[asset.roadAttachment.networkNodeId as AnyNodeId],
			);
			owners.set(network.id, network);
			sites.add(getImportOwnerSite(state, id));
		}
	}
	if (!owners.size) throw Error("Edit batch has no attached street assets");
	if (sites.size !== 1)
		throw Error(
			"An attached asset gesture must belong to one street document owner",
		);
	const siteId = [...sites][0]!;
	const draft = createStreetCommandDraft(
		state.nodes,
		captureStreetChangePreconditions(siteId),
	);
	for (const op of companions.create ?? [])
		draft.createNode(op.node, (op.parentId ?? op.node.parentId) as AnyNodeId);
	for (const id of companions.delete ?? []) draft.deleteNode(id);
	// Merge every pending edit first, including repeated edits to the same asset.
	for (const { id, data } of updates) draft.updateNode(id, data);
	const remaps: StreetApplicationChangeSet["identityRemaps"] = (
		companions.delete ?? []
	).map((id) => ({ from: { kind: "host-node" as const, id }, to: [] }));
	const networks: RoadNetworkNode[] = [];
	for (const old of owners.values()) {
		const acceptance = captureGeneratedItemAcceptance(
			old,
			RoadNetworkNode.parse(draft.nodes[old.id as AnyNodeId]),
			state.nodes,
			draft.nodes,
		);
		draft.updateNode(
			old.id as AnyNodeId,
			{
				generatedItemHistory: acceptance.network.generatedItemHistory,
				attachments: acceptance.network.attachments,
			} as Partial<AnyNode>,
		);
		for (const op of acceptance.updates)
			draft.updateNode(op.id as AnyNodeId, { metadata: op.metadata });
		const furnishing = planRoadFurnishings(
			RoadNetworkNode.parse(draft.nodes[old.id as AnyNodeId]),
			draft.nodes,
		);
		const next = furnishing.network;
		draft.applyNodeChanges({ update: furnishing.update });
		const components = Object.keys(next.edges).length
			? splitRoadGraphComponents(next)
			: [];
		const separated = components.map((component, index) =>
			RoadNetworkNode.parse({
				...next,
				...component,
				...(index ? { id: undefined } : {}),
			}),
		);
		if (!separated.length) draft.deleteNode(old.id as AnyNodeId);
		for (let index = 0; index < separated.length; index++) {
			const network = separated[index]!;
			if (index)
				draft.createNode(
					network as unknown as AnyNode,
					next.parentId as AnyNodeId,
				);
			else
				draft.updateNode(
					network.id as AnyNodeId,
					network as unknown as Partial<AnyNode>,
				);
			const reconciled = reconcileRoadAttachments(network, draft.nodes, moved);
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
		for (const anchor of Object.values(old.attachments)) {
			if (
				!separated.some((network) =>
					Object.values(network.attachments).some(
						(a) => a.assetNodeId === anchor.assetNodeId,
					),
				) &&
				draft.nodes[anchor.assetNodeId as AnyNodeId]
			)
				draft.updateNode(
					anchor.assetNodeId as AnyNodeId,
					{ roadAttachment: undefined } as Partial<AnyNode>,
				);
		}
		for (const [field, kind] of [
			["edges", "road-edge"],
			["graphNodes", "road-node"],
		] as const) {
			for (const id of Object.keys(old[field]))
				remaps.push({
					from: { kind, networkId: old.id, id },
					to: separated
						.filter((network) => Object.hasOwn(network[field], id))
						.map((network) => ({ kind, networkId: network.id, id })),
				});
		}
		if (!separated.length)
			remaps.push({ from: { kind: "host-node", id: old.id }, to: [] });
		networks.push(...separated);
	}
	const document = prepareRoadTopologyDocument({
		before: state,
		after: { ...state, nodes: draft.nodes },
		siteId,
		oldNetworks: [...owners.values()],
		networks,
		identityRemaps: remaps,
	});
	if (document)
		draft.applyNodeChanges({
			update: document.generatedItemUpdates as {
				id: AnyNodeId;
				data: Partial<AnyNode>;
			}[],
		});
	if (document)
		draft.updateNode(siteId as AnyNodeId, { metadata: document.metadata });
	return draft.finish(
		"edit-attached-assets",
		"Edit attached street assets and retain adjusted anchors",
		[...remaps, ...(document?.identityRemaps ?? [])],
	);
}

export function prepareAttachedAssetEdit(
	id: AnyNodeId,
	patch: Partial<AnyNode>,
) {
	return prepareAttachedAssetEdits([{ id, data: patch }]);
}
export function commitAttachedAssetEdit(
	id: AnyNodeId,
	patch: Partial<AnyNode>,
) {
	return commitHostStreetChangeSet(prepareAttachedAssetEdit(id, patch));
}
