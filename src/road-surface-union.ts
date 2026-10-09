import type { RoadSurfaceGeometryData } from './road-network-geometry'

type Point = readonly [number, number]
type Polygon = Point[]
const EPSILON = 1e-8
const cross = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

function clipHalfPlane(polygon: Polygon, a: Point, b: Point, inside: boolean): Polygon {
  const result: Polygon = []
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!
    const dp = cross(a, b, p), dq = cross(a, b, q)
    const keepP = inside ? dp >= 0 : dp <= 0
    const keepQ = inside ? dq >= 0 : dq <= 0
    if (keepP) result.push(p)
    if (keepP !== keepQ) {
      const t = dp / (dp - dq)
      result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return result
}

function bounds(polygon: Polygon) {
  return { minX: Math.min(...polygon.map(p => p[0])), maxX: Math.max(...polygon.map(p => p[0])), minZ: Math.min(...polygon.map(p => p[1])), maxZ: Math.max(...polygon.map(p => p[1])) }
}

function subtractTriangle(polygon: Polygon, triangle: Polygon): Polygon[] {
  const a = bounds(polygon), b = bounds(triangle)
  if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ) return [polygon]
  const outside: Polygon[] = []
  let remainder = polygon
  for (let i = 0; i < 3 && remainder.length >= 3; i++) {
    const start = triangle[i]!, end = triangle[(i + 1) % 3]!
    const piece = clipHalfPlane(remainder, start, end, false)
    if (piece.length >= 3) outside.push(piece)
    remainder = clipHalfPlane(remainder, start, end, true)
  }
  return outside
}

/** Exact projected union: subtract previous coverage instead of filling a hull. */
export function unionRoadSurfaceMeshes(meshes: readonly RoadSurfaceGeometryData[]): RoadSurfaceGeometryData {
  const result: RoadSurfaceGeometryData = { positions: [], indices: [] }
  const covered: Polygon[] = []
  for (const mesh of meshes) {
    const triangles: Polygon[] = []
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const vertices = mesh.indices.slice(i, i + 3).map(index => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!] as const)
      const triangle = vertices.map(([x, , z]) => [x, z] as const)
      const area = cross(triangle[0]!, triangle[1]!, triangle[2]!)
      if (Math.abs(area) <= EPSILON) continue
      const heightAt = (point: Point) => {
        const a = [vertices[0]![0], vertices[0]![2]] as const, b = [vertices[1]![0], vertices[1]![2]] as const, c = [vertices[2]![0], vertices[2]![2]] as const
        return (cross(b, c, point) * vertices[0]![1] + cross(c, a, point) * vertices[1]![1] + cross(a, b, point) * vertices[2]![1]) / area
      }
      if (area < 0) triangle.reverse()
      triangles.push(triangle)
      let pieces = [triangle]
      for (const previous of covered) {
        pieces = pieces.flatMap(piece => subtractTriangle(piece, previous))
        if (!pieces.length) break
      }
      for (const piece of pieces) {
        for (let j = 1; j < piece.length - 1; j++) {
          if (Math.abs(cross(piece[0]!, piece[j]!, piece[j + 1]!)) <= EPSILON) continue
          const offset = result.positions.length / 3
          // Upward winding in the x/z plane.
          result.positions.push(...[piece[0]!, piece[j + 1]!, piece[j]!].flatMap(([x, z]) => [x, heightAt([x, z]), z]))
          result.indices.push(offset, offset + 1, offset + 2)
        }
      }
    }
    covered.push(...triangles)
  }
  return result
}
