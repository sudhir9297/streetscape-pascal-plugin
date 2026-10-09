import {useScene,clearSceneHistory,type AnyNode,type AnyNodeId} from '@pascal-app/core'
import {setupAttachmentBrowserFixture} from './step24-browser-fixture'
import {RoadNetworkNode} from '../src/schema'
import {readStreetProjectFromSite} from '../src/host/street-project-persistence'
import {initializeStreetscape} from '../src/plugin-lifecycle'

export function runStep26CommandChecks(){
 const original=useScene.getState(),history=useScene.temporal.getState()
 const saved={pastStates:history.pastStates,futureStates:history.futureStates}
 const checks:Array<{name:string,passed:boolean}>=[]
 const check=(name:string,passed:boolean)=>{checks.push({name,passed});if(!passed)throw Error(name)}
 try{
  initializeStreetscape()
  const {site,road,assets}=setupAttachmentBrowserFixture()
  useScene.getState().updateNode(road.id as AnyNodeId,{graphNodes:{...road.graphNodes,d:{id:'d',position:[90,0,0]}}} as Partial<AnyNode>)
  useScene.getState().updateNode(assets[1]!.id as AnyNodeId,{visible:false,metadata:{...assets[1]!.metadata,generatedBy:'road-auto-infrastructure',roadNetworkId:road.id,roadsideItemKind:'lamp'}} as Partial<AnyNode>)
  clearSceneHistory()
  const before=JSON.stringify(useScene.getState().nodes),revision=readStreetProjectFromSite(useScene.getState().nodes[site.id])!.project.revision
  useScene.getState().updateNode(road.id as AnyNodeId,{roadsideItemVisibility:{lamp:true}} as Partial<AnyNode>)
  const current=RoadNetworkNode.parse(useScene.getState().nodes[road.id as AnyNodeId])
  check('decoration inventory accepted in command',Object.keys(current.roadsideDecorations).length>0)
  check('generated asset visibility accepted in same command',useScene.getState().nodes[assets[1]!.id as AnyNodeId]!.visible===true)
  check('one accepted document revision',readStreetProjectFromSite(useScene.getState().nodes[site.id])!.project.revision===revision+1)
  check('one undo entry for furnishings and visibility',useScene.temporal.getState().pastStates.length===1)
  const first=JSON.stringify({styles:current.stylePresets,decorations:current.roadsideDecorations})
  useScene.getState().updateNode(road.id as AnyNodeId,{roadsideItemVisibility:{lamp:true}} as Partial<AnyNode>)
  const repeated=RoadNetworkNode.parse(useScene.getState().nodes[road.id as AnyNodeId])
  check('repeat generation produces identical inventory',first===JSON.stringify({styles:repeated.stylePresets,decorations:repeated.roadsideDecorations}))
  useScene.temporal.getState().undo();useScene.temporal.getState().undo()
  check('undo restores exact scene and accepted document',before===JSON.stringify(useScene.getState().nodes))
  return {ok:true,checks}
 }catch(error){return {ok:false,checks,error:String(error)}}
 finally{useScene.setState(original);useScene.temporal.setState(saved)}
}
