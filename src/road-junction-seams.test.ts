import { expect, test } from 'bun:test'
import { compileStreetLayout } from './street-compiler-layout'
import {
  buildRoadJunctionSeams,
  mergeCollidingJunctionSurfaces,
  roadJunctionMouth,
  triangulateRoadBoundary,
  trimRoadProfileAtJunctions,
} from './road-junction-seams'
import { buildJunctionBoundaryGeometry } from './road-network-geometry'
import { buildRoadVariableRibbonGeometry } from './road-pavement-geometry'
import { buildRoadTransitionProfiles } from './road-transition-profile'
import { createEmptyRoadGraph, insertRoadSegment } from './road-network-topology'
import { RoadNetworkNode } from './schema'
import { ROAD_SIDE_COMPONENT_SPECS } from './road-cross-section'

function fixture(curved = false) {
  let graph = createEmptyRoadGraph()
  for (const end of [
    [40, 2, 0],
    [-40, 0, 0],
    [0, 1, 40],
  ] as [number, number, number][])
    graph = insertRoadSegment(graph, [0, 0, 0], end).graph
  const node = RoadNetworkNode.parse({ ...graph, applyStyleToAll: false })
  Object.values(node.edges).forEach((edge, i) => {
    const style = structuredClone(node.stylePresets[edge.styleId]!)
    style.id = `style-${i}`
    style.laneCount = i + 1
    style.leftSide = {
      parkingLaneWidth: 0,
      bikeLaneWidth: 0,
      gutterWidth: 0.2,
      curbWidth: 0.15,
      vergeWidth: 0,
      sidewalkWidth: i + 1,
    }
    style.rightSide = { ...style.leftSide, sidewalkWidth: i === 0 ? 0 : 0.6 }
    node.stylePresets[style.id] = style
    edge.styleId = style.id
  })
  const profiles = buildRoadTransitionProfiles(node)
  if (curved) {
    // Curve a sampled approach so its trimmed tangent differs from its node tangent.
    const profile = profiles[0]!
    const total = profile.samples.at(-1)!.distance
    for (const sample of profile.samples)
      sample.point[2] += Math.sin((sample.distance / total) * Math.PI) * 3
    let distance = 0
    profile.samples.forEach((sample, i) => {
      if (i > 0) {
        const previous = profile.samples[i - 1]!
        distance += Math.hypot(
          sample.point[0] - previous.point[0],
          sample.point[2] - previous.point[2],
        )
      }
      sample.distance = distance
    })
  }
  const center = Object.values(node.graphNodes).find((n) => n.position.every((x) => x === 0))!
  const approaches = profiles.map((p) => {
    const atEnd = p.endNodeId === center.id
    const mouth = roadJunctionMouth(p, atEnd)
    return {
      edgeId: p.edgeIds[0]!,
      halfWidth: mouth.sample.carriagewayHalfWidth,
      angle: Math.atan2(mouth.direction[1], mouth.direction[0]),
    }
  })
  const solution = buildJunctionBoundaryGeometry(approaches, {})
  const trimmed = profiles.map((p) =>
    trimRoadProfileAtJunctions(
      p,
      p.startNodeId === center.id ? solution.approachCuts[p.edgeIds[0]!]! : 0,
      p.endNodeId === center.id ? solution.approachCuts[p.edgeIds.at(-1)!]! : 0,
    ),
  )
  const mouths = Object.fromEntries(
    trimmed.map((p) => [p.edgeIds[0]!, roadJunctionMouth(p, p.endNodeId === center.id)]),
  )
  return {
    trimmed,
    mouths,
    solution,
    center,
    seams: buildRoadJunctionSeams(solution, center.position, mouths),
  }
}

test('merges overlapping short-connector patches into one shared asphalt region', () => {
  const regions = [
    { center: [0, 0, 0] as const, mergeKey: 'at-grade:0', solution: { boundary: [[-3, -2], [3, -2], [3, 2], [-3, 2]] as const } },
    { center: [4, 0, 0] as const, mergeKey: 'at-grade:0', solution: { boundary: [[-3, -2], [3, -2], [3, 2], [-3, 2]] as const } },
  ]
  const merged = mergeCollidingJunctionSurfaces(regions)
  expect(merged[0]!.positions.length).toBeGreaterThan(0)
  expect(merged[1]!.positions).toEqual([])
  expect(merged[0]!.indices.length).toBeGreaterThan(0)
  expect(Math.max(...merged[0]!.positions.filter((_, index) => index % 3 === 0))).toBe(7)
})

test('keeps bridge and at-grade patches separate', () => {
  const regions = [
    { center: [0, 0, 0] as const, mergeKey: 'bridge:1', solution: { boundary: [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const } },
    { center: [0, 0, 0] as const, mergeKey: 'at-grade:0', solution: { boundary: [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const } },
  ]
  const merged = mergeCollidingJunctionSurfaces(regions)
  expect(merged[0]!.positions.length).toBeGreaterThan(0)
  expect(merged[1]!.positions.length).toBeGreaterThan(0)
})

test('triangulates an interior traffic island as a hole', () => {
  const mesh = triangulateRoadBoundary(
    [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]],
    [[[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]],
  )
  expect(mesh.positions).toHaveLength(24)
  expect(mesh.indices.length).toBeGreaterThan(0)
  let area = 0
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index]! * 3
    const b = mesh.indices[index + 1]! * 3
    const c = mesh.indices[index + 2]! * 3
    area += Math.abs(
      (mesh.positions[b]! - mesh.positions[a]!) * (mesh.positions[c + 2]! - mesh.positions[a + 2]!)
      - (mesh.positions[b + 2]! - mesh.positions[a + 2]!) * (mesh.positions[c]! - mesh.positions[a]!),
    ) / 2
  }
  expect(area).toBeCloseTo(96, 5)
})
function containsVertex(positions: number[], point: readonly number[]) {
  for (let i = 0; i < positions.length; i += 3)
    if (
      Math.hypot(
        positions[i]! - point[0]!,
        positions[i + 1]! - point[1]!,
        positions[i + 2]! - point[2]!,
      ) < 1e-6
    )
      return true
  return false
}

test.each([
  false,
  true,
])('junction asphalt shares exact road-mouth vertices, curved=%s', (curved) => {
  const { trimmed, center, seams } = fixture(curved)
  for (const p of trimmed) {
    const mesh = buildRoadVariableRibbonGeometry(
      p.samples.map((s) => ({
        ...s,
        leftOffset: s.carriagewayHalfWidth,
        rightOffset: -s.carriagewayHalfWidth,
      })),
    )
    const atEnd = p.endNodeId === center.id
    const cap = atEnd ? mesh.positions.slice(-6) : mesh.positions.slice(0, 6)
    expect(containsVertex(seams.asphalt.positions, cap.slice(0, 3))).toBe(true)
    expect(containsVertex(seams.asphalt.positions, cap.slice(3))).toBe(true)
  }
})

test('curbs and asymmetric sidewalks meet each road side instead of the widest style', () => {
  const { trimmed, center, seams } = fixture()
  for (const p of trimmed)
    for (const side of ['left', 'right'] as const)
      for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
        const samples = p.samples.map((s) => ({
          ...s,
          leftOffset:
            side === 'left'
              ? s.components[side][spec.kind].outerOffset
              : -s.components[side][spec.kind].innerOffset,
          rightOffset:
            side === 'left'
              ? s.components[side][spec.kind].innerOffset
              : -s.components[side][spec.kind].outerOffset,
        }))
        const endSample = p.endNodeId === center.id ? samples.at(-1)! : samples[0]!
        if (endSample.components[side][spec.kind].width <= 0) continue
        const mesh = buildRoadVariableRibbonGeometry(samples)
        const cap =
          p.endNodeId === center.id ? mesh.positions.slice(-6) : mesh.positions.slice(0, 6)
        expect(containsVertex(seams.bands[spec.kind].positions, cap.slice(0, 3))).toBe(true)
        expect(containsVertex(seams.bands[spec.kind].positions, cap.slice(3))).toBe(true)
      }
})

test('oversized junction cuts leave a forward connecting road rather than duplicate endpoints', () => {
  const p = fixture().trimmed[0]!
  const trimmed = trimRoadProfileAtJunctions(p, 100, 100)
  expect(trimmed.samples.at(-1)!.distance).toBeGreaterThan(0)
  expect(trimmed.samples[0]!.point).not.toEqual(trimmed.samples.at(-1)!.point)
})

test('concave junction triangulation covers the polygon without overlapping center-fan triangles', () => {
  const polygon: [number, number, number][] = [
    [0, 0, 0],
    [6, 0, 0],
    [6, 0, 2],
    [2, 0, 2],
    [2, 0, 6],
    [0, 0, 6],
  ]
  const mesh = triangulateRoadBoundary(polygon)
  let area = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices
      .slice(i, i + 3)
      .map((n) => mesh.positions.slice(n * 3, n * 3 + 3))
    area +=
      Math.abs((b![0]! - a![0]!) * (c![2]! - a![2]!) - (b![2]! - a![2]!) * (c![0]! - a![0]!)) / 2
  }
  expect(area).toBeCloseTo(20, 8)
  expect(mesh.indices.length).toBe(12)
})

test('captured Times Square roads produce matching mouths for every imported junction', async () => {
  const node = RoadNetworkNode.parse(
    await Bun.file(`${import.meta.dir}/__fixtures__/osm-times-square-roads.json`).json(),
  )
  const profiles = buildRoadTransitionProfiles(node)
  const junctions = Object.values(node.graphNodes).flatMap((center) => {
    const incident = Object.values(node.edges).filter(
      (e) => e.startNodeId === center.id || e.endNodeId === center.id,
    )
    if (incident.length < 3) return []
    const approaches = incident.map((e) => {
      const p = profiles.find(
        (p) =>
          (p.startNodeId === center.id && p.edgeIds[0] === e.id) ||
          (p.endNodeId === center.id && p.edgeIds.at(-1) === e.id),
      )!
      const m = roadJunctionMouth(p, p.endNodeId === center.id)
      return {
        edgeId: e.id,
        halfWidth: m.sample.carriagewayHalfWidth,
        angle: Math.atan2(m.direction[1], m.direction[0]),
      }
    })
    return [
      {
        center,
        solution: buildJunctionBoundaryGeometry(
          approaches,
          node.junctions[center.id]?.cornerRadii ?? {},
        ),
      },
    ]
  })
  const cuts = Object.fromEntries(
    junctions.flatMap((j) =>
      Object.entries(j.solution.approachCuts).map(([e, d]) => [`${j.center.id}:${e}`, d]),
    ),
  )
  const trimmed = profiles.map((p) =>
    trimRoadProfileAtJunctions(
      p,
      cuts[`${p.startNodeId}:${p.edgeIds[0]}`] ?? 0,
      cuts[`${p.endNodeId}:${p.edgeIds.at(-1)}`] ?? 0,
    ),
  )
  let checked = 0
  for (const { center, solution } of junctions) {
    const mouths = Object.fromEntries(
      trimmed.flatMap((p) => {
        const result: Array<[string, ReturnType<typeof roadJunctionMouth>]> = []
        if (p.startNodeId === center.id) result.push([p.edgeIds[0]!, roadJunctionMouth(p, false)])
        if (p.endNodeId === center.id) result.push([p.edgeIds.at(-1)!, roadJunctionMouth(p, true)])
        return result
      }),
    )
    const seams = buildRoadJunctionSeams(solution, center.position, mouths)
    for (const band of Object.values(seams.bands)) {
      expect(band.positions.length % 3).toBe(0)
      expect(band.indices.every((index) => index >= 0 && index < band.positions.length / 3)).toBe(true)
    }
    expect(seams.asphalt.positions.every(Number.isFinite)).toBe(true)
    expect(seams.asphalt.indices.length).toBeGreaterThan(0)
    let polygonArea = 0,
      triangleArea = 0
    const positions = seams.asphalt.positions
    for (let i = 0; i < positions.length; i += 3) {
      const j = (i + 3) % positions.length
      polygonArea += positions[i]! * positions[j + 2]! - positions[j]! * positions[i + 2]!
    }
    for (let i = 0; i < seams.asphalt.indices.length; i += 3) {
      const [a, b, c] = seams.asphalt.indices
        .slice(i, i + 3)
        .map((n) => positions.slice(n * 3, n * 3 + 3))
      triangleArea += Math.abs(
        (b![0]! - a![0]!) * (c![2]! - a![2]!) - (b![2]! - a![2]!) * (c![0]! - a![0]!),
      )
    }
    expect(triangleArea).toBeCloseTo(Math.abs(polygonArea), 5)
    for (const p of trimmed) {
      if (p.startNodeId !== center.id && p.endNodeId !== center.id) continue
      const mesh = buildRoadVariableRibbonGeometry(
        p.samples.map((s) => ({
          ...s,
          leftOffset: s.carriagewayHalfWidth,
          rightOffset: -s.carriagewayHalfWidth,
        })),
      )
      const cap = p.endNodeId === center.id ? mesh.positions.slice(-6) : mesh.positions.slice(0, 6)
      for (const point of [cap.slice(0, 3), cap.slice(3)])
        expect(
          containsVertex(
            seams.asphalt.positions,
            point.map((v, i) => v - center.position[i]!),
          ),
        ).toBe(true)
      checked++
    }
  }
  expect(junctions.length).toBe(19)
  expect(checked).toBeGreaterThanOrEqual(57)
})

test('merged fitted seams retain each junction elevation relative to the owner', () => {
  const boundary = [[-3, -2], [3, -2], [3, 2], [-3, 2]] as const
  const surface = triangulateRoadBoundary(boundary.map(([x, z]) => [x, x * 0.1, z] as const))
  const merged = mergeCollidingJunctionSurfaces([
    { center: [0, 5, 0], solution: { boundary }, surface },
    { center: [4, 5.4, 0], solution: { boundary }, surface },
  ])
  for (let i = 0; i < merged[0]!.positions.length; i += 3) {
    expect(merged[0]!.positions[i + 1]!).toBeCloseTo(merged[0]!.positions[i]! * 0.1, 8)
  }
  expect(merged[1]!.positions).toEqual([])
  expect(surface.positions[1]).toBeCloseTo(-0.3, 8)
})


test('the compiler preserves sloped mouth heights in its rendered junction asphalt', () => {
  let graph = createEmptyRoadGraph()
  for (const end of [[40, 4, 0], [-40, -2, 0], [0, 1, 40]] as [number, number, number][]) {
    graph = insertRoadSegment(graph, [0, 0, 0], end).graph
  }
  const node = RoadNetworkNode.parse({ ...graph, applyStyleToAll: false })
  const layout = compileStreetLayout(node)
  const junction = layout.renderedJunctionSurfaces.find(j => j.graphNode.position.every(value => value === 0))!
  const heights = junction.solution.positions.filter((_, i) => i % 3 === 1)
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.1)
  for (const { profile } of layout.edgeSurfaces) {
    const atEnd = profile.endNodeId === junction.graphNode.id
    const mouth = roadJunctionMouth(profile, atEnd)
    const expectedHeight = mouth.sample.point[1] - junction.graphNode.position[1]
    expect(heights.some(value => Math.abs(value - expectedHeight) < 1e-6)).toBe(true)
  }
})
