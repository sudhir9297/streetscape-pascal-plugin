import type { GeoBoundingBox } from "./osm-elevation";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const OSM_TILE_ENDPOINT = "https://tile.openstreetmap.org";
const TERRARIUM_TILE_ENDPOINT =
	"https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export type MapDataRequest = {
	query?: string;
	elementMetadataRequested?: boolean;
	url: string;
	init?: RequestInit;
};

let gatewayBaseUrl: string | null = null;
let streetDataSource: "overpass" | "osm-api" = "overpass";
export function configureOsmStreetDataSource(
	source: "overpass" | "osm-api",
): void {
	streetDataSource = source;
}

/**
 * Route map requests through a host-owned, same-origin endpoint. Passing null
 * restores the direct public-service adapter used by standalone plugin hosts.
 */
export function configureMapImportGateway(baseUrl: string | null): void {
	if (baseUrl === null) {
		gatewayBaseUrl = null;
		return;
	}
	const normalized = baseUrl.trim().replace(/\/+$/, "");
	if (
		!normalized.startsWith("/") ||
		normalized.startsWith("//") ||
		normalized.includes("?") ||
		normalized.includes("#")
	) {
		throw new Error(
			"Map import gateway must be a same-origin path such as /api/map.",
		);
	}
	gatewayBaseUrl = normalized;
}

function queryString(values: Record<string, string | number>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values))
		params.set(key, String(value));
	return params.toString();
}

export function getGeocodeRequest(query: string): MapDataRequest {
	if (gatewayBaseUrl) {
		return {
			url: `${gatewayBaseUrl}/geocode?${queryString({ q: query })}`,
			init: { headers: { Accept: "application/json" } },
		};
	}
	return {
		url: `${NOMINATIM_ENDPOINT}?${queryString({ q: query, format: "jsonv2", limit: 5 })}`,
		init: { headers: { Accept: "application/json" } },
	};
}

export function getStreetRequest(
	bbox: GeoBoundingBox,
	overpassQuery: string,
): MapDataRequest {
	if (streetDataSource === "osm-api") {
		const bounds = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
		if ((bbox.east - bbox.west) * (bbox.north - bbox.south) > 0.25)
			throw new Error(
				"The OpenStreetMap data area is too large. Reduce the import radius.",
			);
		return {
			url: `https://api.openstreetmap.org/api/0.6/map.json?${queryString({ bbox: bounds })}`,
			query: `OSM API 0.6 map bbox=${bounds}`,
			elementMetadataRequested: true,
			init: { headers: { Accept: "application/json" } },
		};
	}
	if (gatewayBaseUrl) {
		return {
			url: `${gatewayBaseUrl}/streets?${queryString(bbox)}`,
			init: { headers: { Accept: "application/json" } },
		};
	}
	return {
		url: OVERPASS_ENDPOINT,
		elementMetadataRequested: true,
		init: {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: `data=${encodeURIComponent(overpassQuery)}`,
		},
	};
}

export function getRasterTileUrl(
	zoom: number | string,
	x: number | string,
	y: number | string,
): string {
	return gatewayBaseUrl
		? `${gatewayBaseUrl}/tiles/${zoom}/${x}/${y}`
		: `${OSM_TILE_ENDPOINT}/${zoom}/${x}/${y}.png`;
}

export function getElevationTileUrl(
	zoom: number,
	x: number,
	y: number,
): string {
	return gatewayBaseUrl
		? `${gatewayBaseUrl}/elevation/${zoom}/${x}/${y}`
		: `${TERRARIUM_TILE_ENDPOINT}/${zoom}/${x}/${y}.png`;
}
