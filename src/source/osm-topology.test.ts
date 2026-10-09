import { expect, test } from "bun:test";
import { buildOsmSourceTopology } from "./osm-topology";
import {
	buildSegmentsFromWays,
	ensureSimpleSegments,
	buildRoadGraphFromSegments,
	importStreetsFromOsm,
} from "../osm-import";
import type { OsmWay } from "./osm-interpretation";
const way = (
	id: number,
	nodes: number[],
	coordinates: number[][],
	tags: Record<string, string> = {},
): OsmWay => ({
	id,
	tags: { highway: "residential", ...tags },
	points: nodes.map((nodeId, i) => ({
		nodeId,
		lat: coordinates[i]![0]!,
		lon: coordinates[i]![1]!,
	})),
});
test("logical graph preserves shared nodes and legitimate parallel source edges", () => {
	const a = way(
			10,
			[1, 2],
			[
				[0, -0.001],
				[0, 0.001],
			],
		),
		b = way(
			20,
			[1, 2],
			[
				[0, -0.001],
				[0, 0.001],
			],
		);
	const topology = buildOsmSourceTopology([a, b]);
	expect(topology.nodes).toHaveLength(2);
	expect(topology.edges).toHaveLength(2);
	expect(buildOsmSourceTopology([b, a])).toEqual(topology);
	const { segments, nodePositions } = buildSegmentsFromWays(
		[a, b],
		{ lat: 0, lon: 0 },
		300,
	);
	const before = JSON.stringify(segments),
		adapted = ensureSimpleSegments(segments, nodePositions);
	expect(JSON.stringify(segments)).toBe(before);
	expect(adapted).toHaveLength(3);
	const { graph } = buildRoadGraphFromSegments(adapted, nodePositions);
	expect(
		Object.values(graph.edges)
			.map((e) => e.osmSource!.wayId)
			.sort(),
	).toEqual([10, 20, 20]);
	expect(
		Object.values(graph.graphNodes).filter(
			(n) => n.osmTopologyOrigin?.kind === "derived",
		),
	).toHaveLength(1);
});
test("different grade interior crossings remain disconnected even with conflicting shared node evidence", () => {
	const ways = [
		way(
			10,
			[1, 2, 3],
			[
				[0, -0.001],
				[0, 0],
				[0, 0.001],
			],
		),
		way(
			20,
			[4, 2, 5],
			[
				[-0.001, 0],
				[0, 0],
				[0.001, 0],
			],
			{ bridge: "yes", layer: "1" },
		),
	];
	const topology = buildOsmSourceTopology(ways);
	expect(topology.nodes.filter((n) => n.sourceNodeId === 2)).toHaveLength(2);
	expect(topology.diagnostics[0]!.code).toBe("incompatible-shared-node");
	const { segments } = buildSegmentsFromWays(ways, { lat: 0, lon: 0 }, 300);
	const first = new Set(
		segments
			.filter((s) => s.osmSource?.wayId === 10)
			.flatMap((s) => [s.startId, s.endId]),
	);
	expect(
		segments
			.filter((s) => s.osmSource?.wayId === 20)
			.some((s) => first.has(s.startId) || first.has(s.endId)),
	).toBe(false);
});
test("bridge endpoint transitions preserve actual shared source connectivity", () => {
	const topology = buildOsmSourceTopology([
		way(
			10,
			[1, 2],
			[
				[0, -0.001],
				[0, 0],
			],
		),
		way(
			20,
			[2, 3],
			[
				[0, 0],
				[0, 0.001],
			],
			{ bridge: "yes", layer: "1" },
		),
	]);
	expect(topology.nodes).toHaveLength(3);
	expect(topology.nodes.find((n) => n.sourceNodeId === 2)!.grade).toBe(
		"endpoint-transition",
	);
	expect(topology.diagnostics).toHaveLength(0);
});
test("coincident divided carriageways never connect by coordinate proximity", () => {
	const topology = buildOsmSourceTopology([
		way(
			10,
			[1, 2],
			[
				[0, -0.001],
				[0, 0.001],
			],
			{ oneway: "yes" },
		),
		way(
			20,
			[3, 4],
			[
				[0, -0.001],
				[0, 0.001],
			],
			{ oneway: "-1" },
		),
	]);
	expect(topology.nodes).toHaveLength(4);
	expect(topology.edges.map((e) => e.direction)).toEqual([
		"forward",
		"reverse",
	]);
});
test("roundabout logical closure survives host representation without fabricated source nodes", async () => {
	const road = way(
		10,
		[1, 2, 3, 4, 1],
		[
			[0, 0],
			[0, 0.0003],
			[0.0003, 0.0003],
			[0.0003, 0],
			[0, 0],
		],
		{ junction: "roundabout" },
	);
	const before = JSON.stringify(road),
		result = await importStreetsFromOsm({ lat: 0, lon: 0 }, 100, {
			loadStreets: async () => [road],
		});
	expect(JSON.stringify(road)).toBe(before);
	expect(result.sourceTopology!.edges).toHaveLength(4);
	expect(result.sourceTopology!.edges.at(-1)!.endNodeId).toBe("n1");
	expect(
		result.sourceTopology!.edges.every((e) => e.direction === "forward"),
	).toBe(true);
	expect(
		Object.values(result.graphs[0]!.graphNodes).some(
			(n) => n.osmTopologyOrigin?.kind === "derived",
		),
	).toBe(true);
});
test("inconsistent shared source coordinates retain facts and require review", () => {
	const topology = buildOsmSourceTopology([
		way(
			10,
			[1, 2],
			[
				[0, 0],
				[0, 0.001],
			],
		),
		way(
			20,
			[1, 3],
			[
				[0.001, 0],
				[0.001, 0.001],
			],
		),
	]);
	expect(topology.diagnostics[0]!.code).toBe("inconsistent-node-position");
	expect(topology.nodes.filter((n) => n.sourceNodeId === 1)).toHaveLength(2);
});
