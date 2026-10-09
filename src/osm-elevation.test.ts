import { describe, expect, test } from 'bun:test'
import {
	decodeTerrariumPixels,
	latLonToTileFraction,
	TerrainSampler,
	terrariumTileUrl,
} from './osm-elevation'

describe('latLonToTileFraction', () => {
	test('maps the lon/lat extremes onto the tile grid', () => {
		const zoom = 4
		const scale = 2 ** zoom
		expect(latLonToTileFraction({ lat: 0, lon: -180 }, zoom).x).toBeCloseTo(0, 6)
		expect(latLonToTileFraction({ lat: 0, lon: 180 }, zoom).x).toBeCloseTo(scale, 6)
		expect(latLonToTileFraction({ lat: 0, lon: 0 }, zoom).y).toBeCloseTo(scale / 2, 6)
	})

	test('y decreases as latitude increases', () => {
		const low = latLonToTileFraction({ lat: 10, lon: 0 }, 10)
		const high = latLonToTileFraction({ lat: 50, lon: 0 }, 10)
		expect(high.y).toBeLessThan(low.y)
	})
})

describe('decodeTerrariumPixels', () => {
	test('decodes the terrarium RGB encoding', () => {
		const rgba = new Uint8ClampedArray([
			128, 0, 0, 255, // (128*256 + 0 + 0) - 32768 = 0 m
			128, 100, 128, 255, // +100.5 m
			127, 156, 0, 255, // -100 m
			129, 244, 64, 255, // +500.25 m
		])
		const elevations = decodeTerrariumPixels(rgba, 2, 2)
		expect(elevations[0]).toBeCloseTo(0, 5)
		expect(elevations[1]).toBeCloseTo(100.5, 5)
		expect(elevations[2]).toBeCloseTo(-100, 5)
		expect(elevations[3]).toBeCloseTo(500.25, 5)
	})
})

describe('terrariumTileUrl', () => {
	test('builds the AWS terrain tile URL', () => {
		expect(terrariumTileUrl(15, 5241, 12667)).toBe(
			'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/5241/12667.png',
		)
	})
})

describe('TerrainSampler', () => {
	const bbox = { south: -0.002, west: -0.002, north: 0.002, east: 0.002 }

	test('samples prefetched tiles', async () => {
		const sampler = new TerrainSampler(15, async () => ({
			width: 2,
			height: 2,
			elevations: new Float32Array([250, 250, 250, 250]),
		}))
		await sampler.prefetch(bbox)
		expect(sampler.elevationAt({ lat: 0, lon: 0 })).toBeCloseTo(250, 5)
		expect(sampler.hasElevationAt({ lat: 0, lon: 0 })).toBe(true)
		expect(sampler.failedTiles).toBe(0)
	})

	test('interpolates bilinearly inside a tile', async () => {
		const sampler = new TerrainSampler(15, async () => ({
			width: 2,
			height: 2,
			// left column 0 m, right column 100 m
			elevations: new Float32Array([0, 100, 0, 100]),
		}))
		// the zoom-15 tile starting at lon 0 spans 360/2^15 degrees
		const tileSpan = 360 / 2 ** 15
		await sampler.prefetch({ south: -0.001, west: 0, north: 0.001, east: tileSpan })
		const sampled = sampler.elevationAt({ lat: 0.0001, lon: tileSpan / 2 })
		expect(sampled).toBeCloseTo(50, 1)
	})

	test('falls back to zero and counts failures when tiles fail', async () => {
		const sampler = new TerrainSampler(15, async () => null)
		await sampler.prefetch(bbox)
		expect(sampler.failedTiles).toBeGreaterThan(0)
		expect(sampler.hasElevationAt({ lat: 0, lon: 0 })).toBe(false)
		expect(sampler.elevationAt({ lat: 0, lon: 0 })).toBe(0)
		expect(sampler.sampleElevationAt({ lat: 0, lon: 0 })).toBeNull()
	})

	test('fetches each covering tile exactly once', async () => {
		let calls = 0
		const sampler = new TerrainSampler(15, async () => {
			calls += 1
			return { width: 1, height: 1, elevations: new Float32Array([7]) }
		})
		await sampler.prefetch(bbox)
		const after = calls
		await sampler.prefetch(bbox)
		expect(calls).toBe(after)
		expect(after).toBeGreaterThanOrEqual(1)
	})

	test('passes cancellation to tile loaders', async () => {
		const controller = new AbortController()
		const sampler = new TerrainSampler(15, async (_zoom, _x, _y, signal) => {
			expect(signal).toBe(controller.signal)
			controller.abort()
			signal?.throwIfAborted()
			return null
		})
		await expect(sampler.prefetch(bbox, controller.signal)).rejects.toMatchObject({
			name: 'AbortError',
		})
	})
})

 test('measured sea level is distinct from a missing terrain sample', async () => {
 const sampler = new TerrainSampler(15, async () => ({width:1,height:1,elevations:new Float32Array([0])}))
 await sampler.prefetch({south:-0.001,west:-0.001,north:0.001,east:0.001})
 expect(sampler.sampleElevationAt({lat:0,lon:0})).toBe(0)
 expect(sampler.sampleElevationAt({lat:10,lon:10})).toBeNull()
 })
