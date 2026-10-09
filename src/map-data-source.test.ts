import { afterEach, describe, expect, test } from 'bun:test'
import {
	configureMapImportGateway,
	configureOsmStreetDataSource,
	getElevationTileUrl,
	getGeocodeRequest,
	getRasterTileUrl,
	getStreetRequest,
} from './map-data-source'

afterEach(() => {configureMapImportGateway(null);configureOsmStreetDataSource('overpass')})

test('small-area OSM API requests retain honest query provenance and can switch back to Overpass',()=>{
 configureOsmStreetDataSource('osm-api');
 const spec=getStreetRequest({south:12.976,west:77.589,north:12.978,east:77.591},'unused overpass query');
 expect(spec.url).toContain('https://api.openstreetmap.org/api/0.6/map.json?bbox=');
 expect(spec.query).toContain('OSM API 0.6 map bbox=');expect(spec.elementMetadataRequested).toBe(true);
 expect(()=>getStreetRequest({south:0,west:0,north:1,east:1},'')).toThrow();
 configureOsmStreetDataSource('overpass');expect(getStreetRequest({south:0,west:0,north:.001,east:.001},'q').url).toContain('overpass-api.de');
})

describe('map data source', () => {
	test('uses public services directly by default', () => {
		expect(getGeocodeRequest('New Delhi').url).toContain(
			'https://nominatim.openstreetmap.org/search?',
		)
		expect(getRasterTileUrl(5, 12, 9)).toBe(
			'https://tile.openstreetmap.org/5/12/9.png',
		)
		expect(getElevationTileUrl(15, 5241, 12667)).toBe(
			'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/5241/12667.png',
		)
		const streets = getStreetRequest(
			{ south: 1, west: 2, north: 3, east: 4 },
			'overpass query',
		)
		expect(streets.url).toBe('https://overpass-api.de/api/interpreter')
		expect(streets.init).toMatchObject({ method: 'POST' })
	})

	test('routes every map resource through a configured gateway', () => {
		configureMapImportGateway('/api/map/')
		expect(getGeocodeRequest('New Delhi').url).toBe('/api/map/geocode?q=New+Delhi')
		expect(getRasterTileUrl(5, 12, 9)).toBe('/api/map/tiles/5/12/9')
		expect(getElevationTileUrl(15, 5241, 12667)).toBe(
			'/api/map/elevation/15/5241/12667',
		)
		expect(
			getStreetRequest(
				{ south: 1, west: 2, north: 3, east: 4 },
				'not sent to gateway',
			).url,
		).toBe('/api/map/streets?south=1&west=2&north=3&east=4')
	})

	test('only accepts same-origin gateway paths', () => {
		expect(() => configureMapImportGateway('https://example.com/api/map')).toThrow(
			/same-origin path/,
		)
		expect(() => configureMapImportGateway('//example.com/api/map')).toThrow(
			/same-origin path/,
		)
	})
})
