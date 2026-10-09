import { z } from 'zod'
import { RoadNetworkNode } from './schema'
import { validateRoadGraph } from './road-network-validation'
import { DEFAULT_ROAD_STYLE_PRESETS } from './road-style-presets'

export const ROAD_NETWORK_EXCHANGE_FORMAT = 'pascal-road-network' as const
export const ROAD_NETWORK_EXCHANGE_VERSION = 1 as const

export const RoadNetworkSemanticGraph = RoadNetworkNode.pick({
  graphNodes: true,
  edges: true,
	roadsideDecorations: true,
	roadsideDecorationSpacing: true,
	roadsideLampsBothSides: true,
	showRoadsideDecorations: true,
	roadsideItemVisibility: true,
	roadsideDecorationSuppressed: true,
	roadsideAutoFillEnabled: true,
	roadsideItemSuppressed: true,
  generatedItemHistory: true,
  attachments: true,
  junctions: true,
  stylePresets: true,
  activeStyleId: true,
  applyStyleToAll: true,
	regionalPack: true,
  snapTolerance: true,
	embankmentSlope: true,
	excavationSlope: true,
  bridgeDeckThickness: true,
  bridgeBarrierHeight: true,
  bridgePierSpacing: true,
  bridgePierDiameter: true,
  bridgeMinimumClearance: true,
})

export type RoadNetworkSemanticGraph = z.infer<typeof RoadNetworkSemanticGraph>

const RoadNetworkExchange = z.object({
  format: z.literal(ROAD_NETWORK_EXCHANGE_FORMAT),
  version: z.literal(ROAD_NETWORK_EXCHANGE_VERSION),
  graph: RoadNetworkSemanticGraph,
})

/** Export topology and road semantics without scene identity or parent metadata. */
export function exportRoadNetworkGraph(network: RoadNetworkNode): string {
  const parsed = RoadNetworkSemanticGraph.parse(network)
  const graph = {
    ...parsed,
    stylePresets: { ...DEFAULT_ROAD_STYLE_PRESETS, ...parsed.stylePresets },
  }
  return JSON.stringify({
    format: ROAD_NETWORK_EXCHANGE_FORMAT,
    version: ROAD_NETWORK_EXCHANGE_VERSION,
    graph,
  }, null, 2)
}

/** Parse and validate a semantic graph before it is allowed into the scene. */
export function importRoadNetworkGraph(source: string): RoadNetworkSemanticGraph {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('The clipboard does not contain valid road-network JSON.')
  }

  const parsed = RoadNetworkExchange.safeParse(value)
  if (!parsed.success) {
    throw new Error('This is not a supported Pascal road-network exchange file.')
  }

  const graph = RoadNetworkSemanticGraph.parse({
    ...parsed.data.graph,
    stylePresets: {
      ...DEFAULT_ROAD_STYLE_PRESETS,
      ...parsed.data.graph.stylePresets,
    },
  })
  const blockingIssues = validateRoadGraph(graph)
    .filter((issue) => issue.severity === 'error')
  if (blockingIssues.length > 0) {
    throw new Error(`Road graph rejected: ${blockingIssues[0]!.message}`)
  }
  return graph
}
