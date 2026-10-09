import type {
	RoadGraphEdge,
	RoadStylePreset,
	RoadSideComponents,
} from "./schema";

/** Junction mouth dimensions use the same endpoint widths as station surfaces. */
export function sectionEndpointStyle(
	base: RoadStylePreset,
	edge: RoadGraphEdge,
	nodeId: string,
): RoadStylePreset {
	const layout = edge.sectionLayout;
	if (!layout) return base;
	const atStart = edge.startNodeId === nodeId;
	const interval = atStart ? layout.intervals[0]! : layout.intervals.at(-1)!;
	const width = (item: {
		width: number;
		startWidth?: number;
		endWidth?: number;
	}) => (atStart ? item.startWidth : item.endWidth) ?? item.width;
	const lanes = interval.lanes.filter((lane) => width(lane) > 1e-6);
	const side = (bands: typeof interval.leftBands): RoadSideComponents => {
		const result: RoadSideComponents = {
			parkingLaneWidth: 0,
			busLaneWidth: 0,
			bikeLaneWidth: 0,
			gutterWidth: 0,
			curbWidth: 0,
			vergeWidth: 0,
			sidewalkWidth: 0,
		};
		const keys = {
			parking: "parkingLaneWidth",
			"protected-cycling": "bikeLaneWidth",
			gutter: "gutterWidth",
			curb: "curbWidth",
			verge: "vergeWidth",
			sidewalk: "sidewalkWidth",
			median: "vergeWidth",
			shoulder: "vergeWidth",
		} as const;
		for (const band of bands) result[keys[band.kind]] += width(band);
		return result;
	};
	return {
		...base,
		laneCount: lanes.length,
		laneWidths: lanes.map(width),
		laneDirections: lanes.map((lane) => lane.direction),
		laneUses: lanes.map((lane) => lane.use),
		shoulderWidth: 0,
		medianWidth: 0,
		leftSide: side(interval.leftBands),
		rightSide: side(interval.rightBands),
	};
}
