import { type GeoPoint, latLonToTileFraction } from './osm-elevation'
import { getRasterTileUrl } from './map-data-source'

export const MIN_MAP_ZOOM = 1
export const MAX_MAP_ZOOM = 18
export const DEFAULT_MAP_ZOOM = 3
/** Below this zoom the picker shows the globe; at or above it, the flat map. */
export const GLOBE_FLAT_THRESHOLD_ZOOM = 5
/** Standard web-map tile edge in pixels. */
export const MAP_TILE_SIZE = 256

export function osmTileUrl(zoom: number, x: number, y: number): string {
	return getRasterTileUrl(zoom, x, y)
}

/** Inverse of {@link latLonToTileFraction}: continuous tile coords → lon/lat. */
export function tileFractionToLatLon(
	x: number,
	y: number,
	zoom: number,
): GeoPoint {
	const scale = 2 ** zoom
	const lon = (x / scale) * 360 - 180
	const n = Math.PI - 2 * Math.PI * (y / scale)
	const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
	return { lat, lon }
}

/** Ground resolution in metres per pixel at a given latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
	const EARTH_CIRCUMFERENCE_M = 40075016.686
	return (
		(EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
		(MAP_TILE_SIZE * 2 ** zoom)
	)
}

export function clampMapZoom(zoom: number): number {
	return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom))
}

export function isGlobeZoom(zoom: number): boolean {
	return zoom < GLOBE_FLAT_THRESHOLD_ZOOM
}

/** Mercator tile offset from a map center, wrapping across the antimeridian. */
export function tileOffsetFromCenter(
	point: GeoPoint,
	center: GeoPoint,
	zoom: number,
): { x: number; y: number } {
	const scale = 2 ** zoom
	const pointTile = latLonToTileFraction(point, zoom)
	const centerTile = latLonToTileFraction(center, zoom)
	let x = pointTile.x - centerTile.x
	if (x > scale / 2) x -= scale
	if (x < -scale / 2) x += scale
	return { x, y: pointTile.y - centerTile.y }
}

/** Integer tile indices covering a point, clamped to the grid at that zoom. */
export function tileIndexAt(
	point: GeoPoint,
	zoom: number,
): { x: number; y: number } {
	const scale = 2 ** zoom
	const fraction = latLonToTileFraction(point, zoom)
	const clamp = (value: number) =>
		Math.max(0, Math.min(scale - 1, Math.floor(value)))
	return { x: clamp(fraction.x), y: clamp(fraction.y) }
}

export { latLonToTileFraction }

/** MapLibre uses a 512 CSS-pixel world tile, including fractional zoom levels. */
export function mapSelectionRadiusPixels(lat: number, zoom: number, radiusMeters: number): number {
	return radiusMeters / (metersPerPixel(lat, zoom) / 2)
}
