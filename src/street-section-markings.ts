import type { RoadNetworkNode } from "./schema";
import type { SectionSurface } from "./street-section-surfaces";
import {
	ribbonPolygons,
	splitRoadMarkingDashes,
	type RoadMarkingPolygon,
} from "./road-network-markings";
import { resolveRoadRegionalPack } from "./road-regional-packs";

/** Boundaries are the exact shared edges of the compiled lane strips, including tapers. */
export function compileSectionMarkings(
	node: RoadNetworkNode,
	surfaces: SectionSurface[],
): RoadMarkingPolygon[] {
	const result: RoadMarkingPolygon[] = [];
	const pack = resolveRoadRegionalPack(node);
	for (const edge of Object.values(node.edges)) {
		const style =
			node.stylePresets[
				node.applyStyleToAll ? node.activeStyleId : edge.styleId
			];
		if (!style?.markings) continue;
		for (const interval of edge.sectionLayout?.intervals ?? []) {
			for (let i = 0; i < interval.lanes.length - 1; i++) {
				const lane = interval.lanes[i]!,
					next = interval.lanes[i + 1]!;
				const strips = surfaces.filter(
					(s) =>
						s.edgeId === edge.id &&
						s.intervalId === interval.id &&
						s.physicalId === lane.id &&
						s.kind === "traffic",
				);
				if (!strips.length) continue;
				const points = [
					strips[0]!.points[0]!,
					...strips.map((s) => s.points[1]!),
				].map((p) => [p[0], p[1] + 0.014, p[2]] as const);
				const opposed =
					lane.direction !== next.direction &&
					lane.direction !== "both" &&
					next.direction !== "both";
				const paths = opposed ? [points] : splitRoadMarkingDashes(points);
				for (const path of paths)
					result.push(
						...ribbonPolygons(
							path,
							opposed ? 0.12 : 0.09,
							opposed ? "centerline" : "lane-dash",
							opposed ? pack.centerlineColor : pack.markingColor,
							edge.id,
						),
					);
			}
		}
	}
	return result;
}
