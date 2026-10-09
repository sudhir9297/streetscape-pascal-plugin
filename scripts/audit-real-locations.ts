import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { configureOsmStreetDataSource } from '../src/map-data-source'
import { prepareOsmStreetImport, completeOsmStreetImport } from '../src/osm-import'
import { confirmStreetRegionalPolicy } from '../src/domain/street-sections'
import { createImportedStreetProject, readImportedBaselineNetworks } from '../src/osm-baseline-bridge'
import { compileStreet } from '../src/street-compiler'

const locations = [
  { id: 'paris-roundabout', lat: 48.8738, lon: 2.2950, radius: 250, driving: 'right-driving' },
  { id: 'manhattan-grid', lat: 40.7411, lon: -73.9897, radius: 150, driving: 'right-driving' },
  { id: 'san-francisco-curves', lat: 37.8021, lon: -122.4187, radius: 150, driving: 'right-driving' },
  { id: 'london-tower-bridge', lat: 51.5055, lon: -0.0754, radius: 200, driving: 'left-driving' },
] as const
const selected = process.argv.slice(2)
if (selected.some(id => !locations.some(location => location.id === id))) {
  throw new Error(`Choose location IDs: ${locations.map(location => location.id).join(', ')}`)
}
const output = resolve(import.meta.dir, '../../../reports/streetscape-verification')
await mkdir(output, { recursive: true })
configureOsmStreetDataSource('osm-api')
const counts = (values: readonly string[]) => values.reduce<Record<string, number>>((result, value) => {
  result[value] = (result[value] ?? 0) + 1
  return result
}, {})
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

for (const location of locations.filter(location => selected.length === 0 || selected.includes(location.id))) {
  const started = performance.now()
  console.log(`Acquiring ${location.id}`)
  const prepared = await prepareOsmStreetImport({ lat: location.lat, lon: location.lon }, location.radius, { loadTerrain: false })
  prepared.regionalPolicy = confirmStreetRegionalPolicy(prepared.regionalPolicy, location.driving)
  prepared.sectionReport.policy = prepared.regionalPolicy
  const result = await completeOsmStreetImport(prepared)
  const project = createImportedStreetProject(result, { acceptedAt: new Date().toISOString() })
  const networks = readImportedBaselineNetworks(project)
  const compiled = networks.map(({ network }) => compileStreet(network))
  const report = {
    capturedAt: new Date().toISOString(),
    location,
    terrain: 'Not acquired in this compiler audit; browser elevation verification remains required.',
    visualVerification: 'Pending external browser comparison; compiler success does not prove visual accuracy.',
    sourceIdentity: result.normalization.sourceContentIdentity,
    preview: { ways: prepared.preview.wayCount, segments: prepared.preview.segmentCount, assets: prepared.preview.assetCounts },
    normalization: {
      dispositions: counts(result.normalization.features.map(feature => feature.disposition)),
      kinds: counts(result.normalization.features.map(feature => feature.kind)),
      diagnostics: counts(result.normalization.features.flatMap(feature => feature.diagnostics.map(diagnostic => diagnostic.code))),
    },
    inventory: counts(result.inventoryReport.items.map(item => item.status)),
    projectBytes: bytes(project),
    compile: compiled.map(plan => ({
      bounds: plan.bounds,
      paths: plan.referencePaths.length,
      polygons: plan.surfacePolygons.length,
      bridges: plan.bridgeSpans.length,
      mappedSurfaces: plan.mappedSurfaces.length,
      diagnostics: counts(plan.diagnostics.map(diagnostic => diagnostic.code)),
      finite: plan.surfacePolygons.every(polygon => polygon.points.every(point => point.every(Number.isFinite))),
    })),
    elapsedMs: Math.round(performance.now() - started),
  }
  await Bun.write(resolve(output, `${location.id}-compiler-audit.json`), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  if (report.compile.some(plan => !plan.finite || plan.polygons === 0)) throw new Error(`${location.id} produced invalid or empty geometry`)
}

// Host package imports can leave editor service timers alive in this CLI.
process.exit(0)
