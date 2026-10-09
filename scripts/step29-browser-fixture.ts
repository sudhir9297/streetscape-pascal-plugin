import {createRoadGeometry,setRoadGeometryRetained} from '../src/road-network-model'
import {compileStreet,createCachedStreetCompiler} from '../src/street-compiler'
import {RoadNetworkNode} from '../src/schema'
export async function runStep29Checks(){
 const checks:Array<{name:string,passed:boolean}>=[]
 const check=(name:string,passed:boolean)=>{checks.push({name,passed});if(!passed)throw Error(name)}
 const wait=()=>new Promise(resolve=>setTimeout(resolve,600))
 try{
  const road=RoadNetworkNode.parse({id:'road-network_model-browser',graphNodes:{a:{id:'a',position:[0,0,0]},b:{id:'b',position:[80,0,0]}},edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b'}}})
  const cached=createCachedStreetCompiler()
  check('cached and pure plans equivalent',JSON.stringify(cached.compile(road))===JSON.stringify(compileStreet(road)))
  cached.compile(road)
  check('unchanged profiles reused',cached.stats.reusedProfiles>0)
  const style=road.stylePresets[road.activeStyleId]!
  const edited=RoadNetworkNode.parse({...road,stylePresets:{...road.stylePresets,[style.id]:{...style,laneWidth:style.laneWidth+1}}})
  check('width edit invalidates cache with equivalent output',JSON.stringify(cached.compile(edited))===JSON.stringify(compileStreet(edited)) && cached.stats.rebuiltProfiles>0)
  let disposed=0
  const geometry=createRoadGeometry()
  geometry.addEventListener('dispose',()=>disposed++)
  setRoadGeometryRetained(geometry,true);geometry.dispose();await wait()
  check('mounted geometry survives disposal request',disposed===0)
  setRoadGeometryRetained(geometry,false);geometry.dispose();setRoadGeometryRetained(geometry,true);await wait()
  check('remount cancels pending retirement',disposed===0)
  setRoadGeometryRetained(geometry,false);geometry.dispose();await wait()
  check('superseded unmounted geometry disposed once',disposed===1)
  const resources=Array.from({length:3},()=>createRoadGeometry())
  let retirements=0
  for(const resource of resources){resource.addEventListener('dispose',()=>retirements++);resource.dispose()}
  await wait()
  check('repeated regeneration retires all superseded resources',retirements===3)
  return {ok:true,checks}
 }catch(error){return {ok:false,checks,error:String(error)}}
}
