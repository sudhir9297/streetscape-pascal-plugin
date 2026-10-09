import { expect, test } from "bun:test";
import { RoadNetworkNode } from "./schema";
import { buildRoadAutoInfrastructurePlan } from "./road-auto-infrastructure";
import { FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS as settings } from "./road-auto-infrastructure-settings";
import {
	captureGeneratedItemAcceptance,
	generatedSourceDuplicateCandidates,
} from "./generated-item-acceptance";
import { generatedMetadata } from "./domain/generated-item-history";
const at = "2026-10-09T10:00:00Z";
function fixture() {
	const road = RoadNetworkNode.parse({
		id: "road-network_identity",
		parentId: "level_identity",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [40, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
	});
	const plan = buildRoadAutoInfrastructurePlan({
		network: road,
		edgeIds: ["ab"],
		settings,
	});
	return {
		road: RoadNetworkNode.parse({ ...road, attachments: plan.attachments }),
		assets: Object.fromEntries(plan.nodes.map((n) => [n.id, n])),
	};
}
test("acceptance is pure, captures edits once and retains deletion after serialization and length changes", () => {
	const { road, assets } = fixture(),
		before = JSON.stringify({ road, assets });
	const accepted = captureGeneratedItemAcceptance(
		road,
		road,
		{},
		assets,
		at,
	).network;
	expect(JSON.stringify({ road, assets })).toBe(before);
	const asset = Object.values(assets).find(
		(n) => n.type === "streetscape:fire-hydrant",
	)!;
	const key = generatedMetadata(asset.metadata)!.key;
	expect(accepted.generatedItemHistory[key]!.events.map((e) => e.kind)).toEqual(
		["accepted"],
	);
	const moved = {
		...assets,
		[asset.id]: { ...asset, position: [15, 0, 7], color: "#123456" },
	};
	const adjusted = RoadNetworkNode.parse({
		...accepted,
		attachments: Object.fromEntries(
			Object.entries(accepted.attachments).map(([id, a]) => [
				id,
				a.assetNodeId === asset.id ? { ...a, placementMode: "adjusted" } : a,
			]),
		),
	});
	const edited = captureGeneratedItemAcceptance(
		accepted,
		adjusted,
		assets,
		moved,
		at,
	).network;
	const twice = captureGeneratedItemAcceptance(
		accepted,
		edited,
		assets,
		moved,
		at,
	).network;
	expect(twice.generatedItemHistory[key]!.events.map((e) => e.kind)).toEqual([
		"accepted",
		"edited",
	]);
	expect(twice.generatedItemHistory[key]!.position).toEqual([15, 0, 7]);
	const remaining = { ...moved };
	delete remaining[asset.id];
	const deleted = captureGeneratedItemAcceptance(
		twice,
		twice,
		moved,
		remaining,
		at,
	).network;
	expect(deleted.generatedItemHistory[key]!.status).toBe("suppressed");
	const reload = RoadNetworkNode.parse(JSON.parse(JSON.stringify(deleted)));
	reload.graphNodes.b!.position = [80, 0, 0];
	const regenerated = buildRoadAutoInfrastructurePlan({
		network: reload,
		edgeIds: ["ab"],
		settings,
	});
	expect(
		regenerated.nodes.some((n) => generatedMetadata(n.metadata)?.key === key),
	).toBe(false);
	expect(
		Object.values(reload.generatedItemHistory).filter(
			(h) => h.status === "accepted",
		),
	).toHaveLength(Object.keys(assets).length - 1);
});
test("proposal slot identities survive station movement and accepted assets cannot share a key", () => {
	const { road, assets } = fixture();
	const expanded = RoadNetworkNode.parse({
		...road,
		graphNodes: {
			...road.graphNodes,
			b: { ...road.graphNodes.b, position: [80, 0, 0] },
		},
	});
	const next = buildRoadAutoInfrastructurePlan({
		network: expanded,
		edgeIds: ["ab"],
		settings,
	});
	const original = Object.values(assets).find(
		(n) => n.type === "streetscape:road-barrier",
	)!;
	const replacement = next.nodes.find((n) => n.type === original.type)!;
	expect(generatedMetadata(replacement.metadata)!.key).toBe(
		generatedMetadata(original.metadata)!.key,
	);
	expect(replacement.position).not.toEqual(original.position);
	expect(() =>
		captureGeneratedItemAcceptance(
			road,
			road,
			{},
			{ ...assets, duplicate: { ...original, id: "duplicate" } },
			at,
		),
	).toThrow("multiple accepted");
});
test("nearby observed source objects produce evidence, never an automatic identity match", () => {
	const { road, assets } = fixture();
	const accepted = captureGeneratedItemAcceptance(
		road,
		road,
		{},
		assets,
		at,
	).network;
	const record = Object.values(accepted.generatedItemHistory)[0]!;
	record.kind = "streetscape:street-light";
	record.position = [10, 0, 5];
	const candidates = generatedSourceDuplicateCandidates(
		{ [record.id]: record },
		{ id: "node/999", kind: "street-lamp", position: [10.5, 0, 5] },
	);
	expect(candidates).toHaveLength(1);
	expect(candidates[0]!.evidence.identityMatch).toBe(false);
	expect(candidates[0]!.evidence.distanceMeters).toBe(0.5);
	expect(
		generatedSourceDuplicateCandidates(
			{ [record.id]: record },
			{ id: "node/999", kind: "street-lamp", position: [30, 0, 5] },
		),
	).toEqual([]);
});

test("unresolved legacy suppression remains conservative after key migration and edge retirement",()=>{
 const {road}=fixture();const legacy="road-auto:streetscape:fire-hydrant:ab:999:right";
 road.roadsideItemSuppressed={[legacy]:true};
 const migrated=captureGeneratedItemAcceptance(road,road,{}, {},at).network;
 const record=Object.values(migrated.generatedItemHistory)[0]!;
 expect(record.identityStatus).toBe("legacy-unresolved");expect(record.id.startsWith("generated-key~")).toBe(true);
 const next=RoadNetworkNode.parse({...migrated,edges:{next:{id:"next",startNodeId:"a",endNodeId:"b"}}});
 const retired=captureGeneratedItemAcceptance(migrated,next,{}, {},at).network;
 expect(Object.values(retired.generatedItemHistory)[0]!.edgeId).toBe("unlocated");
 const plan=buildRoadAutoInfrastructurePlan({network:retired,edgeIds:["next"],settings});
 expect(plan.nodes.some(n=>n.type==="streetscape:fire-hydrant")).toBe(false);
});
