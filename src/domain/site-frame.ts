import { z } from "zod";

export type GeoPoint = { lat: number; lon: number };
export type GeoBoundingBox = {
	south: number;
	west: number;
	north: number;
	east: number;
};
export type PlanPoint = readonly [number, number];
export type SitePoint = readonly [number, number, number];
export const METERS_PER_DEGREE = 111320;

const GeographicOrigin = z.strictObject({
	lat: z.number().min(-85).max(85),
	lon: z.number().min(-180).max(180),
});
export const SiteFrame = z.strictObject({
	format: z.literal("streetscape-site-frame"),
	schemaVersion: z.literal(1),
	id: z.string().min(1),
	projection: z.literal("equirectangular-local-v1"),
	units: z.literal("metres"),
	origin: GeographicOrigin,
	// Three-compatible yaw from local axes into the east/south geographic plane.
	orientationRadians: z.number(),
	verticalReference: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("unknown") }),
		z.strictObject({
			kind: z.literal("relative-to-elevation"),
			originElevationMeters: z.number(),
			datumId: z.string().min(1),
		}),
	]),
});
export type SiteFrame = z.infer<typeof SiteFrame>;

export function createSiteFrame(input: {
	id: string;
	origin: GeoPoint;
	orientationRadians?: number;
	verticalReference?: SiteFrame["verticalReference"];
}): SiteFrame {
	return SiteFrame.parse({
		format: "streetscape-site-frame",
		schemaVersion: 1,
		projection: "equirectangular-local-v1",
		units: "metres",
		...input,
		orientationRadians: input.orientationRadians ?? 0,
		verticalReference: input.verticalReference ?? { kind: "unknown" },
	});
}

// Preserve the existing small-area projection. Selected areas are limited to 600 m, with at most 200 m of context.
export function projectToLocal(
	point: GeoPoint,
	origin: GeoPoint,
): [number, number] {
	const scale = Math.cos((origin.lat * Math.PI) / 180);
	return [
		(point.lon - origin.lon) * scale * METERS_PER_DEGREE,
		-(point.lat - origin.lat) * METERS_PER_DEGREE,
	];
}
export function localToGeo(point: PlanPoint, origin: GeoPoint): GeoPoint {
	return {
		lat: origin.lat - point[1] / METERS_PER_DEGREE,
		lon:
			origin.lon +
			point[0] / (Math.cos((origin.lat * Math.PI) / 180) * METERS_PER_DEGREE),
	};
}
export function computeBoundingBox(
	center: GeoPoint,
	radiusMeters: number,
): GeoBoundingBox {
	const latitude = radiusMeters / METERS_PER_DEGREE;
	const longitude =
		radiusMeters /
		(METERS_PER_DEGREE *
			Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
	return {
		south: center.lat - latitude,
		west: center.lon - longitude,
		north: center.lat + latitude,
		east: center.lon + longitude,
	};
}
export function geographicToSite(
	point: GeoPoint,
	frame: SiteFrame,
): [number, number] {
	const [east, south] = projectToLocal(point, frame.origin),
		c = Math.cos(frame.orientationRadians),
		s = Math.sin(frame.orientationRadians);
	const x = east * c - south * s,
		z = east * s + south * c;
	return [x === 0 ? 0 : x, z === 0 ? 0 : z];
}
export function siteToGeographic(point: PlanPoint, frame: SiteFrame): GeoPoint {
	const c = Math.cos(frame.orientationRadians),
		s = Math.sin(frame.orientationRadians);
	return localToGeo(
		[point[0] * c + point[1] * s, -point[0] * s + point[1] * c],
		frame.origin,
	);
}
/** Unknown elevation is null. Display lift is deliberately absent from this module. */
export function elevationToSiteHeight(
	elevation: number | null,
	frame: SiteFrame,
): number | null {
	return elevation === null || frame.verticalReference.kind === "unknown"
		? null
		: elevation - frame.verticalReference.originElevationMeters;
}
export function siteHeightToElevation(
	height: number,
	frame: SiteFrame,
): number | null {
	return frame.verticalReference.kind === "unknown"
		? null
		: height + frame.verticalReference.originElevationMeters;
}
export function siteFrameVerticalOffset(
	from: SiteFrame,
	to: SiteFrame,
): number | null {
	const a = from.verticalReference,
		b = to.verticalReference;
	return a.kind === "relative-to-elevation" &&
		b.kind === "relative-to-elevation" &&
		a.datumId === b.datumId
		? a.originElevationMeters - b.originElevationMeters
		: null;
}
/** Height remains relative when datums cannot be aligned; callers must expose that estimate. */
export function rebaseSitePoint(
	point: SitePoint,
	from: SiteFrame,
	to: SiteFrame,
): [number, number, number] {
	const [x, z] = geographicToSite(
		siteToGeographic([point[0], point[2]], from),
		to,
	);
	return [x, point[1] + (siteFrameVerticalOffset(from, to) ?? 0), z];
}

/** Compatibility for existing OSM origins; this datum does not claim survey accuracy. */
export function createOsmSiteFrame(origin: {
	center: GeoPoint;
	baseElevation: number | null;
	verticalDatumId?: string;
}): SiteFrame {
	return createSiteFrame({
		id: `osm:${origin.center.lat}:${origin.center.lon}:${origin.baseElevation ?? "unknown"}${origin.verticalDatumId ? `:${origin.verticalDatumId}` : ""}`,
		origin: origin.center,
		verticalReference:
			origin.baseElevation === null
				? { kind: "unknown" }
				: {
						kind: "relative-to-elevation",
						originElevationMeters: origin.baseElevation,
						datumId: origin.verticalDatumId ?? "legacy-osm-elevation",
					},
	});
}
