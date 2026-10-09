'use client'

import {buildMappedSurfaceMesh,mappedSurfaceColor} from "./road-mapped-surface-plan";
import {maskMappedComponentsForProfile} from "./road-mapped-band-mask";
export {maskMappedComponentsForProfile} from "./road-mapped-band-mask";
import type {compileStreetPlacementPlan} from './street-placement-plan'
import type { LaneMovementGraph } from './domain/lane-movement'
import {createCachedStreetCompiler} from './street-compiler'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import {
  buildJunctionBoundaryGeometry,
  buildJunctionBoundarySidewalkGeometry,
  buildRoadRibbonGeometry,
  sampleRoadEdgePoints,
  type JunctionBoundaryGeometryData,
} from './road-network-geometry'
import { buildRoadJunctionSeams, mergeCollidingJunctionSurfaces, roadJunctionMouth, triangulateRoadBoundary, trimRoadProfileAtJunctions } from './road-junction-seams'
import { ROAD_SURFACE_MATERIALS, roadSurfaceUvs, type RoadSurfaceMaterialKind } from './road-surface-material'
import { roadSurfaceTexture } from './road-surface-textures'
import { roadCurbCornerKey } from './road-network-corner-editing'
import {
  buildRoadNetworkMarkings,
  type RoadMarkingPolygon,
} from './road-network-markings'
import {
  buildRoadCrossSection,
  buildRoadJunctionBands,
  roadCarriagewayWidth,
  ROAD_SIDE_COMPONENT_SPECS,
  type RoadJunctionBand,
} from './road-cross-section'
import {
  buildRoadTransitionProfilesIncremental,
  createRoadTransitionProfileCache,
  trimRoadTransitionProfile,
  type RoadTransitionSample,
  type RoadTransitionProfile,
} from './road-transition-profile'
import {
  RoadSignNode,
  StreetLightNode,
  type RoadGraphEdge,
  type RoadNetworkNode,
  type RoadStylePreset,
} from './schema'
import { buildRoadVariableRibbonGeometry, buildRoadPavementShell } from './road-pavement-geometry'
import { DEFAULT_ROAD_STYLE_PRESETS } from './road-style-presets'
import type { RoadElementSelection } from './store'
import { roadValidationIssuePoint, validateRoadGraph } from './road-network-validation'
import { buildRoadsideDecorationPreviews } from './roadside-decoration-rules'
import {
  buildManualRoadJunctionBand,
  buildManualRoadJunctionBoundary,
} from './road-junction-boundary-editor'
import { RoadNetworkBridgeStructures } from './road-network-bridge-model'
import { RoadNetworkEarthworks } from './road-network-earthworks-model'
import type { TerrainField } from './terrain-field-compat'
import { StreetLightModel } from './street-light-model'
import { RoadSignModel } from './road-sign-model'
import {
  buildRoadsideComponentSurfacePolygons,
  type RoadsideSurfacePolygon,
} from './roadside-openings'

const NO_RAYCAST = () => undefined
const ROADSIDE_STREET_LIGHT = StreetLightNode.parse({ lightOn: false })
const ROADSIDE_ROAD_SIGN = RoadSignNode.parse({ signId: 'stop' })
let pageIsUnloading = false
type RoadGeometryLifecycle = {
  disposeImmediately: () => void
  pendingDisposal?: ReturnType<typeof setTimeout>
  retained: boolean
}
const roadGeometryLifecycles = new WeakMap<BufferGeometry, RoadGeometryLifecycle>()

if (typeof window !== 'undefined') {
  const markPageAsUnloading = () => {
    pageIsUnloading = true
  }
  window.addEventListener('beforeunload', markPageAsUnloading, { once: true })
  window.addEventListener('pagehide', markPageAsUnloading, { once: true })
}

/**
 * WebGPU may still have the previous frame queued when React detaches a road
 * surface. Retire its buffer shortly afterwards instead of letting R3F dispose
 * it synchronously during unmount. The regular `geometry` mesh prop preserves
 * the renderer's existing buffer-binding path while only changing retirement.
 */
export function createRoadGeometry() {
  const geometry = new BufferGeometry()
  const lifecycle: RoadGeometryLifecycle = {
    disposeImmediately: geometry.dispose.bind(geometry),
    retained: false,
  }
  roadGeometryLifecycles.set(geometry, lifecycle)
  geometry.dispose = () => {
    // The browser releases the whole WebGPU device during navigation. Calling
    // dispose while its final command buffer is still being submitted is both
    // unnecessary and produces a validation-error cascade on refresh.
    if (pageIsUnloading || lifecycle.retained) return
    if (lifecycle.pendingDisposal !== undefined) clearTimeout(lifecycle.pendingDisposal)
    lifecycle.pendingDisposal = setTimeout(() => {
      lifecycle.pendingDisposal = undefined
      if (lifecycle.retained || pageIsUnloading) return
      lifecycle.disposeImmediately()
    }, 500)
  }
  return geometry
}

export function setRoadGeometryRetained(geometry: BufferGeometry, retained: boolean) {
  const lifecycle = roadGeometryLifecycles.get(geometry)
  if (!lifecycle) return
  lifecycle.retained = retained
  if (retained && lifecycle.pendingDisposal !== undefined) {
    clearTimeout(lifecycle.pendingDisposal)
    lifecycle.pendingDisposal = undefined
  }
}

function useRoadGeometryLifecycle(geometry: BufferGeometry) {
  useLayoutEffect(() => {
    setRoadGeometryRetained(geometry, true)
    return () => setRoadGeometryRetained(geometry, false)
  }, [geometry])
}

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


function junctionApproachIndicatorPoints(
  node: RoadNetworkNode,
  edge: RoadGraphEdge,
  nodeId: string,
  length = 3,
): Array<[number, number, number]> {
  const sampled = sampleRoadEdgePoints(node, edge, 48)
  const points = edge.startNodeId === nodeId ? sampled : [...sampled].reverse()
  if (points.length < 2) return []
  const result: Array<[number, number, number]> = [[...points[0]!] as [number, number, number]]
  let remaining = length
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!
    const point = points[index]!
    const segmentLength = Math.hypot(point[0] - previous[0], point[2] - previous[2])
    if (segmentLength <= remaining) {
      result.push([...point] as [number, number, number])
      remaining -= segmentLength
      continue
    }
    const ratio = remaining / Math.max(segmentLength, 1e-6)
    result.push([
      previous[0] + (point[0] - previous[0]) * ratio,
      previous[1] + (point[1] - previous[1]) * ratio,
      previous[2] + (point[2] - previous[2]) * ratio,
    ])
    break
  }
  return result
}

/**
 * Road ribbons are infinitely thin top surfaces. Let them receive scene
 * shadows, but never add them to the shadow map: a ribbon casting onto its
 * own adjacent triangles creates the thin diagonal streaks seen on curves.
 */
export function roadRibbonShadowPolicy(ghost: boolean) {
  return {
    castShadow: false,
    receiveShadow: !ghost,
  } as const
}

export function RoadSegmentSurface({
  color,
  end,
  ghost = false,
  start,
  style,
}: {
  color?: string
  end: readonly [number, number, number]
  ghost?: boolean
  start: readonly [number, number, number]
  style: RoadStylePreset
}) {
  return (
    <RoadPathSurface
      color={color}
      ghost={ghost}
      points={[start, end]}
      style={style}
    />
  )
}

function RoadPathSurface({
  color,
  ghost = false,
  points,
  style,
}: {
  color?: string
  ghost?: boolean
  points: ReadonlyArray<readonly [number, number, number]>
  style: RoadStylePreset
}) {
  const crossSection = buildRoadCrossSection(style)
  return (
    <>
      <RoadRibbonSurface color={color} ghost={ghost} points={points} style={style} />
      {(['left', 'right'] as const).flatMap((side) =>
        crossSection.sides[side].components.map((component) => (
          <RoadRibbonSurface
            color={component.color}
            elevationOffset={component.elevationOffset}
            ghost={ghost}
            key={`${side}:${component.kind}`}
            lateralOffset={component.lateralOffset}
            name={`road-side-${side}-${component.kind}-preview`}
            nonInteractive
            points={points}
            style={style}
            width={component.width}
          />
        )),
      )}
    </>
  )
}

export function RoadDraftPreviewSurface({
  color,
  points,
  style,
}: {
  color?: string
  points: ReadonlyArray<readonly [number, number, number]>
  style: RoadStylePreset
}) {
  return (
    <RoadPathSurface
      color={color}
      ghost
      points={points}
      style={style}
    />
  )
}

/** Build one continuous top surface so sampled curves have no box-to-box gaps. */
export function RoadRibbonSurface({
  ghost = false,
  color,
  elevationOffset = 0,
  lateralOffset = 0,
  name,
  nonInteractive = false,
  onPointerDown,
  opacity,
  points,
  style,
  width,
}: {
  color?: string
  elevationOffset?: number
  ghost?: boolean
  lateralOffset?: number
  name?: string
  nonInteractive?: boolean
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
  opacity?: number
  points: ReadonlyArray<readonly [number, number, number]>
  style: RoadStylePreset
  width?: number
}) {
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    const mesh = buildRoadRibbonGeometry(points, {
      elevationOffset,
      lateralOffset,
      surfaceThickness: style.surfaceThickness,
      width: width ?? roadCarriagewayWidth(style),
    })
    if (mesh.positions.length === 0) return result
    result.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3))
    result.setIndex(mesh.indices)
    result.setAttribute('uv', new Float32BufferAttribute(roadSurfaceUvs(mesh.positions), 2))
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [elevationOffset, lateralOffset, points, style, width])
  useRoadGeometryLifecycle(geometry)
  if (points.length < 2) return null
  const shadowPolicy = roadRibbonShadowPolicy(ghost)
  const resolvedOpacity = opacity ?? (ghost ? 0.48 : 1)
  return (
    <mesh
      castShadow={shadowPolicy.castShadow}
      geometry={geometry}
      name={name ?? (ghost ? 'road-segment-preview' : 'road-segment-surface')}
      onPointerDown={onPointerDown}
      raycast={ghost || nonInteractive ? NO_RAYCAST : undefined}
      receiveShadow={shadowPolicy.receiveShadow}
    >
      <meshStandardMaterial
        color={color ?? style.surfaceColor}
        depthWrite={!ghost && resolvedOpacity >= 1}
        metalness={0.02}
        opacity={resolvedOpacity}
        polygonOffset
        polygonOffsetFactor={-1}
        map={roadSurfaceTexture(style.surfaceMaterial)}
        roughness={style.surfaceMaterial ? ROAD_SURFACE_MATERIALS[style.surfaceMaterial].roughness : 0.94}
        side={DoubleSide}
        transparent={ghost || resolvedOpacity < 1}
      />
    </mesh>
  )
}

/** Pavement has depth below the finished surface, without a duplicate top face. */
type RoadPavementShellProps = (
  | { top: BufferGeometry; data?: never }
  | { top?: never; data: { positions: number[]; indices: number[] } }
) & { thickness: number | number[]; color?: string }

function RoadPavementShell({ top, data, thickness, color = '#303338' }: RoadPavementShellProps) {
  const geometry = useMemo(() => {
    const source = data ?? {
      positions: Array.from(top!.getAttribute('position').array),
      indices: Array.from(top!.getIndex()!.array),
    }
    const shell = buildRoadPavementShell(source, thickness)
    const result = createRoadGeometry()
    result.setAttribute('position', new Float32BufferAttribute(shell.positions, 3))
    result.setIndex(shell.indices)
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [top, data, thickness])
  useRoadGeometryLifecycle(geometry)
  return (
    <mesh name="road-pavement-body" geometry={geometry} raycast={NO_RAYCAST} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.94} />
    </mesh>
  )
}

type RoadVariableRibbonSample = Pick<RoadTransitionSample, 'point' | 'surfaceThickness'> & {
  leftOffset: number
  rightOffset: number
}

/** Render a ribbon whose left and right offsets can change along its centerline. */
function RoadVariableRibbonSurface({
  color,
  elevationOffset = 0,
  ghost = false,
  name,
  nonInteractive = false,
  samples,
  pavement = false,
  solidDepth,
  surfaceMaterial,
}: {
  pavement?: boolean
  solidDepth?: number
  surfaceMaterial?: RoadSurfaceMaterialKind
  color: string
  elevationOffset?: number
  ghost?: boolean
  name: string
  nonInteractive?: boolean
  samples: RoadVariableRibbonSample[]
}) {
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    if (samples.length < 2) return result
    const { positions, indices } = buildRoadVariableRibbonGeometry(samples, elevationOffset)
    result.setAttribute('position', new Float32BufferAttribute(positions, 3))
    result.setIndex(indices)
    result.setAttribute('uv', new Float32BufferAttribute(roadSurfaceUvs(positions), 2))
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [elevationOffset, samples])
  const pavementDepths = useMemo(
    () => samples.flatMap((sample) => [sample.surfaceThickness, sample.surfaceThickness]),
    [samples],
  )
  useRoadGeometryLifecycle(geometry)
  if (samples.length < 2) return null
  const shadowPolicy = roadRibbonShadowPolicy(ghost)
  return (
    <>
      <mesh
        castShadow={shadowPolicy.castShadow}
        geometry={geometry}
        name={name}
        raycast={ghost || nonInteractive ? NO_RAYCAST : undefined}
        receiveShadow={shadowPolicy.receiveShadow}
      >
        <meshStandardMaterial
          color={color}
          depthWrite={!ghost}
          metalness={0.02}
          opacity={ghost ? 0.48 : 1}
          polygonOffset
          polygonOffsetFactor={-1}
          map={roadSurfaceTexture(surfaceMaterial)}
          roughness={surfaceMaterial ? ROAD_SURFACE_MATERIALS[surfaceMaterial].roughness : 0.94}
          side={DoubleSide}
          transparent={ghost}
        />
      </mesh>
      {!ghost && (pavement || solidDepth) ? (
        <RoadPavementShell
          top={geometry}
          thickness={solidDepth ?? pavementDepths}
          color={solidDepth ? color : undefined}
        />
      ) : null}
    </>
  )
}

function RoadPolygonSurface({
  color,
  ghost = false,
  name,
  polygon,
  solidDepth,
}: {
  solidDepth?: number
  color: string
  ghost?: boolean
  name: string
  polygon: RoadsideSurfacePolygon
}) {
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    if (polygon.points.length < 3) return result
    const positions = polygon.points.flatMap((point) => point)
    const triangles = ShapeUtils.triangulateShape(
      polygon.points.map((point) => new Vector2(point[0], point[2])),
      [],
    )
    result.setAttribute('position', new Float32BufferAttribute(positions, 3))
    result.setIndex(triangles.flatMap((triangle) => triangle))
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [polygon])
  useRoadGeometryLifecycle(geometry)
  if (polygon.points.length < 3) return null
  const shadowPolicy = roadRibbonShadowPolicy(ghost)
  return (
    <>
      <mesh
        castShadow={shadowPolicy.castShadow}
        geometry={geometry}
        name={name}
        raycast={NO_RAYCAST}
        receiveShadow={shadowPolicy.receiveShadow}
      >
        <meshStandardMaterial
          color={color}
          depthWrite={!ghost}
          metalness={0.02}
          opacity={ghost ? 0.48 : 1}
          polygonOffset
          polygonOffsetFactor={-1}
          roughness={0.94}
          side={DoubleSide}
          transparent={ghost}
        />
      </mesh>
      {!ghost && solidDepth ? (
        <RoadPavementShell top={geometry} thickness={solidDepth} color={color} />
      ) : null}
    </>
  )
}

type MappedSurface = {
  id: number
  kind: 'road-area' | 'sidewalk' | 'cycleway' | 'pedestrian-area' | 'kerb' | 'crossing'
  partIndex?: number
  sourceType?: 'way' | 'relation'
  widthMeters?: number
  tags: Record<string, string>
  points: Array<readonly [number, number, number]>
  holes?: Array<Array<readonly [number, number, number]>>
}

function RoadMappedCrossing({ crossing, ghost = false, roadWidth = 7 }: { crossing: { id: number; kind?: 'crossing' | 'kerb'; point: readonly [number, number, number]; rotationY?: number; tags: Record<string, string> }; ghost?: boolean; roadWidth?: number }) {
  const lowered = crossing.tags.kerb === 'lowered' || crossing.tags.kerb === 'flush' || crossing.tags.kerb === 'no'
  const kerbOnly = crossing.kind === 'kerb'
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    const width = kerbOnly ? 1.2 : 2.4
    const sidewalkY = lowered ? 0.06 : 0.105
    const roadY = 0.018
    const rows = kerbOnly
      ? [[-0.225, sidewalkY], [0, roadY], [0.225, sidewalkY]]
      : [
          [-(roadWidth / 2 + 0.8), sidewalkY],
          [-roadWidth / 2, roadY],
          [roadWidth / 2, roadY],
          [roadWidth / 2 + 0.8, sidewalkY],
        ]
    const positions = rows.flatMap(([z, y]) => [-width / 2, y!, z!, width / 2, y!, z!])
    const indices = rows.slice(1).flatMap((_, index) => {
      const base = index * 2
      return [base, base + 2, base + 1, base + 2, base + 3, base + 1]
    })
    result.setAttribute('position', new Float32BufferAttribute(positions, 3))
    result.setIndex(indices)
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [kerbOnly, lowered, roadWidth])
  useRoadGeometryLifecycle(geometry)
  return (
    <group position={crossing.point} rotation={[0, crossing.rotationY ?? 0, 0]}>
      <mesh geometry={geometry} name={`road-mapped-${kerbOnly ? 'kerb-ramp' : 'crossing-ramp'}:${crossing.id}`} raycast={NO_RAYCAST} receiveShadow>
        <meshStandardMaterial color={lowered ? '#d6d0b5' : '#aaa79f'} depthWrite={!ghost} opacity={ghost ? 0.48 : 1} roughness={0.9} transparent={ghost} />
      </mesh>
      {!ghost ? <RoadPavementShell top={geometry} thickness={0.1} color={lowered ? '#aaa58f' : '#898780'} /> : null}
      {!ghost && !kerbOnly && crossing.tags.tactile_paving === 'yes' ? [-1, 1].map((side) => (
        <mesh key={side} name={`road-mapped-tactile-pad:${crossing.id}`} position={[0, 0.11, side * (roadWidth / 2 + 0.38)]} raycast={NO_RAYCAST} receiveShadow>
          <boxGeometry args={[2.1, 0.025, 0.45]} />
          <meshStandardMaterial color="#d4b94f" roughness={0.95} />
        </mesh>
      )) : null}
    </group>
  )
}

function RoadMappedSurface({ surface, mesh:compiledMesh, ghost = false }: { surface: MappedSurface; mesh?:ReturnType<typeof buildMappedSurfaceMesh>; ghost?: boolean }) {
  const geometry=useMemo(()=>{const result=createRoadGeometry(),mesh=compiledMesh ?? buildMappedSurfaceMesh(surface);result.setAttribute('position',new Float32BufferAttribute(mesh.positions,3));result.setIndex(mesh.indices);if(mesh.positions.length){result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere()}return result},[surface,compiledMesh])
  useRoadGeometryLifecycle(geometry)
  if ((geometry.getAttribute('position')?.count ?? 0) === 0) return null
  const color = mappedSurfaceColor(surface.kind)
  const solidDepth = surface.kind === 'kerb' ? 0.15 : surface.kind === 'road-area' ? 0.08 : 0.1
  return (
    <>
      <mesh geometry={geometry} name={`road-mapped-${surface.kind}:${surface.id}${surface.partIndex ? `:${surface.partIndex}` : ''}`} raycast={NO_RAYCAST} receiveShadow>
        <meshStandardMaterial color={color} depthWrite={!ghost} opacity={ghost ? 0.48 : 1} polygonOffset polygonOffsetFactor={-2} roughness={0.92} side={DoubleSide} transparent={ghost} />
      </mesh>
      {!ghost ? <RoadPavementShell top={geometry} thickness={solidDepth} color={color} /> : null}
    </>
  )
}

function RoadJunctionSurface({
  color,
  center,
  ghost,
  name,
  nonInteractive,
  onPointerDown,
  solution,
  surfaceY,
  surfaceMaterial,
}: {
  color: string
  center: readonly [number, number, number]
  ghost: boolean
  name: string
  nonInteractive: boolean
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
  solution: JunctionBoundaryGeometryData
  surfaceY: number
  surfaceMaterial?: RoadSurfaceMaterialKind
}) {
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    result.setAttribute('position', new Float32BufferAttribute(solution.positions, 3))
    result.setIndex(solution.indices)
    result.setAttribute('uv', new Float32BufferAttribute(roadSurfaceUvs(solution.positions, center), 2))
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [solution, center])
  useRoadGeometryLifecycle(geometry)
  if ((geometry.getAttribute('position')?.count ?? 0) === 0) return null
  return (
    <mesh
      castShadow={false}
      geometry={geometry}
      name={name}
      onPointerDown={onPointerDown}
      position={[center[0], center[1] + surfaceY, center[2]]}
      raycast={ghost || nonInteractive ? NO_RAYCAST : undefined}
      receiveShadow={!ghost}
    >
      <meshStandardMaterial
        color={color}
        depthWrite={!ghost}
        opacity={ghost ? 0.48 : 1}
        polygonOffset
        polygonOffsetFactor={-2}
        map={roadSurfaceTexture(surfaceMaterial)}
        roughness={surfaceMaterial ? ROAD_SURFACE_MATERIALS[surfaceMaterial].roughness : 0.94}
        side={DoubleSide}
        transparent={ghost}
      />
    </mesh>
  )
}

function RoadJunctionSideBand({
  band,
  center,
  manualBoundary,
  solution,
  surfaceY,
  seamSurface,
}: {
  seamSurface?: { positions: number[]; indices: number[] }
  band: RoadJunctionBand
  center: readonly [number, number, number]
  manualBoundary?: ReadonlyArray<readonly [number, number]>
  solution: JunctionBoundaryGeometryData
  surfaceY: number
}) {
  const surface = useMemo(
    () =>
      seamSurface ??
      (manualBoundary
        ? buildManualRoadJunctionBand(manualBoundary, band.width, band.outerWidth - band.width)
        : buildJunctionBoundarySidewalkGeometry(
            solution,
            band.width,
            band.outerWidth - band.width,
          )),
    [band.outerWidth, band.width, manualBoundary, solution, seamSurface],
  )
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    result.setAttribute('position', new Float32BufferAttribute(surface.positions, 3))
    result.setIndex(surface.indices)
    result.computeVertexNormals()
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [surface])
  useRoadGeometryLifecycle(geometry)
  if ((geometry.getAttribute('position')?.count ?? 0) === 0) return null
  return (
    <group position={[center[0], center[1] + surfaceY, center[2]]}>
      <mesh
        geometry={geometry}
        name={`road-junction-${band.kind}`}
        raycast={NO_RAYCAST}
        receiveShadow
      >
        <meshStandardMaterial
          color={band.color}
          polygonOffset
          polygonOffsetFactor={-3}
          roughness={0.94}
          side={DoubleSide}
        />
      </mesh>
      {band.kind === 'curb' || band.kind === 'sidewalk' ? (
        <RoadPavementShell top={geometry} thickness={surfaceY} color={band.color} />
      ) : null}
    </group>
  )
}

function RoadMarkingSurface({
  color,
  name,
  polygons,
}: {
  color: string
  name: string
  polygons: RoadMarkingPolygon[]
}) {
  const geometry = useMemo(() => {
    const result = createRoadGeometry()
    const positions: number[] = []
    const indices: number[] = []
    for (const polygon of polygons) {
      if (polygon.points.length < 3) continue
      const base = positions.length / 3
      for (const point of polygon.points) positions.push(point[0], point[1], point[2])
      for (let index = 1; index < polygon.points.length - 1; index++) {
        indices.push(base, base + index, base + index + 1)
      }
    }
    result.setAttribute('position', new Float32BufferAttribute(positions, 3))
    result.setIndex(indices)
    result.computeBoundingBox()
    result.computeBoundingSphere()
    return result
  }, [polygons])
  useRoadGeometryLifecycle(geometry)
  if ((geometry.getAttribute('position')?.count ?? 0) === 0) return null
  return (
    <mesh geometry={geometry} name={name} raycast={NO_RAYCAST}>
      <meshBasicMaterial
        color={color}
        polygonOffset
        polygonOffsetFactor={-4}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** The procedural road surface. Splines are represented as sampled alignment legs. */
export function RoadNetworkModel({
	clearancePeers = [],
  elementSelection,
  placementPlan, proposalPreviewVisible=true,
  ghost = false,
  nonInteractive = false,
  node,
  onSelectElement,
	onSelectRoadsideDecoration,
	terrain = null,
 laneMovements,
}: {
	clearancePeers?: RoadNetworkNode[]
  elementSelection?: RoadElementSelection | null
  placementPlan?:ReturnType<typeof compileStreetPlacementPlan>
  proposalPreviewVisible?:boolean
  ghost?: boolean
  nonInteractive?: boolean
  node: RoadNetworkNode
  onSelectElement?: (
    selection: Omit<RoadElementSelection, 'networkId'>,
    event: ThreeEvent<PointerEvent>,
  ) => void
	onSelectRoadsideDecoration?: (
		id: string,
		event: ThreeEvent<PointerEvent>,
	) => void
	terrain?: TerrainField | null
 laneMovements?:LaneMovementGraph
}) {
  const compiler=useRef(createCachedStreetCompiler())
  const compiled=useMemo(()=>compiler.current.compile(node,terrain,laneMovements),[node,terrain,laneMovements])
  const edgeSurfaces=compiled.layout.edgeSurfaces
  const renderedJunctionSurfaces=compiled.layout.renderedJunctionSurfaces

  const validationMarkers = useMemo(
    () =>
      validateRoadGraph(node, node.maxRoadGrade, clearancePeers).flatMap((issue, index) => {
        const point = roadValidationIssuePoint(node, issue)
        return point ? [{ index, issue, point }] : []
      }),
    [clearancePeers, node],
  )
  const markingGroups = useMemo(() => {
    const groups = new Map<string, RoadMarkingPolygon[]>()
    for (const marking of compiled.markings) {
      const key = `${marking.kind}:${marking.color}`
      groups.set(key, [...(groups.get(key) ?? []), marking])
    }
    return [...groups.entries()].map(([key, polygons]) => ({
      color: polygons[0]!.color,
      key,
      kind: polygons[0]!.kind,
      polygons,
    }))
  }, [compiled.markings])
  const roadsideDecorationPreviews = useMemo(
    () => proposalPreviewVisible && (node.showRoadsideDecorations
      || node.roadsideItemVisibility?.lamp === true
      || node.roadsideItemVisibility?.sign === true)
      ? (placementPlan ? placementPlan.proposals.map(item=>({...item,id:item.localId})) : compiled.placements).filter((decoration) =>
          node.showRoadsideDecorations
            ? node.roadsideItemVisibility?.[decoration.kind] !== false
            : node.roadsideItemVisibility?.[decoration.kind] === true,
        )
      : [],
    [node,compiled.placements,placementPlan,proposalPreviewVisible],
  )

  return (
    <group name="road-network-model">
		{!ghost ? roadsideDecorationPreviews.map((decoration) => (
			<group
				key={decoration.id}
				name={`roadside-${decoration.kind}:${decoration.id}`}
					position={decoration.position}
					rotation={[0, decoration.rotationY, 0]}
					onPointerDown={onSelectRoadsideDecoration
					? (event) => {
							event.stopPropagation()
							onSelectRoadsideDecoration(decoration.id, event)
						}
					: undefined}
				>
				{decoration.kind === 'lamp' ? (
					<StreetLightModel node={ROADSIDE_STREET_LIGHT} />
				) : (
					<RoadSignModel node={ROADSIDE_ROAD_SIGN} />
				)}
			</group>
		)) : null}
      {!ghost ? <RoadNetworkBridgeStructures node={node} compiledSpans={compiled.bridgeSpans} /> : null}
		{!ghost ? <RoadNetworkEarthworks node={node} terrain={terrain} compiledStrips={compiled.earthworkStrips} /> : null}
      {compiled.sectionSurfaces.map((surface, index) => <RoadPolygonSurface key={`section:${surface.edgeId}:${surface.physicalId}:${index}`} color={surface.color} ghost={ghost} name={`road-section-${surface.kind}`} polygon={{points:surface.points}} />)}
      {edgeSurfaces.map(({ decorativeProfile, profile }) => {
        if (profile.edgeIds.some(id => compiled.sectionSurfaces.some(surface => surface.edgeId === id))) return null;
        return (
        <group key={profile.key}>
          <RoadVariableRibbonSurface
            pavement
            surfaceMaterial={profile.style.surfaceMaterial}
            color={profile.style.surfaceColor}
            ghost={ghost}
            name={ghost ? 'road-segment-preview' : 'road-segment-surface'}
            nonInteractive={nonInteractive}
            samples={profile.samples.map((sample) => ({
              ...sample,
              leftOffset: sample.carriagewayHalfWidth,
              rightOffset: -sample.carriagewayHalfWidth,
            }))}
          />
          {(['left', 'right'] as const).flatMap((side) =>
            ROAD_SIDE_COMPONENT_SPECS.map((spec) => {
              if (!decorativeProfile.samples.some(
                (sample) => sample.components[side][spec.kind].width > 1e-4,
              )) return null
              const shapedPolygons = buildRoadsideComponentSurfacePolygons(
                node,
                decorativeProfile,
                side,
                spec.kind,
                spec.elevationOffset,
              )
              return shapedPolygons
                ? shapedPolygons.map((polygon, polygonIndex) => (
                    <RoadPolygonSurface
                      color={spec.color}
                      ghost={ghost}
                      key={`${side}:${spec.kind}:shape:${polygonIndex}`}
                      name={`road-side-${side}-${spec.kind}`}
                      polygon={polygon}
                      solidDepth={spec.kind === 'curb' || spec.kind === 'sidewalk' ? spec.elevationOffset : undefined}
                    />
                  ))
                : [(
                  <RoadVariableRibbonSurface
                    color={spec.color}
                    elevationOffset={spec.elevationOffset}
                    solidDepth={spec.kind === 'curb' || spec.kind === 'sidewalk' ? spec.elevationOffset : undefined}
                    ghost={ghost}
                    key={`${side}:${spec.kind}:full`}
                    name={`road-side-${side}-${spec.kind}`}
                    nonInteractive
                    samples={decorativeProfile.samples.map((sample) => {
                      const bounds = sample.components[side][spec.kind]
                      return {
                        ...sample,
                        leftOffset: side === 'left' ? bounds.outerOffset : -bounds.innerOffset,
                        rightOffset: side === 'left' ? bounds.innerOffset : -bounds.outerOffset,
                      }
                    })}
                  />
                )]
            }),
          )}
          {!ghost && decorativeProfile.samples.some((sample) => sample.medianWidth > 1e-4) ? (
            <RoadVariableRibbonSurface
              color="#777d70"
              elevationOffset={0.07}
              name="road-median"
              nonInteractive
              samples={decorativeProfile.samples.map((sample) => ({
                ...sample,
                leftOffset: sample.medianWidth * 0.36,
                rightOffset: -sample.medianWidth * 0.36,
              }))}
            />
          ) : null}
        </group>
        )
      })}
      {!ghost
        ? markingGroups.map((group) => (
            <RoadMarkingSurface
              color={group.color}
              key={group.key}
              name={`road-marking-${group.kind}`}
              polygons={group.polygons}
            />
          ))
        : null}
      {!ghost && proposalPreviewVisible ? compiled.junctionMovementPlan.signalProposals.map(proposal=>(
       <group key={proposal.id} position={[...proposal.position]} name="pending-junction-signal-proposal">
        <mesh position={[0,1.4,0]} raycast={()=>null}><cylinderGeometry args={[0.06,0.06,2.8,6]}/><meshBasicMaterial color="#a78bfa" transparent opacity={0.6}/></mesh>
        <mesh position={[0,2.5,0]} raycast={()=>null}><boxGeometry args={[0.3,0.7,0.2]}/><meshBasicMaterial color="#a78bfa" transparent opacity={0.6}/></mesh>
       </group>
      )) : null}
      {!ghost ? node.osmMappedSurfaces.map((surface,index) => (
        <RoadMappedSurface key={`osm-surface:${surface.kind}:${surface.id}:${surface.partIndex ?? 0}`} surface={surface} mesh={compiled.mappedSurfaces[index]!.mesh} />
      )) : null}
      {!ghost ? node.osmCrossings.map((crossing) => (
        <RoadMappedCrossing
          key={`osm-crossing:${crossing.id}`}
          crossing={crossing}
          roadWidth={crossing.associatedEdgeId && node.edges[crossing.associatedEdgeId]
            ? roadCarriagewayWidth(resolveStyle(node, node.edges[crossing.associatedEdgeId]!) ?? DEFAULT_ROAD_STYLE_PRESETS['local-street'])
            : undefined}
        />
      )) : null}
      {!ghost && !nonInteractive && onSelectElement
        ? Object.values(node.edges).map((edge) => {
            const style = resolveStyle(node, edge)
            if (!style) return null
            const selected =
              elementSelection?.kind === 'edge' && elementSelection.id === edge.id
            return (
              <RoadRibbonSurface
                color="#38bdf8"
                elevationOffset={0.025}
                key={`edge-hit:${edge.id}`}
                name={`road-edge-hit:${edge.id}`}
                onPointerDown={(event) =>
                  onSelectElement({ kind: 'edge', id: edge.id }, event)
                }
                opacity={selected ? 0.3 : 0}
                points={sampleRoadEdgePoints(node, edge)}
                style={style}
                width={roadCarriagewayWidth(style) + 0.16}
              />
            )
          })
        : null}
      {!ghost
        ? validationMarkers.map(({ index, issue, point }) => (
            <group
              key={`validation:${issue.code}:${issue.nodeId ?? issue.edgeId ?? index}`}
              name={`road-validation-${issue.severity}:${issue.code}`}
              position={[point[0], point[1] + 0.55, point[2]]}
            >
              <mesh raycast={NO_RAYCAST} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.25, 0.065, 8, 24]} />
                <meshBasicMaterial
                  color={issue.severity === 'error' ? '#ef4444' : '#f59e0b'}
                  depthTest={false}
                />
              </mesh>
              <mesh position={[0, 0.02, 0]} raycast={NO_RAYCAST}>
                <sphereGeometry args={[0.075, 12, 8]} />
                <meshBasicMaterial color="#ffffff" depthTest={false} />
              </mesh>
            </group>
          ))
        : null}
      {renderedJunctionSurfaces.map(({ graphNode, junction, manualBoundary, radius, sideBands, solution, style, treatment, bandSurfaces }) => (
        <group key={graphNode.id}>
          <RoadJunctionSurface
            center={graphNode.position}
            color={
              elementSelection?.kind === 'junction' && elementSelection.id === graphNode.id
                ? '#38bdf8'
                : style.surfaceColor
            }
            ghost={ghost}
            name="road-junction-surface"
            onPointerDown={
              onSelectElement
                ? (event) => onSelectElement({ kind: 'junction', id: graphNode.id }, event)
                : undefined
            }
            nonInteractive={nonInteractive}
            solution={solution}
            surfaceY={0}
            surfaceMaterial={style.surfaceMaterial}
          />
          {!ghost ? (
            <group position={graphNode.position}>
              <RoadPavementShell data={solution} thickness={style.surfaceThickness} />
            </group>
          ) : null}
          {!ghost
            ? [...sideBands].reverse().map((band) => (
                <RoadJunctionSideBand
                  band={band}
                  seamSurface={bandSurfaces?.[band.kind]}
                  center={graphNode.position}
                  key={band.kind}
                  manualBoundary={manualBoundary}
                  solution={solution}
                  surfaceY={band.elevationOffset}
                />
              ))
            : null}
          {!ghost && treatment === 'roundabout' ? (
            <>
              <mesh
                name="road-roundabout-island"
                position={[graphNode.position[0], graphNode.position[1] + 0.12, graphNode.position[2]]}
                raycast={nonInteractive ? NO_RAYCAST : undefined}
              >
                <cylinderGeometry args={[radius * 0.34, radius * 0.34, 0.22, 48]} />
                <meshStandardMaterial color="#69775a" roughness={0.92} />
              </mesh>
              <mesh
                name="road-roundabout-kerb"
                position={[graphNode.position[0], graphNode.position[1] + 0.2, graphNode.position[2]]}
                rotation={[Math.PI / 2, 0, 0]}
                raycast={NO_RAYCAST}
              >
                <torusGeometry args={[radius * 0.38, 0.12, 10, 48]} />
                <meshStandardMaterial color="#d7d4ca" roughness={0.9} />
              </mesh>
            </>
          ) : null}
          {!ghost &&
          junction?.manualBoundaryEnabled &&
          (elementSelection?.kind === 'junction' || elementSelection?.kind === 'corner') &&
          elementSelection.id === graphNode.id
            ? junction.manualBoundaryPoints.map((point, index) => (
                <group
                  key={`manual-boundary:${index}`}
                  name={`road-manual-boundary-point:${index + 1}`}
                  position={[
                    graphNode.position[0] + point[0],
                    graphNode.position[1] + 0.32,
                    graphNode.position[2] + point[1],
                  ]}
                >
                  <mesh raycast={NO_RAYCAST} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.2, 0.055, 8, 20]} />
                    <meshBasicMaterial color="#facc15" depthTest={false} />
                  </mesh>
                  <mesh raycast={NO_RAYCAST}>
                    <sphereGeometry args={[0.07, 10, 8]} />
                    <meshBasicMaterial color="#ffffff" depthTest={false} />
                  </mesh>
                </group>
              ))
            : null}
          {!ghost &&
          elementSelection?.kind === 'junction' &&
          elementSelection.id === graphNode.id
            ? junction?.primaryEdgeIds.map((edgeId) => {
                const edge = node.edges[edgeId]
                const edgeStyle = edge ? resolveStyle(node, edge) : undefined
                if (!edge || !edgeStyle) return null
                return (
                  <RoadRibbonSurface
                    color="#facc15"
                    elevationOffset={0.04}
                    key={`primary:${edgeId}`}
                    name={`road-primary-approach:${edgeId}`}
                    nonInteractive
                    points={junctionApproachIndicatorPoints(node, edge, graphNode.id)}
                    style={edgeStyle}
                    width={0.3}
                  />
                )
              })
            : null}
          {!ghost &&
          !nonInteractive &&
          onSelectElement &&
          (elementSelection?.kind === 'junction' || elementSelection?.kind === 'corner') &&
          elementSelection.id === graphNode.id
            ? solution.corners.map((corner) => {
                if (!corner.center || corner.effectiveRadius <= 0) return null
                const point = corner.innerPoints[
                  Math.floor((corner.innerPoints.length - 1) / 2)
                ]
                if (!point) return null
                const cornerKey = roadCurbCornerKey(corner.fromEdgeId, corner.toEdgeId)
                const selected =
                  elementSelection.kind === 'corner' &&
                  elementSelection.cornerKey === cornerKey
                return (
                  <mesh
                    key={`curb-corner:${cornerKey}`}
                    name={`road-curb-corner-hit:${graphNode.id}:${cornerKey}`}
                    onPointerDown={(event) =>
                      onSelectElement({
                        kind: 'corner',
                        id: graphNode.id,
                        cornerKey,
                      }, event)
                    }
                    position={[
                      graphNode.position[0] + point[0],
                      graphNode.position[1] + 0.28,
                      graphNode.position[2] + point[1],
                    ]}
                  >
                    <sphereGeometry args={[selected ? 0.32 : 0.24, 18, 12]} />
                    <meshBasicMaterial
                      color={selected ? '#facc15' : '#f59e0b'}
                      depthTest={false}
                    />
                  </mesh>
                )
              })
            : null}
        </group>
      ))}
    </group>
  )
}
