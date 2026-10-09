import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoadCrossSectionInspector } from "./road-network-cross-section-inspector";
import {
	editRoadEdgeRoadway,
	editRoadEdgeSide,
	editRoadNetworkDefaultRoadway,
	editRoadNetworkDefaultSide,
	editRoadNetworkSharedSide,
	resetRoadEdgeStyle,
} from "./road-network-style-editing";
import { RoadNetworkNode } from "./schema";
import {
	createEmptyRoadGraph,
	insertRoadSegment,
} from "./road-network-topology";

describe("road cross-section inspector editing", () => {
	test("edits roadway and side values without mutating another preset", () => {
		const node = RoadNetworkNode.parse({ activeStyleId: "local-street" });
		const arterialBefore = node.stylePresets.arterial;
		const roadway = editRoadNetworkDefaultRoadway(node, "laneCount", 5.6);
		const withRoadway = RoadNetworkNode.parse({
			...node,
			stylePresets: roadway,
		});
		const side = editRoadNetworkDefaultSide(
			withRoadway,
			"left",
			"bikeLaneWidth",
			1.8,
		);

		expect(roadway["local-street"]?.laneCount).toBe(6);
		expect(side["local-street"]?.leftSide?.bikeLaneWidth).toBe(1.8);
		expect(side["local-street"]?.rightSide?.bikeLaneWidth).toBe(0);
		expect(side.arterial).toEqual(arterialBefore);
		expect(node.stylePresets["local-street"]?.laneCount).toBe(2);
	});

	test("clamps direct inspector values to schema ranges", () => {
		const node = RoadNetworkNode.parse({});
		expect(
			editRoadNetworkDefaultRoadway(node, "laneWidth", 99)["local-street"]
				?.laneWidth,
		).toBe(5);
		expect(
			editRoadNetworkDefaultSide(node, "right", "curbWidth", -3)["local-street"]
				?.rightSide?.curbWidth,
		).toBe(0);
	});

	test("renders shared roadside sliders and per-side parking and bike sliders", () => {
		const markup = renderToStaticMarkup(
			createElement(RoadCrossSectionInspector, {
				node: RoadNetworkNode.parse({}),
				onUpdate: () => {},
			}),
		);
		for (const label of [
			"Lane count",
			"Lane width",
			"Shoulder width",
			"Median width",
			"Surface thickness",
			"Left side parking lane",
			"Left side bike lane",
			"Right side parking lane",
			"Right side bike lane",
			"Shared gutter",
			"Shared kerb",
			"Shared verge",
			"Shared sidewalk",
		]) {
			expect(markup).toContain(`aria-label="${label} in metres"`);
		}
		expect(markup).not.toContain('aria-label="Left side sidewalk in metres"');
		expect(markup).not.toContain('aria-label="Right side sidewalk in metres"');
	});

	test("creates an edge-local style while preserving the network default", () => {
		const first = insertRoadSegment(
			createEmptyRoadGraph(),
			[0, 0, 0],
			[10, 0, 0],
		);
		const second = insertRoadSegment(first.graph, [10, 0, 0], [20, 0, 0]);
		let node = RoadNetworkNode.parse(second.graph);
		const edgeIds = Object.keys(node.edges).sort();
		const targetId = edgeIds[0]!;
		const otherId = edgeIds[1]!;
		const roadway = editRoadEdgeRoadway(node, targetId, "laneCount", 4)!;
		node = RoadNetworkNode.parse({ ...node, ...roadway });
		const side = editRoadEdgeSide(
			node,
			targetId,
			"right",
			"parkingLaneWidth",
			2.4,
		)!;
		node = RoadNetworkNode.parse({ ...node, ...side });

		expect(node.applyStyleToAll).toBe(false);
		expect(node.activeStyleId).toBe("local-street");
		expect(node.stylePresets["local-street"]?.laneCount).toBe(2);
		expect(node.stylePresets[node.edges[targetId]!.styleId]?.laneCount).toBe(4);
		expect(
			node.stylePresets[node.edges[targetId]!.styleId]?.rightSide
				?.parkingLaneWidth,
		).toBe(2.4);
		expect(node.edges[otherId]?.styleId).toBe("local-street");

		const reset = resetRoadEdgeStyle(node, targetId)!;
		expect(reset.edges[targetId]?.styleId).toBe("local-street");
		expect(reset.stylePresets[`edge-style~${targetId}`]).toBeUndefined();
	});

	test("applies a shared roadside width to both sides of every segment in a plus network", () => {
		const through = insertRoadSegment(
			createEmptyRoadGraph(),
			[-12, 0, 0],
			[12, 0, 0],
		);
		const crossed = insertRoadSegment(through.graph, [0, 0, -12], [0, 0, 12], {
			tolerance: 0.1,
		});
		let node = RoadNetworkNode.parse(crossed.graph);
		const selectedEdgeId = Object.keys(node.edges)[0]!;
		const edgeStylePatch = editRoadEdgeRoadway(
			node,
			selectedEdgeId,
			"laneCount",
			4,
		)!;
		node = RoadNetworkNode.parse({ ...node, ...edgeStylePatch });
		for (const [key, value] of [
			["gutterWidth", 0.45],
			["curbWidth", 0.2],
			["vergeWidth", 1.25],
			["sidewalkWidth", 2.25],
		] as const) {
			node = RoadNetworkNode.parse({
				...node,
				stylePresets: editRoadNetworkSharedSide(node, key, value),
			});
		}

		for (const edge of Object.values(node.edges)) {
			const style = node.stylePresets[edge.styleId]!;
			expect(style.leftSide?.gutterWidth).toBe(0.45);
			expect(style.rightSide?.gutterWidth).toBe(0.45);
			expect(style.leftSide?.curbWidth).toBe(0.2);
			expect(style.rightSide?.curbWidth).toBe(0.2);
			expect(style.leftSide?.vergeWidth).toBe(1.25);
			expect(style.rightSide?.vergeWidth).toBe(1.25);
			expect(style.leftSide?.sidewalkWidth).toBe(2.25);
			expect(style.rightSide?.sidewalkWidth).toBe(2.25);
		}
	});
});

test("correcting one segment preserves other effective styles when a common preset is active", () => {
	const node = RoadNetworkNode.parse({
		applyStyleToAll: true,
		activeStyleId: "collector",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [20, 0, 0] },
			c: { id: "c", position: [40, 0, 0] },
		},
		edges: {
			ab: { id: "ab", startNodeId: "a", endNodeId: "b", styleId: "alley" },
			bc: { id: "bc", startNodeId: "b", endNodeId: "c", styleId: "arterial" },
		},
	});
	const patch = editRoadEdgeRoadway(node, "ab", "laneWidth", 4)!;
	const next = RoadNetworkNode.parse({ ...node, ...patch });
	expect(next.applyStyleToAll).toBe(false);
	expect(next.stylePresets[next.edges.ab!.styleId]!.laneWidth).toBe(4);
	expect(next.edges.bc!.styleId).toBe("collector");
	expect(next.stylePresets[next.edges.bc!.styleId]).toEqual(
		node.stylePresets.collector,
	);
	expect(node.edges.bc!.styleId).toBe("arterial");
});
