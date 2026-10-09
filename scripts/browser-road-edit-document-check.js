(async () => {
 let r; webpackChunk_N_E.push([['road-document-'+Date.now()],{},x=>r=x]);
 const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'), schema=module('/streetscape/src/schema.ts'), compat=module('/streetscape/src/street-project-compatibility.ts'), persistence=module('/streetscape/src/host/street-project-persistence.ts'), commands=module('/streetscape/src/road-edit-commit.ts');
 const scene=core.useScene.getState(),original={nodes:scene.nodes,rootNodeIds:scene.rootNodeIds,collections:scene.collections,materials:scene.materials,installedPlugins:scene.installedPlugins},history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 try {
  const site=Object.values(scene.nodes).find(n=>n.type==='site'),building=Object.values(scene.nodes).find(n=>n.type==='building'),level=Object.values(scene.nodes).find(n=>n.type==='level');
  const road=schema.RoadNetworkNode.parse({id:'road-network_document-command',parentId:level.id,graphNodes:{a:{id:'a',position:[0,.1,0]},b:{id:'b',position:[20,.1,0]}},edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b'}}});
  core.useScene.getState().setScene({[site.id]:{...site,metadata:{},children:[building.id]},[building.id]:{...building,parentId:site.id,children:[level.id]},[level.id]:{...level,parentId:building.id,children:[road.id]},[road.id]:road},[site.id],{collections:{},materials:scene.materials,installedPlugins:scene.installedPlugins});
  const project=compat.convertStreetProjectRoads(compat.createLegacyStreetProject({id:'road-command-project',name:'Road command verification',baselineRevisionId:'original',acceptedAt:'2026-10-08T10:00:00Z',roads:[road]}));
  const prepared=persistence.prepareStreetProjectPersistence(core.useScene.getState(),site.id,{project,projection:{baselineRevisionId:'original',scenarioId:null,bindings:[{category:'roads',featureId:road.id,nodeIds:[road.id]}]},expectedRevision:null});
  core.useScene.getState().applyNodeChanges({update:[{id:site.id,data:{metadata:prepared.metadata}}]});
  const before=core.useScene.getState().nodes,count=core.useScene.temporal.getState().pastStates.length;
  const patch={graphNodes:{...road.graphNodes,b:{...road.graphNodes.b,position:[30,.1,0]}}};
  const command=commands.prepareRoadGeometryEdit(road,patch);
  check('preparation leaves accepted geometry and document untouched',core.useScene.getState().nodes===before);
  commands.commitRoadGeometryEdit(road,patch,command.expected);
  const stored=persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]);
  check('scene and document share one undo entry',core.useScene.temporal.getState().pastStates.length===count+1);
  check('document revision advances',stored.project.revision===project.revision+1);
  check('historical baseline is retained unchanged',JSON.stringify(stored.project.baselineRevisions.original)===JSON.stringify(project.baselineRevisions.original));
  const resolved=compat.readResolvedCurrentRoad(stored.project,stored.project.activeBaselineRevisionId,road.id);
  check('accepted baseline compiles the edited geometry',resolved.graphNodes.b.position[0]===30);
  check('new geometry has authored evidence',Object.values(stored.project.baselineRevisions[stored.project.activeBaselineRevisionId].propertyEvidence).some(p=>p.target.path.join('/')==='referenceNodes/b/position'&&p.accepted.kind==='claim'&&p.claims[p.accepted.claimId].origin.kind==='authored'));
  core.useScene.temporal.getState().undo();check('undo restores both geometry and complete document',JSON.stringify(core.useScene.getState().nodes)===JSON.stringify(before));
  const stale=commands.captureRoadEditPreconditions(road);core.useScene.getState().updateNode(level.id,{name:'Newer edit'});const newer=core.useScene.getState().nodes;let rejected=false;try{commands.commitRoadGeometryEdit(road,patch,stale)}catch(e){rejected=/Scene changed/.test(e.message)};
  check('stale preview cannot replace the newer scene or document',rejected&&core.useScene.getState().nodes===newer);
  return {pass:true,url:location.href,checks};
 }catch(error){return {pass:false,error:error.message,checks}}
 finally {core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory)}
})()
