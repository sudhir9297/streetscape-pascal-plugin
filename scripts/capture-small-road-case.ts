import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { configureOsmStreetDataSource } from '../src/map-data-source'
import { prepareOsmStreetImport, completeOsmStreetImport } from '../src/osm-import'
import { confirmStreetRegionalPolicy } from '../src/domain/street-sections'
import { createImportedStreetProject, readImportedBaselineNetworks } from '../src/osm-baseline-bridge'
import { compileStreet } from '../src/street-compiler'

const [id, latitude, longitude, radius = '50'] = process.argv.slice(2)
if (!id || !/^[a-z0-9-]+$/.test(id) || !latitude || !longitude) {
  throw Error('Usage: bun scripts/capture-small-road-case.ts case-id latitude longitude [radius]')
}
const center = { lat: Number(latitude), lon: Number(longitude) }
configureOsmStreetDataSource('osm-api')
const prepared = await prepareOsmStreetImport(center, Number(radius), {
  loadTerrain: false,
  contextMarginMeters: 25,
  signal: AbortSignal.timeout(60_000),
})
prepared.regionalPolicy = confirmStreetRegionalPolicy(prepared.regionalPolicy, 'right-driving')
prepared.sectionReport.policy = prepared.regionalPolicy
const result = await completeOsmStreetImport(prepared)
const output = resolve(import.meta.dir, '../../../reports/streetscape-verification/small-roads', id)
await mkdir(output, { recursive: true })
await Bun.write(resolve(output, 'source.json'), JSON.stringify(prepared.sourceSnapshot, null, 2))
await Bun.write(resolve(output, 'import.json'), JSON.stringify(result, null, 2))
const project = createImportedStreetProject(result, { acceptedAt: new Date().toISOString() })
const plans = readImportedBaselineNetworks(project).map(({ network }) => compileStreet(network))
const polygons = plans.flatMap(plan => plan.surfacePolygons)
if (!polygons.length || polygons.some(p => p.points.some(point => point.some(n => !Number.isFinite(n))))) {
  throw Error('The small road case produced empty or nonfinite geometry')
}
await Bun.write(resolve(output, 'compiler.json'), JSON.stringify(plans.map(plan => ({
  bounds: plan.bounds, diagnostics: plan.diagnostics,
  referencePaths: plan.referencePaths, surfacePolygons: plan.surfacePolygons,
})), null, 2))
// A geometric inspection artifact, explicitly separate from browser render evidence.
const extent = prepared.radiusMeters + 20
const paths = polygons.map(p => `<polygon points="${p.points.map(point => `${point[0]},${point[1]}`).join(' ')}" fill="#b7bac0" stroke="#454a54" stroke-width="0.08"/>`).join('\n')
const centerlines = result.graphs.flatMap(graph => Object.values(graph.edges).map(edge => {
  const points = [graph.graphNodes[edge.startNodeId]!.position, ...edge.alignment, graph.graphNodes[edge.endNodeId]!.position]
  return `<polyline points="${points.map(point => `${point[0]},${point[2]}`).join(' ')}" fill="none" stroke="#dc2626" stroke-width="0.2"/>`
})).join('\n')
await Bun.write(resolve(output, 'geometry.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-extent} ${-extent} ${extent * 2} ${extent * 2}"><rect x="${-extent}" y="${-extent}" width="${extent * 2}" height="${extent * 2}" fill="white"/>${paths}${centerlines}</svg>`)
const summary = {
  center, radius: prepared.radiusMeters,
  sourceIdentity: prepared.sourceSnapshot?.contentIdentity,
  segments: prepared.preview.segmentCount,
  roads: prepared.normalization.features.filter(f => f.kind === 'road').map(f => ({
    id: f.id, disposition: f.disposition, tags: f.raw.tags, geometry: f.geometry,
  })),
  visualVerification: 'Pending; this capture records source data, not visual correctness.',
}
await Bun.write(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ output, center, radius: summary.radius, segments: summary.segments, roads: summary.roads.map(r => ({ id: r.id, name: r.tags?.name })) }))
process.exit(0)
