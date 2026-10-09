import { expect, test } from "bun:test";
import { prepareOsmStreetImport, completeOsmStreetImport } from "./osm-import";
import { createImportedStreetProject } from "./osm-baseline-bridge";
import {
	compileLaneMovements,
	compileProjectLaneMovements,
} from "./lane-movement-graph";
import { prepareLaneMovementDecision } from "./domain/lane-movement-decision";
import { RoadNetworkNode, RoadStylePreset } from "./schema";
import { laneMovementId } from "./domain/lane-movement";
async function imported(connectivity = false) {
	const acquisition = await Bun.file(
		new URL(
			"../docs/fixtures/osm-movement-acquisition-v1.json",
			import.meta.url,
		),
	).json();
	if (connectivity)
		acquisition.responses[0].payload.elements.push({
			type: "relation",
			id: 200,
			tags: { type: "connectivity", connectivity: "1:2|2:1,(2)" },
			members: [
				{ type: "way", ref: 10, role: "from" },
				{ type: "node", ref: 2, role: "via" },
				{ type: "way", ref: 30, role: "to" },
			],
		});
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadAcquisition: async () => acquisition,
		loadTerrain: false,
	});
	const result = await completeOsmStreetImport({
		...prepared,
		regionalPolicy: {
			id: "right-driving",
			version: 1,
			status: "confirmed",
			basis: "manual",
			evidence: null,
		},
	});
	return createImportedStreetProject(result, {
		acceptedAt: "2026-10-09T00:00:00Z",
	});
}
test("legal lane graph is pure, excludes forbidden turns, and keeps inferences pending", async () => {
	const project = await imported(),
		before = JSON.stringify(project),
		graph = compileProjectLaneMovements(project);
	expect(JSON.stringify(project)).toBe(before);
	expect(compileProjectLaneMovements(project)).toEqual(graph);
	const from = graph.lanes.filter(
		(l) => l.wayId === 10 && l.viaNodeId === 2 && l.role === "incoming",
	);
	const forbidden = new Set(
		graph.lanes
			.filter((l) => l.wayId === 20 && l.role === "outgoing")
			.map((l) => l.id),
	);
	expect(from).toHaveLength(2);
	expect(
		graph.links.some(
			(l) =>
				from.some((f) => f.id === l.fromLaneId) && forbidden.has(l.toLaneId),
		),
	).toBe(false);
	expect(
		graph.links.filter((l) => from.some((f) => f.id === l.fromLaneId)),
	).toHaveLength(4);
	expect(graph.links.every((l) => l.status === "pending")).toBe(true);
	expect(
		graph.lanes.some(
			(l) => l.wayId === 10 && l.viaNodeId === 2 && l.role === "outgoing",
		),
	).toBe(false);
});
test("explicit connectivity wins over lane-order inference and preserves lane-change basis", async () => {
	const graph = compileProjectLaneMovements(await imported(true));
	const accepted = graph.links.filter((l) => l.status === "accepted");
	expect(accepted).toHaveLength(3);
	expect(
		accepted.every(
			(l) =>
				l.basis === "source-connectivity" &&
				l.evidenceIds.includes("osm~relation~200"),
		),
	).toBe(true);
	expect(accepted.some((l) => l.requiresLaneChange)).toBe(true);
	expect(
		graph.links
			.filter((l) => l.basis === "inferred")
			.every((l) => l.status === "pending" && !l.suggested),
	).toBe(true);
});
test("review accepts an alternative target, records rejection and rejects stale or forbidden changes", async () => {
	const project = await imported(),
		graph = compileProjectLaneMovements(project),
		link = graph.links.find((l) => !l.suggested)!;
	const decision = {
		id: link.id,
		fromLaneId: link.fromLaneId,
		toLaneId: link.toLaneId,
		status: "accepted",
		reason: "Reviewed lane destination",
		acceptedAt: "2026-10-09T00:00:00Z",
	};
	const next = prepareLaneMovementDecision(project, 0, decision);
	expect(next.revision).toBe(1);
	expect(project.revision).toBe(0);
	expect(
		compileProjectLaneMovements(next).links.find((l) => l.id === link.id),
	).toMatchObject({
		basis: "correction",
		status: "accepted",
		reason: decision.reason,
	});
	const rejected = prepareLaneMovementDecision(next, 1, {
		...decision,
		status: "rejected",
	});
	expect(
		compileProjectLaneMovements(rejected).links.find((l) => l.id === link.id)!
			.status,
	).toBe("rejected");
	expect(() => prepareLaneMovementDecision(next, 0, decision)).toThrow(
		"revision conflict",
	);
	const from = graph.lanes.find(
			(l) => l.wayId === 10 && l.viaNodeId === 2 && l.role === "incoming",
		)!,
		to = graph.lanes.find(
			(l) => l.wayId === 20 && l.viaNodeId === 2 && l.role === "outgoing",
		)!;
	expect(() =>
		prepareLaneMovementDecision(project, 0, {
			...decision,
			id: laneMovementId(from.id, to.id),
			fromLaneId: from.id,
			toLaneId: to.id,
		}),
	).toThrow("forbidden");
});
function network() {
	return RoadNetworkNode.parse({
		id: "road-network_lanes",
		graphNodes: {
			a: { id: "a", position: [-30, 0, 0] },
			j: { id: "j", position: [0, 0, 0] },
			b: { id: "b", position: [30, 0, 0] },
		},
		edges: {
			a: { id: "a", startNodeId: "a", endNodeId: "j", styleId: "s" },
			b: { id: "b", startNodeId: "j", endNodeId: "b", styleId: "s" },
		},
		stylePresets: {
			s: RoadStylePreset.parse({
				id: "s",
				name: "Two-way",
				laneCount: 2,
				laneDirections: ["backward", "forward"],
			}),
		},
		activeStyleId: "s",
	});
}
test("endpoint intervals count only active traffic lanes and use reverse travel lane order", () => {
	const road = network();
	road.edges.a!.sectionLayout = {
		format: "street-section-layout",
		schemaVersion: 1,
		length: 30,
		intervals: [
			{
				id: "base",
				start: 0,
				end: 20,
				lanes: [
					{ id: "back", direction: "backward", use: "general", width: 3 },
					{ id: "forward", direction: "forward", use: "general", width: 3 },
				],
				leftBands: [],
				rightBands: [],
			},
			{
				id: "pocket",
				start: 20,
				end: 30,
				lanes: [
					{ id: "back", direction: "backward", use: "general", width: 3 },
					{ id: "forward", direction: "forward", use: "general", width: 3 },
					{
						id: "pocket",
						direction: "forward",
						use: "turning",
						width: 3,
						startWidth: 0,
						endWidth: 3,
					},
				],
				leftBands: [{ id: "bike", kind: "protected-cycling", width: 1.5 }],
				rightBands: [],
			},
		],
	};
	const graph = compileLaneMovements([{ roadId: "road", network: road }]);
	expect(
		graph.lanes.filter(
			(l) => l.nodeId === "j" && l.edgeId === "a" && l.role === "incoming",
		),
	).toHaveLength(2);
	expect(graph.lanes.some((l) => l.laneId === "bike")).toBe(false);
	expect(
		graph.lanes.filter(
			(l) => l.nodeId === "a" && l.edgeId === "a" && l.direction === "forward",
		),
	).toHaveLength(1);
	const before = JSON.stringify(road);
	expect(compileLaneMovements([{ roadId: "road", network: road }])).toEqual(
		graph,
	);
	expect(JSON.stringify(road)).toBe(before);
});
test("coincident grade-separated nodes never connect, and removed lane decisions are diagnosed", () => {
	const road = network(),
		graph = compileLaneMovements([{ roadId: "road", network: road }]);
	const link = graph.links[0]!;
	const decisions = {
		[link.id]: {
			id: link.id,
			fromLaneId: link.fromLaneId,
			toLaneId: link.toLaneId,
			status: "accepted" as const,
			reason: "Accepted fixture",
			acceptedAt: "2026-10-09T00:00:00Z",
		},
	};
	road.graphNodes.k = { ...road.graphNodes.j!, id: "k", position: [0, 5, 0] };
	road.edges.b!.startNodeId = "k";
	const next = compileLaneMovements(
		[{ roadId: "road", network: road }],
		undefined,
		decisions,
	);
	expect(next.links).toHaveLength(0);
	expect(
		next.diagnostics.some((d) => d.code === "stale-movement-decision"),
	).toBe(true);
});
