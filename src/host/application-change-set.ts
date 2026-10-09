import { withAcceptedStreetCommand } from "./street-command-scope";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
import {
	useScene,
	nodeRegistry,
	validateNodeRelations,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { parseNode } from "@pascal-app/core/schema";
import {
	RoadNetworkNode,
	StreetLightNode,
	RoadSignNode,
	TrafficSignalNode,
} from "../schema";
import { validateRoadGraph } from "../road-network-validation";
import { readCurrentRoad } from "../street-project-compatibility";
import {
	readStreetProjectFromSite,
	inspectStreetProjectProjection,
	DEFAULT_HOST_SCENE_BYTE_LIMIT,
} from "./street-project-persistence";
import {
	prepareStreetApplicationChangeSet,
	StreetApplicationChangeSet,
	streetSceneContent,
	type ApplicationNode,
	type ApplicationScene,
	type StreetIdentityReference,
} from "../domain/application-change-set";

function parseApplicationNode(input: ApplicationNode): ApplicationNode {
	const importSchemas = {
		"streetscape:street-light": StreetLightNode,
		"streetscape:road-sign": RoadSignNode,
		"streetscape:traffic-signal": TrafficSignalNode,
	};
	const schema =
		input.type === "streetscape:road-network"
			? RoadNetworkNode
			: (nodeRegistry.get(input.type)?.schema ??
				importSchemas[input.type as keyof typeof importSchemas]);
	if (schema) return schema.parse(input) as ApplicationNode;
	const parsed = parseNode(input);
	if (!parsed.success) throw Error(`Invalid ${input.type} node: ${input.id}`);
	return parsed.data as ApplicationNode;
}
function readDocument(scene: ApplicationScene, siteId: string) {
	const owner = scene.nodes[siteId];
	if (!owner || owner.type !== "site" || !scene.rootNodeIds.includes(siteId))
		throw Error("Street document owner is missing");
	const stored = readStreetProjectFromSite(owner);
	return stored
		? { id: stored.project.id, revision: stored.project.revision }
		: null;
}
function identityExists(
	scene: ApplicationScene,
	ref: StreetIdentityReference,
): boolean {
	if (ref.kind === "host-node") return Object.hasOwn(scene.nodes, ref.id);
	if (ref.kind === "road-edge" || ref.kind === "road-node") {
		const network = scene.nodes[ref.networkId];
		if (network?.type !== "streetscape:road-network") return false;
		const parsed = RoadNetworkNode.safeParse(network);
		return (
			parsed.success &&
			Object.hasOwn(
				ref.kind === "road-edge" ? parsed.data.edges : parsed.data.graphNodes,
				ref.id,
			)
		);
	}
	const owner = scene.nodes[ref.siteId];
	if (owner?.type !== "site") return false;
	const document = readStreetProjectFromSite(owner);
	if (!document) return false;
	const baseline =
		document.project.baselineRevisions[
			document.project.activeBaselineRevisionId
		]!;
	return Object.hasOwn(
		ref.kind === "baseline-road" ? baseline.roads : baseline.features,
		ref.id,
	);
}
function validateResult(
	before: ApplicationScene,
	next: ApplicationScene,
	changedIds: string[],
	change: StreetApplicationChangeSet,
) {
	for (const [id, node] of Object.entries(next.nodes)) {
		if (node.type === "streetscape:road-network") {
			const graph = RoadNetworkNode.parse(node),
				errors = validateRoadGraph(graph).filter(
					(issue) => issue.severity === "error",
				);
			if (errors.length)
				throw Error(`Invalid final road ${id}: ${errors[0]!.message}`);
			for (const attachment of Object.values(graph.attachments)) {
				const asset = next.nodes[attachment.assetNodeId];
				if (!asset)
					throw Error(
						`Road attachment asset is missing: ${attachment.assetNodeId}`,
					);
				if (!Object.hasOwn(graph.edges, attachment.edgeId))
					throw Error(`Road attachment edge is missing: ${attachment.edgeId}`);
				const ref = asset.roadAttachment as
					| { networkNodeId?: string; attachmentId?: string }
					| undefined;
				if (
					ref &&
					(ref.networkNodeId !== id || ref.attachmentId !== attachment.id)
				)
					throw Error("Road attachment and asset reference disagree");
			}
		}
		const ref = node.roadAttachment as
			| { networkNodeId?: string; attachmentId?: string }
			| undefined;
		if (ref) {
			const road = next.nodes[ref.networkNodeId ?? ""];
			const attachments = road?.attachments as
				| Record<string, { assetNodeId?: string }>
				| undefined;
			if (!road || attachments?.[ref.attachmentId ?? ""]?.assetNodeId !== id)
				throw Error(`Asset has an unresolved road attachment: ${id}`);
		}
	}
	const remapped = new Set(
		change.identityRemaps.map((remap) => canonicalSourceJson(remap.from)),
	);
	for (const [id, old] of Object.entries(before.nodes)) {
		if (old.type === "streetscape:road-network") {
			const oldRoad = RoadNetworkNode.parse(old),
				newRoad =
					next.nodes[id]?.type === "streetscape:road-network"
						? RoadNetworkNode.parse(next.nodes[id])
						: null;
			for (const [field, kind] of [
				["edges", "road-edge"],
				["graphNodes", "road-node"],
			] as const)
				for (const innerId of Object.keys(oldRoad[field])) {
					if (!newRoad || !Object.hasOwn(newRoad[field], innerId))
						if (
							!remapped.has(
								canonicalSourceJson({ kind, networkId: id, id: innerId }),
							)
						)
							throw Error(
								`Removed road identity requires an explicit remap: ${id} / ${innerId}`,
							);
				}
		}
		if (
			old.type.startsWith("streetscape:") &&
			!Object.hasOwn(next.nodes, id) &&
			!remapped.has(canonicalSourceJson({ kind: "host-node", id }))
		)
			throw Error(`Removed street node requires an explicit remap: ${id}`);
	}
	for (const id of changedIds) {
		const node = next.nodes[id] ?? before.nodes[id];
		if (
			node?.type.startsWith("streetscape:") &&
			!change.affectedGeometry.includes(id)
		)
			throw Error(`Changed street geometry is not declared: ${id}`);
	}
	for (const siteId of next.rootNodeIds) {
		const node = next.nodes[siteId];
		if (node?.type !== "site") continue;
		const document = readStreetProjectFromSite(node),
			old =
				before.nodes[siteId]?.type === "site"
					? readStreetProjectFromSite(before.nodes[siteId])
					: null;
		if (old && !document)
			throw Error("A change set cannot discard the retained street document");
		if (!document) continue;
		if (old) {
			const previous =
				old.project.baselineRevisions[old.project.activeBaselineRevisionId]!;
			const current =
				document.project.baselineRevisions[
					document.project.activeBaselineRevisionId
				]!;
			for (const [field, kind] of [
				["roads", "baseline-road"],
				["features", "baseline-feature"],
			] as const)
				for (const id of Object.keys(previous[field]))
					if (
						!Object.hasOwn(current[field], id) &&
						!remapped.has(canonicalSourceJson({ kind, siteId, id }))
					)
						throw Error(
							`Removed baseline identity requires an explicit remap: ${siteId} / ${id}`,
						);
			if (old.project.id !== document.project.id)
				throw Error("A change set cannot replace a different street project");
			if (
				canonicalSourceJson(old.project) !==
					canonicalSourceJson(document.project) &&
				document.project.revision <= old.project.revision
			)
				throw Error("Changed street document must advance its revision");
			for (const [id, source] of Object.entries(old.project.sourceReferences))
				if (
					canonicalSourceJson(source) !==
					canonicalSourceJson(document.project.sourceReferences[id])
				)
					throw Error(`Captured source reference is immutable: ${id}`);
			for (const [id, baseline] of Object.entries(
				old.project.baselineRevisions,
			))
				if (
					canonicalSourceJson(baseline) !==
					canonicalSourceJson(document.project.baselineRevisions[id])
				)
					throw Error(`Accepted historical baseline is immutable: ${id}`);
		}
		if (inspectStreetProjectProjection(next, siteId, document).length)
			throw Error("Change set leaves invalid baseline projection bindings");
		for (const baseline of Object.values(document.project.baselineRevisions))
			for (const road of Object.values(baseline.roads)) readCurrentRoad(road);
	}
	for (const siteId of before.rootNodeIds)
		if (
			before.nodes[siteId]?.type === "site" &&
			readStreetProjectFromSite(before.nodes[siteId]) &&
			!next.nodes[siteId]
		)
			throw Error(
				"A change set cannot delete a retained street document owner",
			);
	validateNodeRelations(
		before.nodes as Record<AnyNodeId, AnyNode>,
		next.nodes as Record<AnyNodeId, AnyNode>,
		changedIds as AnyNodeId[],
	);
	const state = useScene.getState();
	const bytes = new TextEncoder().encode(
		JSON.stringify({
			...next,
			collections: state.collections,
			materials: state.materials,
			installedPlugins: state.installedPlugins,
		}),
	).byteLength;
	if (bytes > DEFAULT_HOST_SCENE_BYTE_LIMIT)
		throw Error(`Change set exceeds scene byte limit (${bytes})`);
}
export function prepareHostStreetChangeSet(input: StreetApplicationChangeSet) {
	const state = useScene.getState();
	if (state.readOnly)
		throw Error("Cannot apply street changes in a read-only scene");
	return prepareStreetApplicationChangeSet(state, input, {
		readDocument,
		parseNode: parseApplicationNode,
		identityExists,
		validateResult: (before, next, ids) =>
			validateResult(before, next, ids, input),
	});
}
/** Capture preconditions before starting asynchronous preparation. */
export function captureStreetChangePreconditions(siteId: string | null) {
	const state = useScene.getState(),
		document = siteId === null ? null : readDocument(state, siteId);
	return {
		sceneContent: streetSceneContent(state),
		siteId,
		projectId: document?.id ?? null,
		documentRevision: document?.revision ?? null,
	};
}
/** Revalidation occurs immediately before the single synchronous host store write. */
export function commitHostStreetChangeSet(input: StreetApplicationChangeSet) {
	const { change } = prepareHostStreetChangeSet(input),
		state = useScene.getState();
	withAcceptedStreetCommand(() =>
		state.applyNodeChanges({
			create: change.create.map((op) => ({
				node: op.node as unknown as AnyNode,
				...(op.parentId === null ? {} : { parentId: op.parentId as AnyNodeId }),
			})),
			update: change.update.map((op) => {
				const data: Record<string, unknown> = { ...op.data };
				for (const field of op.unset) data[field] = undefined;
				return { id: op.id as AnyNodeId, data: data as Partial<AnyNode> };
			}),
			delete: change.delete.map((id) => id as AnyNodeId),
		}),
	);
	return change;
}
