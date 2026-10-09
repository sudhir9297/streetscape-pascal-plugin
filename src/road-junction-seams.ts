import { ShapeUtils, Vector2 } from 'three'
import { unionRoadSurfaceMeshes } from './road-surface-union'
import { ROAD_SIDE_COMPONENT_SPECS, type RoadSideComponentKind } from './road-cross-section'
import {
  buildJunctionBoundarySidePaths,
  type JunctionBoundaryGeometryData,
  type RoadSurfaceGeometryData,
} from './road-network-geometry'
import {
  trimRoadTransitionProfile,
  type RoadTransitionProfile,
  type RoadTransitionSample,
} from './road-transition-profile'

export type RoadJunctionMouth = {
  sample: RoadTransitionSample
  /** Unit direction away from the junction, matching the ribbon's end segment. */
  direction: readonly [number, number]
  reversed: boolean
}

/** Reserve a connecting ribbon even when two requested junction cuts exceed its length. */
export function trimRoadProfileAtJunctions(
  profile: RoadTransitionProfile,
  start: number,
  end: number,
) {
  const length = profile.samples.at(-1)?.distance ?? 0
  const requested = Math.max(0, start) + Math.max(0, end)
  const scale = requested > 0 ? Math.min(1, (length * 0.9) / requested) : 1
  return trimRoadTransitionProfile(profile, Math.max(0, start) * scale, Math.max(0, end) * scale)
}

export function roadJunctionMouth(
  profile: RoadTransitionProfile,
  atEnd: boolean,
): RoadJunctionMouth {
  const samples = profile.samples
  const sample = (atEnd ? samples.at(-1) : samples[0])!
  const next = (atEnd ? samples.at(-2) : samples[1]) ?? sample
  const dx = next.point[0] - sample.point[0]
  const dz = next.point[2] - sample.point[2]
  const length = Math.max(Math.hypot(dx, dz), 1e-9)
  return { sample, direction: [dx / length, dz / length], reversed: atEnd }
}

function sideBounds(mouth: RoadJunctionMouth, left: boolean, kind: RoadSideComponentKind) {
  const side = left !== mouth.reversed ? 'left' : 'right'
  const bounds = mouth.sample.components[side][kind]
  return {
    inner: bounds.innerOffset - mouth.sample.carriagewayHalfWidth,
    outer: bounds.outerOffset - mouth.sample.carriagewayHalfWidth,
  }
}

function cap(mouth: RoadJunctionMouth, left: boolean, offset: number, center: readonly number[]) {
  const sign = left ? 1 : -1
  const width = (mouth.sample.carriagewayHalfWidth + offset) * sign
  return [
    mouth.sample.point[0] - center[0]! - mouth.direction[1] * width,
    mouth.sample.point[2] - center[2]! + mouth.direction[0] * width,
  ] as const
}

/** Triangulate the boundary itself; a center fan overlaps concave junctions. */
export function triangulateRoadBoundary(
  points: readonly (readonly [number, number, number])[],
  holes: readonly (readonly (readonly [number, number, number])[])[] = [],
): RoadSurfaceGeometryData {
  const contour: Array<readonly [number, number, number]> = []
  for (const point of points) {
    const last = contour.at(-1)
    if (!last || Math.hypot(point[0] - last[0], point[2] - last[2]) > 1e-7) contour.push(point)
  }
  if (
    contour.length > 1 &&
    Math.hypot(contour[0]![0] - contour.at(-1)![0], contour[0]![2] - contour.at(-1)![2]) < 1e-7
  )
    contour.pop()
  const cleanHoles = holes.map((hole) => hole.filter((point, index) => {
    const previous = hole[index - 1]
    return !previous || Math.hypot(point[0] - previous[0], point[2] - previous[2]) > 1e-7
  })).filter((hole) => hole.length >= 3)
  const holeContours = cleanHoles.map((hole) => hole.at(0) && hole.at(-1) && Math.hypot(hole[0]![0] - hole.at(-1)![0], hole[0]![2] - hole.at(-1)![2]) < 1e-7 ? hole.slice(0, -1) : hole)
  const vertices = [contour, ...holeContours]
  return {
    positions: vertices.flatMap((vertexSet) => vertexSet.flatMap((point) => [...point])),
    indices: ShapeUtils.triangulateShape(
      contour.map((point) => new Vector2(point[0], point[2])),
      holeContours.map((hole) => hole.map((point) => new Vector2(point[0], point[2]))),
    ).flat(),
  }
}

type JunctionSurfaceRegion = {
	/** Seam geometry already fitted to the sampled road mouths, in junction-local coordinates. */
	surface?: RoadSurfaceGeometryData
	center: readonly [number, number, number]
	solution: { boundary: readonly (readonly [number, number])[]; holes?: readonly (readonly (readonly [number, number])[])[] }
	/** Roads on different vertical structures must never share a surface region. */
	mergeKey?: string
}

function orient2d(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function pointInPolygon(point: readonly [number, number], polygon: readonly (readonly [number, number])[]) {
	let inside = false
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i]!
		const b = polygon[j]!
		if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
	}
	return inside
}

function segmentsIntersect(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]) {
	const ab = orient2d(a, b, c)
	const ab2 = orient2d(a, b, d)
	const cd = orient2d(c, d, a)
	const cd2 = orient2d(c, d, b)
	return ab * ab2 <= 1e-8 && cd * cd2 <= 1e-8 && Math.max(a[0], b[0]) + 1e-7 >= Math.min(c[0], d[0]) && Math.max(c[0], d[0]) + 1e-7 >= Math.min(a[0], b[0]) && Math.max(a[1], b[1]) + 1e-7 >= Math.min(c[1], d[1]) && Math.max(c[1], d[1]) + 1e-7 >= Math.min(a[1], b[1])
}

function polygonsOverlap(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]) {
	for (let i = 0; i < a.length; i++) {
		const aNext = a[(i + 1) % a.length]!
		for (let j = 0; j < b.length; j++) if (segmentsIntersect(a[i]!, aNext, b[j]!, b[(j + 1) % b.length]!)) return true
	}
	return pointInPolygon(a[0]!, b) || pointInPolygon(b[0]!, a)
}

/**
 * Resolve overlapping junction patches into one shared region. This keeps
 * short connector roads from drawing two coplanar asphalt faces on top of one
 * another; each original junction still retains its own approach cuts and
 * roadside bands.
 */
export function mergeCollidingJunctionSurfaces(
	regions: readonly JunctionSurfaceRegion[],
): RoadSurfaceGeometryData[] {
	const polygons = regions.map((region) => region.solution.boundary.map(([x, z]) => [x + region.center[0], z + region.center[2]] as const))
	const parent = regions.map((_, index) => index)
	const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!))
	for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
		if (regions[i]!.mergeKey !== regions[j]!.mergeKey || !polygonsOverlap(polygons[i]!, polygons[j]!)) continue
		const left = find(i)
		const right = find(j)
		if (left !== right) parent[right] = left
	}
	const merged = regions.map((region) => region.surface ?? triangulateRoadBoundary(
		region.solution.boundary.map(([x, z]) => [x, 0, z] as const),
		(region.solution.holes ?? []).map((hole) => hole.map(([x, z]) => [x, 0, z] as const)),
	))
	const originals = [...merged]
	for (let i = 0; i < regions.length; i++) {
		if (find(i) !== i) {
			merged[i] = { positions: [], indices: [] }
			continue
		}
		const members = regions.map((_, index) => index).filter((index) => find(index) === i)
		if (members.length < 2) continue
		const meshes = members.map((index) => {
			const region = regions[index]!
			const dx = region.center[0] - regions[i]!.center[0]
			const dz = region.center[2] - regions[i]!.center[2]
			const dy = region.center[1] - regions[i]!.center[1]
			const surface = originals[index]!
			return {
				indices: surface.indices,
				positions: surface.positions.map((value, offset) => value + (offset % 3 === 0 ? dx : offset % 3 === 1 ? dy : dz)),
			}
		})
		merged[i] = unionRoadSurfaceMeshes(meshes)
	}
	return merged
}

/** Shared mouth coordinates make asphalt, curbs and sidewalks meet the same ribbon ends. */
export function buildRoadJunctionSeams(
  solution: JunctionBoundaryGeometryData & { holes?: readonly (readonly (readonly [number, number])[])[] },
  center: readonly [number, number, number],
  mouths: Readonly<Record<string, RoadJunctionMouth>>,
): {
  asphalt: RoadSurfaceGeometryData
  bands: Record<RoadSideComponentKind, RoadSurfaceGeometryData>
} {
  const paths = buildJunctionBoundarySidePaths(solution)
  const boundary: Array<readonly [number, number, number]> = []
  const bands = Object.fromEntries(
    ROAD_SIDE_COMPONENT_SPECS.map((spec) => [
      spec.kind,
      { positions: [] as number[], indices: [] as number[] },
    ]),
  ) as Record<RoadSideComponentKind, RoadSurfaceGeometryData>
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex]!
    const from = mouths[path.fromEdgeId]!
    const to = mouths[path.toEdgeId]!
    if (!from || !to) throw new Error('Missing road junction mouth')
    const distances = [0]
    for (let i = 1; i < path.points.length; i++)
      distances.push(
        distances[i - 1]! +
          Math.hypot(
            path.points[i]![0] - path.points[i - 1]![0],
            path.points[i]![1] - path.points[i - 1]![1],
          ),
      )
    const total = Math.max(distances.at(-1)!, 1e-9)
    // Warp the original curb return between actual sampled mouths. This also
    // fits short approaches without reversing their remaining road ribbon.
    const trace = (fromOffset: number, toOffset: number) => {
      const firstCap = cap(from, true, fromOffset, center)
      const lastCap = cap(to, false, toOffset, center)
      const firstBase = buildJunctionBoundarySidePaths(solution, fromOffset)[pathIndex]!.points[0]!
      const lastBase = buildJunctionBoundarySidePaths(solution, toOffset)[pathIndex]!.points.at(-1)!
      return path.points.map((_, i) => {
        const t = distances[i]! / total
        const offset = fromOffset + (toOffset - fromOffset) * t
        const base = buildJunctionBoundarySidePaths(solution, offset)[pathIndex]!.points[i]!
        return [
          base[0] + (firstCap[0] - firstBase[0]) * (1 - t) + (lastCap[0] - lastBase[0]) * t,
          from.sample.point[1] * (1 - t) + to.sample.point[1] * t - center[1],
          base[1] + (firstCap[1] - firstBase[1]) * (1 - t) + (lastCap[1] - lastBase[1]) * t,
        ] as const
      })
    }
    boundary.push(...trace(0, 0))
    for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
      const first = sideBounds(from, true, spec.kind)
      const last = sideBounds(to, false, spec.kind)
      if (first.outer - first.inner < 1e-6 && last.outer - last.inner < 1e-6) continue
      const inner = trace(first.inner, last.inner)
      const outer = trace(first.outer, last.outer)
      const mesh = bands[spec.kind]
      // Triangulate the complete strip contour. Per-segment quads can cross
      // when a tight curb return is warped between unequal approach mouths,
      // producing the large triangular overhang visible outside the cutout.
      const contour = [...inner, ...outer.slice().reverse()]
      const base = mesh.positions.length / 3
      for (const point of contour) mesh.positions.push(...point)
      const triangles = ShapeUtils.triangulateShape(
        contour.map((point) => new Vector2(point[0], point[2])),
        [],
      )
      for (const triangle of triangles) {
        mesh.indices.push(base + triangle[0]!, base + triangle[1]!, base + triangle[2]!)
      }
    }
  }
  return {
    asphalt: triangulateRoadBoundary(boundary, (solution.holes ?? []).map(hole => hole.map(([x, z]) => [x, 0, z] as const))),
    bands,
  }
}
