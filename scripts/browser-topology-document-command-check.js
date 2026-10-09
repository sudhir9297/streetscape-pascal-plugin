(async()=>{
 let r;webpackChunk_N_E.push([['road-segment-check-'+Date.now()],{},x=>r=x]);const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),tool=module('/streetscape/src/road-network-tool.tsx'),commands=module('/streetscape/src/host/application-change-set.ts'),store=module('/streetscape/src/store.ts').useStreetscapeStore,deletions=module('/streetscape/src/road-edge-delete-command.ts');
 const compat=module('/streetscape/src/street-project-compatibility.ts'),persistence=module('/streetscape/src/host/street-project-persistence.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins},history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]},settings={roadAutoInfrastructure:store.getState().roadAutoInfrastructure,roadElevationMode:store.getState().roadElevationMode,roadJoinMode:store.getState().roadJoinMode};
 const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 try{
  const site=Object.values(state.nodes).find(n=>n.type==='site'),building=Object.values(state.nodes).find(n=>n.type==='building'),level=Object.values(state.nodes).find(n=>n.type==='level');
  core.useScene.getState().setScene({[site.id]:{...site,metadata:{},children:[building.id]},[building.id]:{...building,parentId:site.id,children:[level.id]},[level.id]:{...level,parentId:building.id,children:[]}},[site.id],{collections:{},materials:state.materials,installedPlugins:state.installedPlugins});
  store.setState({roadAutoInfrastructure:{...settings.roadAutoInfrastructure,enabled:false},roadElevationMode:'ground',roadJoinMode:'auto'});
  const project=compat.createLegacyStreetProject({id:'topology-browser-project',name:'Topology document commands',baselineRevisionId:'original',acceptedAt:'2026-10-08T10:00:00Z',roads:[]});
  const prepared=persistence.prepareStreetProjectPersistence(core.useScene.getState(),site.id,{project,projection:{baselineRevisionId:'original',scenarioId:null,bindings:[]},expectedRevision:null});
  core.useScene.getState().applyNodeChanges({update:[{id:site.id,data:{metadata:prepared.metadata}}]});
  const before=core.useScene.getState().nodes,count=core.useScene.temporal.getState().pastStates.length;
  const first=tool.prepareRoadSegmentCommand(level.id,[-20,0,0],[20,0,0],[]);
  check('road creation prepares without any persistent writes',first&&core.useScene.getState().nodes===before&&core.useScene.temporal.getState().pastStates.length===count);
  commands.commitHostStreetChangeSet(first.change);check('road creation is one undo action',core.useScene.temporal.getState().pastStates.length===count+1);
  const firstDocument=persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]);
  check('creation advances the accepted document and adds its road binding',firstDocument.project.revision===1&&firstDocument.projection.bindings.filter(b=>b.category==='roads').length===1);
  const initial=core.useScene.getState().nodes,initialCount=core.useScene.temporal.getState().pastStates.length;
  const crossing=tool.prepareRoadSegmentCommand(level.id,[0,0,-20],[0,0,20],[]);
  check('intersection planning leaves the accepted road untouched',crossing&&core.useScene.getState().nodes===initial);
  check('crossing includes explicit edge lineage remaps',crossing.change.identityRemaps.some(remap=>remap.from.kind==='road-edge'&&remap.to.length===2));
  commands.commitHostStreetChangeSet(crossing.change);
  const roads=Object.values(core.useScene.getState().nodes).filter(n=>n.type==='streetscape:road-network');
  check('crossing creates four edges in one undo action',roads.length===1&&Object.keys(roads[0].edges).length===4&&core.useScene.temporal.getState().pastStates.length===initialCount+1);
  const crossingDocument=persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]);
  const roadId=crossingDocument.projection.bindings.find(b=>b.category==='roads').featureId;
  check('crossing advances the accepted document in the same action',crossingDocument.project.revision===2);
  check('historical accepted revisions remain exact',Object.keys(firstDocument.project.baselineRevisions).every(id=>JSON.stringify(firstDocument.project.baselineRevisions[id])===JSON.stringify(crossingDocument.project.baselineRevisions[id])));
  check('accepted document compiles all four crossing edges',Object.keys(compat.readResolvedCurrentRoad(crossingDocument.project,crossingDocument.project.activeBaselineRevisionId,roadId).edges).length===4);
  core.useScene.temporal.getState().undo();check('one undo restores the complete unsplit road',JSON.stringify(core.useScene.getState().nodes)===JSON.stringify(initial));
  const delayed=tool.prepareRoadSegmentCommand(level.id,[0,0,-20],[0,0,20],[]);core.useScene.getState().updateNode(level.id,{name:'Concurrent edit during planning'});const newer=core.useScene.getState().nodes;let stale=false;try{commands.commitHostStreetChangeSet(delayed.change)}catch(e){stale=/Scene changed/.test(e.message)};
  check('stale creation plan cannot overwrite a newer edit',stale&&core.useScene.getState().nodes===newer);
  const currentRoad=Object.values(core.useScene.getState().nodes).find(n=>n.type==='streetscape:road-network');
  const deletionBefore=core.useScene.getState().nodes,deletionCount=core.useScene.temporal.getState().pastStates.length;
  const removal=deletions.prepareRoadEdgeDeletion(currentRoad,Object.keys(currentRoad.edges)[0]);
  check('last-edge deletion prepares without changing scene or document',removal&&core.useScene.getState().nodes===deletionBefore);
  commands.commitHostStreetChangeSet(removal);
  const deleted=persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]);
  check('last-edge deletion removes scene node and accepted road binding together',!core.useScene.getState().nodes[currentRoad.id]&&deleted.projection.bindings.every(b=>b.category!=='roads')&&Object.keys(deleted.project.baselineRevisions[deleted.project.activeBaselineRevisionId].roads).length===0);
  check('last-edge deletion has one undo entry',core.useScene.temporal.getState().pastStates.length===deletionCount+1);
  core.useScene.temporal.getState().undo();check('undo restores deleted road and accepted document',JSON.stringify(core.useScene.getState().nodes)===JSON.stringify(deletionBefore));
  return {pass:true,url:location.href,checks};
 }catch(error){return {pass:false,error:error.message,checks}}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);store.setState(settings)}
})()
