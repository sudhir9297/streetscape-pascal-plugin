import type { RoadNetworkNode } from './schema'
import { gradeTerrainToRoad } from './road-network-terrain'
import { compileStreetLayout } from './street-compiler-layout'
import { transformRoadCoordinates } from './road-coordinate-transform'
import { siteToHostWorld, type HostSitePlacement } from './host/site-placement'
import { createTerrainField, decodeTerrainField, encodeTerrainField, surfaceHeightAt, quantize, type TerrainData } from './terrain-field-compat'

/** Estimated ground shaped by accepted road grades, not a surveyed terrain raster. */
export function prepareImportedRoadTerrain(
  networks: readonly RoadNetworkNode[],
  placement: HostSitePlacement,
  existing?: unknown,
): { terrain: TerrainData; basis: string; spacingMeters: number } | null {
  const roads = networks.map(network => transformRoadCoordinates(network,
    point => siteToHostWorld(point, placement), placement.position[1] + placement.displayLiftMeters))
  const points = roads.flatMap(road => Object.values(road.edges).flatMap(edge => {
    const start = road.graphNodes[edge.startNodeId], end = road.graphNodes[edge.endNodeId]
    return start?.elevationMode === 'ground' && end?.elevationMode === 'ground'
      ? [start.position, ...edge.alignment, end.position] : []
  }))
  if (!points.length) return null
  const previous = decodeTerrainField(existing)
  // Never silently replace a corrupt/authored field whose contents cannot be read.
  if (existing != null && !previous) throw Error('Existing site terrain cannot be decoded.')
  const padding = 20
  let minX = Math.min(...points.map(p => p[0])) - padding
  let minZ = Math.min(...points.map(p => p[2])) - padding
  let maxX = Math.max(...points.map(p => p[0])) + padding
  let maxZ = Math.max(...points.map(p => p[2])) + padding
  if (previous) {
    minX = Math.min(minX, previous.origin[0]); minZ = Math.min(minZ, previous.origin[1])
    maxX = Math.max(maxX, previous.origin[0] + (previous.cols - 1) * previous.spacing)
    maxZ = Math.max(maxZ, previous.origin[1] + (previous.rows - 1) * previous.spacing)
  }
  const contained = previous && minX >= previous.origin[0] && minZ >= previous.origin[1]
    && maxX <= previous.origin[0] + (previous.cols - 1) * previous.spacing
    && maxZ <= previous.origin[1] + (previous.rows - 1) * previous.spacing
  const spacing = Math.max(0.25, (maxX - minX) / 256, (maxZ - minZ) / 256)
  let field = contained ? previous : createTerrainField({origin: [minX, minZ], spacing,
    cols: Math.min(257, Math.ceil((maxX - minX) / spacing) + 1),
    rows: Math.min(257, Math.ceil((maxZ - minZ) / spacing) + 1)})
  if (!contained) {
    for (let row = 0; row < field.rows; row++) for (let col = 0; col < field.cols; col++) {
      const x = minX + col * spacing, z = minZ + row * spacing
      const inside = previous && x >= previous.origin[0] && z >= previous.origin[1]
        && x <= previous.origin[0] + (previous.cols - 1) * previous.spacing
        && z <= previous.origin[1] + (previous.rows - 1) * previous.spacing
      field.heights[row * field.cols + col] = quantize(field, inside ? surfaceHeightAt(previous, x, z) : -0.05)
    }
  }
  for (const road of roads) {
    // Clearance prevents quantization/interpolation from burying the road top.
    const belowRoad = transformRoadCoordinates(road, p => [p[0], p[1] - 0.15, p[2]], -0.15)
    field = gradeTerrainToRoad(belowRoad, field, 8).value
  }
  // Fitted mouths can have a different height plane from the nearest centerline.
  // Lower the field against those actual ground junction triangles as well.
  const heights = new Int16Array(field.heights)
  for (const road of roads) for (const junction of compileStreetLayout(road).renderedJunctionSurfaces) {
    if (junction.graphNode.elevationMode !== 'ground') continue
    const mesh = junction.solution, center = junction.graphNode.position
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const vertices = mesh.indices.slice(i, i + 3).map(index => [mesh.positions[index * 3]! + center[0], mesh.positions[index * 3 + 1]! + center[1], mesh.positions[index * 3 + 2]! + center[2]])
      const [a, b, c] = vertices as [number[], number[], number[]]
      const cross = (p: number[], q: number[], x: number, z: number) => (q[0]! - p[0]!) * (z - p[2]!) - (q[2]! - p[2]!) * (x - p[0]!)
      const area = cross(a, b, c[0]!, c[2]!)
      if (Math.abs(area) < 1e-9) continue
      const margin = field.spacing * 2, sign = Math.sign(area)
      const col0 = Math.max(0, Math.floor((Math.min(...vertices.map(v => v[0]!)) - margin - field.origin[0]) / field.spacing))
      const col1 = Math.min(field.cols - 1, Math.ceil((Math.max(...vertices.map(v => v[0]!)) + margin - field.origin[0]) / field.spacing))
      const row0 = Math.max(0, Math.floor((Math.min(...vertices.map(v => v[2]!)) - margin - field.origin[1]) / field.spacing))
      const row1 = Math.min(field.rows - 1, Math.ceil((Math.max(...vertices.map(v => v[2]!)) + margin - field.origin[1]) / field.spacing))
      for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) {
        const x = field.origin[0] + col * field.spacing, z = field.origin[1] + row * field.spacing
        if ([[a,b],[b,c],[c,a]].some(([p,q]) => cross(p!, q!, x, z) * sign < -margin * Math.hypot(q![0]! - p![0]!, q![2]! - p![2]!))) continue
        const wa = cross(b, c, x, z) / area, wb = cross(c, a, x, z) / area
        const y = wa * a[1]! + wb * b[1]! + (1 - wa - wb) * c[1]!
        const index = row * field.cols + col
        heights[index] = Math.min(heights[index]!, quantize(field, y - 0.15))
      }
    }
  }
  field = {...field, heights}
  return {terrain: encodeTerrainField(field), basis: 'estimated-road-grade-v1', spacingMeters: field.spacing}
}
