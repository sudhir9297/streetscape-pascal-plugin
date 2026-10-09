import { useScene, type AnyNodeId, type AnyNode } from "@pascal-app/core";
import { z } from "zod";
import { RoadSignNode, StreetLightNode } from "../schema";
import { captureStreetChangePreconditions } from "./application-change-set";
import { StreetApplicationChangeSet } from "../domain/application-change-set";
import { prepareAttachedAssetEdit } from "./attached-asset-edit";
import {
	readStreetProjectFromSite,
	prepareStreetProjectPersistence,
} from "./street-project-persistence";

/** Explicit authored asset correction, reconciled atomically with retained imagery evidence. */
export function prepareImageryAssetCorrection(
	siteId: string,
	observationId: string,
	patch: { position?: [number, number, number]; signId?: string },
	reason: string,
) {
	z.string().trim().min(1, "Explain the asset correction.").parse(reason);
	const scene = useScene.getState(),
		stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	const observation = stored?.project.observations?.[observationId],
		imagery = observation?.imagery;
	if (
		!stored ||
		!imagery ||
		imagery.status !== "accepted" ||
		!imagery.target.assetFeatureId
	)
		throw Error("Select accepted imagery with a stable mapped asset identity.");
	if (stored.project.activeScenarioId !== null)
		throw Error("Select the accepted baseline before correcting an asset.");
	const binding = stored.projection.bindings.find(
		(binding) =>
			binding.category === "features" &&
			binding.featureId === imagery.target.assetFeatureId,
	);
	if (!binding || binding.nodeIds.length !== 1)
		throw Error("Asset requires an explicit single-node baseline binding.");
	const nodeId = binding.nodeIds[0]!,
		node = scene.nodes[nodeId as AnyNodeId];
	if (!node) throw Error("Mapped asset is missing.");
	if (imagery.claim.kind === "sign-type") {
		if (
			(node.type as string) !== "streetscape:road-sign" ||
			!patch.signId ||
			patch.position
		)
			throw Error("Sign evidence supports a catalog sign correction only.");
		if (patch.signId !== imagery.claim.signType)
			throw Error("Selected sign must agree with the accepted evidence.");
	} else if (imagery.claim.kind === "lamp-location") {
		if (
			(node.type as string) !== "streetscape:street-light" ||
			!patch.position ||
			patch.signId
		)
			throw Error(
				"Lamp evidence supports an explicitly authored position only.",
			);
		z.tuple([
			z.number().finite(),
			z.number().finite(),
			z.number().finite(),
		]).parse(patch.position);
	} else
		throw Error("This evidence does not support a sign or lamp correction.");

	const validated =
		imagery.claim.kind === "sign-type"
			? RoadSignNode.parse({ ...node, ...patch })
			: StreetLightNode.parse({ ...node, ...patch });
	const attached = !!validated.roadAttachment;
	let next;
	let change;
	if (attached) {
		change = prepareAttachedAssetEdit(
			nodeId as AnyNodeId,
			patch as unknown as Partial<AnyNode>,
		);
		const update = change.update.find((update) => update.id === siteId);
		if (!update)
			throw Error("Asset command did not retain its street document.");
		next = readStreetProjectFromSite({
			...scene.nodes[siteId as AnyNodeId],
			...update.data,
		});
		if (!next) throw Error("Asset correction document is missing.");
	} else {
		next = structuredClone(stored);
		const parent =
			next.project.baselineRevisions[next.project.activeBaselineRevisionId]!;
		const baseline = structuredClone(parent);
		baseline.id = `${parent.id}:asset-correction:${next.project.revision + 1}`;
		baseline.parentRevisionId = parent.id;
		baseline.acceptedAt = new Date().toISOString();
		baseline.features[binding.featureId]!.data = {
			...baseline.features[binding.featureId]!.data,
			...z.record(z.string(), z.json()).parse(patch),
		};
		next.project.baselineRevisions[baseline.id] = baseline;
		next.project.activeBaselineRevisionId = baseline.id;
		next.project.revision++;
		next.projection.baselineRevisionId = baseline.id;
		change = StreetApplicationChangeSet.parse({
			format: "street-application-change-set",
			schemaVersion: 1,
			id: `imagery-asset~${nodeId}`,
			reason,
			expected: captureStreetChangePreconditions(siteId),
			create: [],
			update: [
				{ id: nodeId, data: patch },
				{ id: siteId, data: {} },
			],
			delete: [],
			identityRemaps: [],
			affectedGeometry: [nodeId],
		});
	}
	const ownerUpdate = change.update.find((update) => update.id === siteId)!;
	const baseline =
			next.project.baselineRevisions[next.project.activeBaselineRevisionId]!,
		feature = baseline.features[binding.featureId];
	if (!feature) throw Error("Asset correction lost its semantic identity.");
	baseline.propertyEvidence ??= {};
	for (const key of Object.keys(patch)) {
		const related = Object.values(baseline.propertyEvidence).filter(
			(property) =>
				property.target.category === "features" &&
				property.target.featureId === feature.id &&
				property.target.path[0] === key,
		);
		if (related.length)
			for (const property of related) {
				let value: unknown = feature.data;
				for (const token of property.target.path)
					value =
						value && typeof value === "object"
							? (value as Record<string | number, unknown>)[token]
							: undefined;
				property.accepted = {
					kind: "correction",
					value: z.json().parse(value),
					reason,
					acceptedAt: new Date().toISOString(),
					observationIds: [observationId],
					supersedesClaimId:
						property.accepted.kind === "claim"
							? property.accepted.claimId
							: property.accepted.supersedesClaimId,
				};
			}
		else {
			const id = `asset-correction~${feature.id}~${key}`;
			baseline.propertyEvidence[id] = {
				id,
				target: { category: "features", featureId: feature.id, path: [key] },
				units: key === "position" ? "m" : null,
				claims: {},
				rejectedClaims: [],
				accepted: {
					kind: "correction",
					value: feature.data[key]!,
					reason,
					acceptedAt: new Date().toISOString(),
					observationIds: [observationId],
					supersedesClaimId: null,
				},
			};
		}
	}
	const afterNodes = { ...scene.nodes };
	for (const update of change.update)
		if (update.id !== siteId)
			afterNodes[update.id as AnyNodeId] = {
				...afterNodes[update.id as AnyNodeId],
				...update.data,
			} as AnyNode;
	const prepared = prepareStreetProjectPersistence(
		{ ...scene, nodes: afterNodes },
		siteId,
		{
			project: next.project,
			projection: next.projection,
			expectedRevision: stored.project.revision,
		},
	);
	ownerUpdate.data = {
		...ownerUpdate.data,
		metadata: z.record(z.string(), z.json()).parse(prepared.metadata),
	};
	return StreetApplicationChangeSet.parse({ ...change, reason });
}
