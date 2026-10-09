import { generatedSourceDuplicateCandidates } from "./generated-item-acceptance";
import type { GeneratedItemAcceptance } from "./domain/generated-item-history";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import {
	reconcileRoadJunctions,
	splitRoadGraphComponents,
	type RoadNetworkGraph,
} from "./road-network-topology";
import type { GeoPoint } from "./osm-elevation";
import type { OsmImportResult } from "./osm-import";
import {
	createOsmSiteFrame,
	rebaseSitePoint,
	siteFrameVerticalOffset,
	SiteFrame,
} from "./domain/site-frame";
import { transformRoadCoordinates } from "./road-coordinate-transform";
import type { RoadGraphEdge, RoadGraphNode, RoadNetworkNode } from "./schema";

const MATCH_TOLERANCE_M = 0.75;
const MATCH_ANGLE_DEGREES = 25;
const CLIP_INTERVAL_M = 1.5;
const MIN_FRAGMENT_LENGTH_M = 2.5;
const INDEX_CELL_SIZE_M = 12;

export const MAP_IMPORT_METADATA_KEY = "streetscapeMapImport";
export const OSM_FEATURE_METADATA_KEY = "streetscapeOsmFeature";

export type MapImportOrigin = {
	baseElevation: number | null;
	verticalDatumId?: string;
	center: GeoPoint;
};

export type OsmImportReview = {
	verticalAlignment: "aligned" | "estimated";
	duplicateAssets: number;
	duplicateSegments: number;
	incomingAssets: number;
	incomingSegments: number;
	newAssets: number;
	newSegments: number;
	origin: MapImportOrigin;
	result: OsmImportResult;
	trimmedSegments: number;
};

type ExistingRoadNetwork = RoadNetworkGraph &
	Pick<RoadNetworkNode, "metadata"> & {
		generatedItemHistory?: Record<string, GeneratedItemAcceptance>;
	};

export type OsmImportSceneContext = {
	/** Retained project frame is authoritative even when no projected roads remain. */
	coordinateFrame?: SiteFrame;
	featureSourceIds: ReadonlySet<string>;
	networks: readonly ExistingRoadNetwork[];
};

type Point3 = readonly [number, number, number];

type IndexedSegment = {
	a: Point3;
	b: Point3;
	stackLevel: number;
};

type SegmentIndex = {
	cells: Map<string, IndexedSegment[]>;
	segmentCount: number;
};

function countEdges(graphs: readonly RoadNetworkGraph[]): number {
	return graphs.reduce(
		(sum, graph) => sum + Object.keys(graph.edges).length,
		0,
	);
}

function countJunctions(graphs: readonly RoadNetworkGraph[]): number {
	return graphs.reduce(
		(sum, graph) =>
			sum +
			Object.values(graph.graphNodes).filter((node) => {
				let degree = 0;
				for (const edge of Object.values(graph.edges)) {
					if (edge.startNodeId === node.id || edge.endNodeId === node.id)
						degree += 1;
				}
				return degree >= 3;
			}).length,
		0,
	);
}

function metadataOrigin(network: ExistingRoadNetwork): MapImportOrigin | null {
	const metadata = network.metadata;
	if (!(metadata && typeof metadata === "object" && !Array.isArray(metadata)))
		return null;
	const candidate = (metadata as Record<string, unknown>)[
		MAP_IMPORT_METADATA_KEY
	];
	if (
		!(candidate && typeof candidate === "object" && !Array.isArray(candidate))
	) {
		return null;
	}
	const record = candidate as Record<string, unknown>;
	const center = record.origin;
	if (!(center && typeof center === "object" && !Array.isArray(center)))
		return null;
	const lat = (center as Record<string, unknown>).lat;
	const lon = (center as Record<string, unknown>).lon;
	if (!(typeof lat === "number" && Number.isFinite(lat))) return null;
	if (!(typeof lon === "number" && Number.isFinite(lon))) return null;
	const elevation = record.originElevation;
	const frame = SiteFrame.safeParse(record.siteFrame);
	if (
		frame.success &&
		record.siteFrameEncoding === "uri-component-v1" &&
		frame.data.verticalReference.kind === "relative-to-elevation"
	) {
		try {
			frame.data.verticalReference.datumId = decodeURIComponent(
				frame.data.verticalReference.datumId,
			);
		} catch {
			return null;
		}
	}
	return {
		baseElevation:
			typeof elevation === "number" && Number.isFinite(elevation)
				? elevation
				: null,
		center: { lat, lon },
		...(frame.success &&
		frame.data.verticalReference.kind === "relative-to-elevation" &&
		frame.data.verticalReference.datumId !== "legacy-osm-elevation"
			? { verticalDatumId: frame.data.verticalReference.datumId }
			: {}),
	};
}

/** Reuse the first georeferenced map import as the level's geographic origin. */
export function findMapImportOrigin(
	existingNetworks: readonly ExistingRoadNetwork[],
): MapImportOrigin | null {
	for (const network of existingNetworks) {
		const origin = metadataOrigin(network);
		if (origin) return origin;
	}
	return null;
}

export function createMapImportMetadata(
	previous: RoadNetworkNode["metadata"] | undefined,
	origin: MapImportOrigin,
	displayLiftMeters?: number,
): RoadNetworkNode["metadata"] {
	const base =
		previous && typeof previous === "object" && !Array.isArray(previous)
			? previous
			: {};
	const siteFrame = createOsmSiteFrame(origin);
	siteFrame.id = encodeURIComponent(siteFrame.id);
	if (siteFrame.verticalReference.kind === "relative-to-elevation")
		siteFrame.verticalReference.datumId = encodeURIComponent(
			siteFrame.verticalReference.datumId,
		);
	return {
		...base,
		[MAP_IMPORT_METADATA_KEY]: {
			origin: { ...origin.center },
			originElevation: origin.baseElevation,
			siteFrame,
			siteFrameEncoding: "uri-component-v1",
			...(displayLiftMeters !== undefined ? { displayLiftMeters } : {}),
			provider: "openstreetmap",
		},
	};
}

export function createOsmFeatureMetadata(
	previous: RoadNetworkNode["metadata"] | undefined,
	origin: MapImportOrigin,
	feature: {
		kind: string;
		sourceId: string;
		elevationSource?: "terrain" | "estimated";
	},
	displayLiftMeters?: number,
): RoadNetworkNode["metadata"] {
	const mapMetadata = createMapImportMetadata(
		previous,
		origin,
		displayLiftMeters,
	) as Record<string, unknown>;
	return {
		...mapMetadata,
		[OSM_FEATURE_METADATA_KEY]: {
			kind: feature.kind,
			sourceId: feature.sourceId,
			...(feature.elevationSource
				? { elevationSource: feature.elevationSource }
				: {}),
		},
	};
}

export function readOsmFeatureSourceId(metadata: unknown): string | null {
	if (!(metadata && typeof metadata === "object" && !Array.isArray(metadata)))
		return null;
	const candidate = (metadata as Record<string, unknown>)[
		OSM_FEATURE_METADATA_KEY
	];
	if (
		!(candidate && typeof candidate === "object" && !Array.isArray(candidate))
	) {
		return null;
	}
	const sourceId = (candidate as Record<string, unknown>).sourceId;
	return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}

function cell(value: number): number {
	return Math.floor(value / INDEX_CELL_SIZE_M);
}

function cellKey(x: number, z: number): string {
	return `${cell(x)}:${cell(z)}`;
}

function buildSegmentIndex(
	networks: readonly RoadNetworkGraph[],
): SegmentIndex {
	const cells = new Map<string, IndexedSegment[]>();
	let segmentCount = 0;
	for (const graph of networks) {
		for (const edge of Object.values(graph.edges)) {
			const points = sampleRoadEdgePoints(graph, edge, 32);
			for (let index = 0; index < points.length - 1; index += 1) {
				const a = points[index]!;
				const b = points[index + 1]!;
				if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-6) continue;
				const segment = { a, b, stackLevel: edge.stackLevel };
				segmentCount += 1;
				const minX = cell(Math.min(a[0], b[0]) - MATCH_TOLERANCE_M);
				const maxX = cell(Math.max(a[0], b[0]) + MATCH_TOLERANCE_M);
				const minZ = cell(Math.min(a[2], b[2]) - MATCH_TOLERANCE_M);
				const maxZ = cell(Math.max(a[2], b[2]) + MATCH_TOLERANCE_M);
				for (let x = minX; x <= maxX; x += 1) {
					for (let z = minZ; z <= maxZ; z += 1) {
						const key = `${x}:${z}`;
						const entries = cells.get(key);
						if (entries) entries.push(segment);
						else cells.set(key, [segment]);
					}
				}
			}
		}
	}
	return { cells, segmentCount };
}

function intervalCovered(
	a: Point3,
	b: Point3,
	stackLevel: number,
	index: SegmentIndex,
): boolean {
	const midX = (a[0] + b[0]) / 2;
	const midZ = (a[2] + b[2]) / 2;
	const dx = b[0] - a[0];
	const dz = b[2] - a[2];
	const length = Math.hypot(dx, dz);
	if (length < 1e-6) return true;
	const candidates = index.cells.get(cellKey(midX, midZ)) ?? [];
	const minimumDot = Math.cos((MATCH_ANGLE_DEGREES * Math.PI) / 180);
	for (const candidate of candidates) {
		if (candidate.stackLevel !== stackLevel) continue;
		const ex = candidate.b[0] - candidate.a[0];
		const ez = candidate.b[2] - candidate.a[2];
		const existingLength = Math.hypot(ex, ez);
		if (existingLength < 1e-6) continue;
		const directionDot = Math.abs(
			(dx * ex + dz * ez) / (length * existingLength),
		);
		if (directionDot < minimumDot) continue;
		const t = Math.max(
			0,
			Math.min(
				1,
				((midX - candidate.a[0]) * ex + (midZ - candidate.a[2]) * ez) /
					(existingLength * existingLength),
			),
		);
		const nearestX = candidate.a[0] + t * ex;
		const nearestZ = candidate.a[2] + t * ez;
		if (Math.hypot(midX - nearestX, midZ - nearestZ) <= MATCH_TOLERANCE_M) {
			return true;
		}
	}
	return false;
}

function densify(points: readonly Point3[]): Point3[] {
	const dense: Point3[] = [];
	for (let index = 0; index < points.length - 1; index += 1) {
		const a = points[index]!;
		const b = points[index + 1]!;
		const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
		const intervals = Math.max(1, Math.ceil(length / CLIP_INTERVAL_M));
		if (dense.length === 0) dense.push(a);
		for (let step = 1; step <= intervals; step += 1) {
			const t = step / intervals;
			dense.push([
				a[0] + (b[0] - a[0]) * t,
				a[1] + (b[1] - a[1]) * t,
				a[2] + (b[2] - a[2]) * t,
			]);
		}
	}
	return dense;
}

function pathLength(points: readonly Point3[]): number {
	let length = 0;
	for (let index = 0; index < points.length - 1; index += 1) {
		const a = points[index]!;
		const b = points[index + 1]!;
		length += Math.hypot(b[0] - a[0], b[2] - a[2]);
	}
	return length;
}

function addNode(
	graph: RoadNetworkGraph,
	id: string,
	position: Point3,
	template: RoadGraphNode,
) {
	graph.graphNodes[id] = {
		...template,
		id,
		position: [position[0], position[1], position[2]],
		terminal: false,
	};
}

function addEdgeRun(
	target: RoadNetworkGraph,
	source: RoadNetworkGraph,
	edge: RoadGraphEdge,
	points: Point3[],
	runIndex: number,
	usesOriginalStart: boolean,
	usesOriginalEnd: boolean,
) {
	if (pathLength(points) < MIN_FRAGMENT_LENGTH_M) return;
	const edgeId = `${edge.id}:part:${runIndex + 1}`;
	const startId = usesOriginalStart ? edge.startNodeId : `${edgeId}:start`;
	const endId = usesOriginalEnd ? edge.endNodeId : `${edgeId}:end`;
	const startTemplate = source.graphNodes[edge.startNodeId]!;
	const endTemplate = source.graphNodes[edge.endNodeId]!;
	addNode(target, startId, points[0]!, startTemplate);
	addNode(target, endId, points.at(-1)!, endTemplate);
	target.edges[edgeId] = {
		...edge,
		alignment: points
			.slice(1, -1)
			.map((point): [number, number, number] => [point[0], point[1], point[2]]),
		endNodeId: endId,
		id: edgeId,
		parentEdgeId: edge.parentEdgeId ?? edge.id,
		...(edge.turnLanes
			? {
					turnLanes: {
						start: usesOriginalStart ? edge.turnLanes.start : undefined,
						end: usesOriginalEnd ? edge.turnLanes.end : undefined,
					},
				}
			: {}),
		profileMode: "legacy",
		startNodeId: startId,
		verticalProfile: [],
	};
}

function filterGraph(
	source: RoadNetworkGraph,
	index: SegmentIndex,
): {
	duplicateSegments: number;
	graph: RoadNetworkGraph;
	trimmedSegments: number;
} {
	const target: RoadNetworkGraph = {
		activeStyleId: source.activeStyleId,
		attachments: {},
		edges: {},
		graphNodes: {},
		junctions: {},
		stylePresets: { ...source.stylePresets },
	};
	let duplicateSegments = 0;
	let trimmedSegments = 0;

	for (const edge of Object.values(source.edges)) {
		const points = densify(sampleRoadEdgePoints(source, edge, 32));
		const covered = points
			.slice(0, -1)
			.map((point, pointIndex) =>
				intervalCovered(point, points[pointIndex + 1]!, edge.stackLevel, index),
			);
		const coveredCount = covered.filter(Boolean).length;
		if (coveredCount === covered.length) {
			duplicateSegments += 1;
			continue;
		}
		if (coveredCount === 0) {
			addNode(
				target,
				edge.startNodeId,
				points[0]!,
				source.graphNodes[edge.startNodeId]!,
			);
			addNode(
				target,
				edge.endNodeId,
				points.at(-1)!,
				source.graphNodes[edge.endNodeId]!,
			);
			target.edges[edge.id] = {
				...edge,
				alignment: edge.alignment.map((point) => [...point]),
				verticalProfile: edge.verticalProfile.map((point) => ({ ...point })),
			};
			for (const [attachmentId, attachment] of Object.entries(
				source.attachments,
			)) {
				if (attachment.edgeId === edge.id)
					target.attachments[attachmentId] = { ...attachment };
			}
			continue;
		}

		trimmedSegments += 1;
		let runStart = -1;
		let runIndex = 0;
		for (let interval = 0; interval <= covered.length; interval += 1) {
			const uncovered = interval < covered.length && !covered[interval];
			if (uncovered && runStart < 0) runStart = interval;
			if (!uncovered && runStart >= 0) {
				const runEnd = interval;
				addEdgeRun(
					target,
					source,
					edge,
					points.slice(runStart, runEnd + 1),
					runIndex,
					runStart === 0,
					runEnd === covered.length,
				);
				runIndex += 1;
				runStart = -1;
			}
		}
	}

	reconcileRoadJunctions(target);
	return { duplicateSegments, graph: target, trimmedSegments };
}

/**
 * Align a map import to the level's geographic origin and remove centerline
 * portions already represented by roads on that level.
 */
export function reviewOsmImport(
	result: OsmImportResult,
	context: OsmImportSceneContext,
): OsmImportReview {
	const retainedFrame = context.coordinateFrame;
	const origin = retainedFrame ? {
		center: { ...retainedFrame.origin },
		baseElevation: retainedFrame.verticalReference.kind === "relative-to-elevation" ? retainedFrame.verticalReference.originElevationMeters : null,
		...(retainedFrame.verticalReference.kind === "relative-to-elevation" ? { verticalDatumId: retainedFrame.verticalReference.datumId } : {}),
	} : findMapImportOrigin(context.networks) ?? {
		baseElevation: result.source.baseElevation,
		center: { ...result.source.center },
		...(result.coordinateFrame?.verticalReference.kind ===
		"relative-to-elevation"
			? { verticalDatumId: result.coordinateFrame.verticalReference.datumId }
			: {}),
	};
	const fromFrame =
		result.coordinateFrame ??
		createOsmSiteFrame({
			center: result.source.center,
			baseElevation: result.source.baseElevation,
		});
	const toFrame = retainedFrame ?? createOsmSiteFrame(origin);
	const verticalOffset = siteFrameVerticalOffset(fromFrame, toFrame);
	const translatedGraphs = result.graphs.map((graph) =>
		transformRoadCoordinates(
			graph,
			(point) => rebaseSitePoint(point, fromFrame, toFrame),
			verticalOffset ?? 0,
		),
	);
	if (verticalOffset === null) {
		for (const graph of translatedGraphs)
			for (const edge of Object.values(graph.edges)) {
				if (edge.verticalSource?.kind === "terrain")
					edge.verticalSource = { kind: "estimated" };
			}
	}
	const terrainEvidence =
		result.terrainEvidence && verticalOffset === null
			? {
					...structuredClone(result.terrainEvidence),
					diagnostics: [
						...result.terrainEvidence.diagnostics,
						{
							code: "reference-incompatible" as const,
							edgeId: null,
							sampleId: null,
							message:
								"Source terrain reference could not be aligned to the existing site frame; projected heights remain estimates.",
						},
					],
				}
			: result.terrainEvidence;
	const translatedAssets = result.assets.map((asset) => ({
		...asset,
		position: rebaseSitePoint(asset.position, fromFrame, toFrame),
		rotationY:
			asset.rotationY +
			fromFrame.orientationRadians -
			toFrame.orientationRadians,
		...(verticalOffset === null
			? { elevationSource: "estimated" as const }
			: {}),
	}));
	const filteredAssets = translatedAssets.filter(
		(asset) =>
			!context.featureSourceIds.has(asset.sourceId) &&
			!context.networks.some((network) =>
				Object.values(network.generatedItemHistory ?? {}).some((item) => {
					const decision = item.sourceDecisions[asset.sourceId]?.decision;
					return decision === "linked" || decision === "suppressed";
				}),
			),
	);
	for (const asset of filteredAssets) {
		for (const network of context.networks) {
			const records = network.generatedItemHistory ?? {};
			if (
				Object.values(records).some(
					(item) =>
						item.sourceDecisions[asset.sourceId]?.decision === "distinct",
				)
			)
				continue;
			if (
				generatedSourceDuplicateCandidates(records, {
					id: asset.sourceId,
					kind: asset.kind,
					position: asset.position,
				}).length
			)
				throw Error(
					"Source fixture may duplicate accepted generated work. Use source refresh merge to review the match and its evidence before import.",
				);
		}
	}
	const incomingAssets = translatedAssets.length;
	const duplicateAssets = incomingAssets - filteredAssets.length;
	const incomingSegments = countEdges(translatedGraphs);
	const segmentIndex = buildSegmentIndex(context.networks);
	if (segmentIndex.segmentCount === 0) {
		return {
			verticalAlignment: verticalOffset === null ? "estimated" : "aligned",
			duplicateAssets,
			duplicateSegments: 0,
			incomingAssets,
			incomingSegments,
			newAssets: filteredAssets.length,
			newSegments: incomingSegments,
			origin,
			result: {
				...result,
				terrainEvidence,
				coordinateFrame: toFrame,
				assets: filteredAssets,
				graphs: translatedGraphs,
			},
			trimmedSegments: 0,
		};
	}

	let duplicateSegments = 0;
	let trimmedSegments = 0;
	const filteredGraphs: RoadNetworkGraph[] = [];
	for (const graph of translatedGraphs) {
		const filtered = filterGraph(graph, segmentIndex);
		duplicateSegments += filtered.duplicateSegments;
		trimmedSegments += filtered.trimmedSegments;
		for (const component of splitRoadGraphComponents(filtered.graph)) {
			if (Object.keys(component.edges).length > 0)
				filteredGraphs.push(component);
		}
	}
	filteredGraphs.sort(
		(a, b) => Object.keys(b.edges).length - Object.keys(a.edges).length,
	);
	const reviewedResult: OsmImportResult = {
		...result,
		terrainEvidence,
		coordinateFrame: toFrame,
		assets: filteredAssets,
		graphs: filteredGraphs,
		stats: {
			...result.stats,
			components: filteredGraphs.length,
			edges: countEdges(filteredGraphs),
			junctions: countJunctions(filteredGraphs),
		},
	};
	return {
		verticalAlignment: verticalOffset === null ? "estimated" : "aligned",
		duplicateAssets,
		duplicateSegments,
		incomingAssets,
		incomingSegments,
		newAssets: filteredAssets.length,
		newSegments: incomingSegments - duplicateSegments,
		origin,
		result: reviewedResult,
		trimmedSegments,
	};
}

/** New placements record their display lift. Older scene offsets are not guessed. */
export function readMapImportDisplayLift(metadata: unknown): number {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return 0;
	const value = (metadata as Record<string, unknown>)[MAP_IMPORT_METADATA_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
	const lift = (value as Record<string, unknown>).displayLiftMeters;
	return typeof lift === "number" && Number.isFinite(lift) ? lift : 0;
}
