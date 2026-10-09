import type { SitePoint } from "./domain/site-frame";
import type { RoadNetworkGraph } from "./road-network-topology";
import type { RoadNetworkNode } from "./schema";
type CoordinateRoad = RoadNetworkGraph &
	Partial<Pick<RoadNetworkNode, "osmMappedSurfaces" | "osmCrossings">>;

/** Shared coordinate conversion for current road payloads; never mutates the input. */
export function transformRoadCoordinates<T extends CoordinateRoad>(
	graph: T,
	transform: (point: SitePoint) => [number, number, number],
	verticalOffset: number,
): T {
	return {
		...graph,
		...(graph.osmMappedSurfaces
			? {
					osmMappedSurfaces: graph.osmMappedSurfaces.map((surface) => ({
						...surface,
						points: surface.points.map(transform),
						...(surface.holes
							? { holes: surface.holes.map((hole) => hole.map(transform)) }
							: {}),
					})),
				}
			: {}),
		...(graph.osmCrossings
			? {
					osmCrossings: graph.osmCrossings.map((crossing) => ({
						...crossing,
						point: transform(crossing.point),
					})),
				}
			: {}),
		graphNodes: Object.fromEntries(
			Object.entries(graph.graphNodes).map(([id, node]) => [
				id,
				{ ...node, position: transform(node.position) },
			]),
		),
		edges: Object.fromEntries(
			Object.entries(graph.edges).map(([id, edge]) => [
				id,
				{
					...edge,
					alignment: edge.alignment.map(transform),
					verticalProfile: edge.verticalProfile.map((point) => ({
						...point,
						elevation: point.elevation + verticalOffset,
					})),
				},
			]),
		),
		junctions: Object.fromEntries(
			Object.entries(graph.junctions).map(([id, junction]) => [
				id,
				{
					...junction,
					manualBoundaryPoints: junction.manualBoundaryPoints.map((point) => {
						const [x, , z] = transform([point[0], 0, point[1]]);
						return [x, z] as [number, number];
					}),
				},
			]),
		),
	};
}
