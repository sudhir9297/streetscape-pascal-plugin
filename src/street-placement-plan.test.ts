import {test,expect} from 'bun:test'
import {type AnyNode,type AnyNodeId,useScene} from '@pascal-app/core'
import {RoadNetworkNode,StreetLightNode} from './schema'
import {buildRoadsideDecorations} from './roadside-decoration-rules'
import {compileStreetPlacementPlan} from './street-placement-plan'
import {useProposalPreview} from './proposal-preview-store'
import {beginStreetViewMutationCheck} from './host/street-view-mutation-check'

test('proposal identities are owner scoped and accepted inventory prevents duplicate previews',()=>{
 let road=RoadNetworkNode.parse({id:'road-network_placement-plan',roadsideItemVisibility:{lamp:true},graphNodes:{a:{id:'a',position:[0,0,0]},b:{id:'b',position:[100,0,0]}},edges:{ab:{id:'ab',startNodeId:'a',endNodeId:'b'}}})
 road={...road,roadsideDecorations:buildRoadsideDecorations(road)}
 const empty=compileStreetPlacementPlan(road,{})
 expect(empty.proposals.length).toBeGreaterThan(0)
 const proposal=empty.proposals[0]!
 const asset=StreetLightNode.parse({metadata:{generatedBy:'road-auto-infrastructure',roadNetworkId:road.id,roadAutoInfrastructureKey:proposal.localId}})
 const nodes={[asset.id]:asset} as unknown as Record<AnyNodeId,AnyNode>
 const accepted=compileStreetPlacementPlan(road,nodes)
 expect(accepted.inventory).toHaveLength(1)
 expect(accepted.proposals).toHaveLength(empty.proposals.length-1)
 expect(compileStreetPlacementPlan({...road,id:'road-network_other'},nodes).proposals).toHaveLength(empty.proposals.length)
 expect(compileStreetPlacementPlan({...road,id:'road-network_other'},nodes).proposals[0]!.id).not.toBe(proposal.id)
})
test('proposal toggles do not write host scene or history',()=>{
 const check=beginStreetViewMutationCheck(),history=useScene.temporal.getState().pastStates
 useProposalPreview.getState().setVisible('road-network_toggle',false)
 useProposalPreview.getState().setVisible('road-network_toggle',true)
 expect(check.finish().unchanged).toBe(true)
 expect(useScene.temporal.getState().pastStates).toBe(history)
})
