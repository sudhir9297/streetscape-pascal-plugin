import { expect, test } from "bun:test";
import { RoadNetworkNode, RoadStylePreset } from "./schema";
import { compileStreet } from "./street-compiler";
import { compileLaneMovements } from "./lane-movement-graph";
import { laneMovementId } from "./domain/lane-movement";
import {
	SiteNode,
	BuildingNode,
	LevelNode,
	type AnyNodeId,
	type AnyNode,
} from "@pascal-app/core";
import { roadMovementContext } from "./host/road-movement-context";

test("movement context walks level and building ancestors without parsing them as sites", () => {
	const node = fixture();
	const site = SiteNode.parse({ id: "site_context" });
	const building = BuildingNode.parse({
		id: "building_context",
		parentId: site.id,
	});
	const level = LevelNode.parse({ id: "level_context", parentId: building.id });
	node.parentId = level.id;
	const nodes: Record<AnyNodeId, AnyNode> = {
		[site.id]: site,
		[building.id]: building,
		[level.id]: level,
	};
	expect(roadMovementContext(node, (id) => nodes[id])).toBeUndefined();
});

function fixture() {
	return RoadNetworkNode.parse({
		id: "road-network_junction",
		graphNodes: {
			a: { id: "a", position: [-60, 0, 0] },
			j: { id: "j", position: [0, 0, 0] },
			b: { id: "b", position: [60, 0, 0] },
			c: { id: "c", position: [0, 0, 60] },
		},
		edges: {
			a: { id: "a", startNodeId: "a", endNodeId: "j", styleId: "s" },
			b: { id: "b", startNodeId: "j", endNodeId: "b", styleId: "s" },
			c: { id: "c", startNodeId: "j", endNodeId: "c", styleId: "s" },
		},
		junctions: { j: { nodeId: "j", kind: "tee", treatment: "signal" } },
		stylePresets: {
			s: RoadStylePreset.parse({
				id: "s",
				name: "Street",
				laneCount: 2,
				laneWidths: [2.5, 4],
				laneDirections: ["backward", "forward"],
				markings: true,
			}),
		},
		activeStyleId: "s",
	});
}
function reviewed(node: RoadNetworkNode) {
	const graph = compileLaneMovements([{ roadId: node.id, network: node }]);
	const from = graph.lanes.find(
		(l) => l.edgeId === "a" && l.nodeId === "j" && l.role === "incoming",
	)!;
	const to = graph.lanes.find(
		(l) => l.edgeId === "c" && l.nodeId === "j" && l.role === "outgoing",
	)!;
	const id = laneMovementId(from.id, to.id);
	return compileLaneMovements([{ roadId: node.id, network: node }], undefined, {
		[id]: {
			id,
			fromLaneId: from.id,
			toLaneId: to.id,
			status: "accepted",
			reason: "Reviewed turn",
			acceptedAt: "2026-10-09T00:00:00Z",
		},
	});
}
test("junction arrows follow accepted links and 2D uses the same polygons as 3D", () => {
	const node = fixture(),
		before = JSON.stringify(node);
	expect(
		compileStreet(node).markings.filter((m) => m.kind === "direction-arrow"),
	).toHaveLength(0);
	const graph = reviewed(node),
		plan = compileStreet(node, null, graph);
	const arrows = plan.markings.filter((m) => m.kind === "direction-arrow");
	expect(arrows.length).toBeGreaterThan(0);
	expect(
		arrows.every((m) => m.edgeId === "a" && m.movementIds?.length === 1),
	).toBe(true);
	expect(plan.junctionMovementPlan.signalProposals).toHaveLength(3);
	expect(
		plan.junctionMovementPlan.signalProposals.every(
			(p) => p.status === "pending" && !("phases" in p),
		),
	).toBe(true);
	expect(
		plan.junctionMovementPlan.crossings.every((p) =>
			p.movementIds.every((id) =>
				graph.links.some((l) => l.id === id && l.status === "accepted"),
			),
		),
	).toBe(true);
	const polygons: any[] = [];
	const collect = (g: any) => {
		if (g.kind === "polygon") polygons.push(g);
		if (g.children) g.children.forEach(collect);
	};
	collect(plan.canonicalFloorplan);
	expect(
		arrows.every((m) =>
			polygons.some(
				(p) =>
					JSON.stringify(p.points) ===
					JSON.stringify(m.points.map((v) => [v[0], v[2]])),
			),
		),
	).toBe(true);
	expect(JSON.stringify(node)).toBe(before);
	expect(compileStreet(node, null, graph)).toEqual(plan);
	expect(Object.keys(node.edges)).toHaveLength(3);
});
test("endpoint sections determine widths and short or incompatible approaches require manual review", () => {
	const node = fixture();
	node.edges.a!.sectionLayout = {
		format: "street-section-layout",
		schemaVersion: 1,
		length: 60,
		intervals: [
			{
				id: "section",
				start: 0,
				end: 60,
				lanes: [
					{ id: "reverse", direction: "backward", use: "general", width: 2.5 },
					{ id: "forward", direction: "forward", use: "general", width: 4 },
				],
				leftBands: [],
				rightBands: [],
			},
		],
	};
	const plan = compileStreet(node, null, reviewed(node));
	const stop = plan.markings.find(
		(m) => m.kind === "stop-line" && m.edgeId === "a",
	)!;
	expect(Math.abs(stop.points[0]![2] - stop.points[3]![2])).toBeCloseTo(4);
	const centerline = plan.markings.find(
		(m) => m.kind === "centerline" && m.edgeId === "a",
	)!;
	expect(
		centerline.points.reduce((sum, p) => sum + p[2], 0) /
			centerline.points.length,
	).toBeCloseTo(0.75);
	const lane = node.edges.a!.sectionLayout!.intervals[0]!.lanes[1]!;
	lane.startWidth = 2.5;
	lane.endWidth = 4;
	const taper = compileStreet(node, null, reviewed(node)),
		taperStop = taper.markings.find(
			(m) => m.kind === "stop-line" && m.edgeId === "a",
		)!;
	const distance = taper.layout.junctionTrimByApproach["j:a"]! + 5.5;
	expect(
		Math.abs(taperStop.points[0]![2] - taperStop.points[3]![2]),
	).toBeCloseTo(2.5 + (1.5 * (60 - distance)) / 60);
	node.graphNodes.a!.position = [-5, 0, 0];
	node.edges.a!.sectionLayout = undefined;
	const short = compileStreet(node, null, reviewed(node));
	expect(
		short.diagnostics.some(
			(d) => d.code === "junction-short-approach" && d.edgeId === "a",
		),
	).toBe(true);
	expect(short.markings.some((m) => m.junctionId && m.edgeId === "a")).toBe(
		false,
	);
	node.graphNodes.a!.position = [-60, 0, 0];
	node.applyStyleToAll = false;
	node.stylePresets.w = RoadStylePreset.parse({
		id: "w",
		name: "Wide",
		laneCount: 8,
		laneWidth: 4,
	});
	node.edges.c!.styleId = "w";
	const wide = compileStreet(node, null, reviewed(node));
	expect(wide.diagnostics.some((d) => d.code === "junction-width-review")).toBe(
		true,
	);
	expect(wide.markings.some((m) => m.junctionId)).toBe(false);
});

test("mapped crossings relate to accepted departures as well as incoming approaches", () => {
	const node = fixture();
	node.osmCrossings.push({
		id: 1,
		kind: "crossing",
		associatedEdgeId: "c",
		point: [0, 0, 12],
		rotationY: 0,
		tags: { highway: "crossing" },
	});
	const graph = reviewed(node),
		plan = compileStreet(node, null, graph);
	const crossing = plan.junctionMovementPlan.crossings.find(
		(c) => c.basis === "mapped",
	)!;
	expect(crossing.movementIds).toEqual(
		graph.links.filter((l) => l.status === "accepted").map((l) => l.id),
	);
	expect(Object.keys(node.edges)).toHaveLength(3);
});
