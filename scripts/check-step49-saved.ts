import { useScene, clearSceneHistory, registerNode } from "@pascal-app/core";
import { RoadNetworkNode } from "../src/schema";
import { buildRoadAutoInfrastructurePlan } from "../src/road-auto-infrastructure";
import { FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS as settings } from "../src/road-auto-infrastructure-settings";
import { installAttachedAssetHostAdapter } from "../src/host/attached-asset-host-adapter";
import { readStreetProjectFromSite } from "../src/host/street-project-persistence";
import { generatedMetadata } from "../src/domain/generated-item-history";
import {
	drainageInletDefinition,
	fireHydrantDefinition,
	manholeCoverDefinition,
	roadBarrierDefinition,
	trafficBollardDefinition,
	trafficSignalDefinition,
} from "../src/street-infrastructure-definition";
for (const definition of [
	drainageInletDefinition,
	fireHydrantDefinition,
	manholeCoverDefinition,
	roadBarrierDefinition,
	trafficBollardDefinition,
	trafficSignalDefinition,
])
	registerNode(definition as any);
const url = "http://localhost:3002/api/scenes/31a08dab91d0";
const load = async () => {
	const r = await fetch(url);
	if (!r.ok) throw Error(`load ${r.status}`);
	return r.json();
};
const saved = await load();
const nodes = structuredClone(saved.graph.nodes);
const road = RoadNetworkNode.parse(
	Object.values(nodes).find((n: any) => n.type === "streetscape:road-network"),
);
nodes[road.id] = road;
useScene.setState({ nodes, rootNodeIds: saved.graph.rootNodeIds });
clearSceneHistory();
const dispose = installAttachedAssetHostAdapter();
try {
	const plan = buildRoadAutoInfrastructurePlan({
		network: road,
		edgeIds: Object.keys(road.edges),
		settings,
		existingNodes: Object.values(nodes) as any,
	});
	if (!plan.nodes.length) throw Error("QA fixture already generated");
	useScene
		.getState()
		.applyNodeChanges({
			update: [
				{
					id: road.id as any,
					data: {
						attachments: { ...road.attachments, ...plan.attachments },
					} as any,
				},
			],
			create: plan.nodes.map((node) => ({
				node: node as any,
				parentId: node.parentId as any,
			})),
		});
	const hydrants = plan.nodes.filter(
		(n) => n.type === "streetscape:fire-hydrant",
	);
	const moved = hydrants[0]!,
		deleted = hydrants[1]!;
	const pose = [
		moved.position[0] + 2,
		moved.position[1],
		moved.position[2] + 3,
	];
	useScene
		.getState()
		.updateNode(moved.id as any, { position: pose, color: "#bb2244" } as any);
	useScene.getState().deleteNode(deleted.id as any);
	const current = useScene.getState().nodes[
		road.id as any
	] as unknown as RoadNetworkNode;
	const graphNodes = structuredClone(current.graphNodes);
	for (const n of Object.values(graphNodes)) n.position[2] += 1;
	useScene.getState().updateNode(road.id as any, { graphNodes } as any);
	const graph = {
		...saved.graph,
		nodes: useScene.getState().nodes,
		rootNodeIds: useScene.getState().rootNodeIds,
	};
	const put = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			"If-Match": String(saved.version),
		},
		body: JSON.stringify({ name: saved.name, graph }),
	});
	const response = await put.json();
	if (!put.ok) throw Error(`save ${put.status}: ${JSON.stringify(response)}`);
	const reopened = await load(),
		reloaded = RoadNetworkNode.parse(reopened.graph.nodes[road.id]);
	const key = generatedMetadata(deleted.metadata)!.key;
	const regen = buildRoadAutoInfrastructurePlan({
		network: reloaded,
		edgeIds: Object.keys(reloaded.edges),
		settings,
		existingNodes: Object.values(reopened.graph.nodes) as any,
	});
	const movedReloaded = reopened.graph.nodes[moved.id];
	const site = Object.values(reopened.graph.nodes).find(
		(n: any) => n.type === "site",
	);
	const doc = readStreetProjectFromSite(site as any)!;
	if (
		JSON.stringify(movedReloaded.position) !== JSON.stringify(pose) ||
		movedReloaded.color !== "#bb2244" ||
		reopened.graph.nodes[deleted.id] ||
		reloaded.generatedItemHistory[key]?.status !== "suppressed" ||
		regen.nodes.length
	)
		throw Error("Persistence acceptance failed");
	console.log(
		JSON.stringify(
			{
				sceneId: "31a08dab91d0",
				saveStatus: put.status,
				history: Object.keys(reloaded.generatedItemHistory).length,
				movedId: moved.id,
				deletedId: deleted.id,
				movedPose: movedReloaded.position,
				color: movedReloaded.color,
				deletedAbsent: true,
				suppression: reloaded.generatedItemHistory[key]!.status,
				regenerationCount: regen.nodes.length,
				projectRevision: doc.project.revision,
				version: reopened.version,
			},
			null,
			2,
		),
	);
} finally {
	dispose();
}
