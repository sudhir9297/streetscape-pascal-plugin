import { expect, test } from "bun:test";
import { RoadNetworkNode } from "./schema";
import { asymmetricLayout } from "./domain/street-section-layout-fixture";
import { StreetSectionLayout } from "./domain/street-section-layout";
import { splitStreetSectionLayout } from "./domain/street-section-layout-split";
import { compileStreetSectionSurfaces } from "./street-section-surfaces";
import { compileStreet } from "./street-compiler";

test("shared station polygons render sidewalk widening, parking disappearance and a tapered turn pocket", () => {
	const layout = StreetSectionLayout.parse(asymmetricLayout);
	layout.intervals[0]!.leftBands[0]!.startWidth = 2;
	layout.intervals[0]!.leftBands[0]!.endWidth = 3;
	layout.intervals[0]!.lanes.push({
		id: "turn-pocket",
		direction: "forward",
		use: "turning",
		width: 3,
		startWidth: 0,
		endWidth: 3,
	});
	layout.intervals[0]!.rightBands[0]!.endWidth = 0;
	const node = RoadNetworkNode.parse({
		id: "road-network_surface-layout",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [30, 0, 0] },
		},
		edges: {
			ab: { id: "ab", startNodeId: "a", endNodeId: "b", sectionLayout: layout },
		},
	});
	const surfaces = compileStreetSectionSurfaces(node);
	const turn = surfaces.filter(
		(surface) => surface.physicalId === "turn-pocket",
	);
	expect(turn).toHaveLength(10);
	expect(turn[0]!.points[0]![2]).toBe(turn[0]!.points[3]![2]);
	expect(
		Math.abs(turn.at(-1)!.points[1]![2] - turn.at(-1)!.points[2]![2]),
	).toBeCloseTo(3);
	expect(
		surfaces
			.filter((surface) => surface.physicalId === "parking")
			.every((surface) => surface.intervalId === "first"),
	).toBe(true);
	const [first, second] = splitStreetSectionLayout(layout, 5);
	expect(first.intervals[0]!.lanes.at(-1)!.endWidth).toBe(1.5);
	expect(second.intervals[0]!.lanes.at(-1)!.startWidth).toBe(1.5);
	expect(first.intervals[0]!.leftBands[0]!.endWidth).toBe(2.5);
	const compiled = compileStreet(node);
	expect(compiled.sectionSurfaces.length).toBeGreaterThan(0);
	expect(
		compiled.sectionSurfaces.every((surface) =>
			compiled.surfacePolygons.some(
				(polygon) =>
					JSON.stringify(polygon.points) ===
					JSON.stringify(surface.points.map((point) => [point[0], point[2]])),
			),
		),
	).toBe(true);
	expect(
		surfaces.every((surface) => surface.points.flat().every(Number.isFinite)),
	).toBe(true);
});

test("changed span uses a diagnosed whole-span fallback without throwing", () => {
 const node=RoadNetworkNode.parse({id:"road-network_layout-span",graphNodes:{a:{id:"a",position:[0,0,0]},b:{id:"b",position:[40,0,0]}},edges:{ab:{id:"ab",startNodeId:"a",endNodeId:"b",sectionLayout:StreetSectionLayout.parse(asymmetricLayout)}}});
 const compiled=compileStreet(node);
 expect(compiled.sectionSurfaces).toHaveLength(0);
 expect(compiled.diagnostics.some(issue=>issue.code==="section-span-changed")).toBe(true);
 expect(compiled.surfacePolygons.length).toBeGreaterThan(0);
});
