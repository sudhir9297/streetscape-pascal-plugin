import { expect, test } from "bun:test";
import { matchOsmSourceSpan, osmSpanIdentity } from "./domain/source-identity";
import {
	buildSegmentsFromWays,
	buildRoadGraphFromSegments,
	ensureSimpleSegments,
	type OsmWay,
} from "./osm-import";
import {
	insertRoadSegment,
	mergeRoadGraphs,
	splitRoadEdgeWithIdentityRemap,
} from "./road-network-topology";
import { RoadGraphEdge } from "./schema";
const center = { lat: 0, lon: 0 };
const ways: OsmWay[] = [
	{
		id: 20,
		tags: { highway: "residential" },
		points: [
			{ nodeId: 1, lat: 0, lon: -0.01 },
			{ nodeId: 2, lat: 0, lon: 0 },
			{ nodeId: 3, lat: 0, lon: 0.01 },
		],
	},
	{
		id: 10,
		tags: { highway: "residential" },
		points: [
			{ nodeId: 4, lat: -0.01, lon: 0 },
			{ nodeId: 2, lat: 0, lon: 0 },
			{ nodeId: 5, lat: 0.01, lon: 0 },
		],
	},
];
function build(input: OsmWay[]) {
	const { segments, nodePositions } = buildSegmentsFromWays(input, center, 300);
	return buildRoadGraphFromSegments(
		ensureSimpleSegments(segments, nodePositions),
		nodePositions,
	).graph;
}
test("input order preserves clipped node, edge and source-span identity", () => {
	expect(build(ways)).toEqual(build([...ways].reverse()));
	const graph = build(ways);
	expect(Object.keys(graph.edges)).toHaveLength(4);
	for (const edge of Object.values(graph.edges)) {
		expect(edge.osmSource!.span!.coverage).toBe("exact");
		expect(osmSpanIdentity(edge.osmSource!)).not.toBeNull();
		expect(RoadGraphEdge.safeParse(edge).success).toBe(true);
	}
});
test("matches exact topology and flags changed, duplicate and legacy sources", () => {
	const source = {
		wayId: 1,
		nodeIds: [1, 2, 3],
		span: { start: 0, end: 2, coverage: "exact" as const },
	};
	expect(matchOsmSourceSpan(source, [{ id: "a", source }])).toEqual({
		status: "matched",
		candidateIds: ["a"],
	});
	expect(
		matchOsmSourceSpan(source, [
			{ id: "a", source },
			{ id: "b", source },
		]).status,
	).toBe("ambiguous");
	expect(
		matchOsmSourceSpan(source, [
			{ id: "edited", source: { ...source, nodeIds: [1, 7, 3] } },
		]).status,
	).toBe("ambiguous");
	expect(matchOsmSourceSpan({ wayId: 1 }, [{ id: "a", source }]).status).toBe(
		"ambiguous",
	);
	expect(matchOsmSourceSpan(source, []).status).toBe("missing");
	expect(osmSpanIdentity({ ...source, nodeIds: [1, 7, 3] })).not.toBe(
		osmSpanIdentity(source),
	);
});
test("split returns one-to-many mapping and preserves conservative source coverage; merge reports collision maps", () => {
	const graph = build(ways);
	const edge = Object.values(graph.edges)[0]!;
	graph.graphNodes.mid = {
		...graph.graphNodes[edge.startNodeId]!,
		id: "mid",
		position: [0, 0, 50],
	};
	const { secondEdgeId, edgeIdRemap } = splitRoadEdgeWithIdentityRemap(
		graph,
		edge.id,
		"mid",
		0.5,
	);
	expect(secondEdgeId).not.toBeNull();
	expect(edgeIdRemap[edge.id]).toEqual([edge.id, secondEdgeId!]);
	expect(graph.edges[edge.id]!.osmSource!.span!.coverage).toBe("conservative");
	expect(graph.edges[secondEdgeId!]!.osmSource).toEqual(
		graph.edges[edge.id]!.osmSource,
	);
	const merged = mergeRoadGraphs([graph, graph]);
	expect(merged.edgeIdMaps[1]![edge.id]).not.toBe(edge.id);
	expect(
		merged.graph.edges[merged.edgeIdMaps[1]![edge.id]!]!.osmSource,
	).toEqual(graph.edges[edge.id]!.osmSource);
});

test("insertion returns composed identity mappings for multiple splits of one original edge", () => {
	const graph = build(ways);
	const edge = Object.values(graph.edges).find(
		(edge) => edge.osmSource?.wayId === 20 && edge.endNodeId === "n2",
	)!;
	const result = insertRoadSegment(graph, [-200, 0, 0], [-100, 0, 0], {
		alignment: [[-150, 0, 30]],
		tolerance: 0.01,
	});
	const descendants = result.edgeIdRemap[edge.id]!;
	expect(descendants).toHaveLength(3);
	expect(new Set(descendants).size).toBe(3);
	for (const id of descendants)
		expect(result.graph.edges[id]!.osmSource?.wayId).toBe(20);
	expect(graph.edges[edge.id]!.osmSource!.span!.coverage).toBe("exact");
});

test("imported graph identities do not look like URL schemes at the host save boundary", () => {
	const graph = build(ways);
	for (const id of [
		...Object.keys(graph.graphNodes),
		...Object.keys(graph.edges),
	]) {
		expect(/^[a-z][a-z0-9+.-]+:[^\s]/i.test(id)).toBe(false);
	}
});
