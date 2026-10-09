import { sectionEndpointStyle } from "./street-section-endpoint-style";
import type { RoadGraphEdge, RoadNetworkNode, RoadStylePreset } from "./schema";
import { DEFAULT_ROAD_STYLE_PRESETS } from "./road-style-presets";
import {
	buildJunctionBoundaryGeometry,
	sampleRoadEdgePoints,
} from "./road-network-geometry";
import {
	buildRoadJunctionBands,
	roadCarriagewayWidth,
} from "./road-cross-section";
import { buildManualRoadJunctionBoundary } from "./road-junction-boundary-editor";
function resolveStyle(
	node: RoadNetworkNode,
	edge: RoadGraphEdge,
	nodeId: string,
): RoadStylePreset | undefined {
	const styleId = node.applyStyleToAll ? node.activeStyleId : edge.styleId;
	const base = (
		node.stylePresets[styleId] ??
		(DEFAULT_ROAD_STYLE_PRESETS[
			styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS
		] as RoadStylePreset | undefined) ??
		node.stylePresets[node.activeStyleId]
	);
	return base ? sectionEndpointStyle(base, edge, nodeId) : undefined;
}

/** Existing 3D junction solution, detached from React and the host. */
export function compileStreetJunctions(node: RoadNetworkNode) {
	return Object.values(node.graphNodes).flatMap((graphNode) => {
		const incident = Object.values(node.edges).filter(
			(edge) =>
				edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
		);
		// Degree-two nodes are ordinary continuous bends. Their joined ribbon
		// already covers the turn; adding an intersection disk creates a
		// bulbous corner and lets per-junction geometry bleed beyond the kerb.
		if (incident.length < 3) return [];
		const styles = incident.flatMap((edge) => {
			const style = resolveStyle(node, edge, graphNode.id);
			return style ? [style] : [];
		});
		const radius = Math.max(
			...styles.map((style) => roadCarriagewayWidth(style) / 2),
			0,
		);
		const junction = node.junctions?.[graphNode.id];
		const primaryStyle = junction?.primaryEdgeIds.flatMap((edgeId) => {
			const edge = node.edges[edgeId];
			const candidate = edge ? resolveStyle(node, edge, graphNode.id) : undefined;
			return candidate ? [candidate] : [];
		})[0];
		const style = primaryStyle ?? styles[0];
		const approaches = incident.flatMap((edge) => {
			const edgeStyle = resolveStyle(node, edge, graphNode.id);
			const points = sampleRoadEdgePoints(node, edge);
			if (!edgeStyle || points.length < 2) return [];
			const from =
				edge.startNodeId === graphNode.id ? points[0]! : points.at(-1)!;
			const toward =
				edge.startNodeId === graphNode.id ? points[1]! : points.at(-2)!;
			return [
				{
					angle: Math.atan2(toward[2] - from[2], toward[0] - from[0]),
					edgeId: edge.id,
					halfWidth: roadCarriagewayWidth(edgeStyle) / 2,
				},
			];
		});
		const sideBands = buildRoadJunctionBands(styles);
		const treatment = junction?.treatment ?? "auto";
		const automaticSolution = buildJunctionBoundaryGeometry(
			approaches,
			junction?.cornerRadii ?? {},
		);
		const manualBoundary =
			junction?.manualBoundaryEnabled &&
			junction.manualBoundaryPoints.length >= 3
				? junction.manualBoundaryPoints
				: undefined;
		const solution = manualBoundary
			? buildManualRoadJunctionBoundary(automaticSolution, manualBoundary)
			: automaticSolution;
		const mappedHoles = node.osmMappedSurfaces
			.filter(
				(surface) =>
					surface.kind === "road-area" &&
					surface.points.length >= 3 &&
					(surface.tags["area:highway"] === "traffic_island" ||
						surface.tags.highway === "traffic_island" ||
						surface.tags.traffic_calming === "island"),
			)
			.map((surface) =>
				surface.points.map(
					(point) =>
						[
							point[0] - graphNode.position[0],
							point[2] - graphNode.position[2],
						] as const,
				),
			)
			.filter((hole) =>
				hole.every(([x, z]) => Math.hypot(x, z) <= solution.maxExtent + 0.5),
			);
		return style && radius > 0
			? [
					{
						graphNode,
						junction,
						manualBoundary,
						radius,
						sideBands,
						solution: { ...solution, holes: mappedHoles },
						style,
						treatment,
					},
				]
			: [];
	});
}
