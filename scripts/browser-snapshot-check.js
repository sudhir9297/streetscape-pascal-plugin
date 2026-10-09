// Open Streetscape Lab first. Creates a separate server-backed verification scene.
(async()=>{
let r;webpackChunk_N_E.push([['snapshot-browser-'+Date.now()],{},x=>r=x]);const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
const c=module('/packages/core/dist/index.js'),store=module('/streetscape/src/host/street-project-store.ts'),acq=module('/streetscape/src/source/osm-acquisition.ts'),snap=module('/streetscape/src/source/osm-source-snapshot.ts'),projectModule=module('/streetscape/src/source/osm-snapshot-project.ts'),interpret=module('/streetscape/src/source/osm-interpretation.ts'),encoding=module('/streetscape/src/host/osm-projection-encoding.ts');
const state=c.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
const history=c.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
let sceneId;
try{
 const fixture={"format":"osm-acquisition","schemaVersion":1,"bbox":{"south":-0.01,"west":-0.01,"north":0.01,"east":0.01},"responses":[{"bbox":{"south":-0.01,"west":-0.01,"north":0.01,"east":0.01},"payload":{"version":0.6,"generator":"recorded-fixture","elements":[{"type":"way","id":10,"nodes":[1,2,3],"geometry":[{"lat":0,"lon":-0.001},{"lat":0,"lon":0},{"lat":0,"lon":0.001}],"tags":{"highway":"residential","wikipedia":"en:Example","width":"8","source":"US:NY"}},{"type":"node","id":20,"lat":0,"lon":0.0001,"tags":{"highway":"street_lamp","height":"6"}},{"type":"node","id":21,"lat":0,"lon":0,"tags":{"highway":"crossing","crossing":"marked"}}]}}],"diagnostics":[]};
 const payload=fixture.responses[0].payload;
 for(const element of payload.elements)Object.assign(element,{version:1,timestamp:'2026-10-08T10:00:00Z',changeset:7,uid:8,user:'fixture-user'});
 const acquisition=await acq.acquireOsmData(fixture.bbox,{now:()=> '2026-10-08T10:00:00Z',request:()=>({url:'/fixture-only',elementMetadataRequested:true}),fetch:async()=>new Response(JSON.stringify(payload),{headers:{'content-type':'application/json',etag:'snapshot-fixture'}})});
 const snapshot=await snap.createOsmSourceSnapshot(acquisition);
 check('snapshot immutable and metadata complete',Object.isFrozen(snapshot.acquisition.responses[0].payload.elements)&&snapshot.completeness.elementMetadata.status==='complete');
 const map=interpret.interpretOsmAcquisition(acquisition),encoded=encoding.encodeOsmHostProjection({edges:{road:{osmSource:{tags:map.ways[0].tags}}}});
 check('source values unchanged, host projection encoded',map.ways[0].tags.wikipedia==='en:Example'&&encoded.edges.road.osmSource.tags.wikipedia==='https://en.wikipedia.org/wiki/Example');
 const site=Object.values(state.nodes).find(n=>n.type==='site');
 const captured=store.captureLegacyStreetProject(site.id,{id:'snapshot-browser-check',name:'Snapshot verification',baselineRevisionId:'baseline-snapshot',acceptedAt:'2026-10-08T10:00:00Z'});
 const project=await projectModule.attachOsmSourceSnapshot(captured.project,'captured-osm',snapshot);
 await store.persistVerifiedStreetProject(site.id,{project,projection:captured.projection,expectedRevision:null});
 const current=c.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
 const response=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape immutable snapshot verification',graph})});
 const created=await response.json();check('server save accepted',response.status===201);sceneId=created.id;
 const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();check('fresh server read accepted',loadedResponse.ok);
 c.useScene.getState().setScene(c.materializeRegisteredNodeDefaults(loaded.graph.nodes),loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
 const reopened=await store.loadVerifiedStreetProject(site.id),persisted=reopened.snapshots['captured-osm'];
 check('saved snapshot verifies after host hydration',persisted.contentIdentity===snapshot.contentIdentity&&persisted.integrityIdentity===snapshot.integrityIdentity);
 check('capture time and raw metadata survive reopen',persisted.acquiredAt==='2026-10-08T10:00:00Z'&&persisted.acquisition.responses[0].capture.etag==='snapshot-fixture'&&persisted.acquisition.responses[0].payload.elements[0].tags.wikipedia==='en:Example');
 const tampered=JSON.parse(JSON.stringify(persisted));tampered.acquisition.responses[0].payload.elements[0].tags.width='999';let rejected=false;try{await snap.parseOsmSourceSnapshot(tampered)}catch(error){rejected=/identity mismatch/.test(error.message)}
 check('tampered saved content rejected',rejected);
 return {pass:true,url:location.href,sceneId,contentIdentity:snapshot.contentIdentity,integrityIdentity:snapshot.integrityIdentity,checks};
}catch(error){return {pass:false,error:error.message,sceneId,checks}}finally{
 c.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});c.useScene.temporal.setState(oldHistory);
}
})()
