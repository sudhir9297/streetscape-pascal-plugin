import { RoadNetworkNode } from '../src/schema'
import { compileStreetLayout } from '../src/street-compiler-layout'
const inputPath = process.argv[2]
const outputPath = process.argv[3]
if (!inputPath || !outputPath) throw new Error('Usage: bun scripts/audit-saved-junctions.ts <scene.json> <report.json>')
const saved = await Bun.file(inputPath).json()
const network = RoadNetworkNode.parse(Object.values(saved.graph.nodes).find((node:any) => node.type === 'streetscape:road-network'))
const started = performance.now()
const layout = compileStreetLayout(network)
let centerTriangles = 0, triangles = 0, slopedJunctions = 0
for (const junction of layout.renderedJunctionSurfaces) {
 const mesh = junction.solution
 const heights = mesh.positions.filter((_:number,i:number) => i % 3 === 1)
 if (heights.length && Math.max(...heights) - Math.min(...heights) > 0.01) slopedJunctions++
 for (let i=0;i<mesh.indices.length;i+=3) {
  triangles++
  const points = mesh.indices.slice(i,i+3).map((index:number) => [mesh.positions[index*3]+junction.graphNode.position[0], mesh.positions[index*3+2]+junction.graphNode.position[2]])
  const cross = (a:number[],b:number[]) => a[0]*b[1]-a[1]*b[0]
  const signs = [cross(points[0],points[1]),cross(points[1],points[2]),cross(points[2],points[0])]
  if (signs.every(x=>x>=0) || signs.every(x=>x<=0)) centerTriangles++
 }
}
const report = { capturedAt:new Date().toISOString(), scene:saved.id, junctions:layout.renderedJunctionSurfaces.length, triangles, slopedJunctions, centerTriangles, finite:layout.renderedJunctionSurfaces.every(j=>j.solution.positions.every(Number.isFinite)), compileMs:Math.round(performance.now()-started), visualVerification:'Pending; this is compiler evidence only.' }
await Bun.write(outputPath, JSON.stringify(report,null,2)+'\n')
console.log(report)
process.exit(0)
