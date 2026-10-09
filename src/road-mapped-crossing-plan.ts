import { sampleRoadEdgePoints, type RoadSurfaceGeometryData } from './road-network-geometry'
import { roadCarriagewayWidth } from './road-cross-section'
import type { RoadNetworkNode } from './schema'
import type { RoadMarkingPolygon } from './road-network-markings'

type Point = readonly [number, number, number]
export type MappedCrossing = {id: number; kind?: 'crossing' | 'kerb'; point: Point; rotationY?: number; associatedEdgeId?: string; tags: Record<string, string>}

/** Resolve existing imports too: plan atan2(z,x) is the opposite of Three's Y rotation. */
export function resolveMappedCrossingPose(node: RoadNetworkNode, crossing: MappedCrossing): MappedCrossing {
  const edge = crossing.associatedEdgeId ? node.edges[crossing.associatedEdgeId] : undefined
  if (!edge) return crossing
  const path = sampleRoadEdgePoints(node,edge)
  let distance=Infinity, rotationY=crossing.rotationY
  for(let i=1;i<path.length;i++) {
    const a=path[i-1]!,b=path[i]!,dx=b[0]-a[0],dz=b[2]-a[2],length=dx*dx+dz*dz
    if(length<1e-9) continue
    const t=Math.max(0,Math.min(1,((crossing.point[0]-a[0])*dx+(crossing.point[2]-a[2])*dz)/length))
    const next=Math.hypot(crossing.point[0]-a[0]-dx*t,crossing.point[2]-a[2]-dz*t)
    if(next<distance) {distance=next;rotationY=Math.atan2(-dz,dx)}
  }
  return {...crossing,rotationY}
}

/** Interpolated road grade at a mapped point; source dimensions remain estimates. */
export function crossingRoadHeight(node: RoadNetworkNode, crossing: MappedCrossing) {
  const edge = crossing.associatedEdgeId ? node.edges[crossing.associatedEdgeId] : undefined
  const path = edge ? sampleRoadEdgePoints(node, edge) : []
  return (x: number, z: number): number => {
    let best = Infinity, height = crossing.point[1]
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!, dx = b[0] - a[0], dz = b[2] - a[2]
      const t = Math.max(0, Math.min(1, ((x-a[0])*dx+(z-a[2])*dz) / Math.max(dx*dx+dz*dz, 1e-9)))
      const distance = Math.hypot(x-a[0]-t*dx, z-a[2]-t*dz)
      if (distance < best) {best = distance; height = a[1] + (b[1]-a[1])*t}
    }
    return height
  }
}

export function crossingWorldPoint(crossing: MappedCrossing, x: number, z: number, heightAt: (x: number, z: number) => number, lift: number): [number, number, number] {
  const c = Math.cos(crossing.rotationY ?? 0), s = Math.sin(crossing.rotationY ?? 0)
  const wx = crossing.point[0] + x*c + z*s, wz = crossing.point[2] - x*s + z*c
  return [wx, heightAt(wx,wz) + lift, wz]
}

/** Ramp strips end at the curb; they never form a raised plate across traffic lanes. */
export function buildMappedCrossingRampGeometry(crossing: MappedCrossing, roadWidth: number, heightAt: (x: number, z: number) => number): RoadSurfaceGeometryData {
  const kerbOnly = crossing.kind === 'kerb'
  if (!kerbOnly && !crossing.tags.kerb) return {positions: [], indices: []}
  const lowered = ['lowered', 'flush', 'no'].includes(crossing.tags.kerb ?? '')
  const sidewalkY = lowered ? 0.06 : 0.105, roadY = 0.018
  const strips = kerbOnly ? [[[-0.225, sidewalkY],[0,roadY],[0.225,sidewalkY]]]
    : [[[ -roadWidth/2-0.8,sidewalkY],[-roadWidth/2,roadY]],[[roadWidth/2,roadY],[roadWidth/2+0.8,sidewalkY]]]
  const width = kerbOnly ? 1.2 : 2.4, positions: number[] = [], indices: number[] = []
  for (const rows of strips) {
    const base = positions.length / 3
    for (const [z,lift] of rows) for (const x of [-width/2,width/2]) {
      const world = crossingWorldPoint(crossing,x,z!,heightAt,lift!)
      positions.push(x,world[1]-crossing.point[1],z!)
    }
    for (let i=1;i<rows.length;i++) {const a=base+(i-1)*2;indices.push(a,a+2,a+1,a+2,a+3,a+1)}
  }
  return {positions,indices}
}

export function buildMappedTactilePadGeometry(crossing: MappedCrossing, width: number, centerZ: number, heightAt: (x: number, z: number) => number): RoadSurfaceGeometryData {
  const positions = [[-width/2,centerZ-0.225],[width/2,centerZ-0.225],[-width/2,centerZ+0.225],[width/2,centerZ+0.225]].flatMap(([x,z]) => {
    const world = crossingWorldPoint(crossing,x!,z!,heightAt,0.11)
    return [x!,world[1]-crossing.point[1],z!]
  })
  return {positions,indices:[0,2,1,2,3,1]}
}

export function buildMappedCrosswalkMarkings(node: RoadNetworkNode): RoadMarkingPolygon[] {
  return node.osmCrossings.flatMap(sourceCrossing => {
    const crossing = resolveMappedCrossingPose(node,sourceCrossing)
    if (crossing.kind === 'kerb' || !(crossing.tags['crossing:markings'] === 'zebra' || crossing.tags.crossing === 'zebra')) return []
    const edge = crossing.associatedEdgeId ? node.edges[crossing.associatedEdgeId] : undefined
    if (!edge) return []
    const style = node.stylePresets[node.applyStyleToAll ? node.activeStyleId : edge.styleId]
    if (!style) return []
    const half = roadCarriagewayWidth(style)/2, heightAt = crossingRoadHeight(node,crossing)
    const markings: RoadMarkingPolygon[] = []
    for (let z=-half+0.1;z+0.35<=half-0.1;z+=0.7) markings.push({
      kind:'crosswalk',color:'#f4f2e8',edgeId:edge.id,
      points:[[-1.2,z],[1.2,z],[1.2,z+0.35],[-1.2,z+0.35]].map(([x,z])=>crossingWorldPoint(crossing,x!,z!,heightAt,0.012)),
    })
    return markings
  })
}
