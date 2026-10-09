import {
	normalizeOsmAcquisition,
	type NormalizedOsmSource,
} from "./osm-normalization";
import type { GeoPoint } from "../domain/site-frame";
import {
	parseOsmPointFeatures,
	type OsmPointFeature,
} from "../osm-point-assets";
import {
	IMPORTED_HIGHWAY_PATTERN,
	type OsmAcquisition,
} from "./osm-acquisition";
// Compatibility export; interpretation does not call host encoding.
export { normalizeOsmTags } from "../host/osm-projection-encoding";
export type OsmWay = {
	id: number;
	tags: Record<string, string>;
	points: Array<GeoPoint & { nodeId: number }>;
};

function parseRawWays(payload: unknown): OsmWay[] {
	const elements = (payload as { elements?: unknown[] })?.elements;
	if (!Array.isArray(elements)) return [];
	return elements.flatMap((element) => {
		const way = element as {
			type?: string;
			id?: number;
			tags?: Record<string, string>;
			nodes?: number[];
			geometry?: Array<{ lat: number; lon: number } | null>;
		};
		if (
			way.type !== "way" ||
			!way.geometry ||
			!way.nodes ||
			!way.tags ||
			way.geometry.length !== way.nodes.length
		)
			return [];
		const points = way.geometry.flatMap((geo, index) =>
			geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)
				? [{ lat: geo.lat, lon: geo.lon, nodeId: way.nodes![index]! }]
				: [],
		);
		return points.length >= 2
			? [{ id: way.id ?? 0, tags: { ...way.tags }, points }]
			: [];
	});
}

export function parseOverpassResponse(payload: unknown): OsmWay[] {
	return parseRawWays(payload).filter(
		(way) =>
			new RegExp(IMPORTED_HIGHWAY_PATTERN).test(way.tags.highway ?? "") &&
			way.tags.area !== "yes" &&
			way.tags["area:highway"] === undefined,
	);
}

export type OsmMappedSurface = {
	id: number;
	kind:
		| "road-area"
		| "sidewalk"
		| "cycleway"
		| "pedestrian-area"
		| "kerb"
		| "crossing";
	partIndex?: number;
	sourceType?: "way" | "relation";
	tags: Record<string, string>;
	points: Array<GeoPoint & { nodeId: number }>;
	holes?: Array<Array<GeoPoint & { nodeId: number }>>;
};

function mappedSurfaceKind(
	tags: Record<string, string>,
	closed: boolean,
): OsmMappedSurface["kind"] | null {
	if (tags["area:highway"] && closed) return "road-area";
	if (tags.barrier === "kerb") return "kerb";
	if (tags.highway === "cycleway") return "cycleway";
	if (tags.highway === "pedestrian" && (closed || tags.area === "yes"))
		return "pedestrian-area";
	if (tags.highway === "footway" && tags.footway === "crossing")
		return "crossing";
	if (
		(tags.highway === "footway" && tags.footway === "sidewalk") ||
		(/^(footway|path)$/.test(tags.highway ?? "") && tags.sidewalk !== undefined)
	)
		return "sidewalk";
	return null;
}

type RawRelationMember = {
	geometry?: Array<{ lat: number; lon: number } | null>;
	ref?: number;
	role?: string;
	type?: string;
};

function sameGeo(first: GeoPoint, second: GeoPoint): boolean {
	return (
		Math.abs(first.lat - second.lat) <= 1e-8 &&
		Math.abs(first.lon - second.lon) <= 1e-8
	);
}

function relationRings(
	relationId: number,
	members: RawRelationMember[],
	role: "inner" | "outer",
): Array<Array<GeoPoint & { nodeId: number }>> {
	const pending = members.flatMap((member, memberIndex) => {
		const memberRole = member.role === "inner" ? "inner" : "outer";
		if (member.type !== "way" || memberRole !== role || !member.geometry)
			return [];
		const points = member.geometry.flatMap((point, pointIndex) =>
			point && Number.isFinite(point.lat) && Number.isFinite(point.lon)
				? [
						{
							...point,
							nodeId: -(
								relationId * 100000 +
								memberIndex * 1000 +
								pointIndex +
								1
							),
						},
					]
				: [],
		);
		return points.length >= 2 ? [points] : [];
	});
	const rings: Array<Array<GeoPoint & { nodeId: number }>> = [];
	while (pending.length > 0) {
		const ring = [...pending.shift()!];
		let joined = true;
		while (joined && ring.length >= 2 && !sameGeo(ring[0]!, ring.at(-1)!)) {
			joined = false;
			for (let index = 0; index < pending.length; index += 1) {
				const candidate = pending[index]!;
				if (sameGeo(ring.at(-1)!, candidate[0]!))
					ring.push(...candidate.slice(1));
				else if (sameGeo(ring.at(-1)!, candidate.at(-1)!))
					ring.push(...[...candidate].reverse().slice(1));
				else if (sameGeo(ring[0]!, candidate.at(-1)!))
					ring.unshift(...candidate.slice(0, -1));
				else if (sameGeo(ring[0]!, candidate[0]!))
					ring.unshift(...[...candidate].reverse().slice(0, -1));
				else continue;
				pending.splice(index, 1);
				joined = true;
				break;
			}
		}
		if (ring.length >= 4 && sameGeo(ring[0]!, ring.at(-1)!)) rings.push(ring);
	}
	return rings;
}

function geoPointInRing(point: GeoPoint, ring: GeoPoint[]): boolean {
	let inside = false;
	for (
		let index = 0, previous = ring.length - 1;
		index < ring.length;
		previous = index, index += 1
	) {
		const currentPoint = ring[index]!;
		const previousPoint = ring[previous]!;
		if (
			currentPoint.lat > point.lat !== previousPoint.lat > point.lat &&
			point.lon <
				((previousPoint.lon - currentPoint.lon) *
					(point.lat - currentPoint.lat)) /
					(previousPoint.lat - currentPoint.lat) +
					currentPoint.lon
		)
			inside = !inside;
	}
	return inside;
}

export function parseOsmMappedSurfaces(payload: unknown): OsmMappedSurface[] {
	const ways = parseRawWays(payload).flatMap((way): OsmMappedSurface[] => {
		const { tags } = way;
		const closed =
			way.points.length >= 3 &&
			way.points[0]!.nodeId === way.points.at(-1)!.nodeId;
		const kind = mappedSurfaceKind(tags, closed);
		return kind
			? [
					{
						id: way.id,
						kind,
						sourceType: "way",
						tags: { ...tags },
						points: way.points,
					},
				]
			: [];
	});
	const elements = (payload as { elements?: unknown[] })?.elements;
	const relations = !Array.isArray(elements)
		? []
		: elements.flatMap((element): OsmMappedSurface[] => {
				const relation = element as {
					type?: string;
					id?: number;
					tags?: Record<string, string>;
					members?: RawRelationMember[];
				};
				if (
					relation.type !== "relation" ||
					!relation.id ||
					!relation.tags?.["area:highway"] ||
					!relation.members
				)
					return [];
				const holes = relationRings(relation.id, relation.members, "inner");
				return relationRings(relation.id, relation.members, "outer").map(
					(points, partIndex) => ({
						id: relation.id!,
						kind: "road-area" as const,
						holes: holes.filter(
							(hole) => hole[0] && geoPointInRing(hole[0], points),
						),
						partIndex,
						points,
						sourceType: "relation" as const,
						tags: { ...relation.tags! },
					}),
				);
			});
	return [...ways, ...relations];
}

export type OsmMapData = {
	normalization?: NormalizedOsmSource;
	pointFeatures: OsmPointFeature[];
	ways: OsmWay[];
	mappedSurfaces?: OsmMappedSurface[];
	crossings?: OsmCrossingFeature[];
	laneConnectivity?: OsmLaneConnectivityRelation[];
};

export type OsmLaneConnectivityRelation = {
	id: number;
	members: Array<{
		type: "node" | "way" | "relation";
		ref: number;
		role: string;
	}>;
	tags: Record<string, string>;
};

export function parseOsmLaneConnectivity(
	payload: unknown,
): OsmLaneConnectivityRelation[] {
	const elements = (payload as { elements?: unknown[] })?.elements;
	if (!Array.isArray(elements)) return [];
	return elements.flatMap((element): OsmLaneConnectivityRelation[] => {
		const relation = element as {
			type?: string;
			id?: number;
			tags?: Record<string, string>;
			members?: Array<{ type?: string; ref?: number; role?: string }>;
		};
		if (
			relation.type !== "relation" ||
			!relation.id ||
			relation.tags?.type !== "connectivity" ||
			!relation.members
		)
			return [];
		const members = relation.members.flatMap((member) =>
			(member.type === "node" ||
				member.type === "way" ||
				member.type === "relation") &&
			Number.isFinite(member.ref)
				? [
						{
							type: member.type as "node" | "way" | "relation",
							ref: member.ref!,
							role: member.role ?? "",
						},
					]
				: [],
		);
		return [{ id: relation.id, members, tags: { ...relation.tags } }];
	});
}

export type OsmCrossingFeature = {
	id: number;
	kind?: "crossing" | "kerb";
	point: GeoPoint;
	tags: Record<string, string>;
};

export function parseOsmCrossingFeatures(
	payload: unknown,
): OsmCrossingFeature[] {
	const elements = (payload as { elements?: unknown[] })?.elements;
	if (!Array.isArray(elements)) return [];
	return elements.flatMap((element) => {
		const node = element as {
			type?: string;
			id?: number;
			lat?: number;
			lon?: number;
			tags?: Record<string, string>;
		};
		if (
			node.type !== "node" ||
			!Number.isFinite(node.id) ||
			!Number.isFinite(node.lat) ||
			!Number.isFinite(node.lon) ||
			!node.tags
		)
			return [];
		const crossing =
			node.tags.highway === "crossing" || node.tags.crossing !== undefined;
		const loweredKerb =
			node.tags.barrier === "kerb" &&
			["lowered", "flush", "no"].includes(node.tags.kerb ?? "");
		if (!crossing && !loweredKerb) return [];
		return [
			{
				id: node.id!,
				kind: crossing ? "crossing" : "kerb",
				point: { lat: node.lat!, lon: node.lon! },
				tags: { ...node.tags },
			},
		];
	});
}

export function parseOsmMapResponse(payload: unknown): OsmMapData {
	return {
		pointFeatures: parseOsmPointFeatures(payload),
		ways: parseOverpassResponse(payload),
		mappedSurfaces: parseOsmMappedSurfaces(payload),
		crossings: parseOsmCrossingFeatures(payload),
		laneConnectivity: parseOsmLaneConnectivity(payload),
	};
}

export function mergeOsmMapData(parts: OsmMapData[]): OsmMapData {
	const bestWays = new Map<number, OsmWay>();
	for (const way of parts.flatMap((part) => part.ways)) {
		const existing = bestWays.get(way.id);
		if (!existing || way.points.length > existing.points.length)
			bestWays.set(way.id, way);
	}
	const surfaces = new Map<string, OsmMappedSurface>();
	for (const surface of parts.flatMap((part) => part.mappedSurfaces ?? [])) {
		const key = `${surface.sourceType ?? "way"}:${surface.id}:${surface.partIndex ?? 0}:${surface.kind}`;
		const existing = surfaces.get(key);
		if (!existing || surface.points.length > existing.points.length)
			surfaces.set(key, surface);
	}
	const points = new Map<string, OsmPointFeature>();
	for (const feature of parts.flatMap((part) => part.pointFeatures))
		points.set(feature.sourceId, feature);
	const crossings = new Map<number, OsmCrossingFeature>();
	for (const crossing of parts.flatMap((part) => part.crossings ?? []))
		crossings.set(crossing.id, crossing);
	const connectivity = new Map<number, OsmLaneConnectivityRelation>();
	for (const relation of parts.flatMap((part) => part.laneConnectivity ?? []))
		connectivity.set(relation.id, relation);
	return {
		ways: [...bestWays.values()],
		mappedSurfaces: [...surfaces.values()],
		pointFeatures: [...points.values()],
		crossings: [...crossings.values()],
		laneConnectivity: [...connectivity.values()],
	};
}

/** Pure offline replay: source tags stay intact in captured responses. */
export function interpretOsmAcquisition(input: OsmAcquisition): OsmMapData {
	const normalization = normalizeOsmAcquisition(input);
	const accepted = normalization.features.filter(
		(feature) => feature.disposition === "accepted",
	);
	const interpreted = parseOsmMapResponse({
		elements: accepted.map((feature) => ({
			...feature.raw,
			...(feature.geometry?.kind === "way"
				? {
						geometry: feature.geometry.points.map(({ lat, lon }) => ({
							lat,
							lon,
						})),
					}
				: {}),
			...(feature.geometry?.kind === "relation"
				? { members: feature.geometry.members }
				: {}),
		})),
	});
	// Accepted road coordinates are complete. Keep raw source tags on the compatibility output.
	return { ...interpreted, normalization };
}
