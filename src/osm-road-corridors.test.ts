import { expect, test } from 'bun:test'
import { localToGeo, type OsmMappedSurface } from './osm-import'
import { associateOsmCrossings, associateOsmMappedSurfaces } from './osm-road-corridors'
import {resolveMappedInventory} from './osm-road-corridors'
import {parseMappedInventoryReport} from './domain/mapped-inventory'
import { insertRoadSegment, createEmptyRoadGraph } from './road-network-topology'

const center = { lat: 40, lon: -73 }

function straightRoad(z: number) {
  return insertRoadSegment(createEmptyRoadGraph(), [-30, 0, z], [30, 0, z]).graph
}

function surface(id: number, z: number, tags: Record<string, string> = { highway: 'footway', footway: 'sidewalk' }): OsmMappedSurface {
  return {
    id,
    kind: 'sidewalk',
    sourceType: 'way',
    tags,
    points: [-20, 0, 20].map((x, index) => ({
      ...localToGeo([x, z], center),
      nodeId: id * 10 + index,
    })),
  }
}

test('ambiguous mapped corridors retain candidates and require an explicit choice',()=>{
 const graphs=[straightRoad(0),straightRoad(8)],source=surface(90,4),before=JSON.stringify(source)
 // Authored graph IDs can coincide across graphs; use distinct IDs like imports.
 const second=graphs[1]!,edge=Object.values(second.edges)[0]!,old=edge.id
 delete second.edges[old];edge.id='other-road';second.edges[edge.id]=edge
 const resolved=resolveMappedInventory(graphs,[source],[],center,100,0)
 const item=resolved.report.items[0]!
 expect(item.status).toBe('pending');expect(item.candidates).toHaveLength(2)
 expect(resolved.surfacesByGraph.flat()).toHaveLength(0)
 const selected=resolveMappedInventory(graphs,[source],[],center,100,0,undefined,{[item.id]:item.candidates[1]!.id})
 expect(selected.report.items[0]!.basis).toBe('manual')
 expect(selected.surfacesByGraph[1]).toHaveLength(1)
 expect(JSON.stringify(source)).toBe(before)
 expect(parseMappedInventoryReport(JSON.stringify(selected.report))).toEqual(selected.report)
})
test('unmarked ground inventory cannot attach to a nearby bridge',()=>{
 const graph=straightRoad(0);Object.values(graph.edges)[0]!.osmVertical={bridge:true,layer:1}
 const resolved=resolveMappedInventory([graph],[surface(91,2)],[],center,100,0)
 expect(resolved.surfacesByGraph[0]).toHaveLength(0)
 expect(resolved.report.items[0]!.status).toBe('unmatched')
 expect(resolved.report.items[0]!.source).toEqual(surface(91,2))
 const crossings=resolveMappedInventory([graph],[],[{id:92,point:localToGeo([0,0],center),tags:{highway:'crossing'}}],center,100,0)
 expect(crossings.crossingsByGraph[0]).toHaveLength(0)
 expect(crossings.report.items[0]!.status).toBe('unmatched')
})
test('stale association choices remain pending instead of silently selecting another road',()=>{
 const resolved=resolveMappedInventory([straightRoad(0)],[surface(93,2)],[],center,100,0,undefined,{'way~93~0':'removed-road'})
 expect(resolved.report.items[0]!.status).toBe('pending')
 expect(resolved.report.items[0]!.diagnostics.some(d=>d.includes('no longer available'))).toBe(true)
 expect(resolved.surfacesByGraph[0]).toHaveLength(0)
})
test('mapped observations remain separate from procedural placement proposals',()=>{
 const observation={kind:'street-lamp' as const,point:localToGeo([0,2],center),sourceId:'node/94',tags:{highway:'street_lamp'}}
 const resolved=resolveMappedInventory([straightRoad(0)],[],[],center,100,0,undefined,undefined,[observation])
 expect(resolved.report.items[0]!.kind).toBe('point-asset')
 expect(resolved.report.items[0]!.source).toEqual(observation)
 expect(resolved.report.items[0]!.diagnostics.join(' ')).toContain('Procedural placement proposals are not mapped observations')
})

test('associates a mapped sidewalk with the closest parallel road corridor', () => {
  const associations = associateOsmMappedSurfaces(
    [straightRoad(0), straightRoad(8)],
    [surface(10, 6)],
    center,
    100,
    0.4,
  )
  expect(associations[0]).toHaveLength(0)
  expect(associations[1]).toHaveLength(1)
  expect(associations[1]![0]).toMatchObject({
    confidence: 'high',
    side: 'right',
    sourceNodeIds: [100, 101, 102],
    widthSource: 'estimated',
  })
  expect(associations[1]![0]!.distanceMeters).toBeCloseTo(2)
})

test('associates one long sidewalk with every road edge along its corridor', () => {
  const first = insertRoadSegment(createEmptyRoadGraph(), [-30, 0, 0], [0, 0, 0])
  const graph = insertRoadSegment(first.graph, [0, 0, 0], [30, 0, 0]).graph
  const longSurface: OsmMappedSurface = {
    ...surface(11, 2),
    points: [-28, 28].map((x, index) => ({
      ...localToGeo([x, 2], center),
      nodeId: 110 + index,
    })),
  }
  const result = associateOsmMappedSurfaces([graph], [longSurface], center, 100, 0)[0]!
  expect(result).toHaveLength(1)
  expect(result[0]!.associatedEdgeIds).toHaveLength(2)
})

test('does not associate a mapped feature across an explicit structure mismatch', () => {
  const graph = straightRoad(0)
  const edge = Object.values(graph.edges)[0]!
  edge.osmVertical = { bridge: true, layer: 1 }
  expect(associateOsmMappedSurfaces(
    [graph],
    [surface(20, 2, { highway: 'footway', footway: 'sidewalk', layer: '0' })],
    center,
    100,
    0,
  )[0]).toHaveLength(0)
})

test('clips supplemental geometry to the selected import radius', () => {
  const result = associateOsmMappedSurfaces(
    [straightRoad(0)],
    [surface(30, 2)],
    center,
    10,
    0,
  )[0]!
  expect(result).toHaveLength(1)
  expect(result[0]!.points).toHaveLength(3)
  expect(result[0]!.points.every((point) => Math.hypot(point[0], point[2]) <= 10.001)).toBe(true)
})

test('clips mapped areas as closed polygons instead of turning their boundary into a ribbon', () => {
  const polygon: OsmMappedSurface = {
    id: 40,
    kind: 'road-area',
    sourceType: 'way',
    tags: { 'area:highway': 'residential' },
    points: [[-20, -6], [20, -6], [20, 6], [-20, 6], [-20, -6]].map(([x, z], index) => ({
      ...localToGeo([x!, z!], center),
      nodeId: 400 + index,
    })),
  }
  const result = associateOsmMappedSurfaces([straightRoad(0)], [polygon], center, 10, 0)[0]!
  expect(result).toHaveLength(1)
  expect(result[0]!.points.length).toBeGreaterThan(4)
  expect(result[0]!.points[0]).toEqual(result[0]!.points.at(-1))
  expect(result[0]!.points.every((point) => Math.hypot(point[0], point[2]) <= 10.001)).toBe(true)
})

test('keeps a lowered kerb node at its mapped curb position', () => {
  const point = localToGeo([0, 4], center)
  const result = associateOsmCrossings([straightRoad(0)], [{
    id: 50,
    kind: 'kerb',
    point,
    tags: { barrier: 'kerb', kerb: 'lowered' },
  }], center, 100, 0.4)[0]!
  expect(result).toHaveLength(1)
  expect(result[0]!.point[0]).toBeCloseTo(0)
  expect(result[0]!.point[1]).toBe(0.4)
  expect(result[0]!.point[2]).toBeCloseTo(4)
})

test('conforms mapped roadside geometry to the imported road elevation', () => {
  const graph = straightRoad(0)
  for (const node of Object.values(graph.graphNodes)) node.position[1] = 2
  const result = associateOsmMappedSurfaces([graph], [surface(60, 2)], center, 100, 0.4)[0]!
  expect(result[0]!.points.every((point) => Math.abs(point[1] - 2.4) < 1e-6)).toBe(true)
})
