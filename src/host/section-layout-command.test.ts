import { test, expect } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode, StreetLightNode } from "../schema";
import { captureLegacyStreetProject } from "./street-project-store";
import { convertStreetProjectRoads } from "../street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
import { prepareAttachedAssetEdits } from "./attached-asset-edit";
import { commitHostStreetChangeSet } from "./application-change-set";

import { prepareImageryAssetCorrection } from "./imagery-asset-correction";
import { createManualImageReference } from "../domain/street-imagery";
import { acceptStreetSectionLayout } from "./section-layout-command";
import { asymmetricLayout } from "../domain/street-section-layout-fixture";
function fixture(attached: boolean) {
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
			b: { id: "b", position: [30, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
		attachments: !attached
			? {}
			: Object.fromEntries(
					["a", "b"].map((id, i) => [
						id,
						{
							id,
							edgeId: "ab",
							assetNodeId: `street-light_batch-${id}`,
							station: 5 + i * 10,
							lateralOffset: 4,
						},
					]),
				),
	});
	const assets = ["a", "b"].map((id, i) =>
		StreetLightNode.parse({
			id: `street-light_batch-${id}`,
			parentId: level.id,
			position: [5 + i * 10, 0, 4],
			roadAttachment: attached
				? { networkNodeId: road.id, attachmentId: id }
				: undefined,
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

test("section projection preserves current hierarchy when captured baseline parent is stale", () => {
	const { site, road } = fixture(false);
	const scene = useScene.getState();
	const stored = readStreetProjectFromSite(scene.nodes[site.id])!;
	const baseline =
		stored.project.baselineRevisions[stored.project.activeBaselineRevisionId]!;
	const binding = stored.projection.bindings.find(
		(binding) => binding.category === "roads",
	)!;
	const semantic = baseline.roads[binding.featureId]!;
	const compatibility = semantic.data.compatibility as {
		node: Record<string, unknown>;
	};
	compatibility.node.parentId = "level_detached-original-import";
	stored.project.revision++;
	const prepared = prepareStreetProjectPersistence(scene, site.id, {
		project: stored.project,
		projection: stored.projection,
		expectedRevision: stored.project.revision - 1,
	});
	scene.applyNodeChanges({
		update: [{ id: site.id, data: { metadata: prepared.metadata } }],
	});
	clearSceneHistory();
	const before = useScene.getState().nodes;
	acceptStreetSectionLayout(
		site.id,
		stored.project.revision,
		"section:ab",
		asymmetricLayout,
		"Explicit QA interval acceptance",
	);
	const after = useScene.getState();
	expect(after.nodes[road.id as AnyNodeId]!.parentId).toBe(road.parentId);
	expect(
		(after.nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges.ab!
			.sectionLayout!.length,
	).toBe(30);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});

import { prepareRoadEditDocument } from "./road-edit-document";
import { splitRoadEdgeAtNode } from "../road-network-topology";
test("baseline split creates both editable section owners and retains historical layout evidence", () => {
	const { site, road } = fixture(false);
	let stored = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
	acceptStreetSectionLayout(
		site.id,
		stored.project.revision,
		"section:ab",
		asymmetricLayout,
		"Reviewed asymmetric section",
	);
	stored = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
	const before = RoadNetworkNode.parse(
		useScene.getState().nodes[road.id as AnyNodeId],
	);
	const next = RoadNetworkNode.parse(before);
	next.graphNodes.mid = {
		id: "mid",
		position: [15, 0, 0],
		level: 0,
		elevationMode: "ground",
		terminal: false,
	};
	const second = splitRoadEdgeAtNode(next, "ab", "mid", 0.5)!;
	const patch = { graphNodes: next.graphNodes, edges: next.edges };
	const prepared = prepareRoadEditDocument(site.id, before, patch)!;
	useScene.getState().applyNodeChanges({
		update: [
			{ id: road.id as AnyNodeId, data: patch as unknown as Partial<AnyNode> },
			{ id: site.id, data: { metadata: prepared.metadata } },
		],
	});
	const after = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
	const baseline =
		after.project.baselineRevisions[after.project.activeBaselineRevisionId]!;
	const semantic = Object.values(baseline.roads)[0]!;
	const sections = semantic.data.sections as Record<
		string,
		{ layout: { length: number }; interval: { end: number } }
	>;
	expect(sections["section:ab"]!.layout.length).toBe(15);
	expect(sections[`section:${second}`]!.layout.length).toBe(15);
	expect(sections[`section:${second}`]!.interval.end).toBe(15);
	const layout = (
		sections[`section:${second}`] as unknown as {
			layout: import("../domain/street-section-layout").StreetSectionLayout;
		}
	).layout;
	const edited = structuredClone(layout);
	edited.intervals[0]!.leftBands[0]!.width = 4;
	expect(() =>
		acceptStreetSectionLayout(
			site.id,
			after.project.revision,
			`section:${second}`,
			edited,
			"Post-split sidewalk correction",
			semantic.id,
		),
	).not.toThrow();
	const editedDoc = readStreetProjectFromSite(
		useScene.getState().nodes[site.id],
	)!;
	const editedBaseline =
		editedDoc.project.baselineRevisions[
			editedDoc.project.activeBaselineRevisionId
		]!;
	expect(
		Object.values(editedBaseline.propertyEvidence!).filter(
			(property) =>
				property.target.featureId === semantic.id &&
				JSON.stringify(property.target.path) ===
					JSON.stringify(["sections", `section:${second}`, "layout"]),
		),
	).toHaveLength(1);
	expect(
		Object.values(baseline.propertyEvidence!).some(
			(property) =>
				property.target.path[1] === `section:${second}` &&
				property.target.path[2] === "layout",
		),
	).toBe(true);
	expect(
		after.project.baselineRevisions[stored.project.activeBaselineRevisionId],
	).toEqual(
		stored.project.baselineRevisions[stored.project.activeBaselineRevisionId],
	);
});

import { createStreetScenario, selectStreetScenario, redesignStreetSectionLayout } from "./street-scenario-command";
test("named scenarios retain accepted facts, independently redesign bands and restore baseline with one Undo", () => {
 const {site, road} = fixture(false);
 let doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 acceptStreetSectionLayout(site.id, doc.project.revision, "section:ab", asymmetricLayout, "Accepted survey", road.id);
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 const baseline = structuredClone(doc.project.baselineRevisions);
 const sources = structuredClone(doc.project.sourceReferences);
 const original = (useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges;
 const scenario = createStreetScenario(site.id, doc.project.revision, "Wider sidewalks")!;
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 const layout = StreetSectionLayout.parse(asymmetricLayout);
 layout.intervals[0]!.rightBands.push({id:"design-cycle",kind:"protected-cycling",width:2});
 layout.intervals[0]!.leftBands[0]!.width += 1;
 redesignStreetSectionLayout(site.id, doc.project.revision, road.id, "section:ab", layout, "More walking and cycling space");
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 expect(doc.project.baselineRevisions).toEqual(baseline);
 expect(doc.project.sourceReferences).toEqual(sources);
 expect((useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges.ab!.sectionLayout).toEqual(layout);
 const before = useScene.getState().nodes;
 clearSceneHistory();
 selectStreetScenario(site.id, doc.project.revision, null);
 expect((useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges).toEqual(original);
 expect(useScene.temporal.getState().pastStates).toHaveLength(1);
 useScene.temporal.getState().undo();
 expect(useScene.getState().nodes).toEqual(before);
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 createStreetScenario(site.id, doc.project.revision, "Alternative");
 expect((useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges).toEqual(original);
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 selectStreetScenario(site.id, doc.project.revision, scenario);
 expect((useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges.ab!.sectionLayout).toEqual(layout);
 useScene.setState({readOnly:true});
 expect(() => selectStreetScenario(site.id, doc.project.revision, null)).toThrow("read-only");
 useScene.setState({readOnly:false});
 expect(() => selectStreetScenario(site.id, -1, null)).toThrow("revision conflict");
});

import { StreetSectionLayout } from "../domain/street-section-layout";

import { redesignStreetProperty } from "./street-scenario-command";
test("scenario material appearance and band removal are authored changes, with invalid changes atomic", () => {
 const {site,road} = fixture(false);
 let doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 acceptStreetSectionLayout(site.id,doc.project.revision,"section:ab",asymmetricLayout,"Accepted section",road.id);
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 const baselines = structuredClone(doc.project.baselineRevisions);
 createStreetScenario(site.id,doc.project.revision,"Material alternative");
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 const color = Object.values(doc.project.baselineRevisions[doc.project.activeBaselineRevisionId]!.propertyEvidence!).find(p=>p.target.path.at(-1)==="surfaceColor")!;
 redesignStreetProperty(site.id,doc.project.revision,color.id,"#999999","Lighter paving proposal");
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 expect(doc.project.scenarios[doc.project.activeScenarioId!]!.overrides![color.id]!.value).toBe("#999999");
 const layout = StreetSectionLayout.parse(asymmetricLayout);
 layout.intervals[0]!.rightBands = [];
 redesignStreetSectionLayout(site.id,doc.project.revision,road.id,"section:ab",layout,"Remove parking band for proposal");
 doc = readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 expect(doc.project.baselineRevisions).toEqual(baselines);
 expect((useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).edges.ab!.sectionLayout!.intervals[0]!.rightBands).toEqual([]);
 const before = useScene.getState().nodes;
 expect(()=>redesignStreetProperty(site.id,doc.project.revision,color.id,123,"Invalid color")).toThrow();
 expect(useScene.getState().nodes).toEqual(before);
 expect(()=>redesignStreetSectionLayout(site.id,doc.project.revision,road.id,"section:ab",layout," ")).toThrow();
 expect(useScene.getState().nodes).toEqual(before);
});

import { lockStreetScenarioSection, suppressStreetScenarioInventory, redesignStreetSectionStyle } from "./street-scenario-command";
import { resolveScenarioRoadContext } from "./effective-road-context";
import { buildRoadNetworkFloorplan } from "../road-network-floorplan";
test("effective host commands atomically suppress and restore assets; both views resolve document-owned designs",()=>{
 const {site,road,assets}=fixture(true);
 let doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 const accepted=structuredClone(doc.project.baselineRevisions);
 createStreetScenario(site.id,doc.project.revision,"Effective proposal");
 doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 redesignStreetSectionLayout(site.id,doc.project.revision,road.id,"section:ab",asymmetricLayout,"Design an inherited section without baseline correction");
 doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 const before=useScene.getState().nodes;
 clearSceneHistory();
 suppressStreetScenarioInventory(site.id,doc.project.revision,{category:"features",featureId:assets[0]!.id},true,"Suppress lamp");
 expect(useScene.getState().nodes[assets[0]!.id as AnyNodeId]!.visible).toBe(false);
 expect(useScene.temporal.getState().pastStates).toHaveLength(1);
 useScene.temporal.getState().undo();expect(useScene.getState().nodes).toEqual(before);
 doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 lockStreetScenarioSection(site.id,doc.project.revision,road.id,"section:ab",true,"Pin design");
 doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 expect(()=>redesignStreetSectionStyle(site.id,doc.project.revision,road.id,"section:ab",{surfaceMaterial:"concrete"},"Change locked design")).toThrow("Unlock");
 const resolve=(id:AnyNodeId)=>useScene.getState().nodes[id];
 const stale=RoadNetworkNode.parse(road);
 const effective=resolveScenarioRoadContext(stale,resolve);
 expect(effective.edges.ab!.sectionLayout).toEqual(StreetSectionLayout.parse(asymmetricLayout));
 expect(buildRoadNetworkFloorplan(stale,{resolve} as never)).toEqual(buildRoadNetworkFloorplan(effective,{resolve} as never));
 expect(readStreetProjectFromSite(useScene.getState().nodes[site.id])!.project.baselineRevisions).toEqual(accepted);
 doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 suppressStreetScenarioInventory(site.id,doc.project.revision,{category:"features",featureId:assets[0]!.id},true,"Suppress lamp");
 doc=readStreetProjectFromSite(useScene.getState().nodes[site.id])!;
 selectStreetScenario(site.id,doc.project.revision,null);
 expect(useScene.getState().nodes[assets[0]!.id as AnyNodeId]!.visible).toBe(true);
 expect((useScene.getState().nodes[road.id as AnyNodeId] as unknown as RoadNetworkNode).attachments).toEqual(road.attachments);
});
