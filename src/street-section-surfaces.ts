import type { RoadNetworkNode } from "./schema";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import type { StreetSectionLayout } from "./domain/street-section-layout";
import type { CompiledStreetLayout } from "./street-compiler-layout";

export type SectionSurface = {
	edgeId: string;
	intervalId: string;
	physicalId: string;
	kind: string;
	color: string;
	points: [number, number, number][];
};
const appearance: Record<string, { color: string; height: number }> = {
	sidewalk: { color: "#b9b7b0", height: 0.055 },
	curb: { color: "#d8d5cd", height: 0.105 },
	verge: { color: "#748166", height: 0.06 },
	"protected-cycling": { color: "#517665", height: 0.008 },
	parking: { color: "#44484c", height: 0.004 },
	median: { color: "#748166", height: 0.06 },
	gutter: { color: "#85888a", height: 0.018 },
	shoulder: { color: "#44484c", height: 0.004 },
	traffic: { color: "#3f4246", height: 0 },
};
/** Shared quadrilaterals are consumed unchanged by the floorplan and the 3D mesh. */
export function compileStreetSectionSurfaces(
	node: RoadNetworkNode,
	trims?: Pick<CompiledStreetLayout, "junctionTrimByApproach">,
): SectionSurface[] {
	const result: SectionSurface[] = [];
	for (const edge of Object.values(node.edges)) {
		const layout = edge.sectionLayout;
		if (!layout) continue;
		const points = sampleRoadEdgePoints(node, edge);
		const stations = [0];
		for (let i = 1; i < points.length; i++)
			stations.push(
				stations[i - 1]! +
					Math.hypot(
						points[i]![0] - points[i - 1]![0],
						points[i]![2] - points[i - 1]![2],
					),
			);
		const total = stations.at(-1)!;
		if (Math.abs(total - layout.length) > 0.05) continue;
		const at = (
			station: number,
			offset: number,
			height: number,
		): [number, number, number] => {
			let i = 0;
			while (i < stations.length - 2 && stations[i + 1]! < station) i++;
			const a = points[i]!,
				b = points[i + 1]!,
				length = stations[i + 1]! - stations[i]!;
			const t = length > 1e-9 ? (station - stations[i]!) / length : 0;
			const dx = b[0] - a[0],
				dz = b[2] - a[2],
				horizontal = Math.hypot(dx, dz) || 1;
			return [
				a[0] + dx * t - (dz / horizontal) * offset,
				a[1] + (b[1] - a[1]) * t + height,
				a[2] + dz * t + (dx / horizontal) * offset,
			];
		};
		const width = (
			item: { width: number; startWidth?: number; endWidth?: number },
			interval: StreetSectionLayout["intervals"][number],
			station: number,
		) =>
			(item.startWidth ?? item.width) +
			(((item.endWidth ?? item.width) - (item.startWidth ?? item.width)) *
				(station - interval.start)) /
				(interval.end - interval.start);
		const startCut = trims?.junctionTrimByApproach[`${edge.startNodeId}:${edge.id}`] ?? 0;
		const endCut = trims?.junctionTrimByApproach[`${edge.endNodeId}:${edge.id}`] ?? 0;
		const cutScale = startCut + endCut > 0 ? Math.min(1, total * 0.9 / (startCut + endCut)) : 1;
		for (const interval of layout.intervals) {
			const start = Math.max(interval.start, startCut * cutScale);
			const end = Math.min(interval.end, total - endCut * cutScale);
			if (end <= start) continue;
			const sampleStations = [
				start,
				...stations.filter((s) => s > start && s < end),
				end,
			];
			for (let s = start + 1; s < end; s += 1) sampleStations.push(s);
			sampleStations.sort((a, b) => a - b);
			const entries = (station: number) => {
				const lanesWidth = interval.lanes.reduce(
					(sum, item) => sum + width(item, interval, station),
					0,
				);
				const strips: Array<{
					id: string;
					kind: string;
					inner: number;
					outer: number;
				}> = [];
				let laneOffset = lanesWidth / 2;
				for (const lane of interval.lanes) {
					const next = laneOffset - width(lane, interval, station);
					strips.push({
						id: lane.id,
						kind: "traffic",
						inner: next,
						outer: laneOffset,
					});
					laneOffset = next;
				}
				for (const [side, bands] of [
					[1, interval.leftBands],
					[-1, interval.rightBands],
				] as const) {
					let offset = lanesWidth / 2;
					for (const band of bands) {
						const next = offset + width(band, interval, station);
						strips.push({
							id: band.id,
							kind: band.kind,
							inner: side * offset,
							outer: side * next,
						});
						offset = next;
					}
				}
				return strips;
			};
			for (let i = 0; i < sampleStations.length - 1; i++) {
				const a = sampleStations[i]!,
					b = sampleStations[i + 1]!;
				if (b - a < 1e-8) continue;
				const from = entries(a),
					to = entries(b);
				for (let j = 0; j < from.length; j++) {
					const strip = from[j]!,
						next = to[j]!;
					if (
						Math.abs(strip.outer - strip.inner) +
							Math.abs(next.outer - next.inner) <
						1e-8
					)
						continue;
					const look = appearance[strip.kind]!;
					result.push({
						edgeId: edge.id,
						intervalId: interval.id,
						physicalId: strip.id,
						kind: strip.kind,
						color: look.color,
						points: [
							at(a, strip.inner, look.height),
							at(b, next.inner, look.height),
							at(b, next.outer, look.height),
							at(a, strip.outer, look.height),
						],
					});
				}
			}
		}
	}
	return result;
}
