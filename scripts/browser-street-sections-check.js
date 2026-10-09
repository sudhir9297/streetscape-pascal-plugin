// Open Streetscape Lab > Map. Creates a separate server-backed verification scene.
(async()=>{
 let r;webpackChunk_N_E.push([['sections-check-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),importer=module('/streetscape/src/osm-import.ts'),terrain=module('/streetscape/src/osm-elevation.ts'),evidenceModule=module('/streetscape/src/domain/terrain-evidence.ts'),placement=module('/streetscape/src/osm-import-placement.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
 const history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 let sceneId;
 try{
  const center={lat:0,lon:0},sections=module('/streetscape/src/domain/street-sections.ts');
  const roads=[{id:10,tags:{highway:'residential',width:'2',lanes:'2',driving_side:'left',source:'US:NY'},points:[{nodeId:1,lat:0,lon:-.0005},{nodeId:2,lat:0,lon:.0005}]}];
  const prepared=await importer.prepareOsmStreetImport(center,100,{loadStreets:async()=>roads});
  check('location evidence proposes unconfirmed left-driving policy',prepared.regionalPolicy.id==='left-driving'&&prepared.regionalPolicy.status==='proposed');
  const confirmed=sections.confirmStreetRegionalPolicy(prepared.regionalPolicy,'left-driving');
  const result=await importer.completeOsmStreetImport({...prepared,regionalPolicy:confirmed});
  const section=result.sectionReport.sections[0];
  check('missing sidewalk presence remains unknown',section.values.leftSidewalkPresence.value===null);
  check('preview widths are visibly estimated with raw incompatible claim',section.values.laneWidth.origin==='estimate'&&section.values.laneWidth.rawClaims.width==='2');
  const activeLevelId=module('/packages/viewer/dist/store/use-viewer.js').default.getState().selection.levelId;
  const level=state.nodes[activeLevelId]??Object.values(state.nodes).find(node=>node.type==='level');
  const ids=placement.placeOsmImport(result,level.id);
  await new Promise(resolve=>setTimeout(resolve,150));
  check('Map panel exposes persisted evidence diagnostics',document.body.innerText.includes('Street section evidence')&&document.body.innerText.includes('left-driving (confirmed)'));
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const savedResponse=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape section evidence verification',graph})});
  const saved=await savedResponse.json();if(savedResponse.status!==201)throw Error('Server save '+savedResponse.status+': '+JSON.stringify(saved));check('server save accepted',savedResponse.status===201);sceneId=saved.id;
  const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();
  check('fresh server read accepted',loadedResponse.ok);
  const persisted=sections.parseStreetSectionReport(loaded.graph.nodes[ids[0]].metadata.osmSectionReport);
  check('section provenance survives server save',JSON.stringify(persisted)===JSON.stringify(result.sectionReport));
  core.useScene.getState().setScene(core.materializeRegisteredNodeDefaults(loaded.graph.nodes),loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
  check('confirmed regional pack survives hydration',core.useScene.getState().nodes[ids[0]].regionalPack==='left-driving');
  return {pass:true,url:location.href,sceneId,nodeId:ids[0],checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);}
})()
