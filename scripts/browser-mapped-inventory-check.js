// Open Streetscape Lab > Map. Creates a separate server-backed verification scene.
(async()=>{
 let r;webpackChunk_N_E.push([['inventory-check-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),importer=module('/streetscape/src/osm-import.ts'),terrain=module('/streetscape/src/osm-elevation.ts'),evidenceModule=module('/streetscape/src/domain/terrain-evidence.ts'),placement=module('/streetscape/src/osm-import-placement.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
 const history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 let sceneId;
 try{
  const center={lat:0,lon:0},corridors=module('/streetscape/src/osm-road-corridors.ts'),inventory=module('/streetscape/src/domain/mapped-inventory.ts');
  const road=(id,z)=>({id,tags:{highway:'residential'},points:[{nodeId:id*10,...importer.localToGeo([-50,z],center)},{nodeId:id*10+1,...importer.localToGeo([50,z],center)}]});
  const surface={id:90,kind:'sidewalk',sourceType:'way',tags:{highway:'footway',footway:'sidewalk',source:'US:NY'},points:[-40,40].map((x,i)=>({nodeId:900+i,...importer.localToGeo([x,4],center)}))};
  const prepared=await importer.prepareOsmStreetImport(center,100,{loadMapData:async()=>({ways:[road(10,0),road(20,8)],mappedSurfaces:[surface],crossings:[],laneConnectivity:[],pointFeatures:[]})});
  const pending=prepared.inventoryReport.items[0];
  check('ambiguous corridor retains candidates without acceptance',pending.status==='pending'&&pending.candidates.length===2);
  const result=await importer.completeOsmStreetImport({...prepared,associationChoices:{[pending.id]:pending.candidates[0].id}});
  check('manual choice resolves inventory',result.inventoryReport.items[0].basis==='manual'&&result.inventoryReport.items[0].status==='resolved');
  const activeLevelId=module('/packages/viewer/dist/store/use-viewer.js').default.getState().selection.levelId;
  const level=state.nodes[activeLevelId]??Object.values(state.nodes).find(node=>node.type==='level');
  const ids=placement.placeOsmImport(result,level.id);
  await new Promise(resolve=>setTimeout(resolve,150));
  check('Map panel exposes persisted evidence diagnostics',document.body.innerText.includes('Mapped inventory review'));
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const savedResponse=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape mapped inventory verification',graph})});
  const saved=await savedResponse.json();if(savedResponse.status!==201)throw Error('Server save '+savedResponse.status+': '+JSON.stringify(saved));check('server save accepted',savedResponse.status===201);sceneId=saved.id;
  const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();
  check('fresh server read accepted',loadedResponse.ok);
  const persisted=inventory.parseMappedInventoryReport(loaded.graph.nodes[ids[0]].metadata.osmInventoryReport);
  check('candidate choices and raw source survive save',persisted.items[0].basis==='manual'&&persisted.items[0].source.tags.source==='US:NY');
  core.useScene.getState().setScene(core.materializeRegisteredNodeDefaults(loaded.graph.nodes),loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
  check('resolved mapped surface survives hydration',ids.some(id=>core.useScene.getState().nodes[id].osmMappedSurfaces.some(s=>s.id===90)));
  const network=ids.map(id=>core.useScene.getState().nodes[id]).find(n=>n.osmMappedSurfaces.length);
  const profiles=module('/streetscape/src/road-transition-profile.ts').buildRoadTransitionProfiles(network);
  const mask=module('/streetscape/src/road-mapped-band-mask.ts').maskMappedComponentsForProfile;
  check('mapped sidewalk replaces estimated band through interior stations',profiles.some(p=>{const m=mask(network,p),side=network.osmMappedSurfaces[0].side;return m.samples.filter(s=>Math.abs(s.point[0])<35).every(s=>s.components[side].sidewalk.width===0)}));
  return {pass:true,url:location.href,sceneId,nodeId:ids[0],checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);}
})()
