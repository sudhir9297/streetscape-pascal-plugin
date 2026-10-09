// Open Streetscape Lab, then evaluate this expression on localhost:3002.
(async () => {
 let r; webpackChunk_N_E.push([['scope-check-'+Date.now()],{},x=>r=x]);
 const importer=r(Object.keys(r.m).find(x=>x.endsWith('/streetscape/src/osm-import.ts')));
 const checks=[];
 const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
 try {
  const center={lat:0,lon:0},radius=100;
  const p=(nodeId,x,z)=>({nodeId,...importer.localToGeo([x,z],center)});
  let requested;
  const prepared=await importer.prepareOsmStreetImport(center,radius,{loadStreets:async bounds=>{
   requested=bounds;
   return [
    {id:1,tags:{highway:'residential'},points:[p(1,0,0),p(2,100,0),p(3,180,0)]},
    {id:2,tags:{highway:'residential'},points:[p(4,100,-80),p(2,100,0),p(5,100,80)]},
    {id:3,tags:{highway:'service'},points:[p(6,-180,70),p(7,-140,70)]},
   ];
  }});
  check('acquires documented context margin',Math.abs(requested.north*111320-200)<1e-6&&prepared.context.scope.contextMarginMeters===100);
  const context=prepared.context.graphs.find(graph=>graph.graphNodes.n2);
  check('boundary junction retains four context approaches',Object.values(context.edges).filter(edge=>edge.startNodeId==='n2'||edge.endNodeId==='n2').length===4);
  const result=await importer.completeOsmStreetImport(prepared);
  check('generated centerlines remain selected',result.graphs.every(graph=>Object.values(graph.graphNodes).every(node=>Math.hypot(node.position[0],node.position[2])<=100.00001)));
  check('support-only road excluded from generation',!result.graphs.some(graph=>Object.values(graph.edges).some(edge=>edge.osmSource.wayId===3)));
  check('preview shows context only outside selection',prepared.preview.contextPaths.length>0&&prepared.preview.contextPaths.every(path=>path.points.every(point=>Math.hypot(...importer.projectToLocal(point,center))>=99.99999)));
  check('completed import retains detached supporting topology',result.context!==prepared.context&&result.context.graphs.length===prepared.context.graphs.length);
  return {pass:true,url:location.href,checks};
 }catch(error){return {pass:false,error:error.message,checks};}
})()
