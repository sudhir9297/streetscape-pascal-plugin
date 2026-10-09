// Open Streetscape Lab first, then evaluate this expression in the port 3002 preview.
(async()=>{
let r;webpackChunk_N_E.push([['osm-replay-'+Date.now()],{},x=>r=x]);const module=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error('Missing '+s);return r(id)};
const acquisition=module('/streetscape/src/source/osm-acquisition.ts'),interpretation=module('/streetscape/src/source/osm-interpretation.ts'),importer=module('/streetscape/src/osm-import.ts');
const fixture={"format":"osm-acquisition","schemaVersion":1,"bbox":{"south":-0.01,"west":-0.01,"north":0.01,"east":0.01},"responses":[{"bbox":{"south":-0.01,"west":-0.01,"north":0.01,"east":0.01},"payload":{"version":0.6,"generator":"recorded-fixture","elements":[{"type":"way","id":10,"nodes":[1,2,3],"geometry":[{"lat":0,"lon":-0.001},{"lat":0,"lon":0},{"lat":0,"lon":0.001}],"tags":{"highway":"residential","wikipedia":"en:Example","width":"8","source":"US:NY"}},{"type":"node","id":20,"lat":0,"lon":0.0001,"tags":{"highway":"street_lamp","height":"6"}},{"type":"node","id":21,"lat":0,"lon":0,"tags":{"highway":"crossing","crossing":"marked"}}]}}],"diagnostics":[]};
const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{
let requests=0;
const recorded=await acquisition.acquireOsmData(fixture.bbox,{request:()=>({url:'/test-only'}),fetch:async()=>{requests++;return new Response(JSON.stringify(fixture.responses[0].payload))}});
check('raw source tags unchanged',recorded.responses[0].payload.elements[0].tags.wikipedia==='en:Example');
const map=interpretation.interpretOsmAcquisition(recorded);
check('interpretation remains compatible',map.ways[0].tags.wikipedia==='en:Example'&&map.pointFeatures.length===1&&map.crossings.length===1);
const prepared=await importer.prepareOsmStreetImport({lat:0,lon:0},300,{loadAcquisition:async()=>recorded});
const result=await importer.completeOsmStreetImport(prepared);
check('offline road and asset replay',result.stats.edges===1&&result.assets.length===1&&requests===1);
check('acquisition retained for later snapshot persistence',JSON.stringify(result.acquisition)===JSON.stringify(recorded));
let code;try{await acquisition.acquireOsmData(fixture.bbox,{request:()=>({url:'/test-only'}),fetch:async()=>new Response(JSON.stringify({remark:'timeout'}))})}catch(error){code=error.code}
check('invalid service data is not empty roads',code==='invalid-response');
return {pass:true,url:location.href,requests,checks};
}catch(error){return {pass:false,error:error.message,checks}}
})()
