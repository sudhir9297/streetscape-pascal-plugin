// Open Streetscape Lab > Map. Uses an isolated verification graph and restores the user graph.
(async()=>{
 let r;webpackChunk_N_E.push([['baseline-bridge-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),viewer=module('/packages/viewer/dist/store/use-viewer.js').default,schemas=module('/streetscape/src/schema.ts'),importer=module('/streetscape/src/osm-import.ts'),sections=module('/streetscape/src/domain/street-sections.ts'),bridge=module('/streetscape/src/osm-baseline-bridge.ts'),snapshots=module('/streetscape/src/source/osm-source-snapshot.ts'),acquisitions=module('/streetscape/src/source/osm-acquisition.ts'),placement=module('/streetscape/src/osm-import-placement.ts'),persistence=module('/streetscape/src/host/street-project-persistence.ts'),store=module('/streetscape/src/host/street-project-store.ts'),compatibility=module('/streetscape/src/street-project-compatibility.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins},selection=viewer.getState().selection;
 const history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};let sceneId;
 try{
  const site=Object.values(state.nodes).find(n=>n.type==='site'),building=Object.values(state.nodes).find(n=>n.type==='building'),level=Object.values(state.nodes).find(n=>n.type==='level');
  const road=schemas.RoadNetworkNode.parse({id:'road-network_baseline-authored',parentId:level.id,name:'Baseline authored preservation',graphNodes:{a:{id:'a',position:[-20,.1,60]},b:{id:'b',position:[20,.1,60]}},edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b',alignment:[[0,.1,64]],styleId:'local-street'}},attachments:{lamp:{id:'lamp',edgeId:'ab',assetNodeId:'street-light_baseline-authored',kind:'lamp',station:5,lateralOffset:5,placementMode:'adjusted'}}});
  const lamp=schemas.StreetLightNode.parse({id:'street-light_baseline-authored',parentId:level.id,name:'Baseline authored lamp',roadAttachment:{networkNodeId:road.id,attachmentId:'lamp'}});
  const transform=module('/streetscape/src/road-edge-attachments.ts').resolveRoadAttachmentTransform(road,road.attachments.lamp,lamp);Object.assign(lamp,{position:transform.position,rotation:transform.rotation});
  const nodes={[site.id]:{...site,metadata:{},children:[building.id]},[building.id]:{...building,parentId:site.id,children:[level.id]},[level.id]:{...level,parentId:building.id,children:[road.id,lamp.id]},[road.id]:road,[lamp.id]:lamp};
  core.useScene.getState().setScene(nodes,[site.id],{collections:{},materials:original.materials,installedPlugins:original.installedPlugins});viewer.getState().setSelection({buildingId:building.id,levelId:level.id,selectedIds:[]});
  await new Promise(resolve=>setTimeout(resolve,180));
  const authoredBefore=JSON.stringify(core.useScene.getState().nodes[road.id]),lampBefore=JSON.stringify(core.useScene.getState().nodes[lamp.id]);
  const bbox={south:-.01,west:-.01,north:.01,east:.01};
  const acquisition=acquisitions.parseOsmAcquisition({format:'osm-acquisition',schemaVersion:1,bbox,responses:[{bbox,payload:{elements:[{type:'way',id:10,nodes:[1,2],geometry:[{lat:0,lon:-.0005},{lat:0,lon:.0005}],tags:{highway:'residential',width:'2',source:'US:NY',wikipedia:'en:Example'}},{type:'node',id:20,lat:0,lon:.0001,tags:{highway:'street_lamp',height:'6'}}]}}],diagnostics:[]});
  const snapshot=await snapshots.createOsmSourceSnapshot(acquisition),policy=sections.confirmStreetRegionalPolicy({id:'right-driving',version:1,status:'proposed',basis:'fallback',evidence:null},'right-driving'),acceptedAt='2026-10-08T10:00:00Z';
  const originalFetch=window.fetch;let requests=0;let a,b;
  try{window.fetch=async()=>{requests++;throw Error('Replay attempted a network request')};a=await bridge.resolveOsmSnapshotBaseline({snapshot,center:{lat:0,lon:0},radiusMeters:100,policy,acceptedAt});b=await bridge.resolveOsmSnapshotBaseline({snapshot,center:{lat:0,lon:0},radiusMeters:100,policy,acceptedAt});}finally{window.fetch=originalFetch}
  check('Gate G1 repeated snapshot replay is identical and offline',requests===0&&JSON.stringify(a)===JSON.stringify(b));
  const baseline=a.baselineRevisions[a.activeBaselineRevisionId];
  check('sparse dimensions remain estimates with raw contradictory width',baseline.diagnostics.items.some(i=>i.property==='laneWidth'&&i.severity==='review'&&i.evidence.rawClaims.width==='2'));
  const prepared=await importer.prepareOsmStreetImport({lat:0,lon:0},100,{loadAcquisition:async()=>acquisition,loadTerrain:false});
  const result=await importer.completeOsmStreetImport({...prepared,regionalPolicy:policy});
  const before=core.useScene.temporal.getState().pastStates.length;
  const ids=placement.placeOsmImport(result,level.id,undefined,{resolveBaseline:true,acceptedAt});
  check('semantic document and scene projection share one undo entry',core.useScene.temporal.getState().pastStates.length===before+1);
  await new Promise(resolve=>setTimeout(resolve,180));
  check('authored road and attached lamp retain their full effective values',JSON.stringify(core.useScene.getState().nodes[road.id])===authoredBefore&&JSON.stringify(core.useScene.getState().nodes[lamp.id])===lampBefore);
  const document=persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]);
  check('baseline document is retained by root site',!!document&&document.projection.bindings.some(binding=>binding.nodeIds[0]===ids[0]));
  check('Map exposes inspectable baseline document',!!window.document.querySelector('[aria-label="Baseline document"]'));
  const active=document.project.baselineRevisions[document.project.activeBaselineRevisionId],converted=active.roads[road.id];
  check('authored conversion has no fabricated source or geographic frame',converted.origin==='legacy-authored'&&converted.sourceReferenceIds.length===0&&converted.data.coordinateFrameId===null);
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const response=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape semantic baseline bridge verification',graph})});const saved=await response.json();if(response.status!==201)throw Error('Save '+response.status+': '+JSON.stringify(saved));sceneId=saved.id;check('server save accepted',response.status===201);
  const reopenedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),reopened=await reopenedResponse.json();check('fresh server read accepted',reopenedResponse.ok);
  core.useScene.getState().setScene(core.materializeRegisteredNodeDefaults(reopened.graph.nodes),reopened.graph.rootNodeIds,{collections:reopened.graph.collections,materials:reopened.graph.materials,installedPlugins:reopened.graph.installedPlugins});
  const loaded=await store.loadVerifiedStreetProject(site.id),loadedBaseline=loaded.document.project.baselineRevisions[loaded.document.project.activeBaselineRevisionId];
  check('embedded snapshot verifies after hydration',Object.values(loaded.snapshots)[0].contentIdentity===snapshot.contentIdentity);
  check('semantic identity, values and diagnostics survive server persistence',JSON.stringify(loaded.document.project)===JSON.stringify(document.project));
  check('authored road remains editable through renderer adapter',compatibility.readResolvedCurrentRoad(loaded.document.project,loadedBaseline.id,road.id).attachments.lamp.placementMode==='adjusted');
  return {pass:true,url:location.href,sceneId,checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);viewer.getState().setSelection(selection);}
})()
