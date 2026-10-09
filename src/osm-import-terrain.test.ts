import { expect, test } from 'bun:test'
import { prepareImportedRoadTerrain } from './osm-import-terrain'
import { createEmptyRoadGraph, insertRoadSegment } from './road-network-topology'
import { RoadNetworkNode } from './schema'
import { compileStreetLayout } from './street-compiler-layout'
import { createTerrainField, decodeTerrainField, encodeTerrainField, surfaceHeightAt } from './terrain-field-compat'

const pose = {position: [0, 0, 0] as const, rotationY: 0, displayLiftMeters: 0}
function road(mode: 'ground' | 'bridge' = 'ground') {
  return RoadNetworkNode.parse(insertRoadSegment(createEmptyRoadGraph(), [-15, -0.76, 0], [15, 0.92, 0], {elevationMode: mode}).graph)
}

test('estimated native ground stays below a sloping imported carriageway across its width', () => {
  const projection = prepareImportedRoadTerrain([road()], pose)!
  const field = decodeTerrainField(projection.terrain)!
  for (let x = -15; x <= 15; x += 0.5) for (const z of [-3, 0, 3]) {
    const roadY = -0.76 + (x + 15) * 1.68 / 30
    expect(surfaceHeightAt(field, x, z)).toBeLessThan(roadY - 0.1)
    expect(surfaceHeightAt(field, x, z)).toBeGreaterThan(roadY - 0.2)
  }
  expect(projection.basis).toBe('estimated-road-grade-v1')
})

test('terrain follows translated and rotated building coordinates', () => {
  const projection = prepareImportedRoadTerrain([road()], {position: [100, 3, -50], rotationY: Math.PI / 2, displayLiftMeters: 0})!
  const field = decodeTerrainField(projection.terrain)!
  expect(surfaceHeightAt(field, 100, -35)).toBeCloseTo(3 - 0.76 - 0.15, 2)
  expect(surfaceHeightAt(field, 100, -65)).toBeCloseTo(3 + 0.92 - 0.15, 2)
})

test('bridge-only imports do not turn the bridge deck into terrain', () => {
  expect(prepareImportedRoadTerrain([road('bridge')], pose)).toBeNull()
})

test('ground stays below the fitted four-way junction, including triangle interiors', () => {
  let graph = createEmptyRoadGraph()
  for (const endpoint of [[6.26, 0.003, -13.63], [-13.52, -0.764, -6.49], [-6.56, 0.418, 13.49], [13.5, 0.915, 6.53]] as [number, number, number][]) {
    graph = insertRoadSegment(graph, [0, 0.1, 0], endpoint).graph
  }
  const network = RoadNetworkNode.parse(graph)
  const field = decodeTerrainField(prepareImportedRoadTerrain([network], pose)!.terrain)!
  const junctions = compileStreetLayout(network).renderedJunctionSurfaces
  expect(junctions.length).toBeGreaterThan(0)
  for (const junction of junctions) {
    const {positions, indices} = junction.solution, center = junction.graphNode.position
    for (let i = 0; i < indices.length; i += 3) {
      const points = indices.slice(i, i + 3).map(index => [positions[index * 3]! + center[0], positions[index * 3 + 1]! + center[1], positions[index * 3 + 2]! + center[2]])
      points.push([0,1,2].map(axis => points.reduce((sum,p) => sum + p[axis]!, 0) / 3))
      for (const p of points) expect(p[1]! - surfaceHeightAt(field, p[0]!, p[2]!)).toBeGreaterThan(0.05)
    }
  }
})

test('existing terrain outside the grading corridor survives expansion', () => {
  const previous = createTerrainField({origin: [-100, -100], cols: 21, rows: 21, spacing: 1})
  previous.heights.fill(200)
  const projection = prepareImportedRoadTerrain([road()], pose, encodeTerrainField(previous))!
  const field = decodeTerrainField(projection.terrain)!
  expect(surfaceHeightAt(field, -90, -90)).toBeCloseTo(2, 2)
  expect(() => prepareImportedRoadTerrain([road()], pose, {type: 'heightfield'})).toThrow('cannot be decoded')
})
