import type { AnyNodeId } from "@pascal-app/core";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	buildRoadCrossSection,
	buildRoadJunctionBands,
	ROAD_SIDE_COMPONENT_SPECS,
} from "./road-cross-section";
import {
	buildJunctionBoundarySidePaths,
	buildJunctionBoundaryGeometry,
	sampleRoadEdgePoints,
} from "./road-network-geometry";
import {
	buildRoadsideDecorationPreviews,
	buildRoadsideDecorations,
	ensureRoadsideLampVerge,
	materializeRoadsideDecorationSelection,
	ROADSIDE_LAMP_MIN_VERGE_WIDTH,
	ROADSIDE_SIGN_LAMP_MIN_SEPARATION,
	RoadsideDecorationInspector,
} from "./roadside-decoration-rules";
import { roadSignParametrics } from "./road-sign-parametrics";
import { RoadNetworkNode } from "./schema";
import {
	createEmptyRoadGraph,
	insertRoadSegment,
	roadJunctionCornerKey,
} from "./road-network-topology";

function longRoad() {
	const inserted = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [100, 0, 0]);
	const node = RoadNetworkNode.parse(inserted.graph);
	node.roadsideDecorations = buildRoadsideDecorations(node);
	return node;
}

function tJunctionRoad() {
	let graph = insertRoadSegment(
		createEmptyRoadGraph(),
		[-60, 0, 0],
		[0, 0, 0],
	).graph;
	graph = insertRoadSegment(graph, [0, 0, 0], [60, 0, 0]).graph;
	graph = insertRoadSegment(graph, [0, 0, 0], [0, 0, 60]).graph;
	const node = RoadNetworkNode.parse(graph);
	node.stylePresets = ensureRoadsideLampVerge(node)!;
	return node;
}

describe("semantic roadside decoration rules", () => {
	test("materializes a clicked roadside lamp as the only selected scene node", () => {
		const network = longRoad();
		const lamp = Object.values(network.roadsideDecorations).find(
			(decoration) => decoration.kind === "lamp",
		)!;

		const result = materializeRoadsideDecorationSelection(network, lamp.id, []);

		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected the roadside lamp to materialize");
		expect(result.selection.selectedIds).toEqual([result.node.id]);
		expect(result.selection.selectedIds).not.toContain(network.id);
		expect(result.node.type).toBe("streetscape:street-light");
		expect(result.node.roadAttachment?.networkNodeId).toBe(network.id);
		expect(result.networkPatch.roadsideDecorationSuppressed?.[lamp.id]).toBe(true);
		expect(result.networkPatch.attachments?.[result.attachment.id]).toEqual(
			result.attachment,
		);
	});

	test("materializes a clicked roadside sign as the only selected scene node", () => {
		const network = longRoad();
		const sign = Object.values(network.roadsideDecorations).find(
			(decoration) => decoration.kind === "sign",
		)!;

		const result = materializeRoadsideDecorationSelection(network, sign.id, []);

		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected the roadside sign to materialize");
		expect(result.selection.selectedIds).toEqual([result.node.id]);
		expect(result.selection.selectedIds).not.toContain(network.id);
		expect(result.node.type).toBe("streetscape:road-sign");
		expect(result.node.roadAttachment?.networkNodeId).toBe(network.id);
		expect(result.networkPatch.roadsideDecorationSuppressed?.[sign.id]).toBe(true);
		expect(result.networkPatch.attachments?.[result.attachment.id]).toEqual(
			result.attachment,
		);

		const updatedRoad = RoadNetworkNode.parse({ ...network, ...result.networkPatch });
		const deletionPatches = roadSignParametrics.onDelete?.(
			result.node as never,
			{ [updatedRoad.id]: updatedRoad, [result.node.id]: result.node } as never,
            new Set<AnyNodeId>([result.node.id as AnyNodeId]),
            new Set<AnyNodeId>([result.node.id as AnyNodeId]),
		) ?? [];
		expect(deletionPatches).toHaveLength(1);
		expect(String(deletionPatches[0]!.id)).toBe(String(network.id));
		expect(deletionPatches[0]!.data).toMatchObject({
			roadsideDecorationSuppressed: { [sign.id]: true },
		});
		expect((deletionPatches[0]!.data as { attachments: Record<string, unknown> }).attachments)
			.not.toHaveProperty(result.attachment.id);
	});

	test("derives stable lamps and terminal signs only", () => {
		const node = longRoad();
		const items = Object.values(node.roadsideDecorations);
		expect(items.some((item) => item.kind === "lamp")).toBe(true);
		expect(items.some((item) => item.kind === "sign")).toBe(true);
		expect(new Set(items.map((item) => item.kind))).toEqual(new Set(["lamp", "sign"]));
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
	});

	test("uses the authored metre spacing for repeated lamps", () => {
		const close = longRoad();
		close.roadsideDecorationSpacing = 15;
		const closeCount = Object.keys(buildRoadsideDecorations(close)).length;
		const far = longRoad();
		far.roadsideDecorationSpacing = 60;
		const farCount = Object.keys(buildRoadsideDecorations(far)).length;
		expect(closeCount).toBeGreaterThan(farCount);
	});

	test("optionally generates matching lamp rows on both sides", () => {
		const oneSide = longRoad();
		const oneSideLamps = Object.values(buildRoadsideDecorations(oneSide)).filter(
			(decoration) => decoration.kind === "lamp",
		);
		expect(new Set(oneSideLamps.map((lamp) => lamp.side))).toEqual(
			new Set(["right"]),
		);

		const bothSides = longRoad();
		bothSides.roadsideLampsBothSides = true;
		const bothSideLamps = Object.values(buildRoadsideDecorations(bothSides)).filter(
			(decoration) => decoration.kind === "lamp",
		);
		const leftStations = bothSideLamps
			.filter((lamp) => lamp.side === "left")
			.map((lamp) => lamp.station);
		const rightStations = bothSideLamps
			.filter((lamp) => lamp.side === "right")
			.map((lamp) => lamp.station);
		expect(leftStations).toEqual(rightStations);
		expect(leftStations.length).toBe(oneSideLamps.length);
	});

	test("keeps lamp poles separated from generated signposts", () => {
		const node = tJunctionRoad();
		node.roadsideLampsBothSides = true;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const previews = buildRoadsideDecorationPreviews(node);
		const lamps = previews.filter((decoration) => decoration.kind === "lamp");
		const signs = previews.filter((decoration) => decoration.kind === "sign");
		const closestPair = Math.min(
			...lamps.flatMap((lamp) => signs.map((sign) => Math.hypot(
				lamp.position[0] - sign.position[0],
				lamp.position[2] - sign.position[2],
			))),
		);

		expect(closestPair).toBeGreaterThanOrEqual(
			ROADSIDE_SIGN_LAMP_MIN_SEPARATION,
		);
	});

	test("keeps close lamp spacing clear of terminal signposts", () => {
		const node = longRoad();
		node.roadsideDecorationSpacing = 10;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const previews = buildRoadsideDecorationPreviews(node);
		const lamps = previews.filter((decoration) => decoration.kind === "lamp");
		const signs = previews.filter((decoration) => decoration.kind === "sign");
		const closestPair = Math.min(
			...lamps.flatMap((lamp) => signs.map((sign) => Math.hypot(
				lamp.position[0] - sign.position[0],
				lamp.position[2] - sign.position[2],
			))),
		);

		expect(closestPair).toBeGreaterThanOrEqual(
			ROADSIDE_SIGN_LAMP_MIN_SEPARATION,
		);
	});

	test("keeps a nearby lamp after resolving each T-junction sign collision", () => {
		const node = tJunctionRoad();
		node.roadsideLampsBothSides = true;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const decorations = Object.values(node.roadsideDecorations);
		const lamps = decorations.filter((decoration) => decoration.kind === "lamp");
		const junctionSigns = decorations.filter(
			(decoration) =>
				decoration.kind === "sign" && decoration.ruleId === "junction-signage",
		);

		for (const sign of junctionSigns) {
			const sameVergeLamps = lamps.filter(
				(lamp) => lamp.edgeId === sign.edgeId && lamp.side === sign.side,
			);
			expect(sameVergeLamps.length).toBeGreaterThan(0);
			const closestStationGap = Math.min(
				...sameVergeLamps.map((lamp) => Math.abs(lamp.station - sign.station)),
			);
			expect(closestStationGap).toBeGreaterThanOrEqual(
				ROADSIDE_SIGN_LAMP_MIN_SEPARATION,
			);
			expect(closestStationGap).toBeLessThanOrEqual(
				ROADSIDE_SIGN_LAMP_MIN_SEPARATION * 2,
			);
		}
	});

	test("fills long T-junction roadside curves at the authored lamp spacing", () => {
		const node = tJunctionRoad();
		node.roadsideDecorationSpacing = 10;
		node.roadsideLampsBothSides = true;
		const junctionNode = Object.values(node.graphNodes).find((graphNode) =>
			Object.values(node.edges).filter(
				(edge) => edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			).length === 3
		)!;
		const incidentEdges = Object.values(node.edges).filter(
			(edge) => edge.startNodeId === junctionNode.id || edge.endNodeId === junctionNode.id,
		);
		const cornerRadii = Object.fromEntries(
			incidentEdges.flatMap((edge, index) =>
				incidentEdges.slice(index + 1).map((otherEdge) => [
					roadJunctionCornerKey(edge.id, otherEdge.id),
					24,
				]),
			),
		);
		node.junctions[junctionNode.id] = {
			...node.junctions[junctionNode.id]!,
			cornerRadii,
		};

		node.roadsideDecorations = buildRoadsideDecorations(node);
		const junctionLamps = Object.values(node.roadsideDecorations).filter(
			(decoration) => decoration.ruleId === "junction-lighting",
		);
		const widerSpacingNode = RoadNetworkNode.parse({
			...node,
			roadsideDecorationSpacing: 20,
		});
		const widerSpacingCount = Object.values(
			buildRoadsideDecorations(widerSpacingNode),
		).filter((decoration) => decoration.ruleId === "junction-lighting").length;

		expect(junctionLamps.length).toBeGreaterThanOrEqual(3);
		expect(junctionLamps.length).toBeGreaterThan(widerSpacingCount);
		expect(junctionLamps.every((lamp) => lamp.worldPosition?.every(Number.isFinite))).toBe(true);
		const lampPreviews = buildRoadsideDecorationPreviews(node).filter(
			(decoration) => decoration.kind === "lamp",
		);
		const closestLampPair = Math.min(
			...lampPreviews.flatMap((lamp, index) =>
				lampPreviews.slice(index + 1).map((otherLamp) => Math.hypot(
					lamp.position[0] - otherLamp.position[0],
					lamp.position[2] - otherLamp.position[2],
				)),
			),
		);
		expect(closestLampPair).toBeGreaterThanOrEqual(
			node.roadsideDecorationSpacing / 2,
		);
	});

	test("fills long roadside sleeves at an acute Y-junction", () => {
		let graph = insertRoadSegment(
			createEmptyRoadGraph(),
			[0, 0, 0],
			[-80, 0, 0],
		).graph;
		graph = insertRoadSegment(graph, [0, 0, 0], [80, 0, 20]).graph;
		graph = insertRoadSegment(graph, [0, 0, 0], [80, 0, -20]).graph;
		const node = RoadNetworkNode.parse(graph);
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		node.roadsideDecorationSpacing = 10;
		node.roadsideLampsBothSides = true;
		const junctionNode = Object.values(node.graphNodes).find((graphNode) =>
			Object.values(node.edges).filter(
				(edge) => edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			).length === 3
		)!;
		const style = node.stylePresets[node.activeStyleId]!;
		const halfWidth = (
			style.laneCount * style.laneWidth + style.shoulderWidth * 2 + style.medianWidth
		) / 2;
		const approaches = Object.values(node.edges).map((edge) => {
			const endpoint = edge.startNodeId === junctionNode.id
				? node.graphNodes[edge.endNodeId]!.position
				: node.graphNodes[edge.startNodeId]!.position;
			return {
				angle: Math.atan2(
					endpoint[2] - junctionNode.position[2],
					endpoint[0] - junctionNode.position[0],
				),
				edgeId: edge.id,
				halfWidth,
			};
		});
		const solution = buildJunctionBoundaryGeometry(approaches, {});
		const sleeveLengths = solution.approaches.flatMap((approach, index) => {
			const previousCorner = solution.corners[
				(index - 1 + solution.corners.length) % solution.corners.length
			]!;
			const nextCorner = solution.corners[index]!;
			const direction = [Math.cos(approach.angle), Math.sin(approach.angle)] as const;
			const left = [-direction[1], direction[0]] as const;
			const cut = solution.approachCuts[approach.edgeId]!;
			const rightCap = [
				direction[0] * cut - left[0] * approach.halfWidth,
				direction[1] * cut - left[1] * approach.halfWidth,
			] as const;
			const leftCap = [
				direction[0] * cut + left[0] * approach.halfWidth,
				direction[1] * cut + left[1] * approach.halfWidth,
			] as const;
			const previousPoint = previousCorner.innerPoints.at(-1)!;
			const nextPoint = nextCorner.innerPoints[0]!;
			return [
				Math.hypot(rightCap[0] - previousPoint[0], rightCap[1] - previousPoint[1]),
				Math.hypot(nextPoint[0] - leftCap[0], nextPoint[1] - leftCap[1]),
			];
		});
		expect(Math.max(...sleeveLengths)).toBeGreaterThan(node.roadsideDecorationSpacing);

		const decorations = Object.values(buildRoadsideDecorations(node));
		const approachLamps = decorations.filter(
			(decoration) => decoration.ruleId === "junction-approach-lighting",
		);
		expect(approachLamps.length).toBeGreaterThan(0);
		const vergeBand = buildRoadJunctionBands([style]).find(
			(band) => band.kind === "verge",
		)!;
		const paths = buildJunctionBoundarySidePaths(
			solution,
			vergeBand.outerWidth - vergeBand.width / 2,
		);
		for (const path of paths) {
			const pathLength = path.points.slice(1).reduce((sum, point, index) => {
				const previous = path.points[index]!;
				return sum + Math.hypot(point[0] - previous[0], point[1] - previous[1]);
			}, 0);
			const idFragment = `:${junctionNode.id}:${path.fromEdgeId}:${path.toEdgeId}:`;
			const stations = decorations
				.filter((decoration) =>
					decoration.kind === "lamp" && decoration.id.includes(idFragment)
				)
				.map((decoration) => decoration.station)
				.sort((left, right) => left - right);
			const intervals = [
				stations[0] ?? pathLength,
				...stations.slice(1).map((station, index) => station - stations[index]!),
				pathLength - (stations.at(-1) ?? 0),
			];
				expect(Math.max(...intervals)).toBeLessThanOrEqual(
					node.roadsideDecorationSpacing,
				);
			}
		const lampPreviews = buildRoadsideDecorationPreviews(node).filter(
			(decoration) => decoration.kind === "lamp",
		);
		const closestLampPair = Math.min(
			...lampPreviews.flatMap((lamp, index) =>
				lampPreviews.slice(index + 1).map((otherLamp) => Math.hypot(
					lamp.position[0] - otherLamp.position[0],
					lamp.position[2] - otherLamp.position[2],
				)),
			),
		);
		expect(closestLampPair).toBeGreaterThanOrEqual(
			node.roadsideDecorationSpacing / 2,
		);
	});

	test("provisions safe furnishing verges on both sides when roadside assets are enabled", () => {
		const node = longRoad();
		const style = node.stylePresets[node.activeStyleId]!;
		node.stylePresets[node.activeStyleId] = {
			...style,
			leftSide: { ...style.leftSide!, vergeWidth: 0 },
			rightSide: { ...style.rightSide!, vergeWidth: 0 },
		};

		const stylePresets = ensureRoadsideLampVerge(node)!;
		expect(stylePresets[node.activeStyleId]?.rightSide?.vergeWidth).toBe(
			ROADSIDE_LAMP_MIN_VERGE_WIDTH,
		);
		expect(stylePresets[node.activeStyleId]?.leftSide?.vergeWidth).toBe(
			ROADSIDE_LAMP_MIN_VERGE_WIDTH,
		);
	});

	test("centers lamps on the verge surface instead of outside the road", () => {
		const node = longRoad();
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const lamp = Object.values(node.roadsideDecorations).find(
			(decoration) => decoration.kind === "lamp",
		)!;
		const style = node.stylePresets[node.activeStyleId]!;
		const verge = buildRoadCrossSection(style).sides.right.components.find(
			(component) => component.kind === "verge",
		)!;
		const vergeElevation = ROAD_SIDE_COMPONENT_SPECS.find(
			(spec) => spec.kind === "verge",
		)!.elevationOffset;
		const preview = buildRoadsideDecorationPreviews(node).find(
			(decoration) => decoration.id === lamp.id,
		)!;

		expect(lamp.lateralOffset).toBe(verge.lateralOffset);
		expect(preview.position[1]).toBeCloseTo(
			vergeElevation,
		);
	});

	test("centers signs on the roadside verge instead of the carriageway edge", () => {
		const node = longRoad();
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const sign = Object.values(node.roadsideDecorations).find(
			(decoration) => decoration.kind === "sign",
		)!;
		const style = node.stylePresets[node.activeStyleId]!;
		const verge = buildRoadCrossSection(style).sides.right.components.find(
			(component) => component.kind === "verge",
		)!;
		const preview = buildRoadsideDecorationPreviews(node).find(
			(decoration) => decoration.id === sign.id,
		)!;

		expect(sign.lateralOffset).toBe(verge.lateralOffset);
		expect(preview.position[1]).toBeCloseTo(
			ROAD_SIDE_COMPONENT_SPECS.find(
				(spec) => spec.kind === "verge",
			)!.elevationOffset,
		);
	});

	test("places a junction sign beside the junction even when the edge starts there", () => {
		const node = tJunctionRoad();
		const junctionNodeId = Object.values(node.graphNodes).find((graphNode) =>
			Object.values(node.edges).filter(
				(edge) =>
					edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			).length === 3
		)!.id;
		const outgoingEdge = Object.values(node.edges).find(
			(edge) => edge.startNodeId === junctionNodeId,
		)!;
		const sign = Object.values(buildRoadsideDecorations(node)).find(
			(decoration) =>
				decoration.kind === "sign" && decoration.edgeId === outgoingEdge.id,
		)!;

		expect(sign.station).toBeLessThan(30);
	});

	test("faces a start-junction sign toward traffic approaching the junction", () => {
		const node = tJunctionRoad();
		const junctionNodeId = Object.values(node.graphNodes).find((graphNode) =>
			Object.values(node.edges).filter(
				(edge) =>
					edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			).length === 3
		)!.id;
		const outgoingEdge = Object.values(node.edges).find(
			(edge) => edge.startNodeId === junctionNodeId,
		)!;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const sign = buildRoadsideDecorationPreviews(node).find(
			(decoration) =>
				decoration.kind === "sign" && decoration.edgeId === outgoingEdge.id,
		)!;
		const visibleFaceX = Math.sin(sign.rotationY);
		const visibleFaceZ = Math.cos(sign.rotationY);

		expect(visibleFaceX).toBeCloseTo(1);
		expect(visibleFaceZ).toBeCloseTo(0);
	});

	test("uses the correct traffic-side verge for either junction endpoint", () => {
		const node = tJunctionRoad();
		node.regionalPack = "left-driving";
		const junctionNodeId = Object.values(node.graphNodes).find((graphNode) =>
			Object.values(node.edges).filter(
				(edge) =>
					edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			).length === 3
		)!.id;
		const decorations = Object.values(buildRoadsideDecorations(node));
		const startSign = decorations.find((decoration) =>
			decoration.kind === "sign" &&
			node.edges[decoration.edgeId]?.startNodeId === junctionNodeId
		)!;
		const endSign = decorations.find((decoration) =>
			decoration.kind === "sign" &&
			node.edges[decoration.edgeId]?.endNodeId === junctionNodeId
		)!;

		expect(startSign.facing).toBe("forward");
		expect(startSign.side).toBe("right");
		expect(endSign.facing).toBe("reverse");
		expect(endSign.side).toBe("left");
	});

	test("keeps lamp poles clear of connected road corners", () => {
		const first = insertRoadSegment(
			createEmptyRoadGraph(),
			[-20, 0, 0],
			[0, 0, 0],
		);
		const second = insertRoadSegment(
			first.graph,
			[0, 0, 0],
			[0, 0, 20],
		);
		const node = RoadNetworkNode.parse(second.graph);
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		const lamps = Object.values(buildRoadsideDecorations(node)).filter(
			(decoration) => decoration.kind === "lamp",
		);
		const degreeByNode = new Map<string, number>();
		for (const edge of Object.values(node.edges)) {
			degreeByNode.set(edge.startNodeId, (degreeByNode.get(edge.startNodeId) ?? 0) + 1);
			degreeByNode.set(edge.endNodeId, (degreeByNode.get(edge.endNodeId) ?? 0) + 1);
		}

		for (const lamp of lamps) {
			const edge = node.edges[lamp.edgeId]!;
			const start = node.graphNodes[edge.startNodeId]!.position;
			const end = node.graphNodes[edge.endNodeId]!.position;
			const edgeLength = Math.hypot(
				end[0] - start[0],
				end[1] - start[1],
				end[2] - start[2],
			);
			if ((degreeByNode.get(edge.startNodeId) ?? 0) > 1) {
				expect(lamp.station).toBeGreaterThanOrEqual(10);
			}
			if ((degreeByNode.get(edge.endNodeId) ?? 0) > 1) {
				expect(edgeLength - lamp.station).toBeGreaterThanOrEqual(10);
			}
		}
	});

	test("keeps regular spacing across a straight segmented road", () => {
		const first = insertRoadSegment(
			createEmptyRoadGraph(),
			[-40, 0, 0],
			[0, 0, 0],
		);
		const second = insertRoadSegment(
			first.graph,
			[0, 0, 0],
			[40, 0, 0],
		);
		const node = RoadNetworkNode.parse(second.graph);
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		const connectedNodeId = Object.values(node.graphNodes).find((graphNode) =>
			Object.values(node.edges).filter(
				(edge) =>
					edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			).length === 2
		)!.id;
		const outgoingEdge = Object.values(node.edges).find(
			(edge) => edge.startNodeId === connectedNodeId,
		)!;
		const firstOutgoingLamp = Object.values(buildRoadsideDecorations(node)).find(
			(decoration) =>
				decoration.kind === "lamp" && decoration.edgeId === outgoingEdge.id,
		)!;

		expect(firstOutgoingLamp.station).toBe(6);
	});

	test("honors wide roads and authored curb-return radii at junctions", () => {
		let graph = insertRoadSegment(
			createEmptyRoadGraph(),
			[-60, 0, 0],
			[0, 0, 0],
		).graph;
		graph = insertRoadSegment(graph, [0, 0, 0], [60, 0, 0]).graph;
		graph = insertRoadSegment(graph, [0, 0, 0], [0, 0, 60]).graph;
		const node = RoadNetworkNode.parse(graph);
		const activeStyle = node.stylePresets[node.activeStyleId]!;
		node.stylePresets[node.activeStyleId] = {
			...activeStyle,
			laneCount: 4,
			laneWidth: 3.5,
		};
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		const incidentByNode = Object.values(node.graphNodes).map((graphNode) => ({
			edges: Object.values(node.edges).filter(
				(edge) =>
					edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			),
			nodeId: graphNode.id,
		}));
		const junction = incidentByNode.find((entry) => entry.edges.length === 3)!;
		const junctionState = node.junctions[junction.nodeId]!;
		expect(junctionState).toBeDefined();
		const cornerRadii: Record<string, number> = {};
		for (let first = 0; first < junction.edges.length; first += 1) {
			for (let second = first + 1; second < junction.edges.length; second += 1) {
				cornerRadii[
					roadJunctionCornerKey(
						junction.edges[first]!.id,
						junction.edges[second]!.id,
					)
				] = 12;
			}
		}
		node.junctions[junction.nodeId] = { ...junctionState, cornerRadii };

		const lamps = Object.values(buildRoadsideDecorations(node)).filter(
			(decoration) => decoration.kind === "lamp",
		);
		for (const lamp of lamps) {
			const edge = node.edges[lamp.edgeId]!;
			if (!junction.edges.some((candidate) => candidate.id === edge.id)) continue;
			const distanceFromJunction = edge.startNodeId === junction.nodeId
				? lamp.station
				: 60 - lamp.station;
			expect(distanceFromJunction).toBeGreaterThanOrEqual(21);
		}
		const signs = Object.values(buildRoadsideDecorations(node)).filter(
			(decoration) => decoration.kind === "sign",
		);
		for (const sign of signs) {
			const edge = node.edges[sign.edgeId]!;
			if (!junction.edges.some((candidate) => candidate.id === edge.id)) continue;
			const distanceFromJunction = edge.startNodeId === junction.nodeId
				? sign.station
				: 60 - sign.station;
			expect(distanceFromJunction).toBeGreaterThanOrEqual(21);
		}
	});

	test("keeps every curved-road lamp arm pointed toward the carriageway", () => {
		const graph = insertRoadSegment(
			createEmptyRoadGraph(),
			[0, 0, 0],
			[60, 0, 60],
		).graph;
		const edge = Object.values(graph.edges)[0]!;
		edge.alignment = [[20, 0, 0], [40, 0, 20], [40, 0, 40]];
		const node = RoadNetworkNode.parse(graph);
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		node.roadsideLampsBothSides = true;
		node.roadsideDecorations = buildRoadsideDecorations(node);
		const previews = buildRoadsideDecorationPreviews(node).filter(
			(preview) => preview.kind === "lamp",
		);

		for (const preview of previews) {
			const points = sampleRoadEdgePoints(node, node.edges[preview.edgeId]!, 40);
			let remaining = preview.station;
			for (let index = 0; index < points.length - 1; index += 1) {
				const start = points[index]!;
				const end = points[index + 1]!;
				const segmentLength = Math.hypot(
					end[0] - start[0],
					end[1] - start[1],
					end[2] - start[2],
				);
				if (remaining > segmentLength && index < points.length - 2) {
					remaining -= segmentLength;
					continue;
				}
				const ratio = Math.min(1, remaining / Math.max(segmentLength, 1e-6));
				const centerX = start[0] + (end[0] - start[0]) * ratio;
				const centerZ = start[2] + (end[2] - start[2]) * ratio;
				const inwardX = centerX - preview.position[0];
				const inwardZ = centerZ - preview.position[2];
				const inwardLength = Math.hypot(inwardX, inwardZ);
				const armX = Math.cos(preview.rotationY);
				const armZ = -Math.sin(preview.rotationY);
				const inwardDot =
					(armX * inwardX + armZ * inwardZ) / Math.max(inwardLength, 1e-6);
				expect(inwardDot).toBeGreaterThan(0.999);
				break;
			}
		}
	});

	test("faces signs correctly in both directions along a curved road", () => {
		const graph = insertRoadSegment(
			createEmptyRoadGraph(),
			[0, 0, 0],
			[60, 0, 60],
		).graph;
		const edge = Object.values(graph.edges)[0]!;
		edge.alignment = [[20, 0, 0], [40, 0, 20], [40, 0, 40]];
		const node = RoadNetworkNode.parse(graph);
		node.stylePresets = ensureRoadsideLampVerge(node)!;
		const reverseSign = Object.values(buildRoadsideDecorations(node)).find(
			(decoration) => decoration.kind === "sign",
		)!;
		const style = node.stylePresets[node.activeStyleId]!;
		const forwardSign = {
			...reverseSign,
			facing: "forward" as const,
			id: "test:curved-sign:forward",
			lateralOffset: buildRoadCrossSection(style).sides.left.components.find(
				(component) => component.kind === "verge",
			)!.lateralOffset,
			side: "left" as const,
			station: 4,
		};
		node.roadsideDecorations = {
			[forwardSign.id]: forwardSign,
			[reverseSign.id]: reverseSign,
		};

		for (const preview of buildRoadsideDecorationPreviews(node)) {
			const points = sampleRoadEdgePoints(node, edge, 40);
			let remaining = preview.station;
			for (let index = 0; index < points.length - 1; index += 1) {
				const start = points[index]!;
				const end = points[index + 1]!;
				const segmentLength = Math.hypot(
					end[0] - start[0],
					end[1] - start[1],
					end[2] - start[2],
				);
				if (remaining > segmentLength && index < points.length - 2) {
					remaining -= segmentLength;
					continue;
				}
				const tangentLength = Math.max(
					Math.hypot(end[0] - start[0], end[2] - start[2]),
					1e-6,
				);
				const direction = preview.facing === "forward" ? 1 : -1;
				const expectedX = direction * (end[0] - start[0]) / tangentLength;
				const expectedZ = direction * (end[2] - start[2]) / tangentLength;
				const visibleFaceX = Math.sin(preview.rotationY);
				const visibleFaceZ = Math.cos(preview.rotationY);
				expect(
					visibleFaceX * expectedX + visibleFaceZ * expectedZ,
				).toBeGreaterThan(0.999);
				break;
			}
		}
	});

	test("uses safe defaults while a legacy in-memory road is being migrated", () => {
		const node = longRoad();
		const legacy = {
			...node,
			roadsideDecorationSpacing: undefined,
		} as unknown as RoadNetworkNode;
		expect(() => buildRoadsideDecorations(legacy)).not.toThrow();
		expect(Object.keys(buildRoadsideDecorations(legacy)).length).toBeGreaterThan(0);
	});

	test("discards retired tree and guardrail decorations from legacy roads", () => {
		const node = longRoad();
		const existing = Object.values(node.roadsideDecorations)[0]!;
		const parsed = RoadNetworkNode.parse({
			...node,
			roadsideDecorations: {
				...node.roadsideDecorations,
				"retired-tree": { ...existing, id: "retired-tree", kind: "tree" },
				"retired-guardrail": {
					...existing,
					id: "retired-guardrail",
					kind: "guardrail",
				},
			},
		});

		expect(Object.values(parsed.roadsideDecorations).map((item) => item.kind)).not.toContain("tree");
		expect(Object.values(parsed.roadsideDecorations).map((item) => item.kind)).not.toContain("guardrail");
	});

	test("keeps an individually deleted generated decoration suppressed", () => {
		const node = longRoad();
		const deletedId = Object.keys(node.roadsideDecorations)[0]!;
		const next = RoadNetworkNode.parse({
			...node,
			roadsideDecorationSuppressed: { [deletedId]: true },
		});

		expect(buildRoadsideDecorations(next)[deletedId]).toBeUndefined();
	});

	test("maps semantic stations into visible world positions", () => {
		const node = longRoad();
		const previews = buildRoadsideDecorationPreviews(node);
		expect(previews).toHaveLength(Object.keys(node.roadsideDecorations).length);
		expect(previews.every((preview) => preview.position.every(Number.isFinite))).toBe(true);
		expect(previews.every((preview) => Number.isFinite(preview.rotationY))).toBe(true);
		expect(previews.every((preview) => Math.abs(preview.rotationY + Math.PI / 2) < 1e-6)).toBe(true);
	});

	test("uses the implemented street-light and road-sign models for previews", () => {
		const source = readFileSync(new URL("./road-network-model.tsx", import.meta.url), "utf8");
		expect(source).toContain("<StreetLightModel node={ROADSIDE_STREET_LIGHT} />");
		expect(source).toContain("<RoadSignModel node={ROADSIDE_ROAD_SIGN} />");
		expect(source).not.toContain('<sphereGeometry args={[0.16, 12, 8]} />');
		expect(source).not.toContain('<boxGeometry args={[0.52, 0.4, 0.06]} />');
	});

	test("renders visibility, lamp-side, and draggable spacing controls", () => {
		const markup = renderToStaticMarkup(createElement(RoadsideDecorationInspector, {
			node: longRoad(),
			onUpdate: () => {},
		}));
		expect(markup).toContain('aria-label="Roadside decorations"');
		expect(markup).toContain('aria-label="Roadside item visibility"');
		expect(markup).toContain('aria-label="Roadside lamp sides"');
		expect(markup).toContain('aria-label="Roadside decoration spacing"');
		expect(markup).toContain('aria-label="Auto-fill roadside"');
		expect(markup).toContain("Auto-fill roadside");
		expect(markup).toContain("Roadside lamps");
		expect(markup).toContain("Traffic signals");
		expect(markup).toContain("Lamps on both sides");
		expect(markup).toContain("Spacing");
		expect(markup).not.toContain("Sparse");
		expect(markup).not.toContain("Standard");
		expect(markup).not.toContain("Dense");
	});
});
