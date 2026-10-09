import { useScene, type AnyNodeId } from "@pascal-app/core";
import { resolveEffectiveStreetModel } from "../effective-street-model";
import {
	RoadNetworkNode,
	StreetLightNode,
	RoadSignNode,
	TrafficSignalNode,
} from "../schema";
import {
	parseStreetProject,
	type StreetProject,
} from "../domain/street-project";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
	type StreetProjectProjection,
} from "./street-project-persistence";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./application-change-set";
import {
	StreetApplicationChangeSet,
	type StreetIdentityReference,
} from "../domain/application-change-set";
/** One atomic, undoable commit after a complete detached merge review. */
export function acceptStreetSourceMerge(
	siteId: string,
	currentIdentity: string,
	input: StreetProject,
) {
	const scene = useScene.getState(),
		stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	if (!stored || canonicalSourceJson(stored.project) !== currentIdentity)
		throw Error("Accepted project changed; prepare the merge again");
	const project = parseStreetProject(input);
	if (
		project.id !== stored.project.id ||
		project.revision !== stored.project.revision + 1
	)
		throw Error("Invalid merged project revision");
	const effective = resolveEffectiveStreetModel(
		project,
		project.activeBaselineRevisionId,
		project.activeScenarioId,
	);
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const parent = stored.projection.bindings
		.flatMap((b) => b.nodeIds)
		.map((id) => scene.nodes[id as AnyNodeId]?.parentId)
		.find(Boolean);
	if (!parent) throw Error("A projected street level is required");
	const create: StreetApplicationChangeSet["create"] = [],
		update: StreetApplicationChangeSet["update"] = [],
		remove: string[] = [],
		remaps: StreetApplicationChangeSet["identityRemaps"] = [],
		bindings: StreetProjectProjection["bindings"] = [];
	const nodes: Record<string, any> = structuredClone(scene.nodes);
	const remap = (from: StreetIdentityReference) =>
		remaps.push({ from, to: [] });
	for (const category of ["roads", "features"] as const) {
		for (const [id, feature] of Object.entries(baseline[category])) {
			const binding = stored.projection.bindings.find(
				(b) => b.category === category && b.featureId === id,
			);
			if (binding && binding.nodeIds.length !== 1)
				throw Error("Merge requires one node per projection binding");
			const oldNode = binding
				? scene.nodes[binding.nodeIds[0]! as AnyNodeId]
				: null;
			let node: any;
			if (category === "roads") {
				const road = effective.roads[id]!;

				node = RoadNetworkNode.parse({
					...oldNode,
					...road,
					id: oldNode?.id,
					parentId: oldNode?.parentId ?? parent,
				});
			} else if (feature.representation === "pascal-scene-node-v1")
				node = {
					...oldNode,
					...(effective.features[id]?.data ?? feature.data),
					visible: !!effective.features[id],
					id: oldNode?.id ?? feature.data.id,
					parentId: oldNode?.parentId ?? parent,
				};
			else {
				const data = effective.features[id]?.data ?? feature.data;
				const shared = {
					...oldNode,
					id: oldNode?.id,
					parentId: oldNode?.parentId ?? parent,
					position: data.position,
					rotation: [0, data.rotationY ?? 0, 0],
					visible: !!effective.features[id],
				};
				node =
					data.kind === "street-lamp"
						? StreetLightNode.parse({ ...shared, height: data.height })
						: data.kind === "road-sign"
							? RoadSignNode.parse({
									...shared,
									signId: data.signId,
									text: data.text,
								})
							: data.kind === "traffic-signal"
								? TrafficSignalNode.parse({
										...shared,
										cabinet: false,
										headCount: "one",
										mount: "post",
										signalState: "red",
										streetNameSign: false,
									})
								: null;
				if (!node)
					throw Error(
						"Feature projection requires an explicit supported asset representation",
					);
			}
			bindings.push({ category, featureId: id, nodeIds: [node.id] });
			nodes[node.id] = node;
			if (oldNode) {
				const { id: nodeId, type, ...patch } = node;
				update.push({
					id: nodeId,
					data: JSON.parse(JSON.stringify(patch)),
					unset: [],
				});
				if (category === "roads")
					for (const [field, kind] of [
						["edges", "road-edge"],
						["graphNodes", "road-node"],
					] as const)
						for (const key of Object.keys((oldNode as any)[field]))
							if (!node[field][key])
								remap({ kind, networkId: nodeId, id: key });
			} else
				create.push({
					node: JSON.parse(JSON.stringify(node)),
					parentId: parent,
				});
		}
		for (const binding of stored.projection.bindings.filter(
			(b) => b.category === category && !baseline[category][b.featureId],
		)) {
			remap({
				kind: category === "roads" ? "baseline-road" : "baseline-feature",
				siteId,
				id: binding.featureId,
			});
			for (const id of binding.nodeIds) {
				remove.push(id);
				remap({ kind: "host-node", id });
				const node = nodes[id];
				if (category === "roads")
					for (const [field, kind] of [
						["edges", "road-edge"],
						["graphNodes", "road-node"],
					] as const)
						for (const key of Object.keys(node[field]))
							remap({ kind, networkId: id, id: key });
				delete nodes[id];
			}
		}
	}
	// Preview parent-child lists exactly as the host change-set adapter will create them.
	for (const node of Object.values(nodes))
		if (Array.isArray(node.children))
			node.children = node.children.filter(
				(id: string) => !remove.includes(id),
			);
	for (const op of create) {
		const owner = nodes[op.parentId!];
		if (owner)
			owner.children = [...new Set([...(owner.children ?? []), op.node.id])];
	}
	const prepared = prepareStreetProjectPersistence(
		{ ...scene, nodes },
		siteId,
		{
			project,
			projection: {
				baselineRevisionId: project.activeBaselineRevisionId,
				scenarioId: project.activeScenarioId,
				bindings,
			},
			expectedRevision: stored.project.revision,
		},
	);
	update.push({
		id: siteId,
		data: { metadata: JSON.parse(JSON.stringify(prepared.metadata)) },
		unset: [],
	});
	return commitHostStreetChangeSet(
		StreetApplicationChangeSet.parse({
			format: "street-application-change-set",
			schemaVersion: 1,
			id: `source-refresh-${crypto.randomUUID()}`,
			reason: "Accept reviewed source refresh merge",
			expected: captureStreetChangePreconditions(siteId),
			create,
			update,
			delete: remove,
			identityRemaps: remaps,
			affectedGeometry: [
				...new Set([
					...create.map((op) => String(op.node.id)),
					...update.filter((op) => op.id !== siteId).map((op) => op.id),
					...remove,
				]),
			],
		}),
	);
}
