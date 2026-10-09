// Open Streetscape Lab > Map. Creates a separate server-backed verification scene.
(async()=>{
 let r;webpackChunk_N_E.push([['terrain-check-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),importer=module('/streetscape/src/osm-import.ts'),terrain=module('/streetscape/src/osm-elevation.ts'),evidenceModule=module('/streetscape/src/domain/terrain-evidence.ts'),placement=module('/streetscape/src/osm-import-placement.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
 const history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 let sceneId;
 try{
  const center={lat:0,lon:0};
  const roads=[{id:10,tags:{highway:'residential',ele:'110',layer:'8'},points:[{nodeId:1,...importer.localToGeo([-50,0],center)},{nodeId:2,...importer.localToGeo([50,0],center)}]}];
  const source={provider:'fixture',dataset:'terrain-browser',encoding:'decoded-grid',units:'metres',verticalReference:{kind:'datum',datumId:'fixture-datum'}};
  const zero=new terrain.TerrainSampler(15,async()=>({width:1,height:1,elevations:new Float32Array([0])}),{source});
  const measured=await importer.importStreetsFromOsm(center,100,{loadTerrain:true,terrainSampler:zero,loadStreets:async()=>roads});
  check('valid zero ground survives as measured data',measured.terrainEvidence.samples.every(sample=>sample.elevationMeters===0));
  check('unknown mapped reference does not change terrain heights',measured.terrainEvidence.roads[0].mappedElevation.reason==='reference-unknown'&&Object.values(measured.graphs[0].graphNodes).every(node=>node.position[1]===0));
  const partial=new terrain.TerrainSampler(15,async(_z,x)=>x===16384?null:{width:1,height:1,elevations:new Float32Array([100])},{source,now:()=> '2026-10-08T00:00:00.000Z',tileUrl:(z,x,y)=>'/fixture-terrain/'+z+'/'+x+'/'+y});
  const result=await importer.importStreetsFromOsm(center,100,{loadTerrain:true,terrainSampler:partial,mappedElevationDatumId:'different-datum',loadStreets:async()=>roads});
  const evidence=result.terrainEvidence;
  check('missing coverage and origin remain explicit',evidence.coverage.tiles.some(tile=>tile.status==='unavailable')&&evidence.diagnostics.some(item=>item.code==='missing-origin')&&evidence.samples.some(sample=>sample.elevationMeters===null));
  check('incompatible mapped reference remains an unapplied claim',evidence.roads[0].mappedElevation.reason==='reference-incompatible'&&!evidence.roads[0].mappedElevation.applied);
  const activeLevelId=module('/packages/viewer/dist/store/use-viewer.js').default.getState().selection.levelId;
  const level=state.nodes[activeLevelId]??Object.values(state.nodes).find(node=>node.type==='level');
  const ids=placement.placeOsmImport(result,level.id);
  await new Promise(resolve=>setTimeout(resolve,150));
  check('Map panel exposes persisted evidence diagnostics',document.body.innerText.includes('Terrain and elevation evidence'));
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const savedResponse=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape terrain evidence verification',graph})});
  const saved=await savedResponse.json();if(savedResponse.status!==201)throw Error('Server save '+savedResponse.status+': '+JSON.stringify(saved));check('server save accepted',savedResponse.status===201);sceneId=saved.id;
  const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();
  check('fresh server read accepted',loadedResponse.ok);
  const persisted=evidenceModule.parseTerrainEvidence(loaded.graph.nodes[ids[0]].metadata.osmTerrainEvidence);
  check('coverage and claims survive server save',JSON.stringify(persisted)===JSON.stringify(evidence));
  core.useScene.getState().setScene(core.materializeRegisteredNodeDefaults(loaded.graph.nodes),loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
  check('host hydration retains terrain evidence',evidenceModule.parseTerrainEvidence(core.useScene.getState().nodes[ids[0]].metadata.osmTerrainEvidence).roads[0].mappedElevation.raw==='110');
  return {pass:true,url:location.href,sceneId,nodeId:ids[0],checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);}
})()
