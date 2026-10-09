import {
	computeBoundingBox,
	localToGeo,
	projectToLocal,
	type GeoPoint,
	type GeoBoundingBox,
} from "./domain/site-frame";

export const DEFAULT_OSM_CONTEXT_MARGIN_M = 100;
export const MAX_OSM_CONTEXT_MARGIN_M = 200;
export type OsmImportScope = {
	kind: "circle";
	center: GeoPoint;
	selectedRadiusMeters: number;
	contextMarginMeters: number;
	contextRadiusMeters: number;
	selectedBounds: GeoBoundingBox;
	acquisitionBounds: GeoBoundingBox;
};

export function createOsmImportScope(
	center: GeoPoint,
	radius: number,
	margin = DEFAULT_OSM_CONTEXT_MARGIN_M,
): OsmImportScope {
	if (
		!Number.isFinite(center.lat) ||
		Math.abs(center.lat) > 85 ||
		!Number.isFinite(center.lon) ||
		Math.abs(center.lon) > 180 ||
		!Number.isFinite(radius) ||
		radius <= 0 ||
		!Number.isFinite(margin) ||
		margin < 0 ||
		margin > MAX_OSM_CONTEXT_MARGIN_M
	)
		throw Error("Invalid OSM selection or context margin.");
	const acquisitionBounds = computeBoundingBox(center, radius + margin);
	if (acquisitionBounds.west < -180 || acquisitionBounds.east > 180)
		throw Error(
			"OSM selection crosses the antimeridian. Move the selection away from the map boundary.",
		);
	return {
		kind: "circle",
		center: { ...center },
		selectedRadiusMeters: radius,
		contextMarginMeters: margin,
		contextRadiusMeters: radius + margin,
		selectedBounds: computeBoundingBox(center, radius),
		acquisitionBounds,
	};
}

/** Split supporting centerlines into the portions outside the selected circle. */
export function outsideSelectedPaths(
	points: GeoPoint[],
	scope: OsmImportScope,
): GeoPoint[][] {
	const paths: GeoPoint[][] = [];
	let current: GeoPoint[] = [];
	const flush = () => {
		if (current.length >= 2) paths.push(current);
		current = [];
	};
	const radius = scope.selectedRadiusMeters;
	for (let index = 1; index < points.length; index++) {
		const a = projectToLocal(points[index - 1]!, scope.center),
			b = projectToLocal(points[index]!, scope.center);
		const dx = b[0] - a[0],
			dz = b[1] - a[1],
			qa = dx * dx + dz * dz;
		if (qa < 1e-12) continue;
		const qb = 2 * (a[0] * dx + a[1] * dz),
			qc = a[0] ** 2 + a[1] ** 2 - radius ** 2;
		const discriminant = qb * qb - 4 * qa * qc;
		const cuts = [0, 1];
		if (discriminant > 0)
			for (const t of [
				(-qb - Math.sqrt(discriminant)) / (2 * qa),
				(-qb + Math.sqrt(discriminant)) / (2 * qa),
			])
				if (t > 0 && t < 1) cuts.push(t);
		cuts.sort((a, b) => a - b);
		const at = (t: number) =>
			localToGeo([a[0] + dx * t, a[1] + dz * t], scope.center);
		for (let part = 1; part < cuts.length; part++) {
			const start = cuts[part - 1]!,
				end = cuts[part]!,
				middle = (start + end) / 2;
			if (Math.hypot(a[0] + dx * middle, a[1] + dz * middle) > radius) {
				if (!current.length) current.push(at(start));
				current.push(at(end));
			} else flush();
		}
	}
	flush();
	return paths;
}
