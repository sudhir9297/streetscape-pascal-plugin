// Open Streetscape Lab > Map. Creates a separate server-backed verification scene.
(async()=>{
 let r;webpackChunk_N_E.push([['topology-check-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),importer=module('/streetscape/src/osm-import.ts'),terrain=module('/streetscape/src/osm-elevation.ts'),evidenceModule=module('/streetscape/src/domain/terrain-evidence.ts'),placement=module('/streetscape/src/osm-import-placement.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins};
 const history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 let sceneId;
 try{
  const center={lat:0,lon:0},topology=module('/streetscape/src/source/osm-topology.ts');
  const way=(id,nodes,coords,tags={})=>({id,tags:{highway:'residential',...tags},points:nodes.map((nodeId,i)=>({nodeId,lat:coords[i][0],lon:coords[i][1]}))});
  const ways=[way(10,[1,2,3],[[0,-.0008],[0,0],[0,.0008]]),way(20,[4,2,5],[[-.0008,0],[0,0],[.0008,0]],{bridge:'yes',layer:'1'}),way(30,[6,7],[[.0003,-.0005],[.0003,.0005]]),way(40,[6,7],[[.0003,-.0005],[.0003,.0005]])];
  const before=JSON.stringify(ways),logical=topology.buildOsmSourceTopology(ways);
  check('source topology is pure and deterministic',JSON.stringify(ways)===before&&JSON.stringify(logical)===JSON.stringify(topology.buildOsmSourceTopology([...ways].reverse())));
  check('grade conflict remains reviewable',logical.diagnostics.some(d=>d.code==='incompatible-shared-node'));
  const result=await importer.importStreetsFromOsm(center,100,{loadStreets:async()=>ways});
  const edges=result.graphs.flatMap(g=>Object.values(g.edges));
  const ground=new Set(edges.filter(e=>e.osmSource.wayId===10).flatMap(e=>[e.startNodeId,e.endNodeId]));
  check('grade-separated crossing has no shared host connection',edges.filter(e=>e.osmSource.wayId===20).every(e=>!ground.has(e.startNodeId)&&!ground.has(e.endNodeId)));
  check('straight parallel source way is retained',edges.some(e=>e.osmSource.wayId===30)&&edges.filter(e=>e.osmSource.wayId===40).length===2);
  check('synthetic host nodes explicitly derived',result.graphs.flatMap(g=>Object.values(g.graphNodes)).some(n=>n.osmTopologyOrigin?.kind==='derived'&&n.osmTopologyOrigin.reason==='simple-graph-adapter'));
  const activeLevelId=module('/packages/viewer/dist/store/use-viewer.js').default.getState().selection.levelId;
  const level=state.nodes[activeLevelId]??Object.values(state.nodes).find(node=>node.type==='level');
  const ids=placement.placeOsmImport(result,level.id);
  await new Promise(resolve=>setTimeout(resolve,150));
  check('Map panel exposes persisted evidence diagnostics',document.body.innerText.includes('OSM source report'));
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const savedResponse=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape source topology verification',graph})});
  const saved=await savedResponse.json();if(savedResponse.status!==201)throw Error('Server save '+savedResponse.status+': '+JSON.stringify(saved));check('server save accepted',savedResponse.status===201);sceneId=saved.id;
  const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();
  check('fresh server read accepted',loadedResponse.ok);
  const persisted=JSON.parse(loaded.graph.nodes[ids[0]].metadata.osmSourceTopology);
  check('logical topology survives server save',JSON.stringify(persisted)===JSON.stringify(result.sourceTopology));
  core.useScene.getState().setScene(core.materializeRegisteredNodeDefaults(loaded.graph.nodes),loaded.graph.rootNodeIds,{collections:loaded.graph.collections,materials:loaded.graph.materials,installedPlugins:loaded.graph.installedPlugins});
  check('derived provenance survives hydration',Object.values(core.useScene.getState().nodes[ids.find(id=>Object.values(loaded.graph.nodes[id].graphNodes).some(n=>n.osmTopologyOrigin?.kind==='derived'))].graphNodes).some(n=>n.osmTopologyOrigin?.kind==='derived'));
  return {pass:true,url:location.href,sceneId,nodeId:ids[0],checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);}
})()
