(async()=>{
 let r;webpackChunk_N_E.push([['merge-assets-'+Date.now()],{},x=>r=x]);const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),schema=module('/streetscape/src/schema.ts'),tool=module('/streetscape/src/road-network-tool.tsx'),commands=module('/streetscape/src/host/application-change-set.ts'),store=module('/streetscape/src/store.ts').useStreetscapeStore,compat=module('/streetscape/src/street-project-compatibility.ts'),persistence=module('/streetscape/src/host/street-project-persistence.ts'),capture=module('/streetscape/src/host/street-project-store.ts'),auto=module('/streetscape/src/road-auto-infrastructure-settings.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins},history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]},settings={roadAutoInfrastructure:store.getState().roadAutoInfrastructure,roadElevationMode:store.getState().roadElevationMode,roadJoinMode:store.getState().roadJoinMode};
 let diagnostic;
 const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 try{
  const site=Object.values(state.nodes).find(n=>n.type==='site'),building=Object.values(state.nodes).find(n=>n.type==='building'),level=Object.values(state.nodes).find(n=>n.type==='level');
  const a=schema.RoadNetworkNode.parse({id:'road-network_merge-a',parentId:level.id,graphNodes:{a:{id:'a',position:[-30,0,0]},b:{id:'b',position:[-10,0,0]}},edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b'}}});
  const b=schema.RoadNetworkNode.parse({...a,id:'road-network_merge-b',graphNodes:{a:{id:'a',position:[10,0,0]},b:{id:'b',position:[30,0,0]}},attachments:{lamp:{id:'lamp',edgeId:'ab',assetNodeId:'street-light_merge-adjusted',station:5,lateralOffset:4,placementMode:'adjusted'}}});
  b.stylePresets[b.activeStyleId]={...b.stylePresets[b.activeStyleId],laneWidth:a.stylePresets[a.activeStyleId].laneWidth+1};
  const lamp=schema.StreetLightNode.parse({id:'street-light_merge-adjusted',parentId:level.id,position:[15,0,4],roadAttachment:{networkNodeId:b.id,attachmentId:'lamp'}});
  core.useScene.getState().setScene({[site.id]:{...site,metadata:{},children:[building.id]},[building.id]:{...building,parentId:site.id,children:[level.id]},[level.id]:{...level,parentId:building.id,children:[a.id,b.id,lamp.id]},[a.id]:a,[b.id]:b,[lamp.id]:lamp},[site.id],{collections:{},materials:state.materials,installedPlugins:state.installedPlugins});
  store.setState({roadAutoInfrastructure:{...settings.roadAutoInfrastructure,enabled:false},roadElevationMode:'ground',roadJoinMode:'auto'});
  const recorded=capture.captureLegacyStreetProject(site.id,{id:'merge-project',name:'Merge and generated assets',baselineRevisionId:'original',acceptedAt:'2026-10-08T10:00:00Z'}),project=compat.convertStreetProjectRoads(recorded.project);
  const prepared=persistence.prepareStreetProjectPersistence(core.useScene.getState(),site.id,{project,projection:recorded.projection,expectedRevision:null});core.useScene.getState().applyNodeChanges({update:[{id:site.id,data:{metadata:prepared.metadata}}]});
  await new Promise(resolve=>setTimeout(resolve,250));
  const before=core.useScene.getState().nodes,count=core.useScene.temporal.getState().pastStates.length;
  const merged=tool.prepareRoadSegmentCommand(level.id,[-10,0,0],[10,0,0],[]);check('collision-safe merge prepares without writes',merged&&core.useScene.getState().nodes===before);
  const predicted=commands.prepareHostStreetChangeSet(merged.change).next;
  commands.commitHostStreetChangeSet(merged.change);await new Promise(resolve=>setTimeout(resolve,250));
  let current=core.useScene.getState(),roads=Object.values(current.nodes).filter(n=>n.type==='streetscape:road-network'),document=persistence.readStreetProjectFromSite(current.nodes[site.id]);
  check('two roads with colliding node and edge IDs merge without losing edges',roads.length===1&&Object.keys(roads[0].edges).length===3&&Object.keys(roads[0].graphNodes).length===4);
  check('colliding style IDs retain both authored lane widths',Object.values(roads[0].edges).some(e=>roads[0].stylePresets[e.styleId].laneWidth===a.stylePresets[a.activeStyleId].laneWidth)&&Object.values(roads[0].edges).some(e=>roads[0].stylePresets[e.styleId].laneWidth===b.stylePresets[b.activeStyleId].laneWidth));
  check('merged asset retains station and adjusted status',Object.values(roads[0].attachments).some(a=>a.assetNodeId===lamp.id&&a.station===5&&a.placementMode==='adjusted'));
  check('asset reverse reference follows new road ownership',current.nodes[lamp.id].roadAttachment.networkNodeId===roads[0].id);
  check('accepted road bindings merge and historical baseline is unchanged',document.projection.bindings.filter(b=>b.category==='roads').length===1&&JSON.stringify(document.project.baselineRevisions.original)===JSON.stringify(project.baselineRevisions.original));
  diagnostic={historyDelta:core.useScene.temporal.getState().pastStates.length-count,changed:Object.keys(predicted.nodes).filter(id=>JSON.stringify(predicted.nodes[id])!==JSON.stringify(current.nodes[id])).map(id=>({id,fields:Object.keys(predicted.nodes[id]).filter(field=>JSON.stringify(predicted.nodes[id][field])!==JSON.stringify(current.nodes[id]?.[field]))}))};
  check('merge is exactly one undo action',core.useScene.temporal.getState().pastStates.length===count+1);
  core.useScene.temporal.getState().undo();check('merge undo restores roads, asset and document',JSON.stringify(core.useScene.getState().nodes)===JSON.stringify(before));
  store.setState({roadAutoInfrastructure:auto.FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS});
  const generated=tool.prepareRoadSegmentCommand(level.id,[-10,0,0],[10,0,0],[]);commands.commitHostStreetChangeSet(generated.change);await new Promise(resolve=>setTimeout(resolve,250));
  current=core.useScene.getState();document=persistence.readStreetProjectFromSite(current.nodes[site.id]);roads=Object.values(current.nodes).filter(n=>n.type==='streetscape:road-network');
  const generatedIds=Object.values(roads[0].attachments).filter(a=>a.generatedKey).map(a=>a.assetNodeId);
  check('generated infrastructure is created and bound in accepted document',generatedIds.length>0&&generatedIds.every(id=>document.projection.bindings.some(b=>b.category==='features'&&b.nodeIds.includes(id))));
  const generationBefore=current.nodes,generationCount=core.useScene.temporal.getState().pastStates.length,priorBaseline=document.project.baselineRevisions[document.project.activeBaselineRevisionId];
  const crossing=tool.prepareRoadSegmentCommand(level.id,[0,0,-20],[0,0,20],[]);const crossingPredicted=commands.prepareHostStreetChangeSet(crossing.change).next;commands.commitHostStreetChangeSet(crossing.change);await new Promise(resolve=>setTimeout(resolve,250));
  current=core.useScene.getState();document=persistence.readStreetProjectFromSite(current.nodes[site.id]);
  check('replacement bindings contain no missing assets',document.projection.bindings.every(binding=>binding.nodeIds.every(id=>current.nodes[id])));
  check('generated replacement retains prior accepted baseline',JSON.stringify(document.project.baselineRevisions[priorBaseline.id])===JSON.stringify(priorBaseline));
  diagnostic={historyDelta:core.useScene.temporal.getState().pastStates.length-generationCount,changed:Object.keys(crossingPredicted.nodes).filter(id=>JSON.stringify(crossingPredicted.nodes[id])!==JSON.stringify(current.nodes[id])).map(id=>({id,before:crossingPredicted.nodes[id],after:current.nodes[id]}))};
  check('generated replacement is one undo action',core.useScene.temporal.getState().pastStates.length===generationCount+1);
  core.useScene.temporal.getState().undo();check('replacement undo restores all prior assets and document',JSON.stringify(core.useScene.getState().nodes)===JSON.stringify(generationBefore));
  return {pass:true,url:location.href,generatedAssetCount:generatedIds.length,checks};
 }catch(error){return {pass:false,error:error.message,checks,diagnostic}}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);store.setState(settings)}
})()
