import { describe, expect, test } from 'bun:test'
import {
  buildJunctionBoundaryGeometry,
  buildJunctionBoundarySidewalkGeometry,
  buildJunctionSidewalkGeometry,
  buildRoadRenderPaths,
  roadTerminalEnds,
  sampleRoadEdgePoints,
  smoothRoadRenderPath,
  trimRoadRenderPath,
} from './road-network-geometry'
import {
  createEmptyRoadGraph,
  insertRoadSegment,
  roadJunctionCornerKey,
} from './road-network-topology'

function meshCoversPlanPoint(
  positions: number[],
  indices: number[],
  point: readonly [number, number],
): boolean {
  const cross = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
  ) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  for (let index = 0; index < indices.length; index += 3) {
    const vertices = [indices[index]!, indices[index + 1]!, indices[index + 2]!].map(
      (vertexIndex) => [positions[vertexIndex * 3]!, positions[vertexIndex * 3 + 2]!] as const,
    )
    const first = cross(vertices[0]!, vertices[1]!, point)
    const second = cross(vertices[1]!, vertices[2]!, point)
    const third = cross(vertices[2]!, vertices[0]!, point)
    if (
      (first >= -1e-6 && second >= -1e-6 && third >= -1e-6) ||
      (first <= 1e-6 && second <= 1e-6 && third <= 1e-6)
    ) return true
  }
  return false
}

describe('road centerline geometry', () => {
  test('mapped circular routes curve through their alignment vertices', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [10, 0, 0], [0, 0, 10])
    const edge = Object.values(result.graph.edges)[0]!
    edge.alignment = [[Math.SQRT1_2 * 10, 0, Math.SQRT1_2 * 10]]
    for (const junction of ['circular', 'roundabout']) {
      edge.osmSource = { wayId: 4217134, nodeIds: [1, 2, 3], tags: { highway: 'residential', junction } }
      const points = sampleRoadEdgePoints(result.graph, edge)
      expect(points.length).toBeGreaterThan(3)
      expect(points[0]).toEqual([10, 0, 0])
      expect(points.at(-1)).toEqual([0, 0, 10])
      expect(points).toContainEqual(edge.alignment[0]!)
    }
  })

  test('preserves the mapped Villa de la Grande Armée corner without spline bowing', () => {
    // OSM way 51556901, node 1986828644, clipped to a 20 m selection.
    const start: [number, number, number] = [-17.674905955082764, 0, -9.359364266817472]
    const end: [number, number, number] = [16.70642031746524, 0, -10.995249891484258]
    const result = insertRoadSegment(createEmptyRoadGraph(), start, end)
    const edge = Object.values(result.graph.edges)[0]!
    edge.alignment = [[0, 0, 0]]
    edge.osmSource = { wayId: 51556901, nodeIds: [659284020, 1986828644, 659284021], tags: { highway: 'service' } }
    expect(sampleRoadEdgePoints(result.graph, edge)).toEqual([start, [0, 0, 0], end])
    expect(sampleRoadEdgePoints(result.graph, edge, 100)).toEqual([start, [0, 0, 0], end])
  })

  test('points continuation descriptors outward from only the two open ends', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const second = insertRoadSegment(first.graph, [10, 0, 0], [10, 0, 10])

    const terminals = roadTerminalEnds(second.graph)

    expect(terminals).toHaveLength(2)
    expect(terminals.map((terminal) => terminal.point)).toEqual([
      [0, 0, 0],
      [10, 0, 10],
    ])
    expect(terminals[0]?.direction[0]).toBeCloseTo(-1, 6)
    expect(terminals[0]?.direction[1]).toBeCloseTo(0, 6)
    expect(terminals[1]?.direction[0]).toBeCloseTo(0, 6)
    expect(terminals[1]?.direction[1]).toBeCloseTo(1, 6)
  })

  test('samples a spline through its authored middle point', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const edge = Object.values(result.graph.edges)[0]!
    edge.alignment = [[5, 0, 5]]
    const points = sampleRoadEdgePoints(result.graph, edge, 10)
    expect(points).toHaveLength(11)
    expect(points[0]).toEqual([0, 0, 0])
    expect(points.at(-1)).toEqual([10, 0, 0])
    expect(points[5]).toEqual([5, 0, 5])
  })

  test('smoothly interpolates every authored point in a multi-point spline', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const edge = Object.values(result.graph.edges)[0]!
    edge.alignment = [[3, 0, 2], [7, 0, 2]]
    const points = sampleRoadEdgePoints(result.graph, edge)
    expect(points).toHaveLength(22)
    expect(points[0]).toEqual([0, 0, 0])
    expect(points[7]).toEqual([3, 0, 2])
    expect(points[14]).toEqual([7, 0, 2])
    expect(points.at(-1)).toEqual([10, 0, 0])
    expect(points[10]?.[2]).toBeGreaterThan(2)
  })

  test('renders a degree-two L bend as one continuous path instead of two square-ended strips', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const second = insertRoadSegment(first.graph, [10, 0, 0], [10, 0, 10])

    const paths = buildRoadRenderPaths(second.graph)

    expect(paths).toHaveLength(1)
    expect(paths[0]?.edgeIds).toHaveLength(2)
    expect(paths[0]?.cornerPointIndices).toEqual([1])
    expect(paths[0]?.cornerNodeIds).toEqual([second.graph.edges['road-edge_1']!.endNodeId])
    expect(paths[0]?.points).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 10],
    ])

    const smoothed = smoothRoadRenderPath(
      paths[0]!.points,
      paths[0]!.cornerPointIndices,
      4,
      8,
    )
    expect(smoothed.length).toBeGreaterThan(3)
    expect(smoothed).not.toContainEqual([10, 0, 0])
    expect(smoothed.some(([x, , z]) => x < 10 && x > 6 && z > 0 && z < 4)).toBe(true)
  })

  test('uses the authored radius for a circular tangent bend', () => {
    const points: Array<[number, number, number]> = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 10],
    ]
    const radiusTwo = smoothRoadRenderPath(points, [1], [2], 8)
    const radiusFour = smoothRoadRenderPath(points, [1], [4], 8)

    expect(radiusTwo[1]?.[0]).toBeCloseTo(8, 6)
    expect(radiusTwo[1]?.[2]).toBeCloseTo(0, 6)
    expect(radiusFour[1]?.[0]).toBeCloseTo(6, 6)
    expect(radiusFour[1]?.[2]).toBeCloseTo(0, 6)
    for (const point of radiusFour.slice(1, -1)) {
      expect(Math.hypot(point[0] - 6, point[2] - 4)).toBeCloseTo(4, 5)
    }
  })

  test('trims straight decorative strips back to a junction boundary', () => {
    expect(trimRoadRenderPath([[0, 0, 0], [10, 0, 0]], 2, 3)).toEqual([
      [2, 0, 0],
      [7, 0, 0],
    ])
  })

  test('builds an outer sidewalk curve while leaving T-junction approaches open', () => {
    const approaches = [
      { angle: 0, halfWidth: 3.75 },
      { angle: Math.PI, halfWidth: 3.75 },
      { angle: -Math.PI / 2, halfWidth: 3.75 },
    ]
    const geometry = buildJunctionSidewalkGeometry(3.75, 1.5, approaches, 96, 4)

    expect(geometry.indices.length).toBeGreaterThan(0)
    expect(geometry.positions.some((value, index) => index % 3 === 2 && value > 4)).toBe(true)
    for (let index = 0; index < geometry.positions.length; index += 12) {
      const x = (
        geometry.positions[index]! +
        geometry.positions[index + 3]! +
        geometry.positions[index + 6]! +
        geometry.positions[index + 9]!
      ) / 4
      const z = (
        geometry.positions[index + 2]! +
        geometry.positions[index + 5]! +
        geometry.positions[index + 8]! +
        geometry.positions[index + 11]!
      ) / 4
      for (const approach of approaches) {
        const forward = x * Math.cos(approach.angle) + z * Math.sin(approach.angle)
        const lateral = Math.abs(-x * Math.sin(approach.angle) + z * Math.cos(approach.angle))
        expect(forward > 0 && lateral < approach.halfWidth).toBe(false)
      }
    }
  })

  test('solves a plus junction from four tangent curb returns instead of a circle', () => {
    const approaches = [
      { edgeId: 'east', angle: 0, halfWidth: 4 },
      { edgeId: 'north', angle: Math.PI / 2, halfWidth: 4 },
      { edgeId: 'west', angle: Math.PI, halfWidth: 4 },
      { edgeId: 'south', angle: -Math.PI / 2, halfWidth: 4 },
    ]
    const cornerRadii = Object.fromEntries([
      ['east', 'north'],
      ['north', 'west'],
      ['west', 'south'],
      ['south', 'east'],
    ].map(([first, second]) => [roadJunctionCornerKey(first!, second!), 6]))

    const solution = buildJunctionBoundaryGeometry(approaches, cornerRadii, 8)

    expect(solution.corners).toHaveLength(4)
    expect(solution.boundary.length).toBeGreaterThan(32)
    for (const distance of Object.values(solution.approachCuts)) {
      expect(distance).toBeCloseTo(10, 6)
    }
    expect(solution.indices).toHaveLength(solution.boundary.length * 3)
    expect(solution.boundary.some(([x, z]) =>
      Math.abs(x - (4 + 6 - 6 / Math.sqrt(2))) < 0.01 &&
      Math.abs(z - (4 + 6 - 6 / Math.sqrt(2))) < 0.01,
    )).toBe(true)
  })

	test('keeps an outer sidewalk band from covering the gutter on curved junction corners', () => {
		const approaches = [
			{ edgeId: 'east', angle: 0, halfWidth: 4 },
			{ edgeId: 'north', angle: Math.PI / 2, halfWidth: 4 },
			{ edgeId: 'west', angle: Math.PI, halfWidth: 4 },
			{ edgeId: 'south', angle: -Math.PI / 2, halfWidth: 4 },
		]
		const solution = buildJunctionBoundaryGeometry(approaches, {}, 12)
		const gutterWidth = 0.45
		const totalRoadsideWidth = 2.4
		const sidewalkWidth = 1.2
		const gutter = buildJunctionBoundarySidewalkGeometry(solution, gutterWidth)
		const sidewalk = buildJunctionBoundarySidewalkGeometry(
			solution,
			sidewalkWidth,
			totalRoadsideWidth - sidewalkWidth,
		)
		const corner = solution.corners[0]!
		const center = corner.center!
		const inner = corner.innerPoints[Math.floor(corner.innerPoints.length / 2)]!
		const dx = inner[0] - center[0]
		const dz = inner[1] - center[1]
		const length = Math.hypot(dx, dz)
		const sample = [
			center[0] + (dx / length) * (corner.effectiveRadius - gutterWidth / 2),
			center[1] + (dz / length) * (corner.effectiveRadius - gutterWidth / 2),
		] as const

		expect(meshCoversPlanPoint(gutter.positions, gutter.indices, sample)).toBe(true)
		expect(meshCoversPlanPoint(sidewalk.positions, sidewalk.indices, sample)).toBe(false)
	})

  test('uses each persisted corner radius independently', () => {
    const approaches = [
      { edgeId: 'east', angle: 0, halfWidth: 4 },
      { edgeId: 'north', angle: Math.PI / 2, halfWidth: 4 },
      { edgeId: 'west', angle: Math.PI, halfWidth: 4 },
      { edgeId: 'south', angle: -Math.PI / 2, halfWidth: 4 },
    ]
    const changedKey = roadJunctionCornerKey('east', 'north')
    const solution = buildJunctionBoundaryGeometry(approaches, { [changedKey]: 12 }, 8)
    const changed = solution.corners.find(
      (corner) => roadJunctionCornerKey(corner.fromEdgeId, corner.toEdgeId) === changedKey,
    )!
    const unchanged = solution.corners.filter((corner) => corner !== changed)

    expect(changed.effectiveRadius).toBe(12)
    expect(unchanged.map((corner) => corner.effectiveRadius)).toEqual([6, 6, 6])
    expect(solution.approachCuts.east).toBe(16)
    expect(solution.approachCuts.north).toBe(16)
  })

  test('builds finite watertight patches and sidewalks for unequal approach widths', () => {
    const approaches = [
      { edgeId: 'east', angle: 0, halfWidth: 7 },
      { edgeId: 'north', angle: Math.PI / 2, halfWidth: 3 },
      { edgeId: 'west', angle: Math.PI, halfWidth: 5 },
    ]
    const solution = buildJunctionBoundaryGeometry(approaches, {}, 8)
    const sidewalk = buildJunctionBoundarySidewalkGeometry(solution, 1.5)

    expect(solution.corners).toHaveLength(3)
    expect(solution.positions.every(Number.isFinite)).toBe(true)
    expect(solution.indices.every((index) => index < solution.positions.length / 3)).toBe(true)
    expect(Object.values(solution.approachCuts).every((distance) => distance > 0)).toBe(true)
    expect(sidewalk.positions.length).toBeGreaterThan(0)
    expect(sidewalk.positions.every(Number.isFinite)).toBe(true)
    expect(sidewalk.indices.every((index) => index < sidewalk.positions.length / 3)).toBe(true)
  })

  test('keeps the outside sidewalk continuous across both seams of a T junction', () => {
    const halfWidth = 3.75
    const sidewalkWidth = 1.5
    const approaches = [
      { edgeId: 'east', angle: 0, halfWidth },
      { edgeId: 'west', angle: Math.PI, halfWidth },
      { edgeId: 'south', angle: -Math.PI / 2, halfWidth },
    ]
    const solution = buildJunctionBoundaryGeometry(approaches, {}, 24)
    const sidewalk = buildJunctionBoundarySidewalkGeometry(solution, sidewalkWidth)
    const sampleZ = halfWidth + sidewalkWidth / 2
    const samples = Array.from({ length: 401 }, (_, index) => -12 + index * 0.06)
    const uncovered = samples.filter((x) => {
      const coveredByApproach =
        x <= -solution.approachCuts.west! || x >= solution.approachCuts.east!
      return !coveredByApproach && !meshCoversPlanPoint(
        sidewalk.positions,
        sidewalk.indices,
        [x, sampleZ],
      )
    })

    expect(uncovered).toEqual([])
  })

})
