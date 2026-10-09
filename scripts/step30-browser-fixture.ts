import {useScene,useLiveNodeOverrides,type AnyNode,type AnyNodeId} from '@pascal-app/core'
import {setupAttachmentBrowserFixture} from './step24-browser-fixture'
import {initializeStreetscape} from '../src/plugin-lifecycle'
import {useProposalPreview} from '../src/proposal-preview-store'
import {beginStreetViewMutationCheck} from '../src/host/street-view-mutation-check'
import {buildRoadAutoInfrastructurePlan,FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS} from '../src/road-auto-infrastructure'
import {RoadNetworkNode} from '../src/schema'
export function runStep30Checks(){
 const original=useScene.getState(),old=useScene.temporal.getState(),overrides=useLiveNodeOverrides.getState().overrides
 const history={pastStates:old.pastStates,futureStates:old.futureStates}
 const checks:Array<{name:string,passed:boolean}>=[]
 const check=(name:string,passed:boolean)=>{checks.push({name,passed});if(!passed)throw Error(name)}
 try{
  initializeStreetscape()
  const {road}=setupAttachmentBrowserFixture()
  const observer=beginStreetViewMutationCheck(),past=useScene.temporal.getState().pastStates
  useProposalPreview.getState().setVisible(road.id,false)
  check('hidden preference reaches transient floorplan overlay',useLiveNodeOverrides.getState().get(road.id)?.streetscapeProposalPreviewVisible===false)
  useLiveNodeOverrides.getState().clear(road.id)
  check('hidden preference survives drag override clearing',useLiveNodeOverrides.getState().get(road.id)?.streetscapeProposalPreviewVisible===false)
  useProposalPreview.getState().setVisible(road.id,true)
  check('preview toggling writes no saved scene',observer.finish().unchanged)
  check('preview toggling adds no undo entries',useScene.temporal.getState().pastStates===past)
  const accept=()=>{
   const network=RoadNetworkNode.parse(useScene.getState().nodes[road.id as AnyNodeId])
   const plan=buildRoadAutoInfrastructurePlan({network,edgeIds:Object.keys(network.edges),existingNodes:Object.values(useScene.getState().nodes),settings:FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS})
   if(plan.nodes.length)useScene.getState().applyNodeChanges({update:[{id:road.id as AnyNodeId,data:{attachments:{...network.attachments,...plan.attachments}} as Partial<AnyNode>}],create:plan.nodes.map(node=>({node:node as unknown as AnyNode,parentId:road.parentId as AnyNodeId}))})
   return plan
  }
  const first=accept()
  check('generation accepted actual inventory',first.nodes.length>0)
  const moved=first.nodes[0]!,position:[number,number,number]=[moved.position[0]+2,moved.position[1],moved.position[2]+1]
  useScene.getState().updateNode(moved.id as AnyNodeId,{position} as Partial<AnyNode>)
  const before=JSON.stringify(useScene.getState().nodes),second=accept()
  check('repeat acceptance creates no duplicate inventory',second.nodes.length===0 && before===JSON.stringify(useScene.getState().nodes))
  const current=RoadNetworkNode.parse(useScene.getState().nodes[road.id as AnyNodeId])
  check('adjusted asset retained after repeated acceptance',Object.values(current.attachments).some(anchor=>anchor.assetNodeId===moved.id&&anchor.placementMode==='adjusted')&&JSON.stringify((useScene.getState().nodes[moved.id as AnyNodeId] as unknown as {position:number[]}).position)===JSON.stringify(position))
  return {ok:true,checks}
 }catch(error){return {ok:false,checks,error:String(error)}}
 finally{useProposalPreview.getState().setVisible('road-network_asset-batch',true);useScene.setState(original);useScene.temporal.setState(history);useLiveNodeOverrides.setState({overrides})}
}
