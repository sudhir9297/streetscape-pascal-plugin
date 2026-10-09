import { describe, expect, test } from 'bun:test'
import { adaptCurrentRoad, createLegacyStreetProject, readCurrentRoad } from '../street-project-compatibility'
import { RoadNetworkNode } from '../schema'
import { parseStreetProject, serializeStreetProject, type StreetProject } from './street-project'

const DATE = '2026-10-08T10:00:00Z'
function road() {
  return RoadNetworkNode.parse({id:'road-network_document',
    graphNodes:{a:{id:'a',position:[0,0,0]},b:{id:'b',position:[20,2,0]}},
    edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b',alignment:[[10,1,3]],styleId:'local-street'}},
    roadsideItemSuppressed:{'generated-lamp:1':true},
    attachments:{lamp:{id:'lamp',edgeId:'ab',assetNodeId:'street-light_existing',kind:'lamp',station:4,lateralOffset:5}},
    metadata:{custom:'preserve me'},
    osmMappedSurfaces:[{id:77,sourceId:'way/77',kind:'sidewalk',points:[[0,0,0],[20,0,0]],tags:{highway:'footway'}}],
  })
}
function project(): StreetProject {
  return createLegacyStreetProject({id:'project-test',name:'Test street',baselineRevisionId:'baseline-1',acceptedAt:DATE,roads:[road()]})
}
function importedProject(): StreetProject {
  const value = project()
  value.sourceReferences.osm = {id:'osm',provider:'openstreetmap',acquiredAt:null,contentIdentity:null,
    snapshot:{status:'embedded',format:'overpass-json',data:{elements:[{type:'way',id:12,tags:{width:'unknown',wikipedia:'en:Example'}}]}}}
  const baseline = value.baselineRevisions['baseline-1']!
  baseline.sourceReferenceIds = ['osm']
  baseline.roads['road-network_document'] = adaptCurrentRoad({id:'road-network_document',network:road(),origin:'imported',sourceReferenceIds:['osm']})
  baseline.features['lamp-observation'] = {id:'lamp-observation',kind:'point-asset',origin:'imported',sourceReferenceIds:['osm'],sourceFeatureId:'node/35',
    representation:'osm-import-v1',data:{kind:'street-lamp',position:[4,0,5],elevationSource:'estimated'}}
  return parseStreetProject(value)
}

describe('versioned street project', () => {
  test('round-trips a legacy road without fabricating source evidence or losing current values', () => {
    const original = road()
    const parsed = parseStreetProject(serializeStreetProject(project()))
    const stored = parsed.baselineRevisions['baseline-1']!.roads[original.id]!
    expect(stored.origin).toBe('legacy-authored')
    expect(stored.sourceReferenceIds).toEqual([])
    expect(parsed.sourceReferences).toEqual({})
    expect(parsed.siteFrameId).toBeNull()
    expect(JSON.parse(JSON.stringify(readCurrentRoad(stored)))).toEqual(JSON.parse(JSON.stringify(original)))
  })
  test('round-trips imported roads, mapped point features and unmodified source tags', () => {
    const value = importedProject()
    const parsed = parseStreetProject(serializeStreetProject(value))
    expect(parsed).toEqual(value)
    expect(parsed.baselineRevisions['baseline-1']!.features['lamp-observation']!.sourceFeatureId).toBe('node/35')
    expect(parsed.sourceReferences.osm!.snapshot).toMatchObject({data:{elements:[{tags:{width:'unknown',wikipedia:'en:Example'}}]}})
  })
  test('supports manually authored roads without requiring geographic source data', () => {
    const value = project()
    value.baselineRevisions['baseline-1']!.roads['road-network_document']!.origin = 'authored'
    expect(parseStreetProject(serializeStreetProject(value))).toEqual(value)
  })
  test('preserves missing raw evidence explicitly in imported legacy data', () => {
    const value = importedProject()
    value.sourceReferences.osm!.snapshot = {status:'unavailable',reason:'Original scene retained import metadata only'}
    expect(parseStreetProject(serializeStreetProject(value)).sourceReferences.osm!.snapshot.status).toBe('unavailable')
  })
  test('rejects unsupported future versions with a clear error', () => {
    expect(() => parseStreetProject({...project(),schemaVersion:2})).toThrow('Unsupported street project schema version: 2')
    expect(() => parseStreetProject({...project(),schemaVersion:undefined})).toThrow('Unsupported street project schema version')
  })
  test('rejects malformed JSON, unknown envelope fields and nonfinite payload values', () => {
    expect(() => parseStreetProject('{')).toThrow('not valid JSON')
    expect(() => parseStreetProject({...project(),unrecognizedField:true})).toThrow()
    const value = project()
    value.baselineRevisions['baseline-1']!.roads['road-network_document']!.data.invalid = Infinity
    expect(() => serializeStreetProject(value)).toThrow()
  })
  test('rejects missing active baselines, mismatched record IDs and duplicate source references', () => {
    const value = project()
    expect(() => parseStreetProject({...value,activeBaselineRevisionId:'missing'})).toThrow('Active baseline revision does not exist')
    value.baselineRevisions['baseline-1']!.id = 'wrong-key'
    expect(() => parseStreetProject(value)).toThrow('Record key must match its ID')
    const imported = importedProject()
    imported.baselineRevisions['baseline-1']!.sourceReferenceIds.push('osm')
    expect(() => parseStreetProject(imported)).toThrow('Source reference IDs must be unique')
  })
  test('rejects imported content without a source and source IDs outside its baseline', () => {
    const value = project()
    value.baselineRevisions['baseline-1']!.roads['road-network_document']!.origin = 'imported'
    expect(() => parseStreetProject(value)).toThrow('Imported content requires a source reference')
    const imported = importedProject()
    imported.baselineRevisions['baseline-1']!.sourceReferenceIds = []
    expect(() => parseStreetProject(imported)).toThrow('Source reference is not part of the baseline')
  })
  test('rejects missing sources and ambiguous road/feature identities', () => {
    const value = importedProject()
    delete value.sourceReferences.osm
    expect(() => parseStreetProject(value)).toThrow('Unknown source reference')
    const collision = importedProject()
    const baseline = collision.baselineRevisions['baseline-1']!
    const feature = baseline.features['lamp-observation']!
    delete baseline.features[feature.id]
    feature.id = 'road-network_document'
    baseline.features[feature.id] = feature
    expect(() => parseStreetProject(collision)).toThrow('Road and feature IDs must be distinct')
  })
  test('validates scenario references without applying design changes to the baseline', () => {
    const value = importedProject()
    const before = JSON.stringify(value.baselineRevisions)
    value.scenarios.design = {id:'design',name:'Wider sidewalk',baselineRevisionId:'baseline-1'}
    value.activeScenarioId = 'design'
    const parsed = parseStreetProject(serializeStreetProject(value))
    expect(JSON.stringify(parsed.baselineRevisions)).toBe(before)
    parsed.scenarios.design!.baselineRevisionId = 'missing'
    expect(() => parseStreetProject(parsed)).toThrow('Scenario baseline revision does not exist')
    expect(() => parseStreetProject({...value,activeScenarioId:'missing'})).toThrow('Active scenario does not exist')
  })
  test('rejects revision ancestry cycles and scenarios on a different active baseline', () => {
    const value = project()
    const next = structuredClone(value.baselineRevisions['baseline-1']!)
    next.id = 'baseline-2';next.parentRevisionId = 'baseline-1'
    value.baselineRevisions[next.id] = next
    value.scenarios.design = {id:'design',name:'Design',baselineRevisionId:'baseline-2'}
    value.activeScenarioId = 'design'
    expect(() => parseStreetProject(value)).toThrow('Active scenario must reference the active baseline revision')
    value.activeScenarioId = null
    value.baselineRevisions['baseline-1']!.parentRevisionId = 'baseline-2'
    expect(() => parseStreetProject(value)).toThrow('ancestry contains a cycle')
  })
  test('rejects duplicate legacy road IDs and invalid graph topology at the adapter', () => {
    expect(() => createLegacyStreetProject({id:'p',name:'p',baselineRevisionId:'b',acceptedAt:DATE,roads:[road(),road()]})).toThrow('Duplicate legacy road ID')
    const invalid = road()
    invalid.edges.ab!.endNodeId = 'missing'
    expect(() => adaptCurrentRoad({id:'r',network:invalid,origin:'authored'})).toThrow('Cannot adapt an invalid road')
  })
  test('parsing detaches the document from caller mutations', () => {
    const input = importedProject(), parsed = parseStreetProject(input)
    input.baselineRevisions['baseline-1']!.roads['road-network_document']!.data.metadata = {changed:true}
    expect(parsed.baselineRevisions['baseline-1']!.roads['road-network_document']!.data.metadata).toEqual({custom:'preserve me'})
  })
})

test('saved imported, authored and legacy document examples parse and serialize', async () => {
  const examples = await Bun.file(new URL('../../docs/fixtures/street-project-v1.examples.json', import.meta.url)).json() as Record<string, unknown>
  for (const value of Object.values(examples)) {
    const parsed = parseStreetProject(value)
    expect(parseStreetProject(serializeStreetProject(parsed))).toEqual(parsed)
    for (const baseline of Object.values(parsed.baselineRevisions)) {
      for (const road of Object.values(baseline.roads)) expect(readCurrentRoad(road).edges.ab).toBeDefined()
    }
  }
})
