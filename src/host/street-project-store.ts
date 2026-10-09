import { verifyStreetProjectSnapshots } from "../source/osm-snapshot-project";
import { useScene, type AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "../schema";
import { createLegacyStreetProject } from "../street-project-compatibility";
import {
	parseStreetProject,
	type StreetFeature,
} from "../domain/street-project";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
	inspectStreetProjectProjection,
	type StreetProjectProjection,
} from "./street-project-persistence";

/** Host action participates in normal save, dirty tracking and undo history. */
export function persistStreetProject(
	siteId: string,
	input: Parameters<typeof prepareStreetProjectPersistence>[2],
) {
	const state = useScene.getState();
	if (state.readOnly)
		throw new Error("Cannot persist a street project in a read-only scene");
	const scene = {
		nodes: state.nodes,
		rootNodeIds: state.rootNodeIds,
		collections: state.collections,
		materials: state.materials,
		installedPlugins: state.installedPlugins,
	};
	const prepared = prepareStreetProjectPersistence(scene, siteId, input);
	state.updateNode(siteId as AnyNodeId, { metadata: prepared.metadata });
	const stored = readStreetProjectFromSite(
		useScene.getState().nodes[siteId as AnyNodeId],
	);
	if (!stored || stored.project.revision !== prepared.document.project.revision)
		throw new Error("Host did not commit the street project");
	return prepared;
}

export function loadStreetProject(siteId: string) {
	const state = useScene.getState();
	const document = readStreetProjectFromSite(state.nodes[siteId as AnyNodeId]);
	if (!document) return null;
	return {
		document,
		projectionProblems: inspectStreetProjectProjection(state, siteId, document),
	};
}

/** Explicit opt-in legacy capture, including full standalone and attached plugin assets. */
export function captureLegacyStreetProject(
	siteId: string,
	input: {
		id: string;
		name: string;
		baselineRevisionId: string;
		acceptedAt: string;
	},
) {
	const state = useScene.getState();
	const owner = state.nodes[siteId as AnyNodeId];
	if (
		owner?.type !== "site" ||
		!state.rootNodeIds.includes(siteId as AnyNodeId)
	)
		throw new Error("Street project owner must be an existing root site");
	const descendants = Object.values(state.nodes).filter((node) => {
		const seen = new Set<string>();
		let current: string | null | undefined = node.parentId;
		while (current && !seen.has(current)) {
			if (current === siteId) return true;
			seen.add(current);
			current = state.nodes[current as AnyNodeId]?.parentId;
		}
		return false;
	});
	const roads = descendants
		.filter((node) => (node.type as string) === "streetscape:road-network")
		.map((node) => RoadNetworkNode.parse(node));
	const project = createLegacyStreetProject({ ...input, roads });
	const baseline = project.baselineRevisions[input.baselineRevisionId]!;
	const attachedIds = new Set(
		roads.flatMap((road) =>
			Object.values(road.attachments).map(
				(attachment) => attachment.assetNodeId,
			),
		),
	);
	for (const node of descendants) {
		if ((node.type as string) === "streetscape:road-network") continue;
		if (!node.type.startsWith("streetscape:") && !attachedIds.has(node.id))
			continue;
		const feature: StreetFeature = {
			id: node.id,
			kind: "scene-asset",
			origin: "legacy-authored",
			sourceReferenceIds: [],
			sourceFeatureId: null,
			representation: "pascal-scene-node-v1",
			data: JSON.parse(JSON.stringify(node)),
		};
		baseline.features[feature.id] = feature;
	}
	const missingAttachments = [...attachedIds].filter(
		(id) => !baseline.features[id],
	);
	if (missingAttachments.length)
		throw new Error(
			`Cannot capture missing or out-of-site attached assets: ${missingAttachments.join(", ")}`,
		);
	const projection: StreetProjectProjection = {
		baselineRevisionId: baseline.id,
		scenarioId: null,
		bindings: [
			...Object.keys(baseline.roads).map((featureId) => ({
				category: "roads" as const,
				featureId,
				nodeIds: [featureId],
			})),
			...Object.keys(baseline.features).map((featureId) => ({
				category: "features" as const,
				featureId,
				nodeIds: [featureId],
			})),
		],
	};
	return { project: parseStreetProject(project), projection };
}

/** Use this entry point for documents containing captured snapshot evidence. */
export async function persistVerifiedStreetProject(
	siteId: string,
	input: Parameters<typeof prepareStreetProjectPersistence>[2],
) {
	const verified = await verifyStreetProjectSnapshots(input.project);
	return persistStreetProject(siteId, { ...input, project: verified.project });
}
export async function loadVerifiedStreetProject(siteId: string) {
	const loaded = loadStreetProject(siteId);
	if (!loaded) return null;
	return {
		...loaded,
		...(await verifyStreetProjectSnapshots(loaded.document.project)),
	};
}
