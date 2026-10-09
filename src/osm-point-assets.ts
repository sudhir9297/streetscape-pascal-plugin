import { parseOsmBearing, parseOsmLength } from "./source/osm-normalization";
import type { RoadSignId } from "./road-sign-config";
import type { GeoPoint } from "./osm-elevation";

export type OsmPointAssetKind = "road-sign" | "street-lamp" | "traffic-signal";

export type OsmPointFeature = {
	kind: OsmPointAssetKind;
	point: GeoPoint;
	sourceId: string;
	tags: Record<string, string>;
};

type ImportedPointAssetBase = {
	kind: OsmPointAssetKind;
	position: [number, number, number];
	rotationY: number;
	elevationSource?: "terrain" | "estimated";
	sourceId: string;
};

export type OsmImportedPointAsset =
	| (ImportedPointAssetBase & {
			kind: "street-lamp";
			height?: number;
	  })
	| (ImportedPointAssetBase & {
			kind: "traffic-signal";
	  })
	| (ImportedPointAssetBase & {
			kind: "road-sign";
			signId: RoadSignId;
			text: string;
	  });

export type OsmPointAssetCounts = {
	roadSigns: number;
	streetLamps: number;
	trafficSignals: number;
};

type PlanPoint = readonly [number, number];

function pointFeatureKind(
	tags: Record<string, string>,
): OsmPointAssetKind | null {
	if (tags.highway === "street_lamp") return "street-lamp";
	if (tags.highway === "traffic_signals") return "traffic-signal";
	if (
		tags.traffic_sign ||
		tags.highway === "stop" ||
		tags.highway === "give_way"
	) {
		return "road-sign";
	}
	return null;
}

/** Read supported tagged OSM nodes while ignoring ways and malformed records. */
export function parseOsmPointFeatures(payload: unknown): OsmPointFeature[] {
	const elements = (payload as { elements?: unknown[] })?.elements;
	if (!Array.isArray(elements)) return [];
	const features: OsmPointFeature[] = [];
	const sourceIds = new Set<string>();
	for (const element of elements) {
		const node = element as {
			id?: number;
			lat?: number;
			lon?: number;
			tags?: Record<string, string>;
			type?: string;
		};
		if (
			node.type !== "node" ||
			!Number.isFinite(node.id) ||
			!Number.isFinite(node.lat) ||
			!Number.isFinite(node.lon) ||
			!node.tags
		) {
			continue;
		}
		const kind = pointFeatureKind(node.tags);
		const sourceId = `node/${node.id}`;
		if (!kind || sourceIds.has(sourceId)) continue;
		sourceIds.add(sourceId);
		features.push({
			kind,
			point: { lat: node.lat!, lon: node.lon! },
			sourceId,
			tags: { ...node.tags },
		});
	}
	return features;
}

function directionDegrees(tags: Record<string, string>): number | null {
	return parseOsmBearing(tags["traffic_signals:direction"] ?? tags.direction);
}

function rotationFromDirection(tags: Record<string, string>): number {
	const degrees = directionDegrees(tags);
	if (degrees === null) return 0;
	return Math.PI - (degrees * Math.PI) / 180;
}

function parseHeight(tags: Record<string, string>): number | undefined {
	const height = parseOsmLength(tags.height);
	return height === null ? undefined : Math.max(2.5, Math.min(30, height));
}

function normalizedSignTags(tags: Record<string, string>): string {
	return [
		tags.highway,
		tags.traffic_sign,
		tags.sign,
		tags.restriction,
		tags.description,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase()
		.replace(/[-:]/g, "_");
}

/** Map common semantic OSM sign tags into the plugin's built-in sign catalog. */
export function mapOsmRoadSign(tags: Record<string, string>): {
	signId: RoadSignId;
	text: string;
} {
	const values = normalizedSignTags(tags);
	if (tags.highway === "stop" || /(^|\W)stop(\W|$)/.test(values)) {
		return { signId: "stop", text: "" };
	}
	if (
		tags.highway === "give_way" ||
		values.includes("give_way") ||
		values.includes("yield")
	) {
		return { signId: "yield", text: "" };
	}
	if (
		tags.maxspeed ||
		values.includes("maxspeed") ||
		values.includes("speed_limit")
	) {
		return { signId: "speed-limit", text: (tags.maxspeed ?? "").slice(0, 32) };
	}
	if (values.includes("no_entry")) return { signId: "no-entry", text: "" };
	if (values.includes("no_parking") || values.includes("parking_restriction")) {
		return { signId: "no-parking", text: "" };
	}
	if (values.includes("pedestrian") || values.includes("crossing")) {
		return { signId: "pedestrian-crossing", text: "" };
	}
	if (values.includes("direction") || tags.destination) {
		return {
			signId: "directional",
			text: (tags.destination ?? "").slice(0, 32),
		};
	}
	return { signId: "warning", text: "" };
}

/** Convert OSM point features into local, elevation-aware scene descriptors. */
export function buildOsmPointAssets(
	features: readonly OsmPointFeature[],
	project: (point: GeoPoint) => PlanPoint,
	radiusMeters: number,
	elevationAt: (x: number, z: number) => number = () => 0,
): OsmImportedPointAsset[] {
	const assets: OsmImportedPointAsset[] = [];
	for (const feature of features) {
		const [x, z] = project(feature.point);
		if (Math.hypot(x, z) > radiusMeters) continue;
		const base = {
			position: [x, elevationAt(x, z), z] as [number, number, number],
			rotationY: rotationFromDirection(feature.tags),
			sourceId: feature.sourceId,
		};
		if (feature.kind === "street-lamp") {
			assets.push({
				...base,
				height: parseHeight(feature.tags),
				kind: feature.kind,
			});
			continue;
		}
		if (feature.kind === "traffic-signal") {
			assets.push({ ...base, kind: feature.kind });
			continue;
		}
		assets.push({
			...base,
			...mapOsmRoadSign(feature.tags),
			kind: feature.kind,
		});
	}
	return assets;
}

export function countOsmPointAssets(
	assets: readonly Pick<OsmImportedPointAsset, "kind">[],
): OsmPointAssetCounts {
	const counts: OsmPointAssetCounts = {
		roadSigns: 0,
		streetLamps: 0,
		trafficSignals: 0,
	};
	for (const asset of assets) {
		if (asset.kind === "road-sign") counts.roadSigns += 1;
		else if (asset.kind === "street-lamp") counts.streetLamps += 1;
		else counts.trafficSignals += 1;
	}
	return counts;
}
