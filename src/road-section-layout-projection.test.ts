import { expect, test } from "bun:test";
import { RoadNetworkNode } from "./schema";
import { StreetSectionLayout } from "./domain/street-section-layout";
import { asymmetricLayout } from "./domain/street-section-layout-fixture";
import { splitRoadEdgeAtNode } from "./road-network-topology";
import {
	adaptResolvedCurrentRoad,
	readCurrentRoad,
} from "./street-project-compatibility";
import { ResolvedStreetRoadData } from "./domain/resolved-street-road";

test("layout has one semantic owner and returns through projection after a topology split", () => {
	const node = RoadNetworkNode.parse({
		id: "road-network_intervals",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [30, 0, 0] },
			mid: { id: "mid", position: [15, 0, 0] },
		},
		edges: {
			ab: {
				id: "ab",
				startNodeId: "a",
				endNodeId: "b",
				sectionLayout: StreetSectionLayout.parse(asymmetricLayout),
			},
		},
	});
	const second = splitRoadEdgeAtNode(node, "ab", "mid", 0.5)!;
	expect(node.edges.ab!.sectionLayout!.length).toBe(15);
	expect(node.edges[second]!.sectionLayout!.length).toBe(15);
	const semantic = adaptResolvedCurrentRoad({
		id: "semantic-road",
		network: node,
		origin: "authored",
	});
	const data = ResolvedStreetRoadData.parse(semantic.data);
	expect(
		Object.values(data.referenceLines).every(
			(line) => !Object.hasOwn(line, "sectionLayout"),
		),
	).toBe(true);
	expect(
		Object.values(data.sections).every((section) => !!section.layout),
	).toBe(true);
	const reopened = readCurrentRoad(semantic);
	expect(reopened.edges.ab!.sectionLayout).toEqual(
		node.edges.ab!.sectionLayout,
	);
	expect(reopened.edges[second]!.sectionLayout).toEqual(
		node.edges[second]!.sectionLayout,
	);
});
