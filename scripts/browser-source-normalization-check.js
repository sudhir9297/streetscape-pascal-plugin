// Open Streetscape Lab > Map. Creates a separate server-backed verification scene.
(async()=>{
 let r;webpackChunk_N_E.push([['normalization-check-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),importer=module('/streetscape/src/osm-import.ts'),terrain=module('/streetscape/src/osm-elevation.ts'),evidenceModule=module('/streetscape/src/domain/terrain-evidence.ts'),placement=module('/streetscape/src/osm-import-placement.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
 const history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 let sceneId;
 try{
  const center={lat:0,lon:0},bbox={south:-.01,west:-.01,north:.01,east:.01};
  const normalization=module('/streetscape/src/source/osm-normalization.ts');
  const raw={format:'osm-acquisition',schemaVersion:1,bbox,responses:[{bbox,payload:{elements:[
   {type:'way',id:10,nodes:[1,2],tags:{highway:'residential',width:'20 ft',lanes:'2',source:'US:NY'},geometry:[{lat:0,lon:-.0005},{lat:0,lon:.0005}]},
   {type:'way',id:20,nodes:[3,4,5],tags:{highway:'residential'},geometry:[{lat:.0002,lon:-.0005},null,{lat:.0002,lon:.0005}]},
   {type:'way',id:30,nodes:[6,7],tags:{highway:'construction'},geometry:[{lat:.0003,lon:-.0005},{lat:.0003,lon:.0005}]}
  ]}}],diagnostics:[]};
  const before=JSON.stringify(raw),first=normalization.normalizeOsmAcquisition(raw);
  check('deterministic pure normalization',JSON.stringify(first)===JSON.stringify(normalization.normalizeOsmAcquisition(raw))&&JSON.stringify(raw)===before);
  check('feet normalized without changing raw tags',first.features.find(f=>f.id===10).road.dimensions.width===6.096);
  check('incomplete and unsupported roads remain rejected evidence',first.features.filter(f=>f.disposition==='rejected').length===2&&first.features.find(f=>f.id===20).raw.geometry[1]===null);
  const prepared=await importer.prepareOsmStreetImport(center,100,{loadAcquisition:async()=>raw});
  const result=await importer.completeOsmStreetImport(prepared);
  check('report linked to immutable snapshot',result.normalization.sourceContentIdentity===prepared.sourceSnapshot.contentIdentity);
  check('only accepted road generates geometry',result.stats.edges===1);
  const activeLevelId=module('/packages/viewer/dist/store/use-viewer.js').default.getState().selection.levelId;
  const level=state.nodes[activeLevelId]??Object.values(state.nodes).find(node=>node.type==='level');
  const ids=placement.placeOsmImport(result,level.id);
  await new Promise(resolve=>setTimeout(resolve,150));
  check('Map panel exposes persisted evidence diagnostics',document.body.innerText.includes('OSM source report'));
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const savedResponse=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape source normalization verification',graph})});
  const saved=await savedResponse.json();if(savedResponse.status!==201)throw Error('Server save '+savedResponse.status+': '+JSON.stringify(saved));check('server save accepted',savedResponse.status===201);sceneId=saved.id;
  const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();
  check('fresh server read accepted',loadedResponse.ok);
  const persisted=normalization.parseNormalizedOsmSource(loaded.graph.nodes[ids[0]].metadata.osmNormalizationReport);
  check('raw rejected inputs and source tags survive server save',JSON.stringify(persisted)===JSON.stringify(result.normalization)&&persisted.features.find(f=>f.id===10).raw.tags.source==='US:NY');
  core.useScene.getState().setScene(core.materializeRegisteredNodeDefaults(loaded.graph.nodes),loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
  check('host hydration retains rejected geometry',normalization.parseNormalizedOsmSource(core.useScene.getState().nodes[ids[0]].metadata.osmNormalizationReport).features.find(f=>f.id===20).raw.geometry[1]===null);
  return {pass:true,url:location.href,sceneId,nodeId:ids[0],checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);}
})()
