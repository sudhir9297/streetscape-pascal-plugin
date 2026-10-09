import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode, StreetLightNode } from "../src/schema";
import { captureLegacyStreetProject } from "../src/host/street-project-store";
import { convertStreetProjectRoads } from "../src/street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "../src/host/street-project-persistence";

import { installAttachedAssetHostAdapter } from "../src/host/attached-asset-host-adapter";
export function setupAttachmentBrowserFixture() {
	const site = SiteNode.parse({
		id: "site_asset-batch",
		children: ["building_asset-batch"],
	});
	const building = BuildingNode.parse({
		id: "building_asset-batch",
		parentId: site.id,
		children: ["level_asset-batch"],
	});
	const level = LevelNode.parse({
		id: "level_asset-batch",
		parentId: building.id,
		children: [
			"road-network_asset-batch",
			"street-light_batch-a",
			"street-light_batch-b",
		],
	});
	const road = RoadNetworkNode.parse({
		id: "road-network_asset-batch",
		parentId: level.id,
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [10, 0, 0] },
 c: {id:"c",position:[20,0,0]}, d:{id:"d",position:[30,0,0]},
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" }, bc:{id:"bc",startNodeId:"b",endNodeId:"c"},cd:{id:"cd",startNodeId:"c",endNodeId:"d"} },
		attachments: Object.fromEntries(
			["a", "b"].map((id, i) => [
				id,
				{
					id,
					edgeId: i ? "cd" : "ab",
					assetNodeId: `street-light_batch-${id}`,
					station: 5,
					lateralOffset: 4,
				},
			]),
		),
	});
	const assets = ["a", "b"].map((id, i) =>
		StreetLightNode.parse({
			id: `street-light_batch-${id}`,
			parentId: level.id,
			position: [5 + i * 20, 0, 4],
			roadAttachment: { networkNodeId: road.id, attachmentId: id },
		}),
	);
	useScene.setState({
		nodes: Object.fromEntries(
			[site, building, level, road, ...assets].map((n) => [n.id, n]),
		) as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	const captured = captureLegacyStreetProject(site.id, {
		id: "asset-batch-project",
		name: "Asset batch",
		baselineRevisionId: "original",
		acceptedAt: "2026-10-08T12:00:00Z",
	});
	const project = convertStreetProjectRoads(captured.project);
	const stored = prepareStreetProjectPersistence(useScene.getState(), site.id, {
		project,
		projection: captured.projection,
		expectedRevision: null,
	});
	useScene.getState().applyNodeChanges({
		update: [{ id: site.id, data: { metadata: stored.metadata } }],
	});
	clearSceneHistory();
	return { site, road, assets, project };
}

export function runStep24BrowserFixture() {
 const original=useScene.getState(), oldHistory=useScene.temporal.getState();
 const history={pastStates:[...oldHistory.pastStates],futureStates:[...oldHistory.futureStates]};
 const checks: {name:string;pass:boolean}[]=[];
 const check=(name:string,pass:boolean)=>{checks.push({name,pass});if(!pass)throw Error(name)};
 try {
  check('no Canvas is mounted', Array.from(document.querySelectorAll('canvas')).filter(canvas=>!canvas.closest('.fps-extension')).length===0);
  const {site,road,assets,project}=setupAttachmentBrowserFixture();
  installAttachedAssetHostAdapter();
  const before=useScene.getState().nodes;
  useScene.getState().updateNode(assets[1]!.id as AnyNodeId,{position:[27,2,6]} as Partial<AnyNode>);
  const moved=useScene.getState().nodes;
  const currentRoad=moved[road.id as AnyNodeId] as unknown as RoadNetworkNode;
  check('generic asset edit retains adjusted station',currentRoad.attachments.b!.placementMode==='adjusted' && Math.abs(currentRoad.attachments.b!.station-7)<1e-6);
  check('asset edit is one undo entry',useScene.temporal.getState().pastStates.length===1);
  const {bc:removed,...edges}=road.edges;
  useScene.getState().updateNode(road.id as AnyNodeId,{edges} as Partial<AnyNode>);
  const state=useScene.getState();
  const roads=Object.values(state.nodes).filter(n=>(n.type as string)==='streetscape:road-network') as unknown as RoadNetworkNode[];
  check('generic edge removal splits disconnected components',roads.length===2);
  const owner=roads.find(n=>n.attachments.b);
  check('adjusted asset ownership and station survive split',!!owner && owner.id!==road.id && owner.attachments.b!.placementMode==='adjusted' && Math.abs(owner.attachments.b!.station-7)<1e-6);
  check('asset reverse reference follows component owner',(state.nodes[assets[1]!.id as AnyNodeId] as unknown as {roadAttachment:{networkNodeId:string}}).roadAttachment.networkNodeId===owner!.id);
  const stored=readStreetProjectFromSite(state.nodes[site.id])!;
  check('document has two road bindings and one revision per edit',stored.projection.bindings.filter(b=>b.category==='roads').length===2 && stored.project.revision===project.revision+2);
  check('historical accepted baseline stays exact',JSON.stringify(stored.project.baselineRevisions.original)===JSON.stringify(project.baselineRevisions.original));
  check('split is one additional undo entry',useScene.temporal.getState().pastStates.length===2);
  useScene.temporal.getState().undo();
  check('split undo restores graph assets and document',JSON.stringify(useScene.getState().nodes)===JSON.stringify(moved));
  useScene.temporal.getState().undo();
  check('asset move undo restores initial graph and document',JSON.stringify(useScene.getState().nodes)===JSON.stringify(before));
  return {pass:true,checks};
 } catch(error) {return {pass:false,error:String(error),checks};}
 finally {useScene.setState(original);useScene.temporal.setState(history);}
}
