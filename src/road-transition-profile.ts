import { sectionTransitionSample } from "./section-transition-sample"
import {
  ROAD_SIDE_COMPONENT_SPECS,
  roadCarriagewayWidth,
  roadVehicleLaneWidth,
  resolveRoadLaneWidths,
  resolveRoadSideComponents,
  type RoadSide,
  type RoadSideComponentKind,
} from './road-cross-section'
import {
  buildRoadRenderPaths,
  sampleRoadEdgePoints,
  smoothRoadRenderPath,
  type RoadGeometryPoint,
  type RoadRenderPath,
} from './road-network-geometry'
import type { RoadGraphEdge, RoadNetworkNode, RoadStylePreset } from './schema'
import { DEFAULT_ROAD_STYLE_PRESETS } from './road-style-presets'

export type RoadTransitionComponentBounds = {
  innerOffset: number
  outerOffset: number
  width: number
}

export type RoadTransitionSample = {
  carriagewayHalfWidth: number
  components: Record<RoadSide, Record<RoadSideComponentKind, RoadTransitionComponentBounds>>
  distance: number
  laneBoundaryOffsets: number[]
  medianWidth: number
  point: RoadGeometryPoint
  surfaceThickness: number
}

export type RoadTransitionEnd = {
  length: number
  nodeId: string
  targetStyleId: string
}

export type RoadTransitionProfile = {
  edgeIds: string[]
  endNodeId: string
  endTransition?: RoadTransitionEnd
  key: string
  samples: RoadTransitionSample[]
  startNodeId: string
  startTransition?: RoadTransitionEnd
  style: RoadStylePreset
}

const EPSILON = 1e-6

function resolveStyle(node: RoadNetworkNode, edge: RoadGraphEdge): RoadStylePreset | undefined {
  const styleId = node.applyStyleToAll ? node.activeStyleId : edge.styleId
  return (
    node.stylePresets[styleId] ??
    (DEFAULT_ROAD_STYLE_PRESETS[styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS] as
      | RoadStylePreset
      | undefined) ??
    node.stylePresets[node.activeStyleId]
  )
}

function distanceXZ(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  return Math.hypot(second[0] - first[0], second[2] - first[2])
}

function cumulativeDistances(points: ReadonlyArray<RoadGeometryPoint>): number[] {
  const distances = [0]
  for (let index = 1; index < points.length; index++) {
    distances.push(distances[index - 1]! + distanceXZ(points[index - 1]!, points[index]!))
  }
  return distances
}

function interpolatePoint(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  t: number,
): RoadGeometryPoint {
  return [
    first[0] + (second[0] - first[0]) * t,
    first[1] + (second[1] - first[1]) * t,
    first[2] + (second[2] - first[2]) * t,
  ]
}

function pointAtDistance(
  points: RoadGeometryPoint[],
  distances: number[],
  distance: number,
): RoadGeometryPoint {
  const target = Math.max(0, Math.min(distances.at(-1) ?? 0, distance))
  for (let index = 0; index < distances.length - 1; index++) {
    const startDistance = distances[index]!
    const endDistance = distances[index + 1]!
    if (target > endDistance + EPSILON) continue
    const span = Math.max(EPSILON, endDistance - startDistance)
    return interpolatePoint(points[index]!, points[index + 1]!, (target - startDistance) / span)
  }
  return [...points.at(-1)!]
}

function laneBoundaryOffsets(style: RoadStylePreset): number[] {
  const widths = resolveRoadLaneWidths(style)
  const total = roadVehicleLaneWidth(style)
  let cursor = -total / 2
  return widths.slice(0, -1).map((width) => {
    cursor += width
    return cursor + (Math.sign(cursor) * style.medianWidth) / 2
  })
}

function targetLaneBoundaryOffsets(source: RoadStylePreset, target: RoadStylePreset): number[] {
  const sourceOffsets = laneBoundaryOffsets(source)
  const targetOffsets = laneBoundaryOffsets(target)
  const targetBySide = {
    left: targetOffsets.filter((offset) => offset > EPSILON).sort((a, b) => a - b),
    right: targetOffsets.filter((offset) => offset < -EPSILON).sort((a, b) => b - a),
  }
  const sourceRanks = { left: 0, right: 0 }
  const targetLaneHalfWidth = target.medianWidth / 2 + roadVehicleLaneWidth(target) / 2
  return sourceOffsets.map((offset) => {
    if (Math.abs(offset) <= EPSILON) return 0
    const side = offset > 0 ? 'left' : 'right'
    const rank = sourceRanks[side]++
    return targetBySide[side][rank] ?? (side === 'left' ? 1 : -1) * targetLaneHalfWidth
  })
}

function componentBounds(
  style: RoadStylePreset,
  target: RoadStylePreset | undefined,
  targetMix: number,
  carriagewayHalfWidth: number,
): RoadTransitionSample['components'] {
  return Object.fromEntries(
    (['left', 'right'] as const).map((side) => {
      const sourceComponents = resolveRoadSideComponents(style, side)
      const targetComponents = target ? resolveRoadSideComponents(target, side) : sourceComponents
      let cursor = carriagewayHalfWidth
      const bounds = Object.fromEntries(
        ROAD_SIDE_COMPONENT_SPECS.map((spec) => {
          const sourceWidth = sourceComponents[spec.widthKey] ?? 0
          const targetWidth = targetComponents[spec.widthKey] ?? 0
          const width = sourceWidth + (targetWidth - sourceWidth) * targetMix
          const innerOffset = cursor
          cursor += width
          return [spec.kind, { innerOffset, outerOffset: cursor, width }]
        }),
      ) as Record<RoadSideComponentKind, RoadTransitionComponentBounds>
      return [side, bounds]
    }),
  ) as RoadTransitionSample['components']
}

function buildSample(
  style: RoadStylePreset,
  target: RoadStylePreset | undefined,
  targetMix: number,
  point: RoadGeometryPoint,
  distance: number,
): RoadTransitionSample {
  const mix = Math.max(0, Math.min(1, targetMix))
  const targetStyle = target ?? style
  const halfWidth =
    (roadCarriagewayWidth(style) + (roadCarriagewayWidth(targetStyle) - roadCarriagewayWidth(style)) * mix) / 2
  const sourceBoundaries = laneBoundaryOffsets(style)
  const targetBoundaries = targetLaneBoundaryOffsets(style, targetStyle)
  return {
    carriagewayHalfWidth: halfWidth,
    components: componentBounds(style, target, mix, halfWidth),
    distance,
    laneBoundaryOffsets: sourceBoundaries.map(
      (offset, index) => offset + (targetBoundaries[index]! - offset) * mix,
    ),
    medianWidth: style.medianWidth + (targetStyle.medianWidth - style.medianWidth) * mix,
    point,
    surfaceThickness:
      style.surfaceThickness + (targetStyle.surfaceThickness - style.surfaceThickness) * mix,
  }
}

function outwardDirectionAtNode(
  node: RoadNetworkNode,
  edge: RoadGraphEdge,
  nodeId: string,
): readonly [number, number] | null {
  const sampled = sampleRoadEdgePoints(node, edge, 32)
  const outward = edge.startNodeId === nodeId ? sampled : [...sampled].reverse()
  if (outward.length < 2) return null
  const dx = outward[1]![0] - outward[0]![0]
  const dz = outward[1]![2] - outward[0]![2]
  const length = Math.hypot(dx, dz)
  return length > EPSILON ? [dx / length, dz / length] : null
}

function styleNeedsTaper(source: RoadStylePreset, target: RoadStylePreset): boolean {
  const sourceWidth = roadCarriagewayWidth(source)
  const targetWidth = roadCarriagewayWidth(target)
  if (sourceWidth > targetWidth + 0.01) return true
  if (Math.abs(sourceWidth - targetWidth) > 0.01) return false
  if (source.laneCount !== target.laneCount) return source.laneCount > target.laneCount
  return source.laneWidth > target.laneWidth + 0.01
}

export function roadTransitionLength(
  source: RoadStylePreset,
  target: RoadStylePreset,
  availableLength: number,
): number {
  const widthDelta = Math.abs(roadCarriagewayWidth(source) - roadCarriagewayWidth(target))
  const laneDelta =
    Math.abs(source.laneCount - target.laneCount) * Math.min(source.laneWidth, target.laneWidth)
  const preferred = Math.max(8, Math.min(40, Math.max(widthDelta, laneDelta) * 6))
  return Math.min(preferred, Math.max(0, availableLength) * 0.45)
}

function endpointTransition(
  node: RoadNetworkNode,
  path: RoadRenderPath,
  style: RoadStylePreset,
  atStart: boolean,
  availableLength: number,
): { end: RoadTransitionEnd; style: RoadStylePreset } | undefined {
  const nodeId = atStart ? path.startNodeId : path.endNodeId
  const currentEdgeId = atStart ? path.edgeIds[0] : path.edgeIds.at(-1)
  const currentEdge = currentEdgeId ? node.edges[currentEdgeId] : undefined
  if (!currentEdge || currentEdge.joinMode !== 'auto') return undefined
  const incident = Object.values(node.edges).filter(
    (edge) => edge.startNodeId === nodeId || edge.endNodeId === nodeId,
  )
  if (incident.length !== 2) return undefined
  const neighbor = incident.find((edge) => edge.id !== currentEdge.id)
  if (!neighbor || neighbor.joinMode !== 'auto' || neighbor.stackLevel !== currentEdge.stackLevel)
    return undefined
  const neighborStyle = resolveStyle(node, neighbor)
  if (!neighborStyle || !styleNeedsTaper(style, neighborStyle)) return undefined
  const currentDirection = outwardDirectionAtNode(node, currentEdge, nodeId)
  const neighborDirection = outwardDirectionAtNode(node, neighbor, nodeId)
  if (!currentDirection || !neighborDirection) return undefined
  const dot =
    currentDirection[0] * neighborDirection[0] + currentDirection[1] * neighborDirection[1]
  if (dot > -0.5) return undefined
  const length = roadTransitionLength(style, neighborStyle, availableLength)
  if (length <= EPSILON) return undefined
  return {
    end: { length, nodeId, targetStyleId: neighborStyle.id },
    style: neighborStyle,
  }
}

function profileForPath(node: RoadNetworkNode, path: RoadRenderPath): RoadTransitionProfile | null {
  const edge = node.edges[path.edgeIds[0]!]
  const style = edge ? resolveStyle(node, edge) : undefined
  if (!edge || !style) return null
  const points = smoothRoadRenderPath(
    path.points,
    path.cornerPointIndices,
    path.cornerNodeIds.map(
      (nodeId) => node.graphNodes[nodeId]?.curveRadius ?? roadCarriagewayWidth(style) * 0.65,
    ),
    10,
  )
  if (points.length < 2) return null
  const distances = cumulativeDistances(points)
  const totalLength = distances.at(-1) ?? 0
  const start = endpointTransition(node, path, style, true, totalLength)
  const end = endpointTransition(node, path, style, false, totalLength)
  const sectionLayout = path.edgeIds.length === 1 && edge.sectionLayout && Math.abs(edge.sectionLayout.length - totalLength) <= 0.05 ? edge.sectionLayout : undefined
  const sampleDistances = [...distances]
  if (sectionLayout) {
    for (const interval of sectionLayout.intervals) sampleDistances.push(interval.start, interval.end)
    for (let station=1; station<totalLength; station++) sampleDistances.push(station)
  }
  if (start) sampleDistances.push(start.end.length)
  if (end) sampleDistances.push(totalLength - end.end.length)
  const orderedDistances = [
    ...new Set(
      sampleDistances.map(
        (distance) => Math.round(Math.max(0, Math.min(totalLength, distance)) * 1e6) / 1e6,
      ),
    ),
  ].sort((left, right) => left - right)
  const samples = orderedDistances.map((distance) => {
    if (sectionLayout) {
      const reversed = edge.startNodeId !== path.startNodeId
      return sectionTransitionSample(buildSample(style, undefined, 0, pointAtDistance(points, distances, distance), distance), sectionLayout, reversed ? totalLength - distance : distance, reversed)
    }
    if (start && distance <= start.end.length + EPSILON) {
      const targetMix = 1 - distance / start.end.length
      return buildSample(
        style,
        start.style,
        targetMix,
        pointAtDistance(points, distances, distance),
        distance,
      )
    }
    if (end && distance >= totalLength - end.end.length - EPSILON) {
      const targetMix = 1 - (totalLength - distance) / end.end.length
      return buildSample(
        style,
        end.style,
        targetMix,
        pointAtDistance(points, distances, distance),
        distance,
      )
    }
    return buildSample(style, undefined, 0, pointAtDistance(points, distances, distance), distance)
  })
  return {
    edgeIds: path.edgeIds,
    endNodeId: path.endNodeId,
    endTransition: end?.end,
    key: path.edgeIds.join(':'),
    samples,
    startNodeId: path.startNodeId,
    startTransition: start?.end,
    style,
  }
}

/** Resolve every render path into a variable-width profile with automatic tapers. */
export function buildRoadTransitionProfiles(node: RoadNetworkNode): RoadTransitionProfile[] {
  return buildRoadRenderPaths(
    node,
    (left, right) => !left.sectionLayout && !right.sectionLayout && resolveStyle(node, left)?.id === resolveStyle(node, right)?.id,
  ).flatMap((path) => {
    const profile = profileForPath(node, path)
    return profile ? [profile] : []
  })
}

export type RoadTransitionProfileCacheStats = {
  rebuiltProfiles: number
  reusedProfiles: number
  totalProfiles: number
}

type RoadTransitionProfileCacheEntry = {
  profile: RoadTransitionProfile | null
  signature: string
}

export type RoadTransitionProfileCache = {
  entries: Map<string, RoadTransitionProfileCacheEntry>
  stats: RoadTransitionProfileCacheStats
}

export function createRoadTransitionProfileCache(): RoadTransitionProfileCache {
  return {
    entries: new Map(),
    stats: { rebuiltProfiles: 0, reusedProfiles: 0, totalProfiles: 0 },
  }
}

function transitionPathSignature(node: RoadNetworkNode, path: RoadRenderPath): string {
  const dependencyEdgeIds = new Set(path.edgeIds)
  for (const nodeId of [path.startNodeId, path.endNodeId]) {
    for (const edge of Object.values(node.edges)) {
      if (edge.startNodeId === nodeId || edge.endNodeId === nodeId) {
        dependencyEdgeIds.add(edge.id)
      }
    }
  }
  const dependencyEdges = [...dependencyEdgeIds].sort().flatMap((edgeId) => {
    const edge = node.edges[edgeId]
    return edge ? [edge] : []
  })
  const dependencyNodeIds = new Set([
    path.startNodeId,
    path.endNodeId,
    ...path.cornerNodeIds,
    ...dependencyEdges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]),
  ])
  const dependencyNodes = [...dependencyNodeIds].sort().flatMap((nodeId) => {
    const graphNode = node.graphNodes[nodeId]
    return graphNode ? [graphNode] : []
  })
  const styles = [
    ...new Set(
      dependencyEdges.flatMap((edge) => {
        const style = resolveStyle(node, edge)
        return style ? [style.id] : []
      }),
    ),
  ]
    .sort()
    .flatMap((styleId) => {
      const style =
        node.stylePresets[styleId] ??
        DEFAULT_ROAD_STYLE_PRESETS[styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS]
      return style ? [style] : []
    })
  return JSON.stringify({
    dependencyEdges,
    dependencyNodes,
    path,
    styles,
  })
}

/**
 * Rebuild only render paths whose own edges, corner nodes, endpoint neighbors,
 * or resolved styles changed. Unaffected profiles retain object identity so
 * React/Three can reuse their cooked buffers across localized edits.
 */
export function buildRoadTransitionProfilesIncremental(
  node: RoadNetworkNode,
  cache: RoadTransitionProfileCache,
): RoadTransitionProfile[] {
  const paths = buildRoadRenderPaths(
    node,
    (left, right) => !left.sectionLayout && !right.sectionLayout && resolveStyle(node, left)?.id === resolveStyle(node, right)?.id,
  )
  const nextEntries = new Map<string, RoadTransitionProfileCacheEntry>()
  const profiles: RoadTransitionProfile[] = []
  let rebuiltProfiles = 0
  let reusedProfiles = 0
  for (const path of paths) {
    const key = path.edgeIds.join(':')
    const signature = transitionPathSignature(node, path)
    const previous = cache.entries.get(key)
    const profile =
      previous?.signature === signature ? previous.profile : profileForPath(node, path)
    if (previous?.signature === signature) reusedProfiles += 1
    else rebuiltProfiles += 1
    nextEntries.set(key, { profile, signature })
    if (profile) profiles.push(profile)
  }
  cache.entries = nextEntries
  cache.stats = { rebuiltProfiles, reusedProfiles, totalProfiles: paths.length }
  return profiles
}

function interpolateBounds(
  first: RoadTransitionComponentBounds,
  second: RoadTransitionComponentBounds,
  t: number,
): RoadTransitionComponentBounds {
  return {
    innerOffset: first.innerOffset + (second.innerOffset - first.innerOffset) * t,
    outerOffset: first.outerOffset + (second.outerOffset - first.outerOffset) * t,
    width: first.width + (second.width - first.width) * t,
  }
}

function interpolateSample(
  first: RoadTransitionSample,
  second: RoadTransitionSample,
  distance: number,
  t: number,
): RoadTransitionSample {
  return {
    carriagewayHalfWidth:
      first.carriagewayHalfWidth + (second.carriagewayHalfWidth - first.carriagewayHalfWidth) * t,
    components: Object.fromEntries(
      (['left', 'right'] as const).map((side) => [
        side,
        Object.fromEntries(
          ROAD_SIDE_COMPONENT_SPECS.map((spec) => [
            spec.kind,
            interpolateBounds(
              first.components[side][spec.kind],
              second.components[side][spec.kind],
              t,
            ),
          ]),
        ),
      ]),
    ) as RoadTransitionSample['components'],
    distance,
    laneBoundaryOffsets: first.laneBoundaryOffsets.map(
      (offset, index) => offset + (second.laneBoundaryOffsets[index]! - offset) * t,
    ),
    medianWidth: first.medianWidth + (second.medianWidth - first.medianWidth) * t,
    point: interpolatePoint(first.point, second.point, t),
    surfaceThickness:
      first.surfaceThickness + (second.surfaceThickness - first.surfaceThickness) * t,
  }
}

function profileSampleAtDistance(
  samples: RoadTransitionSample[],
  distance: number,
): RoadTransitionSample {
  const total = samples.at(-1)?.distance ?? 0
  const target = Math.max(0, Math.min(total, distance))
  for (let index = 0; index < samples.length - 1; index++) {
    const first = samples[index]!
    const second = samples[index + 1]!
    if (target > second.distance + EPSILON) continue
    const span = Math.max(EPSILON, second.distance - first.distance)
    return interpolateSample(first, second, target, (target - first.distance) / span)
  }
  return { ...samples.at(-1)!, distance: target }
}

/** Trim a profile without losing its interpolated offsets at the cut planes. */
export function trimRoadTransitionProfile(
  profile: RoadTransitionProfile,
  startDistance: number,
  endDistance: number,
): RoadTransitionProfile {
  const total = profile.samples.at(-1)?.distance ?? 0
  const start = Math.max(0, Math.min(total, startDistance))
  const end = Math.max(start, total - Math.max(0, endDistance))
  const selectedDistances = [
    start,
    ...profile.samples
      .map((sample) => sample.distance)
      .filter((distance) => distance > start + EPSILON && distance < end - EPSILON),
    end,
  ]
  const samples = selectedDistances.map((distance) => ({
    ...profileSampleAtDistance(profile.samples, distance),
    distance: distance - start,
  }))
  return { ...profile, samples }
}
