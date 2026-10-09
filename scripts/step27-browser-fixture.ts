import { RoadNetworkNode } from "../src/schema";
import { compileStreet } from "../src/street-compiler";
import { beginStreetViewMutationCheck } from "../src/host/street-view-mutation-check";
export function runStep27CompilerChecks() {
	const road = RoadNetworkNode.parse({
		id: "road-network_compiler-browser",
		graphNodes: {
			a: { id: "a", position: [-40, 0, 0] },
			b: { id: "b", position: [0, 0, 0] },
			c: { id: "c", position: [40, 0, 0] },
			d: { id: "d", position: [0, 0, 40] },
		},
		edges: {
			ab: { id: "ab", startNodeId: "a", endNodeId: "b" },
			bc: { id: "bc", startNodeId: "b", endNodeId: "c" },
			bd: { id: "bd", startNodeId: "b", endNodeId: "d" },
		},
	});
	const before = JSON.stringify(road),
		observer = beginStreetViewMutationCheck();
	const first = compileStreet(road),
		second = compileStreet(road);
	const result = observer.finish();
	return {
		ok:
			JSON.stringify(first) === JSON.stringify(second) &&
			before === JSON.stringify(road) &&
			result.unchanged,
		referencePaths: first.referencePaths.length,
		surfaces: first.surfacePolygons.length,
		junctions: first.junctions.length,
		markings: first.markings.length,
		placements: first.placements.length,
		bounds: first.bounds,
		viewCheck: result,
		polygons: first.surfacePolygons.map((p) => ({
			points: p.points,
			fill: p.fill,
		})),
	};
}
