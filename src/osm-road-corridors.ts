import {
	MappedInventoryReport,
	type MappedAssociationChoices,
	type MappedAssociationCandidate,
} from "./domain/mapped-inventory";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import type { GeoPoint } from "./osm-elevation";
import type { OsmImportResult, OsmMappedSurface } from "./osm-import";
import {
	projectToLocal,
	localToGeo,
	geographicToSite,
	type SiteFrame,
} from "./domain/site-frame";
import type { RoadNetworkGraph } from "./road-network-topology";
import type { RoadGraphEdge } from "./schema";
import {
	normalizeOsmRoadTags,
	parseOsmLength,
} from "./source/osm-normalization";

type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];

export type OsmSurfaceAssociation = {
	associatedEdgeIds: string[];
	confidence: "high" | "medium";
	distanceMeters: number;
	id: number;
	kind: OsmMappedSurface["kind"];
	partIndex?: number;
	holes?: Point3[][];
	points: Point3[];
	side: "left" | "right" | "center";
	sourceNodeIds: number[];
	sourceType: "relation" | "way";
	tags: Record<string, string>;
	widthMeters?: number;
	widthSource?: "mapped" | "estimated";
};

export type OsmCrossingAssociation = {
	associatedEdgeId: string;
	id: number;
	kind: "crossing" | "kerb";
	point: Point3;
	rotationY: number;
	tags: Record<string, string>;
};

type AssociationOptions = {
	choices?: MappedAssociationChoices;
	strict?: boolean;
	items: MappedInventoryReport["items"];
};

type GraphCandidate = {
	associatedEdgeIds: string[];
	graphIndex: number;
	headingScore: number;
	meanDistance: number;
	overlap: number;
	side: OsmSurfaceAssociation["side"];
};

function parseLength(value: string | undefined): number | undefined {
	return parseOsmLength(value) ?? undefined;
}

function surfaceDefaultWidth(
	kind: OsmMappedSurface["kind"],
): number | undefined {
	if (kind === "cycleway") return 2.2;
	if (kind === "kerb") return 0.18;
	if (kind === "sidewalk" || kind === "crossing") return 1.8;
	if (kind === "pedestrian-area") return 3;
	return undefined;
}

function surfaceMatchDistance(kind: OsmMappedSurface["kind"]): number {
	if (kind === "road-area" || kind === "pedestrian-area") return 18;
	if (kind === "crossing") return 12;
	if (kind === "cycleway") return 10;
	return 8;
}

function structureKey(tags: Record<string, string>): string {
	const { road } = normalizeOsmRoadTags(tags);
	return `${road.layer ?? 0}:${road.bridge === true ? "bridge" : "ground"}:${road.tunnel === true ? "tunnel" : "open"}`;
}

function edgeStructureKey(edge: RoadGraphEdge): string {
	return `${edge.osmVertical?.layer ?? 0}:${edge.osmVertical?.bridge ? "bridge" : "ground"}:${edge.osmVertical?.tunnel ? "tunnel" : "open"}`;
}

function closestPointOnSegment(point: Point2, start: Point3, end: Point3) {
	const dx = end[0] - start[0];
	const dz = end[2] - start[2];
	const lengthSquared = dx * dx + dz * dz;
	const t =
		lengthSquared <= 1e-9
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						((point[0] - start[0]) * dx + (point[1] - start[2]) * dz) /
							lengthSquared,
					),
				);
	const x = start[0] + dx * t;
	const z = start[2] + dz * t;
	const length = Math.max(Math.hypot(dx, dz), 1e-9);
	return {
		distance: Math.hypot(point[0] - x, point[1] - z),
		heading: [dx / length, dz / length] as Point2,
		lateral: (-dz / length) * (point[0] - x) + (dx / length) * (point[1] - z),
		point: [x, start[1] + (end[1] - start[1]) * t, z] as Point3,
	};
}

function closestPointOnPath(point: Point2, path: Point3[]) {
	let closest: ReturnType<typeof closestPointOnSegment> | undefined;
	for (let index = 0; index < path.length - 1; index += 1) {
		const candidate = closestPointOnSegment(
			point,
			path[index]!,
			path[index + 1]!,
		);
		if (!closest || candidate.distance < closest.distance) closest = candidate;
	}
	return closest;
}

function sampledFeaturePoints(points: Point3[], spacing = 4): Point3[] {
	if (points.length < 2) return points;
	const samples: Point3[] = [points[0]!];
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index]!;
		const end = points[index + 1]!;
		const distance = Math.hypot(end[0] - start[0], end[2] - start[2]);
		const count = Math.max(1, Math.ceil(distance / spacing));
		for (let step = 1; step <= count; step += 1)
			samples.push(interpolatePoint(start, end, step / count));
	}
	return samples;
}

function featureHeading(points: Point3[]): Point2 | undefined {
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last) return undefined;
	const dx = last[0] - first[0];
	const dz = last[2] - first[2];
	const length = Math.hypot(dx, dz);
	return length > 0.5 ? [dx / length, dz / length] : undefined;
}

function candidateForGraph(
	graph: RoadNetworkGraph,
	graphIndex: number,
	surface: OsmMappedSurface,
	points: Point3[],
): GraphCandidate | undefined {
	const eligible = Object.values(graph.edges).flatMap((edge) => {
		if (structureKey(surface.tags) !== edgeStructureKey(edge)) return [];
		const path = sampleRoadEdgePoints(graph, edge);
		return path.length >= 2 ? [{ edge, path }] : [];
	});
	if (eligible.length === 0) return undefined;
	const maxDistance = surfaceMatchDistance(surface.kind);
	const matches = sampledFeaturePoints(points).flatMap((point) => {
		let best:
			| (ReturnType<typeof closestPointOnPath> & { edgeId: string })
			| undefined;
		for (const { edge, path } of eligible) {
			const closest = closestPointOnPath([point[0], point[2]], path);
			if (closest && (!best || closest.distance < best.distance))
				best = { ...closest, edgeId: edge.id };
		}
		return best ? [best] : [];
	});
	if (matches.length === 0) return undefined;
	const near = matches.filter((match) => match.distance <= maxDistance);
	const overlap = near.length / matches.length;
	if (overlap < (surface.kind === "road-area" ? 0.2 : 0.5)) return undefined;
	const meanDistance =
		near.reduce((sum, match) => sum + match.distance, 0) / near.length;
	const heading = featureHeading(points);
	const headingScore = heading
		? near.reduce(
				(sum, match) =>
					sum +
					Math.abs(
						heading[0] * match.heading[0] + heading[1] * match.heading[1],
					),
				0,
			) / near.length
		: 1;
	if (
		surface.kind !== "road-area" &&
		surface.kind !== "crossing" &&
		headingScore < 0.45
	)
		return undefined;
	const lateral =
		near.reduce((sum, match) => sum + match.lateral, 0) / near.length;
	const side =
		Math.abs(lateral) < 0.35 ? "center" : lateral > 0 ? "left" : "right";
	return {
		associatedEdgeIds: [...new Set(near.map((match) => match.edgeId))],
		graphIndex,
		headingScore,
		meanDistance,
		overlap,
		side,
	};
}

function candidateScore(candidate: GraphCandidate): number {
	return (
		candidate.meanDistance +
		(1 - Math.max(0, Math.min(1, candidate.headingScore))) * 5 +
		(1 - candidate.overlap) * 4
	);
}

function insideRadius(point: Point3, radiusMeters: number): boolean {
	return Math.hypot(point[0], point[2]) <= radiusMeters + 0.5;
}

function radiusCrossings(start: Point3, end: Point3, radius: number): number[] {
	const dx = end[0] - start[0];
	const dz = end[2] - start[2];
	const a = dx * dx + dz * dz;
	if (a <= 1e-9) return [];
	const b = 2 * (start[0] * dx + start[2] * dz);
	const c = start[0] ** 2 + start[2] ** 2 - radius ** 2;
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return [];
	const root = Math.sqrt(discriminant);
	return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
		.filter((value) => value > 1e-9 && value < 1 - 1e-9)
		.sort((first, second) => first - second);
}

function interpolatePoint(start: Point3, end: Point3, t: number): Point3 {
	return [
		start[0] + (end[0] - start[0]) * t,
		start[1] + (end[1] - start[1]) * t,
		start[2] + (end[2] - start[2]) * t,
	];
}

function clipPolylineToRadius(points: Point3[], radius: number): Point3[] {
	if (points.length < 2) return [];
	const runs: Point3[][] = [];
	let result: Point3[] = [];
	const finishRun = () => {
		const clean = result.filter(
			(point, index) =>
				index === 0 ||
				Math.hypot(
					point[0] - result[index - 1]![0],
					point[2] - result[index - 1]![2],
				) > 1e-6,
		);
		if (clean.length >= 2) runs.push(clean);
		result = [];
	};
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index]!;
		const end = points[index + 1]!;
		const startInside = insideRadius(start, radius);
		const endInside = insideRadius(end, radius);
		const crossings = radiusCrossings(start, end, radius);
		if (startInside && result.length === 0) result.push(start);
		if (startInside && endInside) result.push(end);
		else if (startInside && !endInside && crossings[0] !== undefined) {
			result.push(interpolatePoint(start, end, crossings[0]));
			finishRun();
		} else if (!startInside && endInside && crossings.at(-1) !== undefined) {
			result.push(interpolatePoint(start, end, crossings.at(-1)!));
			result.push(end);
		} else if (!startInside && !endInside && crossings.length === 2) {
			runs.push([
				interpolatePoint(start, end, crossings[0]!),
				interpolatePoint(start, end, crossings[1]!),
			]);
		}
	}
	finishRun();
	const runLength = (run: Point3[]) =>
		run
			.slice(1)
			.reduce(
				(sum, point, index) =>
					sum +
					Math.hypot(point[0] - run[index]![0], point[2] - run[index]![2]),
				0,
			);
	return (
		runs.sort((first, second) => runLength(second) - runLength(first))[0] ?? []
	);
}

function intersectClipEdge(
	start: Point3,
	end: Point3,
	clipStart: Point2,
	clipEnd: Point2,
): Point3 {
	const edgeX = clipEnd[0] - clipStart[0];
	const edgeZ = clipEnd[1] - clipStart[1];
	const dx = end[0] - start[0];
	const dz = end[2] - start[2];
	const denominator = edgeX * dz - edgeZ * dx;
	if (Math.abs(denominator) < 1e-9) return start;
	const t = Math.max(
		0,
		Math.min(
			1,
			(edgeZ * (start[0] - clipStart[0]) - edgeX * (start[2] - clipStart[1])) /
				denominator,
		),
	);
	return interpolatePoint(start, end, t);
}

/** Clip a closed OSM area against a 64-sided approximation of the import circle. */
function clipPolygonToRadius(points: Point3[], radius: number): Point3[] {
	let output =
		points.length > 1 &&
		Math.hypot(
			points[0]![0] - points.at(-1)![0],
			points[0]![2] - points.at(-1)![2],
		) < 1e-6
			? points.slice(0, -1)
			: [...points];
	const clip = Array.from({ length: 64 }, (_, index) => {
		const angle = (index / 64) * Math.PI * 2;
		return [Math.cos(angle) * radius, Math.sin(angle) * radius] as Point2;
	});
	for (
		let edgeIndex = 0;
		edgeIndex < clip.length && output.length > 0;
		edgeIndex += 1
	) {
		const clipStart = clip[edgeIndex]!;
		const clipEnd = clip[(edgeIndex + 1) % clip.length]!;
		const input = output;
		output = [];
		const inside = (point: Point3) =>
			(clipEnd[0] - clipStart[0]) * (point[2] - clipStart[1]) -
				(clipEnd[1] - clipStart[1]) * (point[0] - clipStart[0]) >=
			-1e-7;
		let start = input.at(-1)!;
		for (const end of input) {
			const startInside = inside(start);
			const endInside = inside(end);
			if (endInside) {
				if (!startInside)
					output.push(intersectClipEdge(start, end, clipStart, clipEnd));
				output.push(end);
			} else if (startInside)
				output.push(intersectClipEdge(start, end, clipStart, clipEnd));
			start = end;
		}
	}
	if (output.length < 3) return [];
	return [...output, output[0]!];
}

function surfaceIsArea(surface: OsmMappedSurface): boolean {
	return (
		surface.sourceType === "relation" ||
		surface.kind === "road-area" ||
		surface.kind === "pedestrian-area" ||
		surface.tags.area === "yes"
	);
}

function conformSurfaceToRoad(
	graph: RoadNetworkGraph,
	edgeIds: string[],
	points: Point3[],
	floorOffset: number,
): Point3[] {
	const paths = edgeIds.flatMap((edgeId) => {
		const edge = graph.edges[edgeId];
		return edge ? [sampleRoadEdgePoints(graph, edge)] : [];
	});
	return points.map((point) => {
		let closest: ReturnType<typeof closestPointOnPath> | undefined;
		for (const path of paths) {
			const match = closestPointOnPath([point[0], point[2]], path);
			if (match && (!closest || match.distance < closest.distance))
				closest = match;
		}
		return [point[0], (closest?.point[1] ?? 0) + floorOffset, point[2]];
	});
}

/**
 * Match supplemental OSM geometry to complete road polylines. A feature is
 * owned by one graph and one compatible road corridor, never by the graph node
 * nearest its first coordinate.
 */
export function associateOsmMappedSurfaces(
	graphs: RoadNetworkGraph[],
	surfaces: OsmMappedSurface[],
	center: GeoPoint,
	radiusMeters: number,
	floorOffset: number,
	frame?: SiteFrame,
	options?: AssociationOptions,
): OsmSurfaceAssociation[][] {
	const byGraph = graphs.map(() => [] as OsmSurfaceAssociation[]);
	const intoFrame = (point: Point3): Point3 => {
		if (!frame) return point;
		const [x, z] = geographicToSite(
			localToGeo([point[0], point[2]], center),
			frame,
		);
		return [x, point[1], z];
	};
	for (const surface of surfaces) {
		const projectedSource = surface.points.map((point) => {
			const [x, z] = projectToLocal(point, center);
			return [x, floorOffset, z] as Point3;
		});
		const projected = surfaceIsArea(surface)
			? clipPolygonToRadius(projectedSource, radiusMeters).map(intoFrame)
			: clipPolylineToRadius(projectedSource, radiusMeters).map(intoFrame);
		if (projected.length < 2) continue;
		const candidates = graphs
			.flatMap((graph, graphIndex) => {
				const whole = candidateForGraph(graph, graphIndex, surface, projected);
				const individual = Object.values(graph.edges).flatMap((edge) => {
					const candidate = candidateForGraph(
						{ ...graph, edges: { [edge.id]: edge } },
						graphIndex,
						surface,
						projected,
					);
					return candidate ? [candidate] : [];
				});
				const unique = new Map<string, GraphCandidate>();
				for (const c of [...(whole ? [whole] : []), ...individual])
					unique.set([...c.associatedEdgeIds].sort().join("|"), c);
				return [...unique.values()];
			})
			.sort(
				(a, b) =>
					candidateScore(a) - candidateScore(b) ||
					[...a.associatedEdgeIds]
						.sort()
						.join("|")
						.localeCompare([...b.associatedEdgeIds].sort().join("|")),
			);
		const id = `${surface.sourceType ?? "way"}~${surface.id}~${surface.partIndex ?? 0}`;
		const item = associationItem(
			id,
			"surface",
			surface,
			candidates,
			options?.choices,
		);
		options?.items.push(item);
		const chosen = item.candidates.find(
			(c) => c.id === item.selectedCandidateId,
		);
		const best = options?.strict
			? item.status === "resolved" && chosen
				? candidates.find((c) => candidateId(c) === chosen.id)
				: undefined
			: candidates[0];
		if (!best) continue;
		const explicitWidth = parseLength(
			surface.tags.width ?? surface.tags.est_width,
		);
		const estimatedWidth = surfaceDefaultWidth(surface.kind);
		const ownedGraph = graphs[best.graphIndex]!;
		byGraph[best.graphIndex]!.push({
			associatedEdgeIds: best.associatedEdgeIds,
			confidence:
				best.meanDistance <= 4 &&
				best.headingScore >= 0.75 &&
				best.overlap >= 0.7
					? "high"
					: "medium",
			distanceMeters: best.meanDistance,
			id: surface.id,
			kind: surface.kind,
			...(surface.partIndex !== undefined
				? { partIndex: surface.partIndex }
				: {}),
			...(surface.holes
				? {
						holes: surface.holes
							.map((hole) =>
								clipPolygonToRadius(
									hole.map((point) => {
										const [x, z] = projectToLocal(point, center);
										return [x, floorOffset, z] as Point3;
									}),
									radiusMeters,
								).map(intoFrame),
							)
							.filter((hole) => hole.length >= 4)
							.map((hole) =>
								conformSurfaceToRoad(
									ownedGraph,
									best.associatedEdgeIds,
									hole,
									floorOffset,
								),
							),
					}
				: {}),
			points: conformSurfaceToRoad(
				ownedGraph,
				best.associatedEdgeIds,
				projected,
				floorOffset,
			),
			side: best.side,
			sourceNodeIds: surface.points.map((point) => point.nodeId),
			sourceType: surface.sourceType ?? "way",
			tags: surface.tags,
			...(explicitWidth !== undefined
				? {
						widthMeters: explicitWidth,
						widthSource: surface.tags.width
							? ("mapped" as const)
							: ("estimated" as const),
					}
				: estimatedWidth !== undefined
					? { widthMeters: estimatedWidth, widthSource: "estimated" as const }
					: {}),
		});
	}
	return byGraph;
}

export function associateOsmCrossings(
	graphs: RoadNetworkGraph[],
	crossings: NonNullable<OsmImportResult["crossings"]>,
	center: GeoPoint,
	radiusMeters: number,
	floorOffset: number,
	frame?: SiteFrame,
	options?: AssociationOptions,
): OsmCrossingAssociation[][] {
	const byGraph = graphs.map(() => [] as OsmCrossingAssociation[]);
	for (const crossing of crossings) {
		const sourcePoint = projectToLocal(crossing.point, center);
		if (Math.hypot(...sourcePoint) > radiusMeters + 0.5) continue;
		const [x, z] = frame
			? geographicToSite(crossing.point, frame)
			: sourcePoint;
		const matches: Array<{
			edge: RoadGraphEdge;
			graphIndex: number;
			match: NonNullable<ReturnType<typeof closestPointOnPath>>;
		}> = [];
		graphs.forEach((graph, graphIndex) => {
			Object.values(graph.edges).forEach((edge) => {
				if (structureKey(crossing.tags) !== edgeStructureKey(edge)) return;
				const match = closestPointOnPath(
					[x, z],
					sampleRoadEdgePoints(graph, edge),
				);
				if (!match || match.distance > 12) return;
				matches.push({ edge, graphIndex, match });
			});
		});
		matches.sort(
			(a, b) =>
				a.match.distance - b.match.distance ||
				a.edge.id.localeCompare(b.edge.id),
		);
		const candidates = matches.map((m) => ({
			associatedEdgeIds: [m.edge.id],
			graphIndex: m.graphIndex,
			headingScore: 1,
			overlap: 1,
			meanDistance: m.match.distance,
			side: "center" as const,
		}));
		const item = associationItem(
			`node~${crossing.id}`,
			crossing.kind ?? "crossing",
			crossing,
			candidates,
			options?.choices,
		);
		options?.items.push(item);
		const selected = item.candidates.find(
			(c) => c.id === item.selectedCandidateId,
		);
		const best = options?.strict
			? item.status === "resolved"
				? matches.find(
						(m) =>
							selected?.edgeIds.includes(m.edge.id) &&
							m.graphIndex === selected.graphIndex,
					)
				: undefined
			: matches[0];
		if (!best) continue;
		byGraph[best.graphIndex]!.push({
			associatedEdgeId: best.edge.id,
			id: crossing.id,
			kind: crossing.kind ?? "crossing",
			point:
				crossing.kind === "kerb"
					? [x, best.match.point[1] + floorOffset, z]
					: [
							best.match.point[0],
							best.match.point[1] + floorOffset,
							best.match.point[2],
						],
			rotationY: Math.atan2(best.match.heading[1], best.match.heading[0]),
			tags: crossing.tags,
		});
	}
	return byGraph;
}

function candidateId(candidate: GraphCandidate): string {
	return `graph~${candidate.graphIndex}~${JSON.stringify([...candidate.associatedEdgeIds].sort())}`;
}
function associationItem(
	id: string,
	kind: "surface" | "crossing" | "kerb",
	source: unknown,
	candidates: GraphCandidate[],
	choices?: MappedAssociationChoices,
): MappedInventoryReport["items"][number] {
	const best = candidates[0],
		runner = candidates[1];
	const high =
		best &&
		best.meanDistance <= 4 &&
		best.headingScore >= 0.75 &&
		best.overlap >= 0.7;
	const ambiguous =
		best && runner && candidateScore(runner) - candidateScore(best) < 1;
	const mapped: MappedAssociationCandidate[] = candidates.map((c) => ({
		id: candidateId(c),
		graphIndex: c.graphIndex,
		edgeIds: [...c.associatedEdgeIds].sort(),
		distanceMeters: c.meanDistance,
		score: candidateScore(c),
		headingScore: Math.min(1, c.headingScore),
		overlap: c.overlap,
		side: c.side,
	}));
	const manual = choices && Object.hasOwn(choices, id),
		choice = choices?.[id];
	const selected = manual
		? mapped.find((c) => c.id === choice)
		: high && !ambiguous
			? mapped[0]
			: undefined;
	const diagnostics: string[] = [];
	if (!best)
		diagnostics.push(
			"No compatible road corridor was found; original source geometry is retained.",
		);
	if (ambiguous)
		diagnostics.push(
			"Multiple nearby compatible corridors have similar scores; choose a candidate or reject the association.",
		);
	if (best && !high)
		diagnostics.push(
			"Distance, heading or overlap is uncertain; manual review is required.",
		);
	if (manual && choice !== null && !selected)
		diagnostics.push(
			"The chosen corridor is no longer available; review again rather than remapping to a nearby road.",
		);
	return {
		id,
		kind,
		source: JSON.parse(JSON.stringify(source)),
		status: selected
			? "resolved"
			: manual && choice === null
				? "rejected"
				: best
					? "pending"
					: "unmatched",
		basis: manual ? "manual" : selected ? "automatic" : "none",
		selectedCandidateId: selected?.id ?? null,
		candidates: mapped,
		diagnostics,
	};
}
export function resolveMappedInventory(
	graphs: RoadNetworkGraph[],
	surfaces: OsmMappedSurface[],
	crossings: NonNullable<OsmImportResult["crossings"]>,
	center: GeoPoint,
	radiusMeters: number,
	floorOffset: number,
	frame?: SiteFrame,
	choices?: MappedAssociationChoices,
	pointFeatures: readonly import("./osm-point-assets").OsmPointFeature[] = [],
) {
	const items: MappedInventoryReport["items"] = [];
	const options = { items, choices, strict: true };
	const surfacesByGraph = associateOsmMappedSurfaces(
		graphs,
		surfaces,
		center,
		radiusMeters,
		floorOffset,
		frame,
		options,
	);
	const crossingsByGraph = associateOsmCrossings(
		graphs,
		crossings,
		center,
		radiusMeters,
		floorOffset,
		frame,
		options,
	);
	for (const feature of pointFeatures) {
		if (Math.hypot(...projectToLocal(feature.point, center)) > radiusMeters)
			continue;
		items.push({
			id: `asset~${feature.sourceId.replaceAll("/", "~")}`,
			kind: "point-asset",
			source: JSON.parse(JSON.stringify(feature)),
			status: "resolved",
			basis: "automatic",
			selectedCandidateId: null,
			candidates: [],
			diagnostics: [
				"Mapped inventory position comes from the source; catalog model, unmeasured size and ground elevation remain separate estimates. Procedural placement proposals are not mapped observations.",
			],
		});
	}
	items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return {
		surfacesByGraph,
		crossingsByGraph,
		report: MappedInventoryReport.parse({
			format: "mapped-inventory-report",
			schemaVersion: 1,
			policyVersion: 1,
			items,
		}),
	};
}
