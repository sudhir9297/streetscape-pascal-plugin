// Open Streetscape Lab > Map. Preserves the user's graph, history and selection.
(async()=>{
 let r;webpackChunk_N_E.push([['street-changes-'+Date.now()],{},x=>r=x]);const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
 const core=module('/packages/core/dist/index.js'),viewer=module('/packages/viewer/dist/store/use-viewer.js').default,schema=module('/streetscape/src/schema.ts'),changes=module('/streetscape/src/host/application-change-set.ts'),domain=module('/streetscape/src/domain/application-change-set.ts'),compat=module('/streetscape/src/street-project-compatibility.ts'),store=module('/streetscape/src/host/street-project-store.ts'),persistence=module('/streetscape/src/host/street-project-persistence.ts');
 const state=core.useScene.getState(),original={nodes:state.nodes,rootNodeIds:state.rootNodeIds,collections:state.collections,materials:state.materials,installedPlugins:state.installedPlugins},selection=viewer.getState().selection,history=core.useScene.temporal.getState(),oldHistory={pastStates:[...history.pastStates],futureStates:[...history.futureStates]};
 const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)},json=v=>JSON.parse(JSON.stringify(v));let sceneId;
 try {
  const site=Object.values(state.nodes).find(n=>n.type==='site'),building=Object.values(state.nodes).find(n=>n.type==='building'),level=Object.values(state.nodes).find(n=>n.type==='level');
  core.useScene.getState().setScene({[site.id]:{...site,metadata:{},children:[building.id]},[building.id]:{...building,parentId:site.id,children:[level.id]},[level.id]:{...level,parentId:building.id,children:[]}},[site.id],{collections:{},materials:state.materials,installedPlugins:state.installedPlugins});viewer.getState().setSelection({buildingId:building.id,levelId:level.id,selectedIds:[]});await new Promise(resolve=>setTimeout(resolve,180));
  const road=id=>schema.RoadNetworkNode.parse({id,parentId:level.id,name:'Change-set verification road',graphNodes:{a:{id:'a',position:[-10,.1,0]},b:{id:'b',position:[10,.1,0]}},edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b',styleId:'local-street'}}});
  const make=()=>domain.StreetApplicationChangeSet.parse({format:'street-application-change-set',schemaVersion:1,id:'browser-command',reason:'Verify atomic street changes',expected:changes.captureStreetChangePreconditions(site.id),create:[{node:json(road('road-network_command-valid')),parentId:level.id}],update:[],delete:[],identityRemaps:[],affectedGeometry:['road-network_command-valid']});
  const invalid=make(),last=road('road-network_command-invalid');last.edges.ab.endNodeId='missing';invalid.create.push({node:json(last),parentId:level.id});invalid.affectedGeometry.push(last.id);
  const before=core.useScene.getState().nodes,count=core.useScene.temporal.getState().pastStates.length;let failed=false;
  try{changes.commitHostStreetChangeSet(invalid)}catch(error){failed=/Invalid final road/.test(error.message)}
  check('invalid final import component leaves the complete graph and undo history untouched',failed&&core.useScene.getState().nodes===before&&core.useScene.temporal.getState().pastStates.length===count);
  const valid=make();changes.prepareHostStreetChangeSet(valid);check('preparation does not mutate persistent graph',core.useScene.getState().nodes===before);
  changes.commitHostStreetChangeSet(valid);check('valid change commits a selectable road in one undo entry',core.useScene.getState().nodes['road-network_command-valid']&&core.useScene.temporal.getState().pastStates.length===count+1);
  core.useScene.temporal.getState().undo();check('undo restores the entire original graph',JSON.stringify(core.useScene.getState().nodes)===JSON.stringify(before));
  const stale=make();const delayed=Promise.resolve().then(()=>{try{changes.commitHostStreetChangeSet(stale);return false}catch(error){return /Scene changed/.test(error.message)}});
  core.useScene.getState().updateNode(level.id,{name:'Newer edit survives stale job'});const newer=core.useScene.getState().nodes,newerCount=core.useScene.temporal.getState().pastStates.length;
  check('delayed job cannot overwrite a newer edit',await delayed&&core.useScene.getState().nodes===newer&&core.useScene.temporal.getState().pastStates.length===newerCount&&!core.useScene.getState().nodes['road-network_command-valid']);
  const project=compat.createLegacyStreetProject({id:'change-set-browser',name:'Transaction verification',baselineRevisionId:'b',acceptedAt:'2026-10-08T10:00:00Z',roads:[]});project.sourceReferences.recorded={id:'recorded',provider:'recorded',acquiredAt:null,contentIdentity:null,snapshot:{status:'unavailable',reason:'No original capture'}};
  store.persistStreetProject(site.id,{project,projection:{baselineRevisionId:'b',scenarioId:null,bindings:[]},expectedRevision:null});
  const revision=make();revision.expected.documentRevision++;
  const revisionBefore=core.useScene.getState().nodes;let conflict=false;try{changes.commitHostStreetChangeSet(revision)}catch(error){conflict=/document revision changed/.test(error.message)}
  check('document revision conflict rejects before mutation',conflict&&core.useScene.getState().nodes===revisionBefore);
  const stored=persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]),tampered=json(stored);tampered.project.revision++;tampered.project.sourceReferences.recorded.snapshot.reason='Changed old evidence';
  const sourceChange=domain.StreetApplicationChangeSet.parse({...make(),create:[],update:[{id:site.id,data:{metadata:{'pascal:streetscape-project':tampered}}}],affectedGeometry:[]});let immutable=false;
  try{changes.commitHostStreetChangeSet(sourceChange)}catch(error){immutable=/source reference is immutable/.test(error.message)}
  check('captured source evidence cannot be rewritten',immutable&&core.useScene.getState().nodes===revisionBefore);
  const accepted=json(stored);accepted.project.revision++;accepted.project.name='Accepted current document';
  const update=domain.StreetApplicationChangeSet.parse({...sourceChange,id:'accept-document',update:[{id:site.id,data:{metadata:{'pascal:streetscape-project':accepted}}}]});changes.commitHostStreetChangeSet(update);
  check('validated document update advances revision',persistence.readStreetProjectFromSite(core.useScene.getState().nodes[site.id]).project.revision===1);
  const current=core.useScene.getState(),graph={nodes:current.nodes,rootNodeIds:current.rootNodeIds,collections:current.collections,materials:current.materials,installedPlugins:current.installedPlugins};
  const response=await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Streetscape validated change-set verification',graph})});const saved=await response.json();if(response.status!==201)throw Error('Save '+response.status+': '+JSON.stringify(saved));sceneId=saved.id;check('validated scene saves successfully',response.status===201);
  const loadedResponse=await fetch('/api/scenes/'+sceneId,{cache:'no-store'}),loaded=await loadedResponse.json();check('server reload retains the newer edit and accepted revision',loadedResponse.ok&&loaded.graph.nodes[level.id].name==='Newer edit survives stale job'&&persistence.readStreetProjectFromSite(loaded.graph.nodes[site.id]).project.revision===1);
  return {pass:true,url:location.href,sceneId,checks};
 }catch(error){return {pass:false,error:error.message,sceneId,checks};}
 finally{core.useScene.getState().setScene(original.nodes,original.rootNodeIds,{collections:original.collections,materials:original.materials,installedPlugins:original.installedPlugins});core.useScene.temporal.setState(oldHistory);viewer.getState().setSelection(selection);}
})()
