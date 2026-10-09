import { buildJunctionBoundaryGeometry } from './road-network-geometry'
import { expect, test } from 'bun:test'
import { importStreetsFromOsm, localToGeo, type OsmWay } from './osm-import'
import { buildRoadCrossSection } from './road-cross-section'

const center = { lat: 40.758, lon: -73.9855 }
async function street(tags: Record<string, string>) {
  const result = await importStreetsFromOsm(center, 100, {
    loadStreets: async (): Promise<OsmWay[]> => [
      {
        id: 123,
        tags,
        points: [
          [-80, 0],
          [80, 0],
        ].map(([x, z], i) => ({
          ...localToGeo([x!, z!], center),
          nodeId: i + 1,
        })),
      },
    ],
  })
  const graph = result.graphs[0]!
  const edge = Object.values(graph.edges)[0]!
  return graph.stylePresets[edge.styleId]!
}
test('imported one-way avenue uses mapped lanes and width without an invented median', async () => {
  const style = await street({
    highway: 'primary',
    oneway: 'yes',
    lanes: '3',
    width: '9.6',
    sidewalk: 'both',
  })
  expect(style.laneCount).toBe(3)
  expect(buildRoadCrossSection(style).carriagewayWidth).toBeCloseTo(9.6)
  expect(style.medianWidth).toBe(0)
  expect(style.leftSide!.bikeLaneWidth).toBe(0)
})
test('imported street preserves asymmetric sidewalks and cycle lanes', async () => {
  const style = await street({
    highway: 'residential',
    sidewalk: 'left',
    'sidewalk:left:width': '2.5',
    'cycleway:right': 'lane',
    'cycleway:right:width': '1.8',
  })
  expect(style.leftSide!.sidewalkWidth).toBe(2.5)
  expect(style.rightSide!.sidewalkWidth).toBe(0)
  expect(style.rightSide!.bikeLaneWidth).toBe(1.8)
})

test('maps protected cycle tracks and explicit bus lanes to their side bands', async () => {
  const style = await street({
    highway: 'primary',
    oneway: 'yes',
    'cycleway:right': 'track',
    'cycleway:right:width': '2.0',
    'busway:left': 'lane',
  })
  expect(style.rightSide!.bikeLaneWidth).toBe(2)
  expect(style.leftSide!.busLaneWidth).toBe(3.2)
  expect(
    buildRoadCrossSection(style).sides.left.components.map((component) => component.kind),
  ).toContain('bus-lane')
})
test('a one-way motorway ramp is a single carriageway', async () => {
  const style = await street({
    highway: 'motorway_link',
    oneway: 'yes',
    lanes: '1',
  })
  expect(style.laneCount).toBe(1)
  expect(style.medianWidth).toBe(0)
  expect(style.leftSide!.sidewalkWidth).toBe(0)
})

test('Grande Armée six-lane total includes its two bus lanes only once', async () => {
  const style = await street({ highway: 'primary', lanes: '6', 'lanes:forward': '3',
    'lanes:backward': '3', 'busway:both': 'lane', 'psv:lanes:backward': 'yes|yes|designated', surface: 'sett' })
  expect(style.laneCount).toBe(6)
  expect(style.laneUses).toEqual(['bus', 'general', 'general', 'general', 'general', 'bus'])
  expect(style.leftSide!.busLaneWidth).toBe(0)
  expect(style.rightSide!.busLaneWidth).toBe(0)
  expect(buildRoadCrossSection(style).carriagewayWidth).toBeCloseTo(19.2)
})

test('bus access does not reserve an ordinary traffic lane', async () => {
  const style = await street({ highway: 'primary', lanes: '2', 'bus:lanes': 'yes|designated', width: '6.4' })
  expect(style.laneUses).toEqual(['general', 'bus'])
  expect(buildRoadCrossSection(style).carriagewayWidth).toBeCloseTo(6.4)
})

test('uncounted one-way residential streets use an explicit single-lane estimate', async () => {
  const style = await street({ highway: 'residential', oneway: 'yes', name: "Rue d’Argentine" })
  expect(style.laneCount).toBe(1)
  expect(style.laneDirections).toEqual(['forward'])
  expect(style.dimensionSources!.laneCount!.kind).toBe('default')
  expect(buildRoadCrossSection(style).carriagewayWidth).toBeCloseTo(3.2)
  const counted = await street({ highway: 'residential', oneway: 'yes', lanes: '2' })
  expect(counted.laneCount).toBe(2)
  expect(counted.dimensionSources!.laneCount!.kind).toBe('mapped')
})

test('mapped pavement width includes parking and bicycle lanes only once', async () => {
  const style = await street({
    highway: 'residential',
    lanes: '2',
    width: '10.2',
    'parking:right': 'lane',
    'parking:right:width': '2.2',
    'cycleway:left': 'lane',
    'cycleway:left:width': '1.6',
  })
  const section = buildRoadCrossSection(style)
  expect(
    section.carriagewayWidth + style.rightSide!.parkingLaneWidth + style.leftSide!.bikeLaneWidth,
  ).toBeCloseTo(10.2)
})
test('directional lane totals, feet, and malformed tags remain schema-valid', async () => {
  const style = await street({
    highway: 'secondary',
    'lanes:forward': '2',
    'lanes:backward': '1',
    width: '30 ft',
    sidewalk: 'no',
  })
  expect(style.laneCount).toBe(3)
  expect(buildRoadCrossSection(style).carriagewayWidth).toBeCloseTo(9.144)
  expect(style.leftSide!.sidewalkWidth).toBe(0)
  const fallback = await street({
    highway: 'primary',
    lanes: '3;4',
    width: 'unknown',
  })
  expect(fallback.laneCount).toBe(2)
  expect(Number.isFinite(buildRoadCrossSection(fallback).totalWidth)).toBe(true)
})

test('nearby mapped entrances fit their curb returns between junctions', async () => {
  const makeWay = (id: number, coords: Array<[number, number, number]>) => ({
    id,
    tags: { highway: 'residential', sidewalk: 'no' },
    points: coords.map(([nodeId, x, z]) => ({
      nodeId,
      ...localToGeo([x, z], center),
    })),
  })
  const result = await importStreetsFromOsm(center, 100, {
    loadStreets: async () => [
      makeWay(1, [
        [1, -60, 0],
        [2, 0, 0],
        [3, 12, 0],
        [4, 60, 0],
      ]),
      makeWay(2, [
        [2, 0, 0],
        [5, 0, 40],
      ]),
      makeWay(3, [
        [3, 12, 0],
        [6, 12, 40],
      ]),
    ],
  })
  const graph = result.graphs[0]!
  for (const junction of Object.values(graph.junctions)) {
    const approaches = Object.values(graph.edges).flatMap((edge) => {
      if (edge.startNodeId !== junction.nodeId && edge.endNodeId !== junction.nodeId) return []
      const from = graph.graphNodes[junction.nodeId]!.position
      const other =
        graph.graphNodes[edge.startNodeId === junction.nodeId ? edge.endNodeId : edge.startNodeId]!
          .position
      return [
        {
          edgeId: edge.id,
          angle: Math.atan2(other[2] - from[2], other[0] - from[0]),
          halfWidth: buildRoadCrossSection(graph.stylePresets[edge.styleId]!).carriagewayWidth / 2,
        },
      ]
    })
    const solution = buildJunctionBoundaryGeometry(approaches, junction.cornerRadii)
    const connector = Object.values(graph.edges).find(
      (edge) => graph.junctions[edge.startNodeId] && graph.junctions[edge.endNodeId],
    )!
    expect(solution.approachCuts[connector.id]).toBeLessThan(6)
  }
})

test('a clipped T approach reserves space only for its actual junction', async () => {
  const result = await importStreetsFromOsm(center, 15, {
    loadStreets: async (): Promise<OsmWay[]> => [
      { id: 470987535, tags: { highway: 'primary', lanes: '6', sidewalk: 'both' },
        points: [[-30, 0], [0, 0], [30, 0]].map(([x, z], i) => ({ ...localToGeo([x!, z!], center), nodeId: i + 1 })) },
      { id: 8413426, tags: { highway: 'residential', oneway: 'yes', sidewalk: 'no' },
        points: [[0, 0], [0, 30]].map(([x, z], i) => ({ ...localToGeo([x!, z!], center), nodeId: i === 0 ? 2 : 4 })) },
    ],
  })
  const graph = result.graphs[0]!
  expect(Object.values(graph.edges)).toHaveLength(3)
  const junction = Object.values(graph.junctions)[0]!
  expect(junction.kind).toBe('tee')
  expect(Math.max(...Object.values(junction.cornerRadii))).toBeGreaterThan(0.5)
})

test('road import preserves the mapped surface through graph assembly', async () => {
  const concrete = await street({ highway: 'primary', lanes: '4', surface: 'concrete' })
  expect(concrete.surfaceMaterial).toBe('concrete')
  expect(concrete.surfaceSource).toEqual({ kind: 'mapped', tag: 'concrete' })
  const unknown = await street({ highway: 'primary', surface: 'paved' })
  expect(unknown.surfaceMaterial).toBeUndefined()
  expect(unknown.surfaceSource).toEqual({ kind: 'default', tag: 'paved' })
})

test('preserves lane-specific widths and dimension provenance', async () => {
  const style = await street({
    highway: 'primary',
    lanes: '3',
    'width:lanes': '3.0|3.2|3.6',
    sidewalk: 'no',
  })
  expect(style.laneWidths).toEqual([3, 3.2, 3.6])
  expect(buildRoadCrossSection(style).carriagewayWidth).toBeCloseTo(9.8)
  expect(style.dimensionSources).toMatchObject({
    laneCount: { kind: 'mapped', tag: 'lanes' },
    laneWidth: { kind: 'mapped', tag: 'width%3Alanes' },
    totalWidth: { kind: 'default' },
  })
})

test('does not duplicate sidewalks declared as separately mapped geometry', async () => {
  const style = await street({
    highway: 'residential',
    sidewalk: 'separate',
  })
  expect(style.leftSide!.sidewalkWidth).toBe(0)
  expect(style.rightSide!.sidewalkWidth).toBe(0)
  expect(style.dimensionSources).toMatchObject({
    leftSidewalk: { kind: 'mapped' },
    rightSidewalk: { kind: 'mapped' },
  })
})

test('preserves directional per-lane transit and bicycle uses', async () => {
  const style = await street({
    highway: 'primary',
    lanes: '3',
    'lanes:forward': '2',
    'lanes:backward': '1',
    'bus:lanes:forward': 'designated|no',
    'bus:lanes:backward': 'no',
    'bicycle:lanes:forward': 'no|designated',
    'bicycle:lanes:backward': 'designated',
  })
  expect(style.laneDirections).toEqual(['backward', 'forward', 'forward'])
  expect(style.laneUses).toEqual(['bicycle', 'bus', 'bicycle'])
})
