'use client'

import {
  type AnyNode,
  type AnyNodeId,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { RoadNetworkExtensionControls } from './road-network-extension-controls'
import { roadNetworkEditingControlsState } from './road-network-editing-controls'
import {
  materializeRoadsideDecorationSelection,
} from './roadside-decoration-rules'
import {compileStreetPlacementPlan} from './street-placement-plan'
import { resolveScenarioRoadContext } from './host/effective-road-context'
import { roadMovementContext } from './host/road-movement-context'
import {useProposalPreview} from './proposal-preview-store'
import { RoadNetworkModel } from './road-network-model'
import { RoadNetworkSplineControls } from './road-network-spline-controls'
import { RoadNetworkNode } from './schema'
import { useStreetscapeStore, type RoadElementSelection } from './store'
import { decodeTerrainField } from './terrain-field-compat'

export default function RoadNetworkRenderer({ node: storeNode }: { node: RoadNetworkNode }) {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(storeNode as never, 'streetscape:road-network' as never)
  const roadToolActive = useEditor(
    (state) => state.mode === 'build' && (state.tool as string | null) === 'streetscape:road-network',
  )
	const sceneNodes = useScene((state) => state.nodes)
	const clearancePeers = useMemo(
		() => Object.values(sceneNodes).flatMap((candidate) =>
			(candidate.id as string) !== storeNode.id &&
			(candidate.type as string) === 'streetscape:road-network'
				? [candidate as unknown as RoadNetworkNode]
				: [],
		),
		[sceneNodes, storeNode.id],
	)
	const terrain = useMemo(() => {
		const site = Object.values(sceneNodes).find(
			(candidate) => (candidate.type as string) === 'site',
		) as (AnyNode & { terrain?: unknown }) | undefined
		return decodeTerrainField(site?.terrain)
	}, [sceneNodes])
  const networkSelected = useViewer((state) =>
    ((state.selection as { selectedIds?: AnyNodeId[] }).selectedIds ?? []).includes(
      storeNode.id as AnyNodeId,
    ),
  )
  const storedElementSelection = useStreetscapeStore((state) => state.roadElementSelection)
  const elementSelection =
    storedElementSelection?.networkId === storeNode.id ? storedElementSelection : null
  const editingControls = roadNetworkEditingControlsState({
    networkSelected,
    roadToolActive,
    splineEditing:
      elementSelection?.kind === 'spline' ||
      elementSelection?.kind === 'control' ||
      elementSelection?.kind === 'endpoint',
  })
  const onSelectElement = useCallback(
    (
      selection: Omit<RoadElementSelection, 'networkId'>,
      event: { stopPropagation: () => void },
    ) => {
      event.stopPropagation()
      const store = useStreetscapeStore.getState()
      if (!networkSelected) {
        useViewer.getState().setSelection({ selectedIds: [storeNode.id as AnyNodeId] })
        store.setRoadElementSelection(
          selection.kind === 'decoration'
            ? { networkId: storeNode.id, ...selection }
            : null,
        )
        return
      }
      const current = store.roadElementSelection
      const same =
        current?.networkId === storeNode.id &&
        current.kind === selection.kind &&
        current.id === selection.id &&
        current.cornerKey === selection.cornerKey &&
        current.index === selection.index
      store.setRoadElementSelection(
        same ? null : { networkId: storeNode.id, ...selection },
      )
    },
    [networkSelected, storeNode.id],
  )
  useRegistry(storeNode.id as AnyNodeId, storeNode.type, ref)
  const override = useLiveNodeOverrides(
    (state) => state.get(storeNode.id as AnyNodeId) as Partial<RoadNetworkNode> | undefined,
  )
  // Local editor scenes can retain an already-mounted node while a plugin schema
  // advances. Parse at the renderer boundary so every derived subsystem receives
  // the same defaults even before the host persists its migration patch.
  const node = useMemo(
    () => RoadNetworkNode.parse(override ? { ...resolveScenarioRoadContext(storeNode,id=>sceneNodes[id]), ...override } : resolveScenarioRoadContext(storeNode,id=>sceneNodes[id])),
    [override, storeNode, sceneNodes],
  )
  const placementPlan=useMemo(()=>compileStreetPlacementPlan(node,sceneNodes),[node,sceneNodes])
  const laneMovements=useMemo(()=>roadMovementContext(node,id=>sceneNodes[id]),[node,sceneNodes])
  const proposalPreviewVisible=useProposalPreview(state=>!state.hidden.has(node.id))
  const onSelectRoadsideDecoration = useCallback(
    (id: string, event: { stopPropagation: () => void }) => {
      event.stopPropagation()
      const scene = useScene.getState()
      const materialized = materializeRoadsideDecorationSelection(
        node,
        id,
        Object.keys(scene.nodes),
      )
      if (!materialized) {
        onSelectElement({ kind: 'decoration', id }, event)
        return
      }
      scene.applyNodeChanges({
        update: [{
          id: node.id as AnyNodeId,
          data: materialized.networkPatch as Partial<AnyNode>,
        }],
        create: [{
          node: materialized.node as unknown as AnyNode,
          parentId: node.parentId as AnyNodeId,
        }],
      })
      useStreetscapeStore.getState().setRoadElementSelection(null)
      useViewer.getState().setSelection({
        selectedIds: materialized.selection.selectedIds as AnyNodeId[],
      })
    },
    [node, onSelectElement],
  )
  useEffect(() => {
    if (!networkSelected && elementSelection) {
      useStreetscapeStore.getState().setRoadElementSelection(null)
    }
  }, [elementSelection, networkSelected])
  return (
    <group
      ref={ref}
      visible={node.visible !== false}
      {...(roadToolActive ? {} : handlers)}
    >
      <RoadNetworkModel
        laneMovements={laneMovements}
		clearancePeers={clearancePeers}
        elementSelection={elementSelection}
        node={node}
        placementPlan={placementPlan}
        proposalPreviewVisible={proposalPreviewVisible}
        nonInteractive={roadToolActive}
        onSelectElement={roadToolActive ? undefined : onSelectElement}
		onSelectRoadsideDecoration={roadToolActive ? undefined : onSelectRoadsideDecoration}
		terrain={terrain}
      />
      {editingControls.splineHandles ? (
        <RoadNetworkSplineControls elementSelection={elementSelection} node={node} />
      ) : null}
      {editingControls.lengthArrows ? <RoadNetworkExtensionControls node={node} /> : null}
    </group>
  )
}
