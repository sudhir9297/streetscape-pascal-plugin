import {
	resolveOsmMovementEvidence,
	type OsmMovementEvidence,
} from "./source/osm-movement-evidence";
import {
	BaselineDiagnosticError,
	buildBaselineDiagnosticReport,
	type BaselineDiagnosticReport,
} from "./domain/baseline-diagnostics";
import { resolveMappedInventory } from "./osm-road-corridors";
import type {
	MappedInventoryReport,
	MappedAssociationChoices,
} from "./domain/mapped-inventory";
import {
	proposeStreetRegionalPolicy,
	resolveInitialStreetSections,
	type StreetRegionalPolicy,
	type StreetSectionReport,
} from "./domain/street-sections";
import {
	buildOsmSourceTopology,
	sourceTopologyNodeIds,
	type OsmSourceTopology,
} from "./source/osm-topology";
import {
	normalizeOsmRoadTags,
	normalizeOsmWays,
	OsmNormalizationError,
	type NormalizedOsmSource,
} from "./source/osm-normalization";
import { buildTerrainEvidence } from "./osm-terrain-evidence";
import {
	type TerrainEvidence,
	type TerrainSource,
	type TerrainCoverage,
} from "./domain/terrain-evidence";
import {
	createOsmImportScope,
	outsideSelectedPaths,
	type OsmImportScope,
} from "./osm-import-scope";
import {
	createOsmSourceSnapshot,
	type OsmSourceSnapshot,
} from "./source/osm-source-snapshot";
import {
	acquireOsmData,
	parseOsmAcquisition,
	type OsmAcquisition,
} from "./source/osm-acquisition";
export {
	buildOverpassQuery,
	splitOsmBoundingBox,
} from "./source/osm-acquisition";
import {
	interpretOsmAcquisition,
	type OsmWay,
	type OsmMappedSurface,
	type OsmCrossingFeature,
	type OsmLaneConnectivityRelation,
	type OsmMapData,
} from "./source/osm-interpretation";
export {
	normalizeOsmTags,
	parseOverpassResponse,
	parseOsmMapResponse,
	parseOsmMappedSurfaces,
	parseOsmCrossingFeatures,
	parseOsmLaneConnectivity,
	mergeOsmMapData,
	type OsmWay,
	type OsmMappedSurface,
	type OsmCrossingFeature,
	type OsmLaneConnectivityRelation,
	type OsmMapData,
} from "./source/osm-interpretation";
import { osmSpanIdentity } from "./domain/source-identity";
import {
	computeBoundingBox,
	projectToLocal,
	localToGeo,
	elevationToSiteHeight,
	createOsmSiteFrame,
	type SiteFrame,
} from "./domain/site-frame";
export {
	computeBoundingBox,
	projectToLocal,
	localToGeo,
} from "./domain/site-frame";
import {
	createEmptyRoadGraph,
	reconcileRoadJunctions,
	splitRoadGraphComponents,
	type RoadNetworkGraph,
} from "./road-network-topology";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import { validateRoadGraph } from "./road-network-validation";
import type { RoadGraphEdge, RoadGraphNode, RoadStylePreset } from "./schema";
import { buildOsmRoadStyle } from "./osm-road-style";
import { fitOsmJunctionCorners } from "./osm-junctions";
import type { GeoBoundingBox, GeoPoint } from "./osm-elevation";
import { TerrainSampler } from "./osm-elevation";
import {
	buildOsmPointAssets,
	countOsmPointAssets,
	type OsmImportedPointAsset,
	type OsmPointFeature,
} from "./osm-point-assets";

export const MIN_IMPORT_RADIUS_M = 10;
export const MAX_IMPORT_RADIUS_M = 600;
export const DEFAULT_IMPORT_RADIUS_M = 50;
export const MAX_IMPORT_SEGMENTS = 3000;
export const IMPORT_SIMPLIFY_TOLERANCE_M = 0.5;
/** Components shorter than this are edge-of-circle fragments and are dropped. */
const MIN_COMPONENT_LENGTH_M = 10;
const MERGE_DISTANCE_M = 0.05;

export type OsmRoadProps = {
	roadClass: RoadGraphEdge["roadClass"];
	styleId: string;
	direction: RoadGraphEdge["direction"];
	isBridge: boolean;
	stackLevel: number;
	style?: RoadStylePreset;
	osmVertical: RoadGraphEdge["osmVertical"];
};

type PlanPoint = readonly [number, number];

export type OsmSegment = {
	startId: string;
	endId: string;
	interior: PlanPoint[];
	props: OsmRoadProps;
	osmSource?: RoadGraphEdge["osmSource"];
	turnLanes?: RoadGraphEdge["turnLanes"];
	osmVertical?: RoadGraphEdge["osmVertical"];
};

export type OsmImportStats = {
	ways: number;
	edges: number;
	junctions: number;
	components: number;
	droppedComponents: number;
	failedElevationTiles: number;
};

export type OsmImportContext = {
	scope: OsmImportScope;
	/** Supporting topology in its own source frame, never placed as scene roads. */
	coordinateFrame: SiteFrame;
	graphs: RoadNetworkGraph[];
};

export type OsmImportResult = {
	baselineDiagnostics?: BaselineDiagnosticReport;
	inventoryReport?: MappedInventoryReport;
	associationChoices?: MappedAssociationChoices;
	sectionReport?: StreetSectionReport;
	sourceTopology?: OsmSourceTopology;
	normalization?: NormalizedOsmSource;
	movementEvidence?: OsmMovementEvidence;
	terrainEvidence?: TerrainEvidence;
	context?: OsmImportContext;
	acquisition?: OsmAcquisition;
	sourceSnapshot?: OsmSourceSnapshot;
	/** Coordinates of graphs/assets; source.center remains the acquisition center. */
	coordinateFrame?: SiteFrame;
	assets: OsmImportedPointAsset[];
	graphs: RoadNetworkGraph[];
	mappedSurfaces?: OsmMappedSurface[];
	crossings?: OsmCrossingFeature[];
	laneConnectivity?: OsmLaneConnectivityRelation[];
	source: {
		baseElevation: number | null;
		center: GeoPoint;
		provider: "openstreetmap";
		radiusMeters: number;
	};
	stats: OsmImportStats;
};

export type OsmStreetPreviewPath = {
	points: GeoPoint[];
	roadClass: RoadGraphEdge["roadClass"];
};

export type OsmStreetPreviewObject = Pick<
	OsmPointFeature,
	"kind" | "point" | "sourceId"
>;

export type OsmStreetPreview = {
	contextPaths?: OsmStreetPreviewPath[];
	scope?: OsmImportScope;
	assetCounts: ReturnType<typeof countOsmPointAssets>;
	mappedObjects: OsmStreetPreviewObject[];
	paths: OsmStreetPreviewPath[];
	segmentCount: number;
	wayCount: number;
};

const PREPARED_IMPORT_DATA: unique symbol = Symbol("prepared-osm-import-data");

export type PreparedOsmImport = {
	inventoryReport: MappedInventoryReport;
	associationChoices?: MappedAssociationChoices;
	regionalPolicy: StreetRegionalPolicy;
	sectionReport: StreetSectionReport;
	sourceTopology: OsmSourceTopology;
	normalization: NormalizedOsmSource;
	context: OsmImportContext;
	acquisition?: OsmAcquisition;
	sourceSnapshot?: OsmSourceSnapshot;
	center: GeoPoint;
	preview: OsmStreetPreview;
	radiusMeters: number;
	readonly [PREPARED_IMPORT_DATA]: {
		componentCount: number;
		nodePositions: Map<string, PlanPoint>;
		pointFeatures: OsmPointFeature[];
		mappedSurfaces: OsmMappedSurface[];
		crossings: OsmCrossingFeature[];
		laneConnectivity: OsmLaneConnectivityRelation[];
		previewGraphs: RoadNetworkGraph[];
		segments: OsmSegment[];
		waysCount: number;
		loadTerrain: boolean;
	};
};

/** Compatibility facade; acquisition is independent of interpretation. */
export async function fetchOsmMapData(
	bbox: GeoBoundingBox,
	signal?: AbortSignal,
): Promise<OsmMapData> {
	return interpretOsmAcquisition(await acquireOsmData(bbox, { signal }));
}

export async function fetchOsmStreets(
	bbox: GeoBoundingBox,
	signal?: AbortSignal,
): Promise<OsmWay[]> {
	return (await fetchOsmMapData(bbox, signal)).ways;
}

// --- tag mapping ---------------------------------------------------------------

export function mapOsmTags(tags: Record<string, string>): OsmRoadProps | null {
	const { road } = normalizeOsmRoadTags(tags);
	if (road.roadClass === null || road.styleId === null) return null;
	const direction = road.direction ?? "both";
	return {
		roadClass: road.roadClass,
		styleId: road.styleId,
		direction,
		style: buildOsmRoadStyle(tags, road.styleId, direction !== "both"),
		isBridge: road.bridge === true,
		stackLevel: Math.max(0, road.layer ?? 0),
		osmVertical: {
			...(road.layer !== null ? { layer: road.layer } : {}),
			...(road.elevationMeters !== null ? { ele: road.elevationMeters } : {}),
			...(road.bridge === true ? { bridge: true } : {}),
			...(road.tunnel === true ? { tunnel: true } : {}),
		},
	};
}

// --- polyline utilities ----------------------------------------------------------

function distance(a: PlanPoint, b: PlanPoint): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function simplifyPolyline(
	points: PlanPoint[],
	tolerance: number = IMPORT_SIMPLIFY_TOLERANCE_M,
): PlanPoint[] {
	if (points.length <= 2) return points;
	const keep = new Array<boolean>(points.length).fill(false);
	keep[0] = keep[points.length - 1] = true;
	const stack: Array<[number, number]> = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [first, last] = stack.pop()!;
		const start = points[first]!;
		const end = points[last]!;
		const dx = end[0] - start[0];
		const dz = end[1] - start[1];
		const lengthSq = dx * dx + dz * dz;
		let maxDistance = 0;
		let maxIndex = -1;
		for (let index = first + 1; index < last; index++) {
			const point = points[index]!;
			let perpendicular: number;
			if (lengthSq < 1e-12) {
				perpendicular = distance(point, start);
			} else {
				const t = Math.max(
					0,
					Math.min(
						1,
						((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
							lengthSq,
					),
				);
				perpendicular = Math.hypot(
					point[0] - (start[0] + t * dx),
					point[1] - (start[1] + t * dz),
				);
			}
			if (perpendicular > maxDistance) {
				maxDistance = perpendicular;
				maxIndex = index;
			}
		}
		if (maxIndex >= 0 && maxDistance > tolerance) {
			keep[maxIndex] = true;
			stack.push([first, maxIndex], [maxIndex, last]);
		}
	}
	return points.filter((_, index) => keep[index]);
}

// --- clipping, splitting, segment building --------------------------------------

type RunPoint = { id: string | null; point: PlanPoint; sourceIndex: number };

/** t values in [0,1] where the segment a→b crosses the circle of the radius. */
function circleCrossings(a: PlanPoint, b: PlanPoint, radius: number): number[] {
	const dx = b[0] - a[0];
	const dz = b[1] - a[1];
	const qa = dx * dx + dz * dz;
	if (qa < 1e-12) return [];
	const qb = 2 * (a[0] * dx + a[1] * dz);
	const qc = a[0] * a[0] + a[1] * a[1] - radius * radius;
	const discriminant = qb * qb - 4 * qa * qc;
	if (discriminant < 0) return [];
	const root = Math.sqrt(discriminant);
	return [
		...new Set(
			[(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]
				.filter((t) => t >= -1e-9 && t <= 1 + 1e-9)
				.map((t) => Math.max(0, Math.min(1, t))),
		),
	];
}

function lerpPoint(a: PlanPoint, b: PlanPoint, t: number): PlanPoint {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipRunToRadius(
	points: RunPoint[],
	radius: number,
	nextBoundaryId: (index: number, t: number) => string,
): RunPoint[][] {
	const inside = (p: PlanPoint) => Math.hypot(p[0], p[1]) <= radius;
	const runs: RunPoint[][] = [];
	let current: RunPoint[] = [];
	const flush = () => {
		if (current.length >= 2) runs.push(current);
		current = [];
	};
	for (let index = 0; index < points.length - 1; index++) {
		const a = points[index]!;
		const b = points[index + 1]!;
		const aIn = inside(a.point);
		const bIn = inside(b.point);
		const crossings = circleCrossings(a.point, b.point, radius);
		if (aIn && current.length === 0) current.push(a);
		if (aIn && bIn) {
			current.push(b);
		} else if (aIn && !bIn) {
			const t = crossings[0] ?? 1;
			current.push({
				id: nextBoundaryId(index, t),
				sourceIndex: a.sourceIndex + t,
				point: lerpPoint(a.point, b.point, t),
			});
			flush();
		} else if (!aIn && bIn) {
			const t = crossings[crossings.length - 1] ?? 0;
			current = [
				{
					id: nextBoundaryId(index, t),
					sourceIndex: a.sourceIndex + t,
					point: lerpPoint(a.point, b.point, t),
				},
				b,
			];
		} else if (crossings.length === 2) {
			runs.push([
				{
					id: nextBoundaryId(index, crossings[0]!),
					sourceIndex: a.sourceIndex + crossings[0]!,
					point: lerpPoint(a.point, b.point, crossings[0]!),
				},
				{
					id: nextBoundaryId(index, crossings[1]!),
					sourceIndex: a.sourceIndex + crossings[1]!,
					point: lerpPoint(a.point, b.point, crossings[1]!),
				},
			]);
		}
	}
	flush();
	return runs;
}

export function buildSegmentsFromWays(
	ways: OsmWay[],
	center: GeoPoint,
	radiusMeters: number,
	junctionIds: ReadonlySet<string> = new Set(),
): { segments: OsmSegment[]; nodePositions: Map<string, PlanPoint> } {
	let boundaryCounter = 0;
	const topologyIds = sourceTopologyNodeIds(buildOsmSourceTopology(ways));
	const runsWithProps: Array<{
		run: RunPoint[];
		props: OsmRoadProps;
		way: OsmWay;
	}> = [];
	for (const way of [...ways].sort((a, b) => a.id - b.id)) {
		const props = mapOsmTags(way.tags);
		if (!props) continue;
		const points: RunPoint[] = way.points.map((point, sourceIndex) => ({
			sourceIndex,
			id: topologyIds.get(`${way.id}~${sourceIndex}`) ?? `n${point.nodeId}`,
			point: projectToLocal(point, center),
		}));
		for (const run of clipRunToRadius(
			points,
			radiusMeters,
			(index, t) =>
				`b~osm~${way.id}~${index}~${circleCrossings(points[index]!.point, points[index + 1]!.point, radiusMeters).indexOf(t)}`,
		)) {
			runsWithProps.push({ run, props, way });
		}
	}

	const idCount = new Map<string, number>();
	for (const { run } of runsWithProps) {
		for (const { id } of run) {
			if (id) idCount.set(id, (idCount.get(id) ?? 0) + 1);
		}
	}

	const segments: OsmSegment[] = [];
	const nodePositions = new Map<string, PlanPoint>();
	for (const { run, props, way } of runsWithProps) {
		let sliceStart = 0;
		for (let index = 1; index < run.length; index++) {
			const isLast = index === run.length - 1;
			const point = run[index]!;
			const isJunction =
				point.id !== null &&
				((idCount.get(point.id) ?? 0) >= 2 || junctionIds.has(point.id));
			if (!isLast && !isJunction) continue;
			const slice = run.slice(sliceStart, index + 1);
			sliceStart = index;
			const start = slice[0]!;
			const end = slice[slice.length - 1]!;
			const startId = start.id ?? `b${++boundaryCounter}`;
			const endId = end.id ?? `b${++boundaryCounter}`;
			nodePositions.set(startId, start.point);
			nodePositions.set(endId, end.point);
			const simplified = simplifyPolyline(slice.map((entry) => entry.point));
			segments.push({
				startId,
				endId,
				interior: simplified.slice(1, -1),
				osmSource: {
					wayId: way.id,
					nodeIds: way.points.map((point) => point.nodeId),
					span: {
						start: start.sourceIndex,
						end: end.sourceIndex,
						coverage: "exact",
					},
					tags: { ...way.tags },
				},
				turnLanes: {
					start:
						start.sourceIndex === 0 && props.direction !== "forward"
							? (way.tags["turn:lanes:backward"] ??
								(props.direction === "reverse"
									? way.tags["turn:lanes"]
									: undefined))
							: undefined,
					end:
						end.sourceIndex === way.points.length - 1 &&
						props.direction !== "reverse"
							? (way.tags["turn:lanes:forward"] ??
								(props.direction === "forward"
									? way.tags["turn:lanes"]
									: undefined))
							: undefined,
				},
				osmVertical: props.osmVertical,
				props,
			});
		}
	}
	return { segments, nodePositions };
}

function segmentPath(
	segment: OsmSegment,
	nodePositions: Map<string, PlanPoint>,
): PlanPoint[] {
	return [
		nodePositions.get(segment.startId)!,
		...segment.interior,
		nodePositions.get(segment.endId)!,
	];
}

function pathLength(points: PlanPoint[]): number {
	let length = 0;
	for (let index = 0; index < points.length - 1; index++) {
		length += distance(points[index]!, points[index + 1]!);
	}
	return length;
}

/**
 * The road-graph validator rejects self-loops, duplicate node pairs, and
 * edges shorter than 5 cm — all of which occur in raw OSM data (roundabout
 * closures, dual carriageways, degenerate stubs). Split offenders at an
 * interior point; merge or drop the pointless remainder.
 */
export function ensureSimpleSegments(
	segments: OsmSegment[],
	nodePositions: Map<string, PlanPoint>,
): OsmSegment[] {
	const alias = new Map<string, string>();
	const resolve = (id: string): string => {
		let current = id;
		while (alias.has(current)) current = alias.get(current)!;
		return current;
	};
	const queue: OsmSegment[] = [];
	for (const segment of segments) {
		const start = nodePositions.get(segment.startId)!;
		const end = nodePositions.get(segment.endId)!;
		if (
			segment.interior.length === 0 &&
			distance(start, end) < MERGE_DISTANCE_M
		) {
			// The host cannot display a sub-5cm edge; its source nodes remain
			// distinct in the logical topology. Never alias source identities.
			if (segment.osmSource) continue;
			const keep = resolve(segment.startId);
			const merge = resolve(segment.endId);
			if (merge !== keep) alias.set(merge, keep);
		} else {
			queue.push(segment);
		}
	}

	const result: OsmSegment[] = [];
	const pairs = new Set<string>();
	while (queue.length > 0) {
		let segment = queue.shift()!;
		const startId = resolve(segment.startId);
		const endId = resolve(segment.endId);
		const start = nodePositions.get(startId)!;
		const end = nodePositions.get(endId)!;
		const pairKey = [startId, endId].sort().join("|");
		const problematic =
			startId === endId ||
			pairs.has(pairKey) ||
			distance(start, end) < MERGE_DISTANCE_M;
		if (!problematic) {
			pairs.add(pairKey);
			result.push({ ...segment, startId, endId });
			continue;
		}
		if (segment.interior.length === 0) {
			if (distance(start, end) < MERGE_DISTANCE_M * 2) continue;
			segment = { ...segment, interior: [lerpPoint(start, end, 0.5)] };
		}
		const splitIndex = Math.floor(segment.interior.length / 2);
		const midId = `m~${segment.osmSource?.wayId ?? "local"}~${startId}~${endId}~${pairs.size}~mid`;
		nodePositions.set(midId, segment.interior[splitIndex]!);
		queue.push(
			{
				startId,
				endId: midId,
				interior: segment.interior.slice(0, splitIndex),
				osmSource: segment.osmSource
					? {
							...segment.osmSource,
							span: segment.osmSource.span
								? { ...segment.osmSource.span, coverage: "conservative" }
								: undefined,
						}
					: undefined,
				turnLanes: segment.turnLanes
					? { start: segment.turnLanes.start }
					: undefined,
				osmVertical: segment.osmVertical,
				props: segment.props,
			},
			{
				startId: midId,
				endId,
				interior: segment.interior.slice(splitIndex + 1),
				osmSource: segment.osmSource
					? {
							...segment.osmSource,
							span: segment.osmSource.span
								? { ...segment.osmSource.span, coverage: "conservative" }
								: undefined,
						}
					: undefined,
				turnLanes: segment.turnLanes
					? { end: segment.turnLanes.end }
					: undefined,
				osmVertical: segment.osmVertical,
				props: segment.props,
			},
		);
	}
	return result;
}

// --- graph assembly ----------------------------------------------------------

function importedSegmentId(segment: OsmSegment, index: number): string {
	return segment.osmSource
		? `${osmSpanIdentity(segment.osmSource) ?? `osm:way:${segment.osmSource.wayId}`}~${segment.startId}~${segment.endId}`.replaceAll(
				":",
				"~",
			)
		: `e${index + 1}`;
}

export function buildRoadGraphFromSegments(
	segments: OsmSegment[],
	nodePositions: Map<string, PlanPoint>,
): { graph: RoadNetworkGraph; bridgeEdgeIds: Set<string> } {
	const graph = createEmptyRoadGraph();
	const bridgeEdgeIds = new Set<string>();
	const nodeAllBridge = new Map<string, boolean>();
	for (const segment of segments) {
		for (const id of [segment.startId, segment.endId]) {
			nodeAllBridge.set(
				id,
				(nodeAllBridge.get(id) ?? true) && segment.props.isBridge,
			);
		}
	}
	for (const [id, allBridge] of nodeAllBridge) {
		const point = nodePositions.get(id)!;
		const node: RoadGraphNode = {
			id,
			osmTopologyOrigin: /^n\d+(?:~|$)/.test(id)
				? { kind: "source", nodeId: Number(id.match(/^n(\d+)/)![1]) }
				: {
						kind: "derived",
						reason: id.startsWith("b~osm~")
							? "scope-boundary"
							: "simple-graph-adapter",
						wayIds: [
							...new Set(
								segments
									.filter((s) => s.startId === id || s.endId === id)
									.flatMap((s) => (s.osmSource ? [s.osmSource.wayId] : [])),
							),
						],
					},
			position: [point[0], 0, point[1]],
			level: 0,
			elevationMode: allBridge ? "bridge" : "ground",
			terminal: false,
		};
		graph.graphNodes[id] = node;
	}
	const importedStyles = new Map<string, string>();
	segments.forEach((segment, index) => {
		const id = importedSegmentId(segment, index);
		let styleId = segment.props.styleId;
		if (segment.props.style) {
			const key = JSON.stringify(segment.props.style);
			styleId = importedStyles.get(key) ?? `osm-${importedStyles.size + 1}`;
			importedStyles.set(key, styleId);
			graph.stylePresets[styleId] = { ...segment.props.style, id: styleId };
		}
		const edge: RoadGraphEdge = {
			id,
			startNodeId: segment.startId,
			endNodeId: segment.endId,
			alignment: segment.interior.map((point) => [point[0], 0, point[1]]),
			profileMode: "legacy",
			verticalProfile: [],
			styleId,
			direction: segment.props.direction,
			osmSource: segment.osmSource,
			turnLanes: segment.turnLanes,
			osmVertical: segment.osmVertical,
			roadClass: segment.props.roadClass,
			joinMode: "auto",
			stackLevel: segment.props.stackLevel,
		};
		graph.edges[id] = edge;
		if (segment.props.isBridge) bridgeEdgeIds.add(id);
	});
	return { graph, bridgeEdgeIds };
}

/**
 * Bake sampled ground elevation into node positions and alignment points.
 * Bridge decks interpolate linearly between their endpoints instead of
 * draping over the terrain they span.
 */
export function applyElevations(
	graph: RoadNetworkGraph,
	bridgeEdgeIds: Set<string>,
	elevationAt: (x: number, z: number) => number,
	hasElevationAt: (x: number, z: number) => boolean = () => true,
): void {
	for (const node of Object.values(graph.graphNodes)) {
		node.position = [
			node.position[0],
			elevationAt(node.position[0], node.position[2]),
			node.position[2],
		];
	}
	for (const edge of Object.values(graph.edges)) {
		const points = [
			graph.graphNodes[edge.startNodeId]!.position,
			graph.graphNodes[edge.endNodeId]!.position,
			...edge.alignment,
		];
		edge.verticalSource = {
			kind:
				!bridgeEdgeIds.has(edge.id) &&
				points.every((point) => hasElevationAt(point[0], point[2]))
					? "terrain"
					: "estimated",
		};
		if (edge.alignment.length === 0) continue;
		const start = graph.graphNodes[edge.startNodeId]!.position;
		const end = graph.graphNodes[edge.endNodeId]!.position;
		if (bridgeEdgeIds.has(edge.id)) {
			const path: PlanPoint[] = [
				[start[0], start[2]],
				...edge.alignment.map((p): PlanPoint => [p[0], p[2]]),
				[end[0], end[2]],
			];
			const total = Math.max(pathLength(path), 1e-6);
			let travelled = 0;
			edge.alignment = edge.alignment.map((point, index) => {
				travelled += distance(path[index]!, path[index + 1]!);
				const t = travelled / total;
				return [point[0], start[1] + (end[1] - start[1]) * t, point[2]];
			});
		} else {
			edge.alignment = edge.alignment.map((point) => [
				point[0],
				elevationAt(point[0], point[2]),
				point[2],
			]);
		}
	}
}

/** Apply explicit OSM elevations as a constrained profile relative to the import origin. */
export function applyOsmElevationFacts(
	graph: RoadNetworkGraph,
	baseElevation: number,
): void {
	const incident = new Map<string, RoadGraphEdge[]>();
	for (const edge of Object.values(graph.edges)) {
		for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
			const edges = incident.get(nodeId) ?? [];
			edges.push(edge);
			incident.set(nodeId, edges);
		}
	}
	for (const [nodeId, edges] of incident) {
		const elevations = edges.flatMap((edge) =>
			Number.isFinite(edge.osmVertical?.ele) ? [edge.osmVertical!.ele!] : [],
		);
		if (elevations.length !== edges.length || elevations.length === 0) continue;
		if (Math.max(...elevations) - Math.min(...elevations) > 0.5) continue;
		const node = graph.graphNodes[nodeId];
		if (!node) continue;
		const elevation =
			elevations.reduce((sum, value) => sum + value, 0) / elevations.length -
			baseElevation;
		node.position = [node.position[0], elevation, node.position[2]];
	}
	for (const edge of Object.values(graph.edges)) {
		const mappedElevation = edge.osmVertical?.ele;
		if (!Number.isFinite(mappedElevation)) continue;
		const start = graph.graphNodes[edge.startNodeId];
		const end = graph.graphNodes[edge.endNodeId];
		if (!start || !end) continue;
		const target = mappedElevation! - baseElevation;
		const points: PlanPoint[] = [
			[start.position[0], start.position[2]],
			...edge.alignment.map((point): PlanPoint => [point[0], point[2]]),
			[end.position[0], end.position[2]],
		];
		const total = pathLength(points);
		if (total <= 1e-6) continue;
		const inset = Math.min(10, total * 0.25);
		edge.profileMode = "designed";
		edge.verticalSource = { kind: "mapped" };
		edge.verticalProfile =
			total > inset * 2 + 0.1
				? [
						{
							id: `osm-ele-${edge.id}-start`,
							station: inset,
							elevation: target,
							curveLength: Math.min(10, inset * 2),
						},
						{
							id: `osm-ele-${edge.id}-end`,
							station: total - inset,
							elevation: target,
							curveLength: Math.min(10, inset * 2),
						},
					]
				: [
						{
							id: `osm-ele-${edge.id}`,
							station: total / 2,
							elevation: target,
							curveLength: Math.min(10, total * 0.5),
						},
					];
	}
}

function planSegmentIntersection(
	firstStart: readonly [number, number, number],
	firstEnd: readonly [number, number, number],
	secondStart: readonly [number, number, number],
	secondEnd: readonly [number, number, number],
): { firstMix: number; secondMix: number } | null {
	const ax = firstEnd[0] - firstStart[0];
	const az = firstEnd[2] - firstStart[2];
	const bx = secondEnd[0] - secondStart[0];
	const bz = secondEnd[2] - secondStart[2];
	const denominator = ax * bz - az * bx;
	if (Math.abs(denominator) <= 1e-8) return null;
	const dx = secondStart[0] - firstStart[0];
	const dz = secondStart[2] - firstStart[2];
	const firstMix = (dx * bz - dz * bx) / denominator;
	const secondMix = (dx * az - dz * ax) / denominator;
	return firstMix > 1e-4 &&
		firstMix < 1 - 1e-4 &&
		secondMix > 1e-4 &&
		secondMix < 1 - 1e-4
		? { firstMix, secondMix }
		: null;
}

/** Build conservative bridge and tunnel profiles where mapped structures cross ordinary roads. */
export function applyOsmStructureClearances(
	graph: RoadNetworkGraph,
	clearanceMeters = 4.5,
): void {
	const edges = Object.values(graph.edges);
	for (const structure of edges) {
		const isBridge = structure.osmVertical?.bridge === true;
		const isTunnel = structure.osmVertical?.tunnel === true;
		if ((!isBridge && !isTunnel) || structure.verticalSource?.kind === "mapped")
			continue;
		const structurePoints = sampleRoadEdgePoints(graph, structure, 48);
		if (structurePoints.length < 2) continue;
		let travelled = 0;
		const controls: Array<{ station: number; elevation: number }> = [];
		for (
			let structureIndex = 0;
			structureIndex < structurePoints.length - 1;
			structureIndex += 1
		) {
			const start = structurePoints[structureIndex]!;
			const end = structurePoints[structureIndex + 1]!;
			const segmentLength = Math.hypot(end[0] - start[0], end[2] - start[2]);
			for (const other of edges) {
				if (
					other.id === structure.id ||
					other.osmVertical?.bridge ||
					other.osmVertical?.tunnel
				)
					continue;
				const otherPoints = sampleRoadEdgePoints(graph, other, 48);
				for (
					let otherIndex = 0;
					otherIndex < otherPoints.length - 1;
					otherIndex += 1
				) {
					const otherStart = otherPoints[otherIndex]!;
					const otherEnd = otherPoints[otherIndex + 1]!;
					const crossing = planSegmentIntersection(
						start,
						end,
						otherStart,
						otherEnd,
					);
					if (!crossing) continue;
					const structureElevation =
						start[1] + (end[1] - start[1]) * crossing.firstMix;
					const otherElevation =
						otherStart[1] + (otherEnd[1] - otherStart[1]) * crossing.secondMix;
					const required = isBridge
						? otherElevation + clearanceMeters
						: otherElevation - clearanceMeters;
					if (
						(isBridge && structureElevation >= required) ||
						(isTunnel && structureElevation <= required)
					)
						continue;
					controls.push({
						station: travelled + segmentLength * crossing.firstMix,
						elevation: required,
					});
				}
			}
			travelled += segmentLength;
		}
		if (controls.length === 0) continue;
		structure.profileMode = "designed";
		structure.verticalSource = { kind: "estimated", clearanceMeters };
		structure.verticalProfile = controls
			.sort((first, second) => first.station - second.station)
			.filter(
				(control, index, all) =>
					index === 0 || control.station - all[index - 1]!.station > 0.5,
			)
			.map((control, index) => ({
				id: `osm-clearance-${structure.id}-${index + 1}`,
				station: control.station,
				elevation: control.elevation,
				curveLength: Math.min(30, Math.max(6, clearanceMeters * 4)),
			}));
	}
}

type AssembledImport = {
	componentCount: number;
	graphs: RoadNetworkGraph[];
};

function countImportJunctions(graphs: RoadNetworkGraph[]): number {
	return graphs.reduce((sum, component) => {
		const incident = new Map<string, number>();
		for (const edge of Object.values(component.edges)) {
			incident.set(edge.startNodeId, (incident.get(edge.startNodeId) ?? 0) + 1);
			incident.set(edge.endNodeId, (incident.get(edge.endNodeId) ?? 0) + 1);
		}
		return sum + [...incident.values()].filter((count) => count >= 3).length;
	}, 0);
}

function createImportResult(
	prepared: PreparedOsmImport,
	assembly: AssembledImport,
	assets: OsmImportedPointAsset[],
	baseElevation: number | null,
	failedElevationTiles: number,
): OsmImportResult {
	return {
		assets,
		associationChoices: prepared.associationChoices,
		inventoryReport: resolveMappedInventory(
			assembly.graphs,
			prepared[PREPARED_IMPORT_DATA].mappedSurfaces,
			prepared[PREPARED_IMPORT_DATA].crossings,
			prepared.center,
			prepared.radiusMeters,
			0,
			undefined,
			prepared.associationChoices,
			prepared[PREPARED_IMPORT_DATA].pointFeatures,
		).report,
		sectionReport: resolveInitialStreetSections(
			assembly.graphs,
			prepared.regionalPolicy,
		),
		movementEvidence: resolveGraphMovementEvidence(
			prepared.normalization,
			assembly.graphs,
		),
		normalization: structuredClone(prepared.normalization),
		sourceTopology: structuredClone(prepared.sourceTopology),
		context: structuredClone(prepared.context),
		...(prepared.acquisition
			? {
					acquisition: structuredClone(prepared.acquisition),
					sourceSnapshot: prepared.sourceSnapshot,
				}
			: {}),
		coordinateFrame: createOsmSiteFrame({
			center: prepared.center,
			baseElevation,
		}),
		graphs: assembly.graphs,
		mappedSurfaces: prepared[PREPARED_IMPORT_DATA].mappedSurfaces,
		crossings: prepared[PREPARED_IMPORT_DATA].crossings,
		laneConnectivity: prepared[PREPARED_IMPORT_DATA].laneConnectivity,
		source: {
			baseElevation,
			center: { ...prepared.center },
			provider: "openstreetmap",
			radiusMeters: prepared.radiusMeters,
		},
		stats: {
			ways: prepared[PREPARED_IMPORT_DATA].waysCount,
			edges: assembly.graphs.reduce(
				(sum, graph) => sum + Object.keys(graph.edges).length,
				0,
			),
			junctions: countImportJunctions(assembly.graphs),
			components: assembly.graphs.length,
			droppedComponents: assembly.componentCount - assembly.graphs.length,
			failedElevationTiles,
		},
	};
}

function assembleImportGraphs(
	segments: OsmSegment[],
	nodePositions: Map<string, PlanPoint>,
	elevationAt?: (x: number, z: number) => number,
	baseElevation?: number,
	hasElevationAt?: (x: number, z: number) => boolean,
	mappedReferenceCompatible = false,
): AssembledImport {
	const { graph, bridgeEdgeIds } = buildRoadGraphFromSegments(
		segments,
		nodePositions,
	);
	if (elevationAt)
		applyElevations(graph, bridgeEdgeIds, elevationAt, hasElevationAt);
	if (baseElevation !== undefined && mappedReferenceCompatible)
		applyOsmElevationFacts(graph, baseElevation);
	applyOsmStructureClearances(graph);
	reconcileRoadJunctions(graph);
	fitOsmJunctionCorners(graph);
	const errors = validateRoadGraph(graph).filter(
		(issue) => issue.severity === "error",
	);
	if (errors.length > 0) {
		throw new BaselineDiagnosticError(
			buildBaselineDiagnosticReport({ graphs: [graph] }, "preview"),
		);
	}

	const components = splitRoadGraphComponents(graph);
	const graphs = components.filter(
		(component) =>
			Object.values(component.edges).reduce((sum, edge) => {
				const start = component.graphNodes[edge.startNodeId]!.position;
				const end = component.graphNodes[edge.endNodeId]!.position;
				return (
					sum +
					pathLength([
						[start[0], start[2]],
						...edge.alignment.map((p): PlanPoint => [p[0], p[2]]),
						[end[0], end[2]],
					])
				);
			}, 0) >= MIN_COMPONENT_LENGTH_M,
	);
	graphs.sort(
		(a, b) => Object.keys(b.edges).length - Object.keys(a.edges).length,
	);
	if (graphs.length === 0) {
		throw new Error("No streets were found in this area. Try a larger radius.");
	}
	return { componentCount: components.length, graphs };
}

// --- orchestrator --------------------------------------------------------------

export type OsmImportPhase = "streets" | "elevation" | "building";

type OsmOperationOptions = {
	onPhase?: (phase: OsmImportPhase) => void;
	signal?: AbortSignal;
};

export type OsmPrepareOptions = OsmOperationOptions & {
	contextMarginMeters?: number;
	loadAcquisition?: (
		bbox: GeoBoundingBox,
		signal?: AbortSignal,
	) => Promise<import("./source/osm-acquisition").OsmAcquisition>;
	loadTerrain?: boolean;
	loadMapData?: (
		bbox: GeoBoundingBox,
		signal?: AbortSignal,
	) => Promise<OsmMapData>;
	loadStreets?: (
		bbox: GeoBoundingBox,
		signal?: AbortSignal,
	) => Promise<OsmWay[]>;
};

export type OsmTerrainSampler = {
	source?: TerrainSource;
	getCoverage?: (bounds: GeoBoundingBox) => TerrainCoverage;
} & Pick<
	TerrainSampler,
	"elevationAt" | "failedTiles" | "prefetch" | "successfulTiles"
> & {
		hasElevationAt?: (point: GeoPoint) => boolean;
		sampleElevationAt?: (point: GeoPoint) => number | null;
	};

export type OsmCompleteOptions = OsmOperationOptions & {
	/** Explicit evidence that mapped ele uses this vertical datum. Unknown by default. */
	mappedElevationDatumId?: string;
	terrainSampler?: OsmTerrainSampler;
};

export type OsmImportOptions = OsmPrepareOptions & OsmCompleteOptions;

export async function prepareOsmStreetImport(
	center: GeoPoint,
	radiusMeters: number,
	options: OsmPrepareOptions = {},
): Promise<PreparedOsmImport> {
	if (!Number.isFinite(radiusMeters))
		throw new Error("Invalid OSM selection radius.");
	const radius = Math.max(
		MIN_IMPORT_RADIUS_M,
		Math.min(MAX_IMPORT_RADIUS_M, radiusMeters),
	);
	options.signal?.throwIfAborted();
	options.onPhase?.("streets");
	const scope = createOsmImportScope(
		center,
		radius,
		options.contextMarginMeters,
	);
	const bbox = scope.acquisitionBounds;
	const acquisition = options.loadAcquisition
		? parseOsmAcquisition(await options.loadAcquisition(bbox, options.signal))
		: !options.loadMapData && !options.loadStreets
			? await acquireOsmData(bbox, { signal: options.signal })
			: undefined;
	const mapData: OsmMapData = acquisition
		? interpretOsmAcquisition(acquisition)
		: options.loadMapData
			? await options.loadMapData(bbox, options.signal)
			: options.loadStreets
				? {
						pointFeatures: [],
						mappedSurfaces: [],
						crossings: [],
						laneConnectivity: [],
						ways: await options.loadStreets(bbox, options.signal),
					}
				: { pointFeatures: [], ways: [] };
	const normalization = mapData.normalization ?? normalizeOsmWays(mapData.ways);

	const sourceSnapshot = acquisition
		? await createOsmSourceSnapshot(acquisition)
		: undefined;
	options.signal?.throwIfAborted();
	const {
		pointFeatures,
		mappedSurfaces = [],
		crossings = [],
		laneConnectivity = [],
	} = mapData;
	const ways: OsmWay[] = normalization.features.flatMap((feature) =>
		feature.kind === "road" &&
		feature.disposition === "accepted" &&
		feature.geometry?.kind === "way"
			? [
					{
						id: feature.id,
						tags: structuredClone(
							(feature.raw.tags ?? {}) as Record<string, string>,
						),
						points: feature.geometry.points,
					},
				]
			: [],
	);
	normalization.sourceContentIdentity = sourceSnapshot?.contentIdentity ?? null;
	options.signal?.throwIfAborted();
	const contextData = buildSegmentsFromWays(
		ways,
		center,
		scope.contextRadiusMeters,
	);
	if (contextData.segments.length > MAX_IMPORT_SEGMENTS)
		throw new Error(
			`The surrounding context has ${contextData.segments.length} road segments (limit ${MAX_IMPORT_SEGMENTS}). Reduce the radius or context margin.`,
		);
	const contextSegments = ensureSimpleSegments(
		contextData.segments,
		contextData.nodePositions,
	);
	// Context counts junction membership before selected roads are clipped.
	const contextJunctionIds = new Set(
		contextSegments.flatMap((segment) => [segment.startId, segment.endId]),
	);
	const { segments: rawSegments, nodePositions } = buildSegmentsFromWays(
		ways,
		center,
		radius,
		contextJunctionIds,
	);
	if (rawSegments.length === 0) {
		throw new OsmNormalizationError(
			"No streets were found in this area. Try a different location or a larger radius.",
			normalization,
		);
	}
	if (rawSegments.length > MAX_IMPORT_SEGMENTS) {
		throw new Error(
			`This area has ${rawSegments.length} road segments (limit ${MAX_IMPORT_SEGMENTS}). Reduce the radius and try again.`,
		);
	}
	const segments = ensureSimpleSegments(rawSegments, nodePositions);
	const previewAssembly = assembleImportGraphs(segments, nodePositions);
	const contextAssembly = assembleImportGraphs(
		contextSegments,
		contextData.nodePositions,
	);
	const context: OsmImportContext = {
		scope,
		coordinateFrame: createOsmSiteFrame({ center, baseElevation: null }),
		graphs: contextAssembly.graphs,
	};
	const contextPaths = contextSegments.flatMap((segment) =>
		outsideSelectedPaths(
			segmentPath(segment, contextData.nodePositions).map((point) =>
				localToGeo(point, center),
			),
			scope,
		).map((points) => ({ points, roadClass: segment.props.roadClass })),
	);
	const includedEdgeIds = new Set(
		previewAssembly.graphs.flatMap((graph) => Object.keys(graph.edges)),
	);
	const paths = segments.flatMap((segment, index): OsmStreetPreviewPath[] =>
		includedEdgeIds.has(importedSegmentId(segment, index))
			? [
					{
						points: segmentPath(segment, nodePositions).map((point) =>
							localToGeo(point, center),
						),
						roadClass: segment.props.roadClass,
					},
				]
			: [],
	);
	const previewAssets = buildOsmPointAssets(
		pointFeatures,
		(point) => projectToLocal(point, center),
		radius,
	);
	const mappedObjects = pointFeatures.flatMap(
		(feature): OsmStreetPreviewObject[] => {
			const [x, z] = projectToLocal(feature.point, center);
			return Math.hypot(x, z) <= radius
				? [
						{
							kind: feature.kind,
							point: feature.point,
							sourceId: feature.sourceId,
						},
					]
				: [];
		},
	);
	return {
		...(acquisition ? { acquisition, sourceSnapshot } : {}),
		center: { ...center },
		context,
		normalization,
		sourceTopology: buildOsmSourceTopology(ways),
		regionalPolicy: proposeStreetRegionalPolicy(ways.map((w) => w.tags)),
		inventoryReport: resolveMappedInventory(
			previewAssembly.graphs,
			mappedSurfaces,
			crossings,
			center,
			radius,
			0,
			undefined,
			undefined,
			pointFeatures,
		).report,
		sectionReport: resolveInitialStreetSections(
			previewAssembly.graphs,
			proposeStreetRegionalPolicy(ways.map((w) => w.tags)),
		),
		preview: {
			contextPaths,
			scope,
			assetCounts: countOsmPointAssets(previewAssets),
			mappedObjects,
			paths,
			segmentCount: paths.length,
			wayCount: ways.length,
		},
		radiusMeters: radius,
		[PREPARED_IMPORT_DATA]: {
			componentCount: previewAssembly.componentCount,
			mappedSurfaces,
			crossings,
			laneConnectivity,
			nodePositions,
			pointFeatures,
			previewGraphs: previewAssembly.graphs,
			segments,
			waysCount: ways.length,
			loadTerrain:
				options.loadTerrain ??
				(!options.loadAcquisition &&
					!options.loadMapData &&
					!options.loadStreets),
		},
	};
}

/** Build the editor-space graph used for duplicate checks without fetching elevation. */
export function getPreparedOsmStreetImportResult(
	prepared: PreparedOsmImport,
): OsmImportResult {
	const { componentCount, previewGraphs } = prepared[PREPARED_IMPORT_DATA];
	const previewAssets = buildOsmPointAssets(
		prepared[PREPARED_IMPORT_DATA].pointFeatures,
		(point) => projectToLocal(point, prepared.center),
		prepared.radiusMeters,
	);
	return createImportResult(
		prepared,
		{ componentCount, graphs: previewGraphs },
		previewAssets,
		null,
		0,
	);
}

export async function completeOsmStreetImport(
	prepared: PreparedOsmImport,
	options: OsmCompleteOptions = {},
): Promise<OsmImportResult> {
	const { center, radiusMeters: radius } = prepared;
	const { loadTerrain, nodePositions, pointFeatures, segments } =
		prepared[PREPARED_IMPORT_DATA];
	options.signal?.throwIfAborted();

	options.onPhase?.("building");
	options.signal?.throwIfAborted();
	let baseElevation: number | null = null;
	let terrainSource: TerrainSource | null = null,
		coverage: TerrainCoverage | null = null;
	let sampleGround: (point: GeoPoint) => number | null = () => null;
	let referenceId: string | null = null;
	let failedElevationTiles = 0;
	let elevationAt: ((x: number, z: number) => number) | undefined;
	let hasElevationAt: (x: number, z: number) => boolean = () => false;
	if (loadTerrain) {
		options.onPhase?.("elevation");
		const sampler = options.terrainSampler ?? new TerrainSampler();
		await sampler.prefetch(computeBoundingBox(center, radius), options.signal);
		options.onPhase?.("building");
		failedElevationTiles = sampler.failedTiles;
		terrainSource = sampler.source ?? {
			provider: "injected",
			dataset: "unspecified",
			encoding: "decoded-grid",
			units: "metres",
			verticalReference: { kind: "unknown" },
		};
		coverage =
			sampler.getCoverage?.(computeBoundingBox(center, radius)) ?? null;
		referenceId =
			terrainSource.verticalReference.kind === "datum"
				? terrainSource.verticalReference.datumId
				: `terrain~${terrainSource.provider}~${terrainSource.dataset}~reference-unspecified~${center.lat}~${center.lon}`;
		const sampledValues = new Map<string, number | null>();
		const sample = (point: GeoPoint): number | null => {
			const key = `${point.lat},${point.lon}`;
			if (sampledValues.has(key)) return sampledValues.get(key)!;
			if (
				sampler.successfulTiles === 0 ||
				sampler.hasElevationAt?.(point) === false
			)
				return null;
			const value = sampler.sampleElevationAt
				? sampler.sampleElevationAt(point)
				: sampler.elevationAt(point);
			const valid = value !== null && Number.isFinite(value) ? value : null;
			sampledValues.set(key, valid);
			return valid;
		};
		sampleGround = sample;
		const originElevation = sample(center);
		if (originElevation !== null) {
			baseElevation = originElevation;
			const frame = createOsmSiteFrame({
				center,
				baseElevation: originElevation,
				verticalDatumId: referenceId!,
			});
			hasElevationAt = (x, z) => sample(localToGeo([x, z], center)) !== null;
			elevationAt = (x, z) => {
				const elevation = sample(localToGeo([x, z], center));
				return elevationToSiteHeight(elevation, frame) ?? 0;
			};
		}
	}
	const { componentCount, graphs } = assembleImportGraphs(
		segments,
		nodePositions,
		elevationAt,
		baseElevation ?? undefined,
		hasElevationAt,
		terrainSource?.verticalReference.kind === "datum" &&
			terrainSource.verticalReference.datumId ===
				options.mappedElevationDatumId,
	);
	const assets = buildOsmPointAssets(
		pointFeatures,
		(point) => projectToLocal(point, center),
		radius,
		elevationAt,
	).map(
		(asset): OsmImportedPointAsset => ({
			...asset,
			elevationSource: hasElevationAt(asset.position[0], asset.position[2])
				? "terrain"
				: "estimated",
		}),
	);
	if (!elevationAt) {
		for (const graph of graphs) {
			for (const edge of Object.values(graph.edges))
				edge.verticalSource ??= { kind: "estimated" };
		}
	}

	const result = createImportResult(
		prepared,
		{ componentCount, graphs },
		assets,
		baseElevation,
		failedElevationTiles,
	);
	result.coordinateFrame = createOsmSiteFrame({
		center,
		baseElevation,
		...(referenceId ? { verticalDatumId: referenceId } : {}),
	});
	result.terrainEvidence = buildTerrainEvidence({
		center,
		origin: baseElevation,
		referenceId: baseElevation === null ? null : referenceId,
		requested: loadTerrain,
		source: terrainSource,
		coverage,
		sample: sampleGround,
		graphs,
		assets,
		mappedDatumId: options.mappedElevationDatumId,
	});
	result.baselineDiagnostics = buildBaselineDiagnosticReport(result);
	return result;
}

export async function importStreetsFromOsm(
	center: GeoPoint,
	radiusMeters: number,
	options: OsmImportOptions = {},
): Promise<OsmImportResult> {
	const prepared = await prepareOsmStreetImport(center, radiusMeters, options);
	return completeOsmStreetImport(prepared, options);
}

export function getPreparedBaselineDiagnostics(prepared: PreparedOsmImport) {
	return buildBaselineDiagnosticReport(
		{
			...prepared,
			movementEvidence: resolveGraphMovementEvidence(
				prepared.normalization,
				prepared[PREPARED_IMPORT_DATA].previewGraphs,
			),
			graphs: prepared[PREPARED_IMPORT_DATA].previewGraphs,
		},
		"preview",
	);
}

function resolveGraphMovementEvidence(
	source: NormalizedOsmSource,
	graphs: readonly RoadNetworkGraph[],
) {
	return resolveOsmMovementEvidence(
		source,
		new Set(
			graphs.flatMap((graph) =>
				Object.values(graph.edges).flatMap((edge) =>
					edge.osmSource ? [edge.osmSource.wayId] : [],
				),
			),
		),
		new Set(
			graphs.flatMap((graph) =>
				Object.values(graph.graphNodes).flatMap((node) =>
					node.osmTopologyOrigin?.kind === "source"
						? [node.osmTopologyOrigin.nodeId]
						: [],
				),
			),
		),
	);
}
