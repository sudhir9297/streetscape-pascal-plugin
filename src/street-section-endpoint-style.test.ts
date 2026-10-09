import { test, expect } from "bun:test";
import { RoadGraphEdge, RoadStylePreset } from "./schema";
import { StreetSectionLayout } from "./domain/street-section-layout";
import { asymmetricLayout } from "./domain/street-section-layout-fixture";
import { sectionEndpointStyle } from "./street-section-endpoint-style";
import { roadCarriagewayWidth } from "./road-cross-section";
test("junction endpoints use tapered traffic dimensions and cycling stays outside carriageway", () => {
	const layout = StreetSectionLayout.parse(asymmetricLayout);
	layout.intervals[0]!.lanes.push({
		id: "turn-pocket",
		direction: "forward",
		use: "turning",
		width: 3,
		startWidth: 0,
	});
	layout.intervals[1]!.lanes.push({
		id: "turn-pocket",
		direction: "forward",
		use: "turning",
		width: 3,
	});
	const edge = RoadGraphEdge.parse({
		id: "ab",
		startNodeId: "a",
		endNodeId: "b",
		sectionLayout: layout,
	});
	const base = RoadStylePreset.parse({ id: "test", name: "Test" });
	const start = sectionEndpointStyle(base, edge, "a"),
		end = sectionEndpointStyle(base, edge, "b");
	expect(roadCarriagewayWidth(start)).toBeCloseTo(6.2);
	expect(roadCarriagewayWidth(end)).toBeCloseTo(9.2);
	expect(end.leftSide!.bikeLaneWidth).toBe(1.2);
	expect(end.leftSide!.sidewalkWidth).toBe(3);
	expect(end.rightSide!.parkingLaneWidth).toBe(0);
});
