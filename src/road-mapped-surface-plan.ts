import type { RoadNetworkNode } from "./schema";
import { buildRoadRibbonGeometry } from "./road-network-geometry";
import { triangulateRoadBoundary } from "./road-junction-seams";
import { parseOsmLength } from "./source/osm-normalization";
type Surface = Pick<RoadNetworkNode["osmMappedSurfaces"][number], 'kind'|'tags'|'widthMeters'> & {sourceType?:'way'|'relation';points:Array<readonly [number,number,number]>;holes?:Array<Array<readonly [number,number,number]>>};
export function mappedSurfaceColor(kind: Surface["kind"]) {
	return kind === "cycleway"
		? "#4f8b72"
		: kind === "pedestrian-area"
			? "#b7a98f"
			: kind === "road-area"
				? "#44474a"
				: kind === "kerb"
					? "#777b7b"
					: kind === "crossing"
						? "#d6d0b5"
						: "#9c9a91";
}
export function buildMappedSurfaceMesh(surface: Surface): {
	positions: number[];
	indices: number[];
} {
	const points = surface.points;
	if (points.length < 2) return { positions: [], indices: [] };
	const closed =
		points.length >= 3 &&
		Math.hypot(
			points[0]![0] - points.at(-1)![0],
			points[0]![2] - points.at(-1)![2],
		) < 1e-5;
	if (
		closed &&
		(surface.sourceType === "relation" ||
			surface.kind === "pedestrian-area" ||
			surface.kind === "road-area" ||
			surface.tags.area === "yes")
	)
		return triangulateRoadBoundary(points.slice(0, -1), surface.holes ?? []);
	const width =
		surface.widthMeters ??
		parseOsmLength(surface.tags.width ?? surface.tags.est_width) ??
		(surface.kind === "cycleway"
			? 2.2
			: surface.kind === "kerb"
				? 0.18
				: surface.kind === "crossing"
					? 2.4
					: 1.8);
	return buildRoadRibbonGeometry(points, {
		elevationOffset: 0.01,
		surfaceThickness: 0,
		width,
	});
}
