import {create} from 'zustand'
/** Transient view preference: never stored in a road or accepted baseline. */
export const useProposalPreview=create<{hidden:Set<string>;setVisible:(id:string,visible:boolean)=>void}>((set)=>({hidden:new Set(),setVisible:(id,visible)=>set(state=>{const hidden=new Set(state.hidden);if(visible)hidden.delete(id);else hidden.add(id);return {hidden}})}))

import {useLiveNodeOverrides} from '@pascal-app/core'
export const PROPOSAL_PREVIEW_FIELD='streetscapeProposalPreviewVisible'
/** The existing transient host overlay invalidates floorplan geometry without writing nodes. */
export function initializeProposalPreviewSynchronization(){
 const sync=()=>{
  const hidden=useProposalPreview.getState().hidden,overrides=useLiveNodeOverrides.getState()
  for(const id of hidden)if(overrides.get(id)?.[PROPOSAL_PREVIEW_FIELD]!==false)overrides.set(id,{[PROPOSAL_PREVIEW_FIELD]:false})
  for(const [id,patch] of overrides.overrides)if(!hidden.has(id)&&patch[PROPOSAL_PREVIEW_FIELD]!==undefined)overrides.clearFields(id,[PROPOSAL_PREVIEW_FIELD])
 }
 const a=useProposalPreview.subscribe(sync),b=useLiveNodeOverrides.subscribe(sync)
 sync()
 return ()=>{a();b();for(const [id,patch] of useLiveNodeOverrides.getState().overrides)if(patch[PROPOSAL_PREVIEW_FIELD]!==undefined)useLiveNodeOverrides.getState().clearFields(id,[PROPOSAL_PREVIEW_FIELD])}
}
