import {compileStreet} from './street-compiler'
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createRoadGeometry,
  roadRibbonShadowPolicy,
  RoadDraftPreviewSurface,
  RoadNetworkModel,
  setRoadGeometryRetained,
  maskMappedComponentsForProfile,
} from './road-network-model'
import { buildRoadNetworkFloorplan } from './road-network-floorplan'
import { moveRoadTerminal } from './road-network-extension-handles'
import type { GeometryContext } from '@pascal-app/core'
import { createEmptyRoadGraph, insertRoadSegment } from './road-network-topology'
import { DrivewayNode, RoadNetworkNode } from './schema'
import { sampleRoadAlignmentPoints } from './road-network-geometry'
import { DEFAULT_ROAD_STYLE_PRESETS } from './road-style-presets'
import {buildRoadTransitionProfiles} from './road-transition-profile'
import {
  createRoadAttachmentForPlacement,
  pruneOrphanedRoadAttachments,
} from './road-edge-attachments'

function renderThree(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  const previousConsoleError = console.error
  console.error = () => {}
  try {
    return renderToStaticMarkup(element)
  } finally {
    console.error = previousConsoleError
  }
}

function renderRoad(node: RoadNetworkNode): string {
  return renderThree(createElement(RoadNetworkModel, { node }))
}

test('a sparse confirmed mapped sidewalk replaces the estimated band across its full span',()=>{
 const result=insertRoadSegment(createEmptyRoadGraph(),[0,0,0],[100,0,0]),edgeId=Object.keys(result.graph.edges)[0]!
 const node=RoadNetworkNode.parse({...result.graph,osmMappedSurfaces:[{id:200,kind:'sidewalk',associatedEdgeIds:[edgeId],side:'left',tags:{highway:'footway'},points:[[0,0,3],[100,0,3]]}]})
 const profile=buildRoadTransitionProfiles(node)[0]!,before=JSON.stringify(profile)
 expect(profile.samples.some(s=>s.components.left.sidewalk.width>0)).toBe(true)
 const masked=maskMappedComponentsForProfile(node,profile)
 expect(masked.samples.every(s=>s.components.left.sidewalk.width===0)).toBe(true)
 expect(masked.samples.some(s=>s.components.right.sidewalk.width>0)).toBe(true)
 expect(JSON.stringify(profile)).toBe(before)
})

test('renders imported mapped sidewalk and cycleway geometry', () => {
  const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [20, 0, 0])
  const edgeId = Object.keys(result.graph.edges)[0]!
  const node = RoadNetworkNode.parse({
    ...result.graph,
    osmMappedSurfaces: [
      { id: 101, kind: 'sidewalk', tags: { highway: 'footway', width: '2' }, points: [[0, 0, 3], [20, 0, 3]] },
      { id: 102, kind: 'cycleway', tags: { highway: 'cycleway' }, points: [[0, 0, -3], [20, 0, -3]] },
    ],
    osmCrossings: [
      { id: 103, associatedEdgeId: edgeId, point: [10, 0, 0], tags: { highway: 'crossing', kerb: 'lowered', tactile_paving: 'yes' } },
      { id: 104, kind: 'kerb', associatedEdgeId: edgeId, point: [10, 0, 3], tags: { barrier: 'kerb', kerb: 'flush' } },
    ],
  })
  const markup = renderRoad(node)
  expect(markup).toContain('name="road-mapped-sidewalk:101"')
  expect(markup).toContain('name="road-mapped-cycleway:102"')
  expect(markup).toContain('name="road-mapped-crossing-ramp:103"')
  expect(markup).toContain('name="road-mapped-kerb-ramp:104"')
  expect(markup.match(/name="road-mapped-tactile-pad:103"/g)).toHaveLength(2)
})

function polygonContains(
  points: readonly (readonly [number, number])[],
  target: readonly [number, number],
): boolean {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [x1, y1] = points[index]!
    const [x2, y2] = points[previous]!
    if (
      (y1 > target[1]) !== (y2 > target[1])
      && target[0] < ((x2 - x1) * (target[1] - y1)) / (y2 - y1) + x1
    ) {
      inside = !inside
    }
  }
  return inside
}

describe('road network corner rendering', () => {
  test('submits one continuous carriageway mesh while previewing a spline', () => {
    const points = sampleRoadAlignmentPoints(
      [0, 0, 0],
      [[6, 0, 5]],
      [12, 0, 0],
      16,
    )
    const markup = renderThree(createElement(RoadDraftPreviewSurface, {
      points,
      style: DEFAULT_ROAD_STYLE_PRESETS['local-street'],
    }))

    expect(points.length).toBeGreaterThan(2)
    expect(markup.match(/name="road-segment-preview"/g)).toHaveLength(1)
    expect(markup.match(/name="road-side-[^"]+-preview"/g)).toHaveLength(8)
  })

  test('keeps flat curved ribbons from casting shadow acne onto themselves', () => {
    expect(roadRibbonShadowPolicy(false)).toEqual({
      castShadow: false,
      receiveShadow: true,
    })
    expect(roadRibbonShadowPolicy(true)).toEqual({
      castShadow: false,
      receiveShadow: false,
    })
  })

  test('treats a degree-two L bend as a continuous road rather than an intersection disk', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const second = insertRoadSegment(first.graph, [10, 0, 0], [10, 0, 10])

    const markup = renderRoad(RoadNetworkNode.parse(second.graph))

    expect(markup.match(/name="road-segment-surface"/g)).toHaveLength(1)
    expect(markup.match(/name="road-side-left-sidewalk"/g)).toHaveLength(1)
    expect(markup.match(/name="road-side-right-sidewalk"/g)).toHaveLength(1)
    expect(markup).toContain('name="road-marking-centerline"')
    expect(markup).not.toContain('name="road-junction-surface"')
  })

  test('keeps a junction surface where three roads meet', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const second = insertRoadSegment(first.graph, [0, 0, -10], [0, 0, 0])

    const markup = renderRoad(RoadNetworkNode.parse(second.graph))

    expect(markup).toContain('name="road-junction-surface"')
    expect(markup).toContain('name="road-junction-sidewalk"')
  })

  test('renders independently configured components on each road side', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [20, 0, 0])
    result.graph.stylePresets['local-street'] = {
      ...result.graph.stylePresets['local-street']!,
      leftSide: {
        parkingLaneWidth: 2.4,
        bikeLaneWidth: 1.5,
        gutterWidth: 0.3,
        curbWidth: 0.15,
        vergeWidth: 0.8,
        sidewalkWidth: 1.8,
      },
      rightSide: {
        parkingLaneWidth: 0,
        bikeLaneWidth: 0,
        gutterWidth: 0.25,
        curbWidth: 0.12,
        vergeWidth: 0,
        sidewalkWidth: 1.2,
      },
    }

    const node = RoadNetworkNode.parse(result.graph)
    const markup = renderRoad(node)
    const floorplan = buildRoadNetworkFloorplan(node, {
      viewState: {
        selected: false,
        palette: { selectedStroke: '#2563eb' },
      },
    } as unknown as GeometryContext)

    expect(markup).toContain('name="road-side-left-parking-lane"')
    expect(markup).toContain('name="road-side-left-bike-lane"')
    expect(markup).not.toContain('name="road-side-right-parking-lane"')
    expect(markup).not.toContain('name="road-side-right-bike-lane"')
    expect(markup).toContain('name="road-side-right-gutter"')
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    const polygons = floorplan.children.filter((child) => child.kind === 'polygon')
    expect(polygons.some((polygon) => polygon.fill === '#44484c')).toBe(true)
    expect(polygons.some((polygon) => polygon.fill === '#517665')).toBe(true)
    expect(polygons.some((polygon) => polygon.fill === '#85888a')).toBe(true)
  })

  test('cuts every roadside band across an attached driveway mouth', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const edgeId = result.createdEdgeIds[0]!
    const node = RoadNetworkNode.parse({
      ...result.graph,
      attachments: {
        'driveway_1:road': {
          id: 'driveway_1:road',
          edgeId,
          assetNodeId: 'driveway_1',
          kind: 'asset',
          station: 10,
          lateralOffset: 6.5,
          verticalOffset: 0,
          alignment: 'carriageway',
          side: 'left',
          roadOpeningWidth: 3.2,
        },
      },
    })

    expect(node.attachments['driveway_1:road']?.roadOpeningWidth).toBe(3.2)
    const markup = renderRoad(node)
    for (const kind of ['gutter', 'curb', 'verge', 'sidewalk']) {
      expect(markup.match(new RegExp(`name="road-side-left-${kind}`, 'g'))).toHaveLength(2)
      expect(markup.match(new RegExp(`name="road-side-right-${kind}`, 'g'))).toHaveLength(1)
    }

    const floorplan = buildRoadNetworkFloorplan(node, {} as GeometryContext)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    const coversDrivewayMouth = floorplan.children.some((child) => {
      if (child.kind !== 'polygon' || child.fill !== '#748166') return false
      let inside = false
      for (let index = 0, previous = child.points.length - 1; index < child.points.length; previous = index, index += 1) {
        const [x1, y1] = child.points[index]!
        const [x2, y2] = child.points[previous]!
        if ((y1 > 4.475) !== (y2 > 4.475) && 0 < ((x2 - x1) * (4.475 - y1)) / (y2 - y1) + x1) {
          inside = !inside
        }
      }
      return inside
    })
    expect(coversDrivewayMouth).toBe(false)
  })

  test('shifts the roadside opening to match curved-left and curved-right mouths', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const road = RoadNetworkNode.parse(result.graph)
    for (const [shape, curvedEdgeX] of [
      ['curved-left', -0.41],
      ['curved-right', 0.41],
    ] as const) {
      const attached = createRoadAttachmentForPlacement({
        assetNodeId: `driveway_${shape}`,
        id: `driveway_${shape}:road`,
        kind: 'streetscape:driveway',
        node: DrivewayNode.parse({ drivewayShape: shape, curveAmount: 2.5 }),
        networks: [road],
        point: [0, 0, 5],
      })
      expect(attached).not.toBeNull()
      const node = RoadNetworkNode.parse({
        ...road,
        attachments: { [attached!.attachment.id]: attached!.attachment },
      })
      const floorplan = buildRoadNetworkFloorplan(node, {} as GeometryContext)
      expect(floorplan.kind).toBe('group')
      if (floorplan.kind !== 'group') continue
      const vergeCovers = (point: readonly [number, number]) => floorplan.children.some(
        (child) => child.kind === 'polygon'
          && child.fill === '#748166'
          && polygonContains(child.points, point),
      )
      expect(vergeCovers([curvedEdgeX, 4.26])).toBe(true)
      expect(vergeCovers([curvedEdgeX, 4.65])).toBe(false)
    }
  })

  test('restores continuous roadside bands when the driveway asset is deleted', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const edgeId = result.createdEdgeIds[0]!
    const attachments = RoadNetworkNode.parse({
      ...result.graph,
      attachments: {
        driveway_deleted: {
          id: 'driveway_deleted',
          edgeId,
          assetNodeId: 'driveway_deleted',
          kind: 'asset',
          station: 10,
          lateralOffset: 6.5,
          verticalOffset: 0,
          alignment: 'carriageway',
          side: 'left',
          roadOpeningWidth: 3.2,
        },
      },
    }).attachments

    expect(pruneOrphanedRoadAttachments(attachments, new Set(['driveway_deleted']))).toBe(attachments)
    const pruned = pruneOrphanedRoadAttachments(attachments, new Set())
    expect(pruned).toEqual({})
    const node = RoadNetworkNode.parse({ ...result.graph, attachments: pruned })
    const markup = renderRoad(node)
    expect(markup.match(/name="road-side-left-verge"/g)).toHaveLength(1)

    const floorplan = buildRoadNetworkFloorplan(node, {} as GeometryContext)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    expect(floorplan.children.some(
      (child) => child.kind === 'polygon'
        && child.fill === '#748166'
        && polygonContains(child.points, [0, 4.475]),
    )).toBe(true)
  })

  test('renders explicit controls and crossings while inferred arrows remain pending', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [-30, 0, 0], [30, 0, 0])
    const tee = insertRoadSegment(first.graph, [0, 0, -30], [0, 0, 0], { tolerance: 0.1 })

    for (const junction of Object.values(tee.graph.junctions)) junction.treatment = 'stop'
    const markup = renderRoad(RoadNetworkNode.parse(tee.graph))

    expect(markup).toContain('name="road-marking-centerline"')
    expect(markup).not.toContain('name="road-marking-direction-arrow"')
    expect(markup).toContain('name="road-marking-stop-line"')
    expect(markup).toContain('name="road-marking-crosswalk"')
  })

  test('renders dashed internal lane boundaries for multi-lane roads', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [40, 0, 0])
    result.graph.stylePresets['local-street'] = {
      ...result.graph.stylePresets['local-street']!,
      laneCount: 4,
    }

    const markup = renderRoad(RoadNetworkNode.parse(result.graph))

    expect(markup).toContain('name="road-marking-lane-dash"')
  })

  test('uses the solved junction boundary in the selected floorplan', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const second = insertRoadSegment(first.graph, [0, 0, -10], [0, 0, 0])
    const node = RoadNetworkNode.parse(second.graph)
    const floorplan = buildRoadNetworkFloorplan(node, {
      viewState: {
        selected: true,
        palette: { selectedStroke: '#2563eb' },
      },
    } as unknown as GeometryContext)

    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    const compiled=compileStreet(node)
    const junction=compiled.junctions[0]!
    expect(junction.solution.indices.length).toBeGreaterThan(0)
    for(let i=0;i<junction.solution.indices.length;i+=3){
      const points=junction.solution.indices.slice(i,i+3).map(index=>[junction.graphNode.position[0]+junction.solution.positions[index*3]!,junction.graphNode.position[2]+junction.solution.positions[index*3+2]!])
      expect(floorplan.children.some(child=>child.kind==='polygon' && JSON.stringify(child.points)===JSON.stringify(points))).toBe(true)
    }
  })

  test('keeps spline controls out of the always-on road hit targets', () => {
    const curved = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0], {
      alignment: [[0, 0, 4]],
    })
    const tee = insertRoadSegment(curved.graph, [0, 0, -10], [0, 0, 4], {
      tolerance: 0.1,
    })
    const node = RoadNetworkNode.parse(tee.graph)
    const edgeId = Object.keys(node.edges)[0]!
    const junctionId = Object.values(node.graphNodes).find((graphNode) =>
      Object.values(node.edges).filter(
        (edge) => edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
      ).length >= 3,
    )!.id
    const previousConsoleError = console.error
    console.error = () => {}
    let markup = ''
    try {
      markup = renderToStaticMarkup(createElement(RoadNetworkModel, {
        node,
        elementSelection: { networkId: node.id, kind: 'edge', id: edgeId },
        onSelectElement: () => {},
      }))
    } finally {
      console.error = previousConsoleError
    }

    expect(markup).toContain(`name="road-edge-hit:${edgeId}"`)
    expect(markup).not.toContain('name="road-control-hit:')
    expect(markup).toContain('name="road-junction-surface"')
    expect(junctionId).toBeTruthy()
  })

  test('shows the inferred primary approaches when a junction is selected', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const tee = insertRoadSegment(base.graph, [0, 0, -10], [0, 0, 0], { tolerance: 0.1 })
    const node = RoadNetworkNode.parse(tee.graph)
    const junctionId = Object.keys(node.junctions)[0]!
    const previousConsoleError = console.error
    console.error = () => {}
    let markup = ''
    try {
      markup = renderToStaticMarkup(createElement(RoadNetworkModel, {
        node,
        elementSelection: { networkId: node.id, kind: 'junction', id: junctionId },
        onSelectElement: () => {},
      }))
    } finally {
      console.error = previousConsoleError
    }

    expect(markup.match(/name="road-primary-approach:/g)).toHaveLength(2)
  })

  test('renders independently selectable curb-return handles for one junction', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const tee = insertRoadSegment(base.graph, [0, 0, -10], [0, 0, 0], { tolerance: 0.1 })
    const node = RoadNetworkNode.parse(tee.graph)
    const junctionId = Object.keys(node.junctions)[0]!
    const previousConsoleError = console.error
    console.error = () => {}
    let markup = ''
    try {
      markup = renderToStaticMarkup(createElement(RoadNetworkModel, {
        node,
        elementSelection: { networkId: node.id, kind: 'junction', id: junctionId },
        onSelectElement: () => {},
      }))
    } finally {
      console.error = previousConsoleError
    }

    expect(markup.match(/name="road-curb-corner-hit:/g)).toHaveLength(2)
  })

  test('adds draggable curb-return handles to a selected floorplan junction', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const tee = insertRoadSegment(base.graph, [0, 0, -10], [0, 0, 0], { tolerance: 0.1 })
    const node = RoadNetworkNode.parse(tee.graph)
    const floorplan = buildRoadNetworkFloorplan(node, {
      viewState: {
        selected: true,
        palette: { selectedStroke: '#2563eb' },
      },
    } as unknown as GeometryContext)

    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    const handles = floorplan.children.filter(
      (child) => child.kind === 'endpoint-handle' && child.affordance === 'road-curb-corner',
    )
    expect(handles).toHaveLength(2)
    expect(handles.every(
      (handle) => handle.kind === 'endpoint-handle' && handle.variant === 'curve',
    )).toBe(true)
  })

  test('adds draggable graph-node and curve-control handles to selected floorplans', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0], {
      alignment: [[5, 0, 3]],
    })
    const node = RoadNetworkNode.parse(result.graph)
    const floorplan = buildRoadNetworkFloorplan(node, {
      viewState: {
        selected: true,
        palette: { selectedStroke: '#2563eb' },
      },
    } as unknown as GeometryContext)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    const handles = floorplan.children.filter((child) => child.kind === 'endpoint-handle')
    const insertHandles = floorplan.children.filter((child) => child.kind === 'midpoint-handle' && child.affordance === 'road-insert-point')
    const extensionArrows = floorplan.children.filter((child) => child.kind === 'move-arrow')
    expect(handles.filter((handle) => handle.affordance === 'road-node-point')).toHaveLength(2)
    expect(handles.filter((handle) => handle.affordance === 'road-control-point')).toHaveLength(1)
    expect(insertHandles).toHaveLength(2)
    expect(extensionArrows).toHaveLength(2)
    expect(extensionArrows.every((arrow) => arrow.affordance === 'road-extend-endpoint')).toBe(true)
  })

  test('extends an existing terminal without creating another road item', () => {
    const first = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const second = insertRoadSegment(first.graph, [10, 0, 0], [10, 0, 10])
    const node = RoadNetworkNode.parse(second.graph)
    const terminal = Object.values(node.graphNodes).find(
      (graphNode) => graphNode.position[0] === 10 && graphNode.position[2] === 10,
    )!
    const patch = moveRoadTerminal(node, terminal.id, [10, 0, 15])

    expect(patch).not.toBeNull()
    expect(Object.keys(patch!.graphNodes)).toHaveLength(Object.keys(node.graphNodes).length)
    expect(Object.keys(patch!).sort()).toEqual(['graphNodes', 'junctions'])
    expect(patch!.graphNodes[terminal.id]?.position).toEqual([10, 0, 15])
    expect(node.graphNodes[terminal.id]?.position).toEqual([10, 0, 10])
  })

  test('renders an in-scene marker for a blocking graph conflict', () => {
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [10, 0, 0])
    const first = Object.values(result.graph.edges)[0]!
    result.graph.edges.duplicate = { ...first, id: 'duplicate' }

    const markup = renderRoad(RoadNetworkNode.parse(result.graph))

    expect(markup).toContain('name="road-validation-error:duplicate-edge"')
  })

  test('does not submit an empty junction-sidewalk mesh to the renderer', () => {
    let graph = createEmptyRoadGraph()
    graph = insertRoadSegment(graph, [-10, 0, 0], [10, 0, 0]).graph
    graph = insertRoadSegment(graph, [0, 0, -10], [0, 0, 10]).graph
    graph = insertRoadSegment(graph, [-8, 0, -8], [8, 0, 8]).graph

    const markup = renderRoad(RoadNetworkNode.parse(graph))
    const emptyPositionAttribute = 'count="0"'

    expect(markup).not.toContain(emptyPositionAttribute)
  })
})

describe('road WebGPU resource lifecycle', () => {
  test('does not dispose a geometry that is mounted or remounted before retirement', async () => {
    const geometry = createRoadGeometry()
    let disposeCount = 0
    geometry.addEventListener('dispose', () => {
      disposeCount += 1
    })

    setRoadGeometryRetained(geometry, true)
    geometry.dispose()
    await Bun.sleep(550)
    expect(disposeCount).toBe(0)

    setRoadGeometryRetained(geometry, false)
    geometry.dispose()
    await Bun.sleep(250)
    setRoadGeometryRetained(geometry, true)
    await Bun.sleep(300)
    expect(disposeCount).toBe(0)

    setRoadGeometryRetained(geometry, false)
    geometry.dispose()
    await Bun.sleep(550)
    expect(disposeCount).toBe(1)
  })
})

test('renders every captured Times Square junction with the production seam builder', async () => {
  const node = RoadNetworkNode.parse(await Bun.file(`${import.meta.dir}/__fixtures__/osm-times-square-roads.json`).json())
  const markup = renderRoad(node)
  expect(markup.match(/name="road-junction-surface"/g)).toHaveLength(19)
  expect(markup).toContain('name="road-junction-sidewalk"')
  expect(markup).toContain('name="road-pavement-body"')
})
