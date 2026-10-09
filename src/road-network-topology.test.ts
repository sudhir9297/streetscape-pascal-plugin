import { describe, expect, test } from 'bun:test'
import { sampleRoadEdgePoints } from './road-network-geometry'
import {
  classifyRoadJunction,
  createEmptyRoadGraph,
  incidentRoadEdges,
  insertRoadSegment,
  mergeRoadGraphs,
  previewRoadInsertion,
  reconcileRoadJunctions,
  roadBendRadiusForTangentLength,
  roadBendTangentLength,
  roadStyleWidth,
  snapRoadDraftPoint,
  splitRoadGraphComponents,
} from './road-network-topology'

function add(graph: ReturnType<typeof createEmptyRoadGraph>, a: [number, number, number], b: [number, number, number]) {
  return insertRoadSegment(graph, a, b, { tolerance: 0.01 }).graph
}

function planLength(points: Array<readonly [number, number, number]>): number {
  return points.slice(1).reduce((length, point, index) => (
    length + Math.hypot(point[0] - points[index]![0], point[2] - points[index]![2])
  ), 0)
}

describe('road network topology', () => {
  test('derives a bend radius from a requested tangent distance', () => {
    const first = insertRoadSegment(
      createEmptyRoadGraph(),
      [-20, 0, 0],
      [0, 0, 0],
    )
    const result = insertRoadSegment(first.graph, [0, 0, 0], [0, 0, 20], {
      tangentLength: 3,
      tolerance: 0.01,
    })
    const bend = Object.values(result.graph.graphNodes).find(
      (node) => classifyRoadJunction(result.graph, node.id) === 'bend-l',
    )!

    expect(roadBendRadiusForTangentLength(result.graph, bend.id, 3)).toBeCloseTo(3, 6)
    expect(bend.curveRadius).toBeCloseTo(3, 6)
    expect(bend.tangentLength).toBeCloseTo(3, 6)
    expect(roadBendTangentLength(result.graph, bend.id, bend.curveRadius!)).toBeCloseTo(3, 6)
  })

  test('magnetically projects a draft point onto a road centerline', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0]).graph

    const snap = snapRoadDraftPoint(base, [4, 0, 2.5], {
      nodeTolerance: 0.5,
      tolerance: 3,
    })

    expect(snap?.kind).toBe('centerline')
    expect(snap?.point).toEqual([4, 0, 0])
    expect(snap?.distance).toBeCloseTo(2.5, 6)
  })

  test('prefers a nearby endpoint and follows sampled spline centerlines', () => {
    const straight = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0]).graph
    const endpointSnap = snapRoadDraftPoint(straight, [9.7, 0, 0.2], {
      nodeTolerance: 0.5,
      tolerance: 3,
    })
    expect(endpointSnap?.kind).toBe('node')
    expect(endpointSnap?.point).toEqual([10, 0, 0])

    const curved = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0], {
      alignment: [[5, 0, 4]],
    }).graph
    const curveSnap = snapRoadDraftPoint(curved, [5, 0, 4.8], {
      nodeTolerance: 0.5,
      tolerance: 1,
    })
    expect(curveSnap?.kind).toBe('centerline')
    expect(curveSnap?.point[0]).toBeCloseTo(5, 1)
    expect(curveSnap?.point[2]).toBeCloseTo(4, 1)
  })

  test('does not magnetically join suppressed or vertically separated roads', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0]).graph

    expect(snapRoadDraftPoint(base, [5, 0, 1], {
      joinMode: 'suppress',
      tolerance: 2,
    })).toBeNull()
    expect(snapRoadDraftPoint(base, [5, 4, 1], {
      stackLevel: 1,
      tolerance: 2,
    })).toBeNull()
  })

  test('separates disconnected roads into independently selectable components', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const connected = insertRoadSegment(first.graph, [10, 0, 0], [10, 0, 10])
    const disconnected = insertRoadSegment(connected.graph, [30, 0, 0], [40, 0, 0])

    const components = splitRoadGraphComponents(disconnected.graph)

    expect(components).toHaveLength(2)
    expect(components.map((component) => Object.keys(component.edges).length)).toEqual([2, 1])
    expect(components.map((component) => Object.keys(component.graphNodes).length)).toEqual([3, 2])
  })

  test('merges colliding inner graph IDs without joining unrelated roads', () => {
    const left = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const right = insertRoadSegment(createEmptyRoadGraph(), [30, 0, 0], [40, 0, 0])

    const merged = mergeRoadGraphs([left.graph, right.graph])

    expect(Object.keys(merged.graph.graphNodes)).toHaveLength(4)
    expect(Object.keys(merged.graph.edges)).toHaveLength(2)
    expect(splitRoadGraphComponents(merged.graph)).toHaveLength(2)
    expect(merged.nodeIdMaps[0]?.['road-point_1']).toBe('road-point_1')
    expect(merged.nodeIdMaps[1]?.['road-point_1']).not.toBe('road-point_1')
  })

  test('becomes one selectable component when a segment joins two stored roads', () => {
    const left = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const right = insertRoadSegment(createEmptyRoadGraph(), [20, 0, 0], [30, 0, 0])
    const merged = mergeRoadGraphs([left.graph, right.graph])

    const joined = insertRoadSegment(merged.graph, [10, 0, 0], [20, 0, 0])

    expect(joined.status).toBe('inserted')
    expect(splitRoadGraphComponents(joined.graph)).toHaveLength(1)
    expect(Object.keys(joined.graph.edges)).toHaveLength(3)
  })

  test('merges conflicting style identities without changing either authored width', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0]).graph
    const second = insertRoadSegment(createEmptyRoadGraph(), [20, 0, 0], [30, 0, 0]).graph
    const styleId = first.activeStyleId
    second.stylePresets = {...second.stylePresets, [styleId]: {...second.stylePresets[styleId]!, laneWidth: 5}}
    const merged = mergeRoadGraphs([first, second])
    const firstEdge = merged.graph.edges[Object.values(merged.edgeIdMaps[0]!)[0]!]!
    const secondEdge = merged.graph.edges[Object.values(merged.edgeIdMaps[1]!)[0]!]!
    expect(firstEdge.styleId).not.toBe(secondEdge.styleId)
    expect(merged.graph.stylePresets[firstEdge.styleId]!.laneWidth).toBe(first.stylePresets[styleId]!.laneWidth)
    expect(merged.graph.stylePresets[secondEdge.styleId]!.laneWidth).toBe(5)
    expect(merged.styleIdMaps[1]![styleId]).toBe(secondEdge.styleId)
  })

  test('creates a two-node straight road with the expected cross-section width', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    expect(result.status).toBe('inserted')
    expect(Object.keys(result.graph.graphNodes)).toHaveLength(2)
    expect(Object.keys(result.graph.edges)).toHaveLength(1)
    expect(roadStyleWidth(result.graph.stylePresets['local-street']!)).toBe(10.4)
    expect(classifyRoadJunction(result.graph, result.createdNodeIds[0]!)).toBe('dead-end')
  })

  test('rejects zero-length and duplicate segments', () => {
    const empty = createEmptyRoadGraph()
    expect(insertRoadSegment(empty, [0, 0, 0], [0.01, 0, 0]).status).toBe('too-short')
    const first = add(empty, [0, 0, 0], [10, 0, 0])
    expect(insertRoadSegment(first, [10, 0, 0], [0, 0, 0]).status).toBe('duplicate')
  })

  test('snaps an endpoint onto an existing edge and creates a T junction', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const result = insertRoadSegment(base, [0, 0, 8], [0.1, 0, 0.1], { tolerance: 0.5 })
    expect(result.status).toBe('inserted')
    expect(result.splitEdgeIds).toHaveLength(1)
    const junction = Object.values(result.graph.graphNodes).find(
      (node) => Math.abs(node.position[0]) < 0.2 && Math.abs(node.position[2]) < 0.2,
    )
    expect(junction).toBeDefined()
    expect(incidentRoadEdges(result.graph, junction!.id)).toHaveLength(3)
    expect(classifyRoadJunction(result.graph, junction!.id)).toBe('tee')
    const record = result.graph.junctions[junction!.id]
    expect(record?.kind).toBe('tee')
    expect(record?.primaryMode).toBe('auto')
    expect(record?.primaryEdgeIds).toHaveLength(2)
    expect(record?.primaryEdgeIds).not.toContain(result.createdEdgeIds[0]!)
    expect(Object.keys(record?.cornerRadii ?? {})).toHaveLength(3)
  })

  test('remaps roadside attachment stations when a T junction splits an edge', () => {
    const base = add(createEmptyRoadGraph(), [0, 0, 0], [20, 0, 0])
    const originalEdgeId = Object.keys(base.edges)[0]!
    base.attachments = {
      before: {
        id: 'before', edgeId: originalEdgeId, assetNodeId: 'sign-before', kind: 'sign',
		station: 4, lateralOffset: 5, verticalOffset: 0,
		alignment: 'free',
      },
      atSplit: {
        id: 'atSplit', edgeId: originalEdgeId, assetNodeId: 'lamp-at-split', kind: 'lamp',
		station: 10, lateralOffset: -5, verticalOffset: 0,
		alignment: 'free',
      },
      after: {
        id: 'after', edgeId: originalEdgeId, assetNodeId: 'asset-after', kind: 'asset',
		station: 16, lateralOffset: 3, verticalOffset: 0.5,
		alignment: 'free',
      },
    }

    const result = insertRoadSegment(base, [10, 0, 8], [10, 0, 0], { tolerance: 0.01 })
    const secondEdge = Object.values(result.graph.edges).find(
      (edge) => edge.parentEdgeId === originalEdgeId,
    )!

    expect(result.graph.attachments.before).toMatchObject({
      edgeId: originalEdgeId,
      station: 4,
    })
    expect(result.graph.attachments.atSplit).toMatchObject({
      edgeId: originalEdgeId,
      station: 10,
    })
    expect(result.graph.attachments.after).toMatchObject({
      edgeId: secondEdge.id,
      station: 6,
      assetNodeId: 'asset-after',
      lateralOffset: 3,
      verticalOffset: 0.5,
    })
  })

  test('uses spline chainage instead of chord distance when remapping an attachment', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0], {
      alignment: [[5, 0, 5]],
    }).graph
    const originalEdge = Object.values(base.edges)[0]!
    const points = sampleRoadEdgePoints(base, originalEdge, 48)
    const splitStation = planLength(points.slice(0, 25))
    base.attachments.curveAsset = {
      id: 'curveAsset', edgeId: originalEdge.id, assetNodeId: 'curve-sign', kind: 'sign',
		station: splitStation + 1.5, lateralOffset: 4, verticalOffset: 0,
		alignment: 'free',
    }

    const result = insertRoadSegment(base, [5, 0, -5], [5, 0, 5], { tolerance: 0.01 })
    const secondEdge = Object.values(result.graph.edges).find(
      (edge) => edge.parentEdgeId === originalEdge.id,
    )!

    expect(result.graph.attachments.curveAsset).toMatchObject({ edgeId: secondEdge.id })
    expect(result.graph.attachments.curveAsset!.station).toBeCloseTo(1.5, 4)
  })

  test('preserves attachment ownership while road components merge and separate', () => {
    const left = add(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const right = add(createEmptyRoadGraph(), [30, 0, 0], [40, 0, 0])
    const leftEdgeId = Object.keys(left.edges)[0]!
    const rightEdgeId = Object.keys(right.edges)[0]!
    left.attachments.shared = {
      id: 'shared', edgeId: leftEdgeId, assetNodeId: 'left-sign', kind: 'sign',
		station: 2, lateralOffset: 4, verticalOffset: 0,
		alignment: 'free',
    }
    right.attachments.shared = {
      id: 'shared', edgeId: rightEdgeId, assetNodeId: 'right-lamp', kind: 'lamp',
		station: 7, lateralOffset: -4, verticalOffset: 0,
		alignment: 'free',
    }

    const merged = mergeRoadGraphs([left, right])
    expect(Object.keys(merged.graph.attachments)).toHaveLength(2)
    expect(merged.attachmentIdMaps[0]?.shared).toBe('shared')
    expect(merged.attachmentIdMaps[1]?.shared).not.toBe('shared')
    expect(Object.values(merged.graph.attachments).every(
      (attachment) => attachment.edgeId in merged.graph.edges,
    )).toBe(true)

    const separated = splitRoadGraphComponents(merged.graph)
    expect(separated).toHaveLength(2)
    expect(separated.map((component) => Object.keys(component.attachments).length)).toEqual([1, 1])
    expect(separated.flatMap((component) => Object.values(component.attachments))
      .map((attachment) => attachment.assetNodeId).sort()).toEqual(['left-sign', 'right-lamp'])
  })

  test('persists four adjacent curb corners and an opposite primary pair at a plus', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const result = insertRoadSegment(base, [0, 0, -10], [0, 0, 10], { tolerance: 0.01 })
    const junctionNode = Object.values(result.graph.graphNodes).find(
      (node) => incidentRoadEdges(result.graph, node.id).length === 4,
    )!
    const junction = result.graph.junctions[junctionNode.id]!

    expect(junction.kind).toBe('four-way-plus')
    expect(junction.primaryEdgeIds).toHaveLength(2)
    expect(Object.keys(junction.cornerRadii)).toHaveLength(4)
    const primaryEdges = junction.primaryEdgeIds.map((id) => result.graph.edges[id]!)
    const otherNodes = primaryEdges.map((edge) =>
      result.graph.graphNodes[edge.startNodeId === junctionNode.id ? edge.endNodeId : edge.startNodeId]!,
    )
    expect(Math.sign(otherNodes[0]!.position[0])).toBe(-Math.sign(otherNodes[1]!.position[0]))
    expect(otherNodes[0]!.position[2]).toBeCloseTo(otherNodes[1]!.position[2], 4)
  })

  test('preserves a manual primary pair and authored curb radius during reconciliation', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const graph = insertRoadSegment(base, [0, 0, -10], [0, 0, 10], { tolerance: 0.01 }).graph
    const nodeId = Object.keys(graph.junctions)[0]!
    const incident = incidentRoadEdges(graph, nodeId)
    const vertical = incident.filter((edge) => {
      const otherId = edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId
      return Math.abs(graph.graphNodes[otherId]!.position[2]) > 1
    })
    const cornerKey = Object.keys(graph.junctions[nodeId]!.cornerRadii)[0]!
    graph.junctions[nodeId] = {
      ...graph.junctions[nodeId]!,
      primaryMode: 'manual',
      primaryEdgeIds: vertical.map((edge) => edge.id),
      cornerRadii: { ...graph.junctions[nodeId]!.cornerRadii, [cornerKey]: 11 },
    }

    reconcileRoadJunctions(graph)

    expect(graph.junctions[nodeId]!.primaryMode).toBe('manual')
    expect(graph.junctions[nodeId]!.primaryEdgeIds).toEqual(vertical.map((edge) => edge.id))
    expect(graph.junctions[nodeId]!.cornerRadii[cornerKey]).toBe(11)
  })

  test('remaps persistent junction references when graphs are merged and split', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const first = insertRoadSegment(base, [0, 0, 8], [0, 0, 0], { tolerance: 0.01 }).graph
    const firstNodeId = Object.keys(first.junctions)[0]!
    first.junctions[firstNodeId] = { ...first.junctions[firstNodeId]!, treatment: 'signal' }
    const otherBase = add(createEmptyRoadGraph(), [30, 0, 0], [50, 0, 0])
    const second = insertRoadSegment(otherBase, [40, 0, 8], [40, 0, 0], { tolerance: 0.01 }).graph

    const merged = mergeRoadGraphs([first, second]).graph
    const components = splitRoadGraphComponents(merged)

    expect(Object.keys(merged.junctions)).toHaveLength(2)
    expect(components).toHaveLength(2)
    expect(components.map((component) => Object.keys(component.junctions).length)).toEqual([1, 1])
    expect(Object.values(merged.junctions).some((junction) => junction.treatment === 'signal')).toBe(true)
    for (const junction of Object.values(merged.junctions)) {
      expect(junction.nodeId in merged.graphNodes).toBe(true)
      expect(junction.primaryEdgeIds.every((edgeId) => edgeId in merged.edges)).toBe(true)
    }
  })

  test('snaps to and preserves both sides of a spline road', () => {
    const curved = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0], {
      alignment: [[5, 0, 5]],
      tolerance: 0.01,
    })
    const result = insertRoadSegment(curved.graph, [5, 0, 8], [5, 0, 5.05], {
      tolerance: 0.2,
    })

    const junction = Object.values(result.graph.graphNodes).find(
      (node) => Math.abs(node.position[0] - 5) < 0.1 && Math.abs(node.position[2] - 5) < 0.1,
    )
    expect(junction).toBeDefined()
    const incident = incidentRoadEdges(result.graph, junction!.id)
    expect(incident).toHaveLength(3)
    expect(incident.filter((edge) => edge.alignment.length === 1)).toHaveLength(2)
  })

  test('intersects the actual spline centerline instead of its endpoint chord', () => {
    const curved = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0], {
      alignment: [[5, 0, 5]],
      tolerance: 0.01,
    })
    const result = insertRoadSegment(curved.graph, [5, 0, -2], [5, 0, 6], {
      tolerance: 0.01,
    })

    const junction = Object.values(result.graph.graphNodes).find(
      (node) => incidentRoadEdges(result.graph, node.id).length === 4,
    )
    expect(junction).toBeDefined()
    expect(junction!.position[0]).toBeCloseTo(5, 1)
    expect(junction!.position[2]).toBeCloseTo(5, 1)
  })

  test('splits a newly drawn spline at its actual crossing and preserves both spline pieces', () => {
    const base = add(createEmptyRoadGraph(), [5, 0, -2], [5, 0, 6])
    const result = insertRoadSegment(base, [0, 0, 0], [10, 0, 0], {
      alignment: [[5, 0, 5]],
      tolerance: 0.01,
    })

    expect(result.createdEdgeIds).toHaveLength(2)
    expect(result.createdEdgeIds.map((id) => result.graph.edges[id]!.alignment)).toEqual([
      expect.arrayContaining([expect.any(Array)]),
      expect.arrayContaining([expect.any(Array)]),
    ])
  })

  test('drawing through an existing road splits both into a four-way plus', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const result = insertRoadSegment(base, [0, 0, -10], [0, 0, 10], { tolerance: 0.1 })
    const junction = Object.values(result.graph.graphNodes).find(
      (node) => node.position[0] === 0 && node.position[2] === 0,
    )
    expect(junction).toBeDefined()
    expect(incidentRoadEdges(result.graph, junction!.id)).toHaveLength(4)
    expect(classifyRoadJunction(result.graph, junction!.id)).toBe('four-way-plus')
  })

  test('classifies L and Y layouts from graph geometry', () => {
    let lGraph = add(createEmptyRoadGraph(), [0, 0, 0], [5, 0, 0])
    lGraph = add(lGraph, [0, 0, 0], [0, 0, 5])
    expect(classifyRoadJunction(lGraph, 'road-point_1')).toBe('bend-l')

    let yGraph = add(createEmptyRoadGraph(), [0, 0, 0], [0, 0, -6])
    yGraph = add(yGraph, [0, 0, 0], [-5, 0, 4])
    yGraph = add(yGraph, [0, 0, 0], [5, 0, 4])
    expect(classifyRoadJunction(yGraph, 'road-point_1')).toBe('y')
  })

  test('persists the authored bend radius and derived tangent length', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0], {
      bendRadius: 3,
    })
    const second = insertRoadSegment(first.graph, [10, 0, 0], [10, 0, 10], {
      bendRadius: 3,
    })
    const bend = Object.values(second.graph.graphNodes).find(
      (node) => classifyRoadJunction(second.graph, node.id) === 'bend-l',
    )
    expect(bend?.curveRadius).toBe(3)
    expect(bend?.tangentLength).toBeCloseTo(3, 5)
  })

  test('same-plan bridge crossing does not create a junction', () => {
    const ground = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const bridge = insertRoadSegment(ground, [0, 4, -10], [0, 4, 10], {
      tolerance: 0.1,
      level: 1,
      elevationMode: 'bridge',
    }).graph
    expect(Object.keys(bridge.graphNodes)).toHaveLength(4)
    expect(Object.keys(bridge.edges)).toHaveLength(2)
    expect(Object.values(bridge.graphNodes).every((node) => incidentRoadEdges(bridge, node.id).length === 1)).toBe(true)
  })

  test('does not connect same-mode roads when their actual elevations differ', () => {
    const lower = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const upper = insertRoadSegment(lower, [0, 3, -10], [0, 3, 10], {
      elevationMode: 'ground',
      level: 0,
      stackLevel: 0,
      tolerance: 0.1,
    }).graph

    expect(Object.keys(upper.edges)).toHaveLength(2)
    expect(Object.values(upper.graphNodes).every(
      (node) => incidentRoadEdges(upper, node.id).length === 1,
    )).toBe(true)
  })

  test('connects roads whose vertical difference is inside tolerance', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const result = insertRoadSegment(base, [0, 0.1, -10], [0, 0.1, 10], {
      tolerance: 0.1,
      verticalTolerance: 0.2,
    })
    expect(Object.values(result.graph.graphNodes).some(
      (node) => incidentRoadEdges(result.graph, node.id).length === 4,
    )).toBe(true)
  })

  test('keeps crossings separate when stack levels differ', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0], {
      stackLevel: 0,
    }).graph
    const result = insertRoadSegment(base, [0, 0, -10], [0, 0, 10], {
      stackLevel: 1,
      tolerance: 0.1,
    })
    expect(Object.keys(result.graph.edges)).toHaveLength(2)
  })

  test('persists and respects automatic-join suppression', () => {
    const base = add(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const result = insertRoadSegment(base, [0, 0, -10], [0, 0, 10], {
      joinMode: 'suppress',
      tolerance: 0.1,
    })
    expect(Object.keys(result.graph.edges)).toHaveLength(2)
    expect(result.graph.edges[result.createdEdgeIds[0]!]?.joinMode).toBe('suppress')
  })

  test('keeps different overlap groups separate at the same height', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0], {
      overlapGroup: 'surface',
    }).graph
    const result = insertRoadSegment(base, [0, 0, -10], [0, 0, 10], {
      overlapGroup: 'service',
      tolerance: 0.1,
    })
    expect(Object.keys(result.graph.edges)).toHaveLength(2)
  })

  test('classifies new, extension, T, cross, and suppressed crossing previews', () => {
    const empty = createEmptyRoadGraph()
    expect(previewRoadInsertion(empty, [0, 0, 0], [10, 0, 0]).operation).toBe('new-road')

    const base = add(empty, [-10, 0, 0], [10, 0, 0])
    expect(previewRoadInsertion(base, [10, 0, 0], [15, 0, 0]).operation).toBe('extend-road')
    expect(previewRoadInsertion(base, [0, 0, 5], [0, 0, 0], { tolerance: 0.1 }).operation).toBe('create-tee')
    expect(previewRoadInsertion(base, [0, 0, -5], [0, 0, 5], { tolerance: 0.1 }).operation).toBe('create-cross')
    expect(previewRoadInsertion(base, [0, 0, -5], [0, 0, 5], {
      joinMode: 'suppress',
      tolerance: 0.1,
    }).operation).toBe('no-connection')
  })

  test('classifies endpoints joined between existing roads', () => {
    const first = add(createEmptyRoadGraph(), [0, 0, 0], [5, 0, 0])
    const second = add(first, [10, 0, 0], [15, 0, 0])
    expect(previewRoadInsertion(second, [5, 0, 0], [10, 0, 0]).operation).toBe('join-endpoints')
  })
})
