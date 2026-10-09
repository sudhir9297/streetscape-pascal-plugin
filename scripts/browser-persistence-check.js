// Evaluate at localhost:3002 with the runtime scratch fixture present. Creates a separate durable test scene.
window.__streetscapePersistenceResult = null;
((async()=> {
let r;webpackChunk_N_E.push([['persistence-check-'+Date.now()],{},x=>r=x]);
const module=suffix=>{const id=Object.keys(r.m).find(id=>id.endsWith(suffix));if(!id)throw Error('Missing module '+suffix);return r(id)};
const core=module('/packages/core/dist/index.js');
const persistence=module('/streetscape/src/host/street-project-persistence.ts');
const store=module('/streetscape/src/host/street-project-store.ts');
const resolution=module('/streetscape/src/domain/street-resolution.ts');
const scene=core.useScene.getState();
const original={nodes:scene.nodes,rootNodeIds:scene.rootNodeIds,collections:scene.collections,materials:scene.materials,installedPlugins:scene.installedPlugins};
const history=core.useScene.temporal.getState(),originalHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
const results=[];const check=(name,pass)=>{results.push({name,pass:!!pass});if(!pass)throw Error(name)};
let sceneId;
try {
const site=Object.values(scene.nodes).find(n=>n.type==='site');
const road=Object.values(scene.nodes).find(n=>n.name==='Streetscape phase 0 test');
check('root site and projected road present',site&&road);
const project={"format":"streetscape-project","schemaVersion":1,"id":"project-imported","name":"OSM block reconstruction","revision":2,"siteFrameId":"site-frame-example","sourceReferences":{"osm-snapshot":{"id":"osm-snapshot","provider":"openstreetmap","acquiredAt":"2026-10-08T09:00:00Z","contentIdentity":null,"snapshot":{"status":"embedded","format":"overpass-json","data":{"elements":[{"type":"node","id":10,"lat":0,"lon":0,"tags":{"highway":"street_lamp"}},{"type":"way","id":20,"nodes":[1,2],"tags":{"highway":"residential","width":"unknown"}}]}}}},"baselineRevisions":{"baseline-original":{"id":"baseline-original","parentRevisionId":null,"acceptedAt":"2026-10-08T10:00:00Z","sourceReferenceIds":["osm-snapshot"],"roads":{"road-block":{"id":"road-block","origin":"imported","sourceReferenceIds":["osm-snapshot"],"representation":"pascal-road-network-v1","data":{"id":"road-network_example","type":"streetscape:road-network","graphNodes":{"a":{"id":"a","position":[0,0,0]},"b":{"id":"b","position":[20,1,0]}},"edges":{"ab":{"id":"ab","startNodeId":"a","endNodeId":"b","alignment":[[10,0.5,2]],"styleId":"local-street"}},"roadsideItemSuppressed":{"generated-lamp:1":true},"stylePresets":{"local-street":{"id":"local-street","name":"Local street","sidewalkWidth":1.5}}}}},"features":{"lamp-observation":{"id":"lamp-observation","kind":"point-asset","origin":"imported","sourceReferenceIds":["osm-snapshot"],"sourceFeatureId":"node/10","representation":"osm-import-v1","data":{"kind":"street-lamp","position":[5,0.25,3],"elevationSource":"terrain"}}},"propertyEvidence":{"sidewalk-width":{"id":"sidewalk-width","target":{"category":"roads","featureId":"road-block","path":["stylePresets","local-street","sidewalkWidth"]},"units":"metres","claims":{"osm":{"id":"osm","value":1.5,"origin":{"kind":"source","sourceReferenceId":"osm-snapshot","sourceFeatureId":"way/12"}}},"rejectedClaims":[],"accepted":{"kind":"claim","claimId":"osm"}}}},"baseline-corrected":{"id":"baseline-corrected","parentRevisionId":"baseline-original","acceptedAt":"2026-10-08T10:00:00Z","sourceReferenceIds":["osm-snapshot"],"roads":{"road-block":{"id":"road-block","origin":"imported","sourceReferenceIds":["osm-snapshot"],"representation":"pascal-road-network-v1","data":{"id":"road-network_example","type":"streetscape:road-network","graphNodes":{"a":{"id":"a","position":[0,0,0]},"b":{"id":"b","position":[20,1,0]}},"edges":{"ab":{"id":"ab","startNodeId":"a","endNodeId":"b","alignment":[[10,0.5,2]],"styleId":"local-street"}},"roadsideItemSuppressed":{"generated-lamp:1":true},"stylePresets":{"local-street":{"id":"local-street","name":"Local street","sidewalkWidth":1.5}}}}},"features":{"lamp-observation":{"id":"lamp-observation","kind":"point-asset","origin":"imported","sourceReferenceIds":["osm-snapshot"],"sourceFeatureId":"node/10","representation":"osm-import-v1","data":{"kind":"street-lamp","position":[5,0.25,3],"elevationSource":"terrain"}}},"propertyEvidence":{"sidewalk-width":{"id":"sidewalk-width","target":{"category":"roads","featureId":"road-block","path":["stylePresets","local-street","sidewalkWidth"]},"units":"metres","claims":{"osm":{"id":"osm","value":1.5,"origin":{"kind":"source","sourceReferenceId":"osm-snapshot","sourceFeatureId":"way/12"}}},"rejectedClaims":[{"claimId":"osm","reason":"Surveyed clear width differs from the map"}],"accepted":{"kind":"correction","value":1.8,"reason":"Accepted site measurement","acceptedAt":"2026-10-08T10:00:00Z","observationIds":["survey"],"supersedesClaimId":"osm"}}}}},"activeBaselineRevisionId":"baseline-corrected","scenarios":{"walking-proposal":{"id":"walking-proposal","name":"Wider walking space","baselineRevisionId":"baseline-corrected","overrides":{"sidewalk-width":{"value":2.4,"reason":"Proposed wider pedestrian zone","authoredAt":"2026-10-08T10:00:00Z"}}}},"activeScenarioId":"walking-proposal","siteFrames":{"site-frame-example":{"format":"streetscape-site-frame","schemaVersion":1,"id":"site-frame-example","projection":"equirectangular-local-v1","units":"metres","origin":{"lat":0,"lon":0},"orientationRadians":0,"verticalReference":{"kind":"unknown"}}},"observations":{"survey":{"id":"survey","description":"Clear sidewalk width measured at the frontage","observedAt":"2026-10-08T10:00:00Z","sourceReferenceId":null,"sourceFeatureId":null,"referenceUri":null}}};
project.id='persistence-browser-check';
const projection={baselineRevisionId:project.activeBaselineRevisionId,scenarioId:project.activeScenarioId,bindings:[{category:'roads',featureId:'road-block',nodeIds:[road.id]}]};
const before=core.useScene.temporal.getState().pastStates.length;
const prepared=store.persistStreetProject(site.id,{project,projection,expectedRevision:null});
check('one host undo entry',core.useScene.temporal.getState().pastStates.length===before+1);
check('complete owner document committed',store.loadStreetProject(site.id).document.project.sourceReferences['osm-snapshot'].snapshot.status==='embedded');
const state=core.useScene.getState();
const graph={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
const response=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape persistence verification',graph})});
const saved=await response.json();check('server save accepted',response.status===201);sceneId=saved.id;
const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'});
const loaded=await loadedResponse.json();check('fresh server read accepted',loadedResponse.ok&&!!loaded.graph);
check('durable payload matches document',JSON.stringify(loaded.graph.nodes[site.id].metadata[persistence.STREET_PROJECT_METADATA_KEY])===JSON.stringify(prepared.document));
const nodes=core.materializeRegisteredNodeDefaults(loaded.graph.nodes);
core.useScene.getState().setScene(nodes,loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
const reopened=store.loadStreetProject(site.id);
check('host hydration retains complete document',JSON.stringify(reopened.document)===JSON.stringify(prepared.document));
check('projection references resolve after hydration',reopened.projectionProblems.length===0);
const property=resolution.resolveStreetProperty(reopened.document.project,'baseline-corrected','sidewalk-width','walking-proposal');
check('source accepted and design values survive reopen',property.claims.osm.value===1.5&&property.accepted.value===1.8&&property.design.value===2.4);
check('baseline history and geometry survive reopen',Object.keys(reopened.document.project.baselineRevisions).length===2&&reopened.document.project.baselineRevisions['baseline-original'].roads['road-block'].data.edges.ab.startNodeId==='a');
check('legacy capture retains road and attached asset nodes',(()=>{const captured=store.captureLegacyStreetProject(site.id,{id:'legacy-check',name:'Legacy check',baselineRevisionId:'legacy',acceptedAt:'2026-10-08T10:00:00Z'});return Object.keys(captured.project.baselineRevisions.legacy.roads).length>0&&Object.values(captured.project.baselineRevisions.legacy.features).some(f=>f.data.name==='Streetscape phase 0 attached lamp')})());
return {pass:true,url:location.href,sceneId,sceneBytes:prepared.sceneBytes,results};
}catch(error){return {pass:false,error:error.message,sceneId,results}}finally{
core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});
core.useScene.temporal.setState(originalHistory);
}
})()).then(result => { window.__streetscapePersistenceResult = result; return result })
