(async()=>{
 let r;webpackChunk_N_E.push([['qa48-'+Date.now()],{},x=>r=x]);
 window.qa48m=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error(s);return r(id)};
 window.qa48core=qa48m('/packages/core/dist/index.js');
 window.qa48read=()=>qa48m('/streetscape/src/host/street-project-persistence.ts').readStreetProjectFromSite(Object.values(qa48core.useScene.getState().nodes).find(n=>n.type==='site'));
 window.qa48doc=qa48read();window.qa48before=JSON.stringify(qa48core.useScene.getState().nodes);
 window.qa48original=structuredClone(qa48doc.project);qa48original.activeBaselineRevisionId='baseline-existing:import:1';qa48original.activeScenarioId=null;qa48original.scenarios={};
 window.qa48incoming=structuredClone(qa48original);
 const b=qa48incoming.baselineRevisions[qa48incoming.activeBaselineRevisionId];b.parentRevisionId=null;qa48incoming.baselineRevisions={[b.id]:b};
 const src=Object.values(qa48incoming.sourceReferences).find(s=>s.snapshot.status==='embedded');window.qa48sourceId=src.id;
 window.qa48acq=structuredClone(src.snapshot.data.acquisition);qa48acq.responses[0].payload.elements.find(e=>e.type==='way').tags.width='9';
 qa48acq.responses[0].payload.elements.push({type:'node',id:999,lat:0.0001,lon:0.0001,tags:{highway:'street_lamp',height:'7'}});
 window.qa48snap=await qa48m('/streetscape/src/source/osm-source-snapshot.ts').createOsmSourceSnapshot(qa48acq);
 const id='osm:'+qa48snap.integrityIdentity;
 qa48incoming.sourceReferences={[id]:{...src,id,contentIdentity:qa48snap.contentIdentity,acquiredAt:qa48snap.acquiredAt,snapshot:{status:'embedded',format:qa48snap.format,data:JSON.parse(JSON.stringify(qa48snap))}}};
 b.sourceReferenceIds=[id];
 for(const road of Object.values(b.roads)){road.sourceReferenceIds=[id];for(const section of Object.values(road.data.sections))section.style.laneWidth=3.8;}
 for(const p of Object.values(b.propertyEvidence))for(const claim of Object.values(p.claims)){if(claim.origin.kind==='source')claim.origin.sourceReferenceId=id;if(p.target.path.at(-1)==='laneWidth')claim.value=3.8;}
 b.features['asset:node/999']={id:'asset:node/999',kind:'point-asset',origin:'imported',sourceReferenceIds:[id],sourceFeatureId:'node/999',representation:'osm-import-v1',data:{kind:'street-lamp',sourceId:'node/999',position:[11.132,0,-11.132],rotationY:0,height:7}};
 qa48m('/streetscape/src/domain/street-project.ts').parseStreetProject(qa48incoming);
 window.qa48fill=(label,data)=>{const el=document.querySelector('[aria-label="'+label+'"]');if(!el)throw Error('Missing '+label);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,JSON.stringify(data));el.dispatchEvent(new Event('input',{bubbles:true}));};
 window.qa48click=text=>{const el=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);if(!el)throw Error('Missing '+text);el.click();};
 return {ready:true,nodes:Object.keys(qa48core.useScene.getState().nodes).length};
})()
