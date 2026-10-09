import type {AnyNode,AnyNodeId} from '@pascal-app/core'
import type {RoadNetworkNode} from './schema'
import {buildRoadsideDecorationPreviews} from './roadside-decoration-rules'

/** Mapped/authored assets are host inventory; optional generation remains a separate layer. */
export function compileStreetPlacementPlan(network:RoadNetworkNode,nodes:Readonly<Record<AnyNodeId,AnyNode>>){
 const inventory=Object.values(nodes).flatMap(node=>{
  const ref=(node as unknown as {roadAttachment?:{networkNodeId:string}}).roadAttachment
  const metadata=node.metadata as Record<string,unknown> | undefined
  if(ref?.networkNodeId!==network.id && metadata?.roadNetworkId!==network.id)return []
  return [{id:node.id,node,origin:metadata?.generatedBy==='road-auto-infrastructure' ? 'accepted-generation' as const : 'observed-or-authored' as const,adjusted:Object.values(network.attachments).some(anchor=>anchor.assetNodeId===node.id && anchor.placementMode==='adjusted')}]
 })
 const acceptedKeys=new Set(inventory.flatMap(item=>{
  const key=item.node.metadata?.roadAutoInfrastructureKey
  return typeof key==='string' ? [key] : []
 }))
 const proposals=buildRoadsideDecorationPreviews(network).filter(item=>!acceptedKeys.has(item.id)).map(item=>({...item,localId:item.id,id:`${network.id}:proposal:${item.id}`,origin:'generated-proposal' as const}))
 return {inventory,proposals}
}
