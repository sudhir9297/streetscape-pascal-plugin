import { configureOsmStreetDataSource } from '../src/map-data-source'
import { prepareOsmStreetImport, completeOsmStreetImport } from '../src/osm-import'
import { confirmStreetRegionalPolicy } from '../src/domain/street-sections'
import { createImportedStreetProject } from '../src/osm-baseline-bridge'

configureOsmStreetDataSource('osm-api')
const center = { lat: 48.8738, lon: 2.2950 }
const prepared = await prepareOsmStreetImport(center, 250, { loadTerrain: false })
prepared.regionalPolicy = confirmStreetRegionalPolicy(prepared.regionalPolicy, 'right-driving')
prepared.sectionReport.policy = prepared.regionalPolicy
const result = await completeOsmStreetImport(prepared)
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
console.log('Import bytes', Object.fromEntries(Object.entries(result).map(([key, value]) => [key, bytes(value)])))
const project = createImportedStreetProject(result, { acceptedAt: new Date().toISOString() })
const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!
console.log('Project bytes', bytes(project))
console.log('Baseline bytes', Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, bytes(value)])))
