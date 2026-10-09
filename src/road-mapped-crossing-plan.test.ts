import {expect, test} from 'bun:test'
import {buildMappedCrossingRampGeometry, buildMappedTactilePadGeometry, buildMappedCrosswalkMarkings, crossingRoadHeight, resolveMappedCrossingPose, crossingWorldPoint} from './road-mapped-crossing-plan'
import {createEmptyRoadGraph, insertRoadSegment} from './road-network-topology'
import {RoadNetworkNode} from './schema'

function fixture(tags: Record<string,string>) {
  const graph = insertRoadSegment(createEmptyRoadGraph(), [-10,-1,0], [10,1,0]).graph
  const edgeId = Object.keys(graph.edges)[0]!
  const crossing = {id:9471837437,associatedEdgeId:edgeId,point:[0,0,0] as [number,number,number],rotationY:0,tags}
  return {crossing,node:RoadNetworkNode.parse({...graph,osmCrossings:[crossing]})}
}

test('an explicitly unmarked source crossing creates neither invented paint nor a ramp plate', () => {
  const {node,crossing} = fixture({highway:'crossing','crossing:markings':'no'})
  expect(buildMappedCrosswalkMarkings(node)).toEqual([])
  expect(buildMappedCrossingRampGeometry(crossing,3.2,crossingRoadHeight(node,crossing))).toEqual({positions:[],indices:[]})
})

test('mapped zebra paint follows a sloped road with a thin surface lift', () => {
  const {node} = fixture({highway:'crossing','crossing:markings':'zebra',kerb:'lowered'})
  const markings = buildMappedCrosswalkMarkings(node)
  expect(markings.length).toBeGreaterThan(0)
  for (const marking of markings) for (const point of marking.points) expect(point[1]).toBeCloseTo(point[0]*0.1+0.012,6)
})

test('curb ramps follow road grade and leave the carriageway unobstructed', () => {
  const {node,crossing} = fixture({highway:'crossing',kerb:'lowered'})
  const mesh = buildMappedCrossingRampGeometry(crossing,3.2,crossingRoadHeight(node,crossing))
  for (let i=0;i<mesh.positions.length;i+=3) {
    const [x,y,z] = mesh.positions.slice(i,i+3)
    expect(Math.abs(z!)).toBeGreaterThanOrEqual(1.6)
    expect(y!-x!*0.1).toBeCloseTo(Math.abs(z!)>1.6?0.06:0.018,6)
  }
  for (let i=0;i<mesh.indices.length;i+=3) {
    const zs=mesh.indices.slice(i,i+3).map(v=>mesh.positions[v*3+2]!)
    expect(zs.every(z=>z<=-1.6)||zs.every(z=>z>=1.6)).toBe(true)
  }
})

test('tactile pad corners follow the grade instead of floating on a horizontal box', () => {
  const {node,crossing} = fixture({highway:'crossing',tactile_paving:'yes'})
  const mesh=buildMappedTactilePadGeometry(crossing,2.1,2,crossingRoadHeight(node,crossing))
  for(let i=0;i<mesh.positions.length;i+=3) expect(mesh.positions[i+1]).toBeCloseTo(mesh.positions[i]!*0.1+0.11,6)
})

test('saved plan angles resolve to a 3D crossing aligned with its diagonal road',()=>{
  const graph=insertRoadSegment(createEmptyRoadGraph(),[0,0,0],[10,1,10]).graph
  const node=RoadNetworkNode.parse(graph),edgeId=Object.keys(node.edges)[0]!
  const crossing=resolveMappedCrossingPose(node,{id:1,point:[5,0.5,5],associatedEdgeId:edgeId,rotationY:Math.PI/4,tags:{}})
  const p=crossingWorldPoint(crossing,1,0,crossingRoadHeight(node,crossing),0)
  expect(p[0]-5).toBeCloseTo(Math.SQRT1_2,6)
  expect(p[2]-5).toBeCloseTo(Math.SQRT1_2,6)
})
