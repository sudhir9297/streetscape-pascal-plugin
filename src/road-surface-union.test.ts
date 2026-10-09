import { expect, test } from 'bun:test'
import { unionRoadSurfaceMeshes } from './road-surface-union'
import { triangulateRoadBoundary } from './road-junction-seams'

const rectangle = (x1: number, z1: number, x2: number, z2: number) => triangulateRoadBoundary([[x1, 0, z1], [x2, 0, z1], [x2, 0, z2], [x1, 0, z2]])
function area(mesh: ReturnType<typeof rectangle>) {
  let total = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(index => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 2]!])
    total += Math.abs((b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)) / 2
  }
  return total
}

test('overlapping patches preserve a roundabout island without duplicate coverage', () => {
  const patches = [rectangle(-5, -5, 5, -3), rectangle(-5, 3, 5, 5), rectangle(-5, -5, -3, 5), rectangle(3, -5, 5, 5)]
  expect(area(unionRoadSurfaceMeshes(patches))).toBeCloseTo(64, 8)
  expect(area(unionRoadSurfaceMeshes(patches.reverse()))).toBeCloseTo(64, 8)
})

test('an L-shaped junction union keeps its concave corner open', () => {
  expect(area(unionRoadSurfaceMeshes([rectangle(0, 0, 6, 2), rectangle(0, 0, 2, 6)]))).toBeCloseTo(20, 8)
})

test('identical patches do not add duplicate triangles', () => {
  const patch = rectangle(0, 0, 6, 2)
  expect(area(unionRoadSurfaceMeshes([patch, patch, patch]))).toBeCloseTo(12, 8)
})

test('preserves existing holes while a new patch fills only part of one', () => {
  const ring = triangulateRoadBoundary([[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]], [[[-3, 0, -3], [3, 0, -3], [3, 0, 3], [-3, 0, 3]]])
  expect(area(unionRoadSurfaceMeshes([ring, rectangle(-1, -5, 1, 0)]))).toBeCloseTo(70, 8)
})

test('clipped union vertices retain the original triangle elevation plane in either winding', () => {
  const flat = rectangle(-1, -1, 2, 5)
  const slope = rectangle(0, 0, 6, 4)
  slope.positions = slope.positions.map((value, i) => i % 3 === 1 ? slope.positions[i - 1]! * 0.5 + slope.positions[i + 1]! * 0.25 + 3 : value)
  for (const reversed of [false, true]) {
    const input = { ...slope, indices: reversed ? [...slope.indices].reverse() : slope.indices }
    const union = unionRoadSurfaceMeshes([flat, input])
    for (let i = 0; i < union.positions.length; i += 3) {
      const x = union.positions[i]!, y = union.positions[i + 1]!, z = union.positions[i + 2]!
      if (x > 2 + 1e-7) expect(y).toBeCloseTo(x * 0.5 + z * 0.25 + 3, 8)
    }
    expect(area(union)).toBeCloseTo(34, 8)
  }
})
