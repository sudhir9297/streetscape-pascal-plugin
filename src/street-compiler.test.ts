import { expect, test } from "bun:test";
import { useScene } from "@pascal-app/core";
import { RoadNetworkNode } from "./schema";
import { compileStreet,createCachedStreetCompiler } from "./street-compiler";
import { buildRoadNetworkMarkings } from "./road-network-markings";
import { buildRoadRenderPaths } from "./road-network-geometry";

const fixture = () =>
	RoadNetworkNode.parse({
		id: "road-network_compiler",
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
test("compiler preserves existing paths, junctions and markings with immutable deterministic output", () => {
	const road = fixture(),
		before = JSON.stringify(road);
	const first = compileStreet(road);
	expect(first.referencePaths).toHaveLength(3);
	expect(first.junctions).toHaveLength(1);
	expect(first.surfacePolygons.length).toBeGreaterThan(0);
	expect(first.bounds).not.toBeNull();
	expect(first.renderPaths).toEqual(buildRoadRenderPaths(road));
	expect(first.markings).toEqual(buildRoadNetworkMarkings(road));
	expect(compileStreet(road)).toEqual(first);
	expect(JSON.stringify(road)).toBe(before);
});
test("compiler ignores unrelated host state and emits serializable plain plan data", () => {
	const road = fixture(),
		first = compileStreet(road),
		original = useScene.getState();
	try {
		useScene.setState({ nodes: {}, rootNodeIds: [] });
		expect(compileStreet(road)).toEqual(first);
	} finally {
		useScene.setState(original);
	}
	expect(JSON.parse(JSON.stringify(first))).toEqual(first);
	expect(
		compileStreet(RoadNetworkNode.parse({ id: "road-network_empty" })).bounds,
	).toBeNull();
});

test('cached compiler matches pure plans and invalidates edited widths',()=>{
 const road=fixture(),cache=createCachedStreetCompiler()
 expect(cache.compile(road)).toEqual(compileStreet(road))
 cache.compile(road)
 expect(cache.stats.reusedProfiles).toBeGreaterThan(0)
 const style=road.stylePresets[road.activeStyleId]!
 const edited=RoadNetworkNode.parse({...road,stylePresets:{...road.stylePresets,[style.id]:{...style,laneWidth:style.laneWidth+1}}})
 const changed=cache.compile(edited)
 expect(changed).toEqual(compileStreet(edited))
 expect(cache.stats.rebuiltProfiles).toBeGreaterThan(0)
 expect(changed.surfacePolygons).not.toEqual(compileStreet(road).surfacePolygons)
})
