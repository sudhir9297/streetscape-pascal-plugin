import { describe, expect, test } from 'bun:test'
import { latLonToTileFraction } from './osm-elevation'
import {
	clampMapZoom,
	GLOBE_FLAT_THRESHOLD_ZOOM,
	isGlobeZoom,
	MAX_MAP_ZOOM,
	MIN_MAP_ZOOM,
	metersPerPixel,
	mapSelectionRadiusPixels,
	osmTileUrl,
	tileOffsetFromCenter,
	tileFractionToLatLon,
	tileIndexAt,
} from './map-tiles'

describe('osmTileUrl', () => {
	test('builds a z/x/y OSM raster tile url', () => {
		expect(osmTileUrl(5, 12, 9)).toBe('https://tile.openstreetmap.org/5/12/9.png')
	})
})

describe('tileFractionToLatLon', () => {
	test('round-trips with latLonToTileFraction', () => {
		const zoom = 12
		for (const point of [
			{ lat: 0, lon: 0 },
			{ lat: 51.5074, lon: -0.1278 },
			{ lat: -33.8688, lon: 151.2093 },
			{ lat: 37.7749, lon: -122.4194 },
		]) {
			const fraction = latLonToTileFraction(point, zoom)
			const back = tileFractionToLatLon(fraction.x, fraction.y, zoom)
			expect(back.lat).toBeCloseTo(point.lat, 6)
			expect(back.lon).toBeCloseTo(point.lon, 6)
		}
	})

	test('maps grid extremes to lon extremes', () => {
		const zoom = 4
		const scale = 2 ** zoom
		expect(tileFractionToLatLon(0, scale / 2, zoom).lon).toBeCloseTo(-180, 6)
		expect(tileFractionToLatLon(scale, scale / 2, zoom).lon).toBeCloseTo(180, 6)
		expect(tileFractionToLatLon(scale / 2, scale / 2, zoom).lat).toBeCloseTo(0, 6)
	})
})

describe('metersPerPixel', () => {
	test('halves each time zoom increases by one', () => {
		const low = metersPerPixel(0, 10)
		const high = metersPerPixel(0, 11)
		expect(high).toBeCloseTo(low / 2, 6)
	})

	test('shrinks toward the poles', () => {
		expect(metersPerPixel(60, 10)).toBeLessThan(metersPerPixel(0, 10))
	})
})

describe('zoom helpers', () => {
	test('clampMapZoom stays within bounds', () => {
		expect(clampMapZoom(-5)).toBe(MIN_MAP_ZOOM)
		expect(clampMapZoom(99)).toBe(MAX_MAP_ZOOM)
		expect(clampMapZoom(7)).toBe(7)
	})

	test('isGlobeZoom flips at the threshold', () => {
		expect(isGlobeZoom(GLOBE_FLAT_THRESHOLD_ZOOM - 1)).toBe(true)
		expect(isGlobeZoom(GLOBE_FLAT_THRESHOLD_ZOOM)).toBe(false)
	})
})

describe('tileIndexAt', () => {
	test('returns integer indices inside the grid', () => {
		const zoom = 6
		const scale = 2 ** zoom
		const index = tileIndexAt({ lat: 48.8566, lon: 2.3522 }, zoom)
		expect(Number.isInteger(index.x)).toBe(true)
		expect(Number.isInteger(index.y)).toBe(true)
		expect(index.x).toBeGreaterThanOrEqual(0)
		expect(index.x).toBeLessThan(scale)
		expect(index.y).toBeGreaterThanOrEqual(0)
		expect(index.y).toBeLessThan(scale)
	})
})

describe('tileOffsetFromCenter', () => {
	test('places north-east points above and right of center', () => {
		const offset = tileOffsetFromCenter(
			{ lat: 51.51, lon: -0.11 },
			{ lat: 51.5, lon: -0.12 },
			14,
		)
		expect(offset.x).toBeGreaterThan(0)
		expect(offset.y).toBeLessThan(0)
	})

	test('uses the short offset across the antimeridian', () => {
		const offset = tileOffsetFromCenter(
			{ lat: 0, lon: -179.9 },
			{ lat: 0, lon: 179.9 },
			8,
		)
		expect(Math.abs(offset.x)).toBeLessThan(1)
	})
})

describe('map selection radius', () => {
	test('matches the MapLibre world scale at fractional zoom', () => {
		const latitude = 48.8738
		const zoom = 14.4
		const radius = 250
		const projected = radius * 512 * 2 ** zoom / (40075016.686 * Math.cos(latitude * Math.PI / 180))
		 expect(mapSelectionRadiusPixels(latitude, zoom, radius)).toBeCloseTo(projected, 8)
	})
	test('scales continuously with zoom and selected distance', () => {
		const radius = mapSelectionRadiusPixels(51.5, 14, 100)
		expect(mapSelectionRadiusPixels(51.5, 14.5, 100)).toBeCloseTo(radius * Math.SQRT2, 8)
		expect(mapSelectionRadiusPixels(51.5, 14, 200)).toBeCloseTo(radius * 2, 8)
	})
})
