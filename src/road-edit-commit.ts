import type { BaselineCorrectionContext } from "./host/baseline-correction-context";
import { type AnyNode, type AnyNodeId, useScene } from "@pascal-app/core";
import { reconcileRoadAttachments } from "./host/road-attachment-reconciliation";
import { RoadNetworkNode } from "./schema";
import { StreetApplicationChangeSet } from "./domain/application-change-set";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./host/application-change-set";
import { getImportOwnerSite } from "./host/imported-baseline-persistence";
import { prepareRoadEditDocument } from "./host/road-edit-document";

export function captureRoadEditPreconditions(node: RoadNetworkNode) {
	const scene = useScene.getState();
	return captureStreetChangePreconditions(getImportOwnerSite(scene, node.id));
}

/** Commit the road and its attached poses as one observable user edit. */
export function prepareRoadGeometryEdit(
	node: RoadNetworkNode,
	patch: Partial<RoadNetworkNode>,
	expected = captureRoadEditPreconditions(node),
	correction?: BaselineCorrectionContext,
) {
	const scene = useScene.getState();
	const next = RoadNetworkNode.parse({ ...node, ...patch });
	const reconciled = reconcileRoadAttachments(next, scene.nodes);
	const acceptedPatch = {
		...patch,
		attachments: reconciled.network.attachments,
		stylePresets: reconciled.network.stylePresets,
		roadsideDecorations: reconciled.network.roadsideDecorations,
	};
	const update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = [
		{ id: node.id as AnyNodeId, data: acceptedPatch as Partial<AnyNode> },
		...reconciled.update,
	];
	const affectedGeometry = update.map((op) => op.id);
	const document =
		expected.siteId === null
			? null
			: prepareRoadEditDocument(
					expected.siteId,
					node,
					acceptedPatch,
					correction,
				);
	if (document)
		update.push({
			id: expected.siteId as AnyNodeId,
			data: { metadata: document.metadata },
		});
	return StreetApplicationChangeSet.parse({
		format: "street-application-change-set",
		schemaVersion: 1,
		id: `road-edit:${node.id}`,
		reason: "Edit road geometry and attached poses",
		expected,
		create: [],
		update: JSON.parse(JSON.stringify(update)),
		delete: [],
		identityRemaps: [],
		affectedGeometry,
	});
}

export function commitRoadGeometryEdit(
	node: RoadNetworkNode,
	patch: Partial<RoadNetworkNode>,
	expected = captureRoadEditPreconditions(node),
	correction?: BaselineCorrectionContext,
) {
	return commitHostStreetChangeSet(
		prepareRoadGeometryEdit(node, patch, expected, correction),
	);
}
