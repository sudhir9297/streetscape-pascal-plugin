import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { AnyNode } from '@pascal-app/core'
import { CATALOG_LAMP_VARIANTS, getCatalogLampStyleOptions, isCatalogLampKind, LAMP_VISUAL_FAMILIES } from './catalog-lamp-config'
import { cobraHeadLightDefinition } from './cobra-head-light-definition'
import { resolveCobraHeadLightLayout } from './cobra-head-light-geometry'
import { multiHeadAreaLightDefinition } from './multi-head-area-light-definition'
import { areaHeadAngles, resolveMultiHeadAreaLightLayout } from './multi-head-area-light-geometry'
import { trussRoadwayLightDefinition } from './truss-roadway-light-definition'
import { resolveTrussRoadwayLightLayout } from './truss-roadway-light-geometry'
import { resolveHighMastCrownLightLayout } from './high-mast-crown-light-geometry'
import { twinArmMedianLightDefinition } from './twin-arm-median-light-definition'
import { resolveTwinArmMedianLightLayout } from './twin-arm-median-light-geometry'
import { heritageCrookLightDefinition } from './heritage-crook-light-definition'
import {
  buildHeritageCrookCurves,
  resolveHeritageCrookLightLayout,
} from './heritage-crook-light-geometry'
import { streetscapeHostPanel, streetscapePlugin } from './index'
import { postTopLightDefinition } from './post-top-light-definition'
import { resolvePostTopLightLayout } from './post-top-light-geometry'
import {
  BollardLightNode,
  CanopySoffitLightNode,
  CobraHeadLightNode,
  HeritageCrookLightNode,
  HighMastCrownLightNode,
  MultiHeadAreaLightNode,
  PathGardenLightNode,
  PedestrianPostLightNode,
  StreetLightNode,
  TrussRoadwayLightNode,
  TunnelLuminaireNode,
  TwinArmMedianLightNode,
  UtilityPoleNode,
  UtilityWireSpanNode,
  WallPackLightNode,
  WallArmLightNode,
  RoadSignNode,
  RoadNetworkNode,
  createRoadSignNode,
  createRoadSignPreviewNode,
  ROAD_SIGN_PREVIEW_ID,
} from './schema'
import { useStreetscapeStore } from './store'
import {
  findNearestUtilityPoleForConnection,
  findUtilityPoleInlineInsertion,
  resolveUtilityPoleAutoConnect,
  resolveUtilityPolePlacementRotation,
  STANDARD_UTILITY_POLE_AUTO_CONNECT_DISTANCE_M,
  STANDARD_UTILITY_POLE_INLINE_INSERT_DISTANCE_M,
  utilityPoleCrossarmRotationY,
} from './utility-wire-auto-connect'
import { utilityWireDefinition } from './utility-wire-definition'
import { buildUtilityConductorCurves } from './utility-wire-geometry'
import { streetLightDefinition } from './street-light-definition'
import { resolveStreetLightLayout } from './street-light-geometry'
import { utilityPoleDefinition } from './utility-pole-definition'
import { ROAD_SIGN_CATALOG, buildRoadSignGraphicSvg } from './road-sign-config'
import { roadSignDefinition } from './road-sign-definition'
import { roadNetworkDefinition } from './road-network-definition'
import { createEmptyRoadGraph, insertRoadSegment } from './road-network-topology'
import {
  buildRoadSignBackGeometry,
  buildRoadSignPlateGeometry,
  resolveRoadSignLayout,
  resolveRoadSignBracketWidth,
  resolveRoadSignPostPositions,
  ROAD_SIGN_BACK_FACE_GAP_M,
  ROAD_SIGN_FACE_GRAPHIC_GAP_M,
} from './road-sign-geometry'
import {
  resolveUtilityPoleLayout,
  STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M,
  STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M,
} from './utility-pole-geometry'

describe('Streetscape plugin manifest', () => {
  test('exports the stable plugin identity and node kinds', () => {
    expect(streetscapePlugin.id).toBe('pascal:streetscape-lab')
    expect(streetscapePlugin.apiVersion).toBe(1)
    expect(streetscapePlugin.nodes?.map((definition) => definition.kind)).toEqual([
      'streetscape:road-network',
      'streetscape:street-light',
      'streetscape:pedestrian-post-light',
      'streetscape:heritage-crook-light',
      'streetscape:cobra-head-light',
      'streetscape:twin-arm-median-light',
      'streetscape:multi-head-area-light',
      'streetscape:truss-roadway-light',
      'streetscape:high-mast-crown-light',
      'streetscape:shoebox-area-light',
      'streetscape:floodlight-pole',
      'streetscape:traditional-post-top-lantern',
      'streetscape:globe-post-top-light',
      'streetscape:decorative-candelabra-light',
      'streetscape:path-garden-light',
      'streetscape:bollard-light',
      'streetscape:catenary-street-light',
      'streetscape:wall-arm-light',
      'streetscape:wall-pack-light',
      'streetscape:tunnel-luminaire',
      'streetscape:canopy-soffit-light',
      'streetscape:solar-street-light',
      'streetscape:utility-pole',
      'streetscape:utility-wire-span',
      'streetscape:traffic-signal',
      'streetscape:drainage-inlet',
      'streetscape:manhole-cover',
      'streetscape:fire-hydrant',
      'streetscape:traffic-bollard',
      'streetscape:road-barrier',
      'streetscape:driveway',
      'streetscape:mailbox',
      'streetscape:parcel-box',
    'streetscape:trash-bin',
    'streetscape:recycling-bin',
    'streetscape:residential-gate',
      'streetscape:speed-hump',
      'streetscape:road-sign',
    ])
  })

  test('centers every vertical resize tracker over its streetscape asset', () => {
    let trackerCount = 0

    for (const definition of streetscapePlugin.nodes ?? []) {
      if (!definition.handles) continue
      const node = definition.schema.parse({})
      const handles = typeof definition.handles === 'function'
        ? definition.handles(node)
        : definition.handles ?? []

      for (const handle of handles) {
        if (handle.kind !== 'linear-resize' || handle.axis !== 'y') continue
        const position = handle.placement.position(node, {} as never)
        expect([position[0], position[2]]).toEqual([0, 0])
        trackerCount += 1
      }
    }

    expect(trackerCount).toBeGreaterThan(0)
  })

  test('advertises placement-time rotation for every movable streetscape asset', () => {
    const placeableDefinitions = (streetscapePlugin.nodes ?? []).filter(
      (definition) => definition.capabilities.movable && definition.tool,
    )

    expect(placeableDefinitions.length).toBeGreaterThan(0)
    for (const definition of placeableDefinitions) {
      expect(definition.toolHints?.some((hint) => hint.key === 'R')).toBe(true)
    }
  })

  test('registers a drawn road network with stable graph defaults', () => {
    const road = RoadNetworkNode.parse({})
    expect(road.type).toBe('streetscape:road-network')
    expect(road.activeStyleId).toBe('local-street')
    expect(road.stylePresets['local-street']?.laneCount).toBe(2)
    expect(road.stylePresets['local-street']?.sidewalkWidth).toBe(0.5)
    expect(road.stylePresets['local-street']?.leftSide?.curbWidth).toBe(0.15)
    expect(road.stylePresets['local-street']?.rightSide?.vergeWidth).toBe(0.45)
    expect(road.stylePresets.arterial?.laneCount).toBe(4)
    expect(road.attachments).toEqual({})
    expect(road.applyStyleToAll).toBe(true)
		expect(road.regionalPack).toBe('right-driving')
		expect(road.embankmentSlope).toBe(2)
    expect(road.excavationSlope).toBe(1.5)
    expect(roadNetworkDefinition.capabilities.drawTool).toBe(true)
    expect(roadNetworkDefinition.tool).toBeDefined()
    expect(roadNetworkDefinition.renderer).toBeDefined()
    expect(roadNetworkDefinition.floorplan).toBeDefined()
    expect(roadNetworkDefinition.parametrics).toBeDefined()
    const migratedRoad = (roadNetworkDefinition as unknown as {
      migrate: Record<number, (value: unknown) => unknown>
    }).migrate[1]!({ stylePresets: { custom: { id: 'custom' } } }) as {
      stylePresets: Record<string, unknown>
      applyStyleToAll: boolean
    }
    expect(migratedRoad.stylePresets.arterial).toBeDefined()
    expect(migratedRoad.stylePresets.custom).toEqual({ id: 'custom' })
    expect(migratedRoad.applyStyleToAll).toBe(true)
    const narrowedRoad = (roadNetworkDefinition as unknown as {
      migrate: Record<number, (value: unknown) => unknown>
    }).migrate[2]!({
      stylePresets: {
        'local-street': { id: 'local-street', sidewalkWidth: 1.5 },
        custom: { id: 'custom', sidewalkWidth: 1.2 },
      },
    }) as { stylePresets: Record<string, { sidewalkWidth: number }> }
    expect(narrowedRoad.stylePresets['local-street']?.sidewalkWidth).toBe(0.5)
    expect(narrowedRoad.stylePresets.custom?.sidewalkWidth).toBe(1.2)
    const attachmentMigration = (roadNetworkDefinition as unknown as {
      migrate: Record<number, (value: unknown) => unknown>
    }).migrate[6]!
    expect(attachmentMigration({ edges: {} })).toMatchObject({ attachments: {} })
    expect(attachmentMigration({ attachments: { existing: { id: 'existing' } } }))
      .toMatchObject({ attachments: { existing: { id: 'existing' } } })
    const sideComponentMigration = (roadNetworkDefinition as unknown as {
      migrate: Record<number, (value: unknown) => unknown>
    }).migrate[7]!
    expect(sideComponentMigration({
      stylePresets: {
        'local-street': { id: 'local-street', name: 'Legacy local' },
        custom: { id: 'custom', name: 'Custom' },
      },
    })).toMatchObject({
      stylePresets: {
        'local-street': {
          leftSide: { curbWidth: 0.15, gutterWidth: 0.35 },
          rightSide: { sidewalkWidth: 0.5 },
        },
        custom: { id: 'custom', name: 'Custom' },
      },
    })
		const bridgeMigration = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[10]!
		expect(bridgeMigration({ edges: {} })).toMatchObject({
			bridgeDeckThickness: 0.65,
			bridgeBarrierHeight: 1.05,
			bridgePierSpacing: 18,
			bridgePierDiameter: 1.1,
			bridgeMinimumClearance: 4.5,
		})
		const earthworkMigration = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[12]!
		expect(earthworkMigration({ edges: {} })).toMatchObject({
			embankmentSlope: 2,
			excavationSlope: 1.5,
		})
		const regionalMigration = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[13]!
		expect(regionalMigration({ edges: {} })).toMatchObject({
			regionalPack: 'right-driving',
		})
		const connectivityMigration = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[33]!
		expect(connectivityMigration({ edges: {} })).toMatchObject({
			osmLaneConnectivity: [],
		})
  })

  test('shows only visual road controls in the inspector', () => {
    const groups = roadNetworkDefinition.parametrics!.groups
    const labels = groups.map((group) => group.label)
    const keys = groups.flatMap((group) => group.fields.map((field) => field.key))

		expect(labels).toEqual([
			'Baseline correction',
			'Style',
			'Roadside',
			'Terrain',
			'Road',
			'Junction',
		])
    expect(labels).not.toContain('Directed lanes')
    expect(labels).not.toContain('Lane movements')
    expect(labels).not.toContain('Signal timing')
    expect(labels).not.toContain('Channelization')
    expect(labels).not.toContain('Divided junctions')
    expect(labels).not.toContain('Vehicle checks')
    expect(labels).not.toContain('Walking and cycling')
    expect(labels).not.toContain('Traffic simulation')
    expect(labels).not.toContain('Performance budget')
    expect(labels).not.toContain('Scale diagnostics')
    expect(keys).not.toContain('snapTolerance')
    expect(keys).not.toContain('maxRoadGrade')
    expect(keys).not.toContain('bridgeMinimumClearance')
		expect(keys).not.toContain('verticalProfileEditor')
		expect(keys).not.toContain('bridgeDeckThickness')
		expect(keys).not.toContain('bridgeBarrierHeight')
		expect(keys).not.toContain('bridgePierSpacing')
		expect(keys).not.toContain('bridgePierDiameter')
  })

	test('retires legacy road tunnels as ordinary ground roads', () => {
		const retireTunnels = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[27]!
		const migrated = retireTunnels({
			graphNodes: {
				start: { id: 'start', elevationMode: 'tunnel', position: [0, 0, 0] },
				end: { id: 'end', elevationMode: 'tunnel', position: [10, 0, 0] },
			},
			edges: {
				edge: { id: 'edge', startNodeId: 'start', endNodeId: 'end', stackLevel: -1 },
			},
			tunnelClearHeight: 5.5,
			tunnelPortalCutLength: 6,
		}) as {
			graphNodes: Record<string, { elevationMode: string }>
			edges: Record<string, { stackLevel: number }>
			tunnelClearHeight?: number
			tunnelPortalCutLength?: number
		}

		expect(migrated.graphNodes.start?.elevationMode).toBe('ground')
		expect(migrated.graphNodes.end?.elevationMode).toBe('ground')
		expect(migrated.edges.edge?.stackLevel).toBe(0)
		expect(migrated.tunnelClearHeight).toBeUndefined()
		expect(migrated.tunnelPortalCutLength).toBeUndefined()
		const parsedLegacy = RoadNetworkNode.parse({
			graphNodes: {
				start: { id: 'start', elevationMode: 'tunnel', position: [0, 0, 0] },
				end: { id: 'end', elevationMode: 'tunnel', position: [10, 0, 0] },
			},
			edges: {
				edge: {
					id: 'edge',
					startNodeId: 'start',
					endNodeId: 'end',
					stackLevel: -1,
				},
			},
		})
		expect(parsedLegacy.graphNodes.start?.elevationMode).toBe('ground')
		expect(parsedLegacy.edges.edge?.stackLevel).toBe(0)
	})

	test('migrates roadside density presets to explicit metre spacing', () => {
		const migrateSpacing = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[28]!
		expect(migrateSpacing({ roadsideDecorationDensity: 'sparse' })).toMatchObject({
			roadsideDecorationSpacing: 45,
		})
		expect(migrateSpacing({ roadsideDecorationDensity: 'standard' })).toMatchObject({
			roadsideDecorationSpacing: 30,
		})
		expect(migrateSpacing({ roadsideDecorationDensity: 'dense' })).toMatchObject({
			roadsideDecorationSpacing: 20,
		})
	})

	test('keeps legacy roads on one-sided lamps by default', () => {
		const migrateLampSides = (roadNetworkDefinition as unknown as {
			migrate: Record<number, (value: unknown) => unknown>
		}).migrate[29]!
		expect(migrateLampSides({})).toMatchObject({
			roadsideLampsBothSides: false,
		})
		expect(migrateLampSides({ roadsideLampsBothSides: true })).toMatchObject({
			roadsideLampsBothSides: true,
		})
	})

  test('publishes live named HUD chips for road alignment and elevation', () => {
    const hints = roadNetworkDefinition.toolHints as unknown as Array<{
      key: string
      chip?: {
        cycle: () => void
        labels: Record<string, string>
        value: () => string
      }
    }>
    const alignment = hints.find((hint) => hint.key === 'C')?.chip
    const elevation = hints.find((hint) => hint.key === 'B')?.chip
    expect(alignment).toBeDefined()
    expect(elevation).toBeDefined()

    useStreetscapeStore.getState().setRoadAlignmentMode('straight')
    expect(alignment?.labels[alignment.value()]).toBe('Alignment: Straight')
    alignment?.cycle()
    expect(alignment?.labels[alignment.value()]).toBe('Alignment: Smooth curve')

    useStreetscapeStore.getState().setRoadElevationMode('ground')
    expect(elevation?.labels[elevation.value()]).toBe('Elevation: Ground')
    elevation?.cycle()
    expect(elevation?.labels[elevation.value()]).toBe('Elevation: Bridge')

    useStreetscapeStore.getState().setRoadAlignmentMode('straight')
    useStreetscapeStore.getState().setRoadElevationMode('ground')
  })

  test('does not expose a redundant segment delete quick action', () => {
    const result = insertRoadSegment(
      createEmptyRoadGraph(),
      [0, 0, 0],
      [10, 0, 0],
    )
    const node = RoadNetworkNode.parse(result.graph)
    const edgeId = Object.keys(node.edges)[0]!
    useStreetscapeStore.getState().setRoadElementSelection({
      networkId: node.id,
      kind: 'edge',
      id: edgeId,
    })
    const quickActions = roadNetworkDefinition.quickActions as unknown as (
      input: { node: RoadNetworkNode },
    ) => Array<{ id: string; label: string }>

    expect(quickActions({ node })).not.toContainEqual(expect.objectContaining({
      id: 'road:delete-edge',
    }))
    useStreetscapeStore.getState().setRoadElementSelection(null)
  })

  test('migrates legacy junction treatments into persistent junction records', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const tee = insertRoadSegment(base.graph, [0, 0, -8], [0, 0, 0], { tolerance: 0.1 })
    const junctionId = Object.keys(tee.graph.junctions)[0]!
    const { junctions: _junctions, ...legacyGraph } = tee.graph
    const migrated = (roadNetworkDefinition as unknown as {
      migrate: Record<number, (value: unknown) => unknown>
    }).migrate[5]!({
      ...legacyGraph,
      junctionOverrides: { [junctionId]: 'signal' },
    }) as RoadNetworkNode

    expect(migrated.junctions[junctionId]?.kind).toBe('tee')
    expect(migrated.junctions[junctionId]?.treatment).toBe('signal')
    expect(migrated.junctions[junctionId]?.primaryEdgeIds).toHaveLength(2)
    expect('junctionOverrides' in migrated).toBe(false)
  })

  test('edits the selected junction primary road and only the selected curb corner', () => {
    const base = insertRoadSegment(createEmptyRoadGraph(), [-10, 0, 0], [10, 0, 0])
    const plus = insertRoadSegment(base.graph, [0, 0, -10], [0, 0, 10], { tolerance: 0.1 })
    const node = RoadNetworkNode.parse(plus.graph)
    const junctionId = Object.keys(node.junctions)[0]!
    useStreetscapeStore.getState().setRoadElementSelection({
      networkId: node.id,
      kind: 'junction',
      id: junctionId,
    })
    const quickActions = roadNetworkDefinition.quickActions as unknown as (
      input: { node: RoadNetworkNode },
    ) => Array<{
      id: string
      run: (input: { sceneApi: { update: (id: string, patch: Partial<AnyNode>) => void } }) => unknown
    }>
    const junctionActions = quickActions({ node })
    const patches: Partial<AnyNode>[] = []
    const sceneApi = { update: (_id: string, patch: Partial<AnyNode>) => patches.push(patch) }

    junctionActions.find((action) => action.id === 'road:cycle-primary')!.run({ sceneApi })
    expect(junctionActions.some((action) => action.id === 'road:widen-corner')).toBe(false)
    const cornerKey = Object.keys(node.junctions[junctionId]!.cornerRadii)[0]!
    useStreetscapeStore.getState().setRoadElementSelection({
      networkId: node.id,
      kind: 'corner',
      id: junctionId,
      cornerKey,
    })
    const cornerActions = quickActions({ node })
    expect(cornerActions.some((action) => action.id === 'road:widen-corners')).toBe(false)
    cornerActions.find((action) => action.id === 'road:widen-corner')!.run({ sceneApi })
    useStreetscapeStore.getState().setRoadElementSelection(null)

    const primaryPatch = patches[0] as unknown as Pick<RoadNetworkNode, 'junctions'>
    const cornerPatch = patches[1] as unknown as Pick<RoadNetworkNode, 'junctions'>
    expect(primaryPatch.junctions[junctionId]?.primaryMode).toBe('manual')
    expect(primaryPatch.junctions[junctionId]?.primaryEdgeIds).not.toEqual(
      node.junctions[junctionId]!.primaryEdgeIds,
    )
    expect(cornerPatch.junctions[junctionId]!.cornerRadii[cornerKey]).toBe(
      node.junctions[junctionId]!.cornerRadii[cornerKey]! + 1,
    )
    expect(Object.entries(cornerPatch.junctions[junctionId]!.cornerRadii)
      .filter(([key]) => key !== cornerKey)).toEqual(
      Object.entries(node.junctions[junctionId]!.cornerRadii).filter(([key]) => key !== cornerKey),
    )
  })

  test('exposes spline editing only for roads with spline alignment points', () => {
    const straightResult = insertRoadSegment(
      createEmptyRoadGraph(),
      [0, 0, 0],
      [12, 0, 0],
    )
    const straightNode = RoadNetworkNode.parse(straightResult.graph)
    const result = insertRoadSegment(createEmptyRoadGraph(), [0, 0, 0], [12, 0, 0], {
      alignment: [[6, 0, 4]],
    })
    const node = RoadNetworkNode.parse(result.graph)
    const quickActions = roadNetworkDefinition.quickActions as unknown as (
      input: { node: RoadNetworkNode },
    ) => Array<{ id: string; run: (input: { sceneApi: unknown }) => unknown }>

    expect(
      quickActions({ node: straightNode }).some(
        (action) => action.id === 'road:edit-spline',
      ),
    ).toBe(false)
    const editAction = quickActions({ node }).find((action) => action.id === 'road:edit-spline')
    expect(editAction).toBeDefined()
    editAction!.run({ sceneApi: {} })
    expect(useStreetscapeStore.getState().roadElementSelection).toMatchObject({
      networkId: node.id,
      kind: 'spline',
    })
    const edgeId = Object.keys(node.edges)[0]!
    useStreetscapeStore.getState().setRoadElementSelection({
      networkId: node.id, kind: 'control', id: edgeId, index: 0,
    })
    const removeAction = quickActions({ node }).find((action) => action.id === 'road:remove-spline-points')
    expect(removeAction).toBeDefined()
    let removed: unknown
    removeAction!.run({ sceneApi: { update: (_id: unknown, patch: unknown) => { removed = patch } } })
    expect((removed as RoadNetworkNode).edges[edgeId]?.alignment).toHaveLength(0)
    useStreetscapeStore.getState().setRoadElementSelection(null)
  })

  test('associates the Streetscape panel with the plugin', () => {
    expect(streetscapeHostPanel.pluginId).toBe(streetscapePlugin.id)
    expect(streetscapeHostPanel.defaultInstalled).toBe(true)
    expect(streetscapeHostPanel.pluginUrl).toBe(
      'https://github.com/sudhir9297/streetscape-pascal-plugin',
    )
  })

  test('creates a street light with stable defaults', () => {
    const streetLight = StreetLightNode.parse({})
    expect(streetLight.type).toBe('streetscape:street-light')
    expect(streetLight.height).toBe(6)
    expect(streetLight.armLength).toBe(1.2)
    expect(streetLight.lightOn).toBe(false)
    expect(streetLight.intensity).toBe(1200)
    expect(() => StreetLightNode.parse({ height: 0.25 })).toThrow()
    expect(() => StreetLightNode.parse({ height: 31 })).toThrow()
  })

  test('registers placement, rendering, and floorplan support for street lights', () => {
    expect(streetLightDefinition.tool).toBeDefined()
    expect(streetLightDefinition.preview).toBeDefined()
    expect(streetLightDefinition.renderer).toBeDefined()
    expect(streetLightDefinition.floorplan).toBeDefined()
    expect(streetLightDefinition.handles).toHaveLength(3)
  })

  test('keeps the mast arm below the top face of the lamp housing', () => {
    const layout = resolveStreetLightLayout(StreetLightNode.parse({}))
    expect(layout.armEndY + layout.armRadius).toBeLessThan(layout.fixtureTopY)
  })

  test('creates an off pedestrian post-top light with stable defaults', () => {
    const postTopLight = PedestrianPostLightNode.parse({})
    expect(postTopLight.type).toBe('streetscape:pedestrian-post-light')
    expect(postTopLight.height).toBe(6)
    expect(postTopLight.lightOn).toBe(false)
    expect(postTopLight.intensity).toBe(650)
    expect(() => PedestrianPostLightNode.parse({ height: 0.25 })).toThrow()
    expect(() => PedestrianPostLightNode.parse({ height: 31 })).toThrow()
  })

  test('registers the pedestrian post-top model and keeps its head above its pole', () => {
    expect(postTopLightDefinition.tool).toBeDefined()
    expect(postTopLightDefinition.preview).toBeDefined()
    expect(postTopLightDefinition.renderer).toBeDefined()
    expect(postTopLightDefinition.floorplan).toBeDefined()
    expect(postTopLightDefinition.handles).toHaveLength(2)
    const layout = resolvePostTopLightLayout(PedestrianPostLightNode.parse({}))
    expect(layout.neckTopY).toBeGreaterThan(layout.poleTopY)
    expect(layout.lensY).toBeGreaterThan(layout.poleTopY)
    expect(layout.capCenterY + layout.capHeight / 2).toBeCloseTo(layout.height)
  })

  test("creates an off heritage Bishop's Crook lamp with stable defaults", () => {
    const crookLight = HeritageCrookLightNode.parse({})
    expect(crookLight.type).toBe('streetscape:heritage-crook-light')
    expect(crookLight.height).toBe(6)
    expect(crookLight.armReach).toBe(0.9)
    expect(crookLight.lightOn).toBe(false)
    expect(crookLight.intensity).toBe(750)
    expect(() => HeritageCrookLightNode.parse({ armReach: 0.4 })).toThrow()
    expect(() => HeritageCrookLightNode.parse({ height: 31 })).toThrow()
  })

  test('registers the heritage crook model and hangs its lamp below the arm', () => {
    expect(heritageCrookLightDefinition.tool).toBeDefined()
    expect(heritageCrookLightDefinition.preview).toBeDefined()
    expect(heritageCrookLightDefinition.renderer).toBeDefined()
    expect(heritageCrookLightDefinition.floorplan).toBeDefined()
    expect(heritageCrookLightDefinition.handles).toHaveLength(3)
    const layout = resolveHeritageCrookLightLayout(HeritageCrookLightNode.parse({}))
    expect(layout.armEndY).toBeGreaterThan(layout.lampCenterY)
    expect(layout.straightPoleTopY).toBeLessThan(layout.height)
    expect(layout.armReach).toBe(0.9)
  })

  test('creates an off cobra-head roadway lamp with stable defaults', () => {
    const cobraHead = CobraHeadLightNode.parse({})
    expect(cobraHead.type).toBe('streetscape:cobra-head-light')
    expect(cobraHead.height).toBe(6)
    expect(cobraHead.armLength).toBe(1.25)
    expect(cobraHead.lightOn).toBe(false)
    expect(cobraHead.intensity).toBe(1400)
    expect(() => CobraHeadLightNode.parse({ armLength: 0.4 })).toThrow()
    expect(() => CobraHeadLightNode.parse({ height: 31 })).toThrow()
  })

  test('registers the cobra-head model with a swept mast arm below the housing', () => {
    expect(cobraHeadLightDefinition.tool).toBeDefined()
    expect(cobraHeadLightDefinition.preview).toBeDefined()
    expect(cobraHeadLightDefinition.renderer).toBeDefined()
    expect(cobraHeadLightDefinition.floorplan).toBeDefined()
    expect(cobraHeadLightDefinition.handles).toHaveLength(3)
    const layout = resolveCobraHeadLightLayout(CobraHeadLightNode.parse({}))
    expect(layout.armY).toBeGreaterThan(layout.poleTopY)
    expect(layout.fixtureTopY).toBeGreaterThan(layout.armY)
    expect(layout.fixtureLength).toBeGreaterThan(1)
    expect(layout.fixtureWidth).toBeGreaterThan(0.5)
  })

  test('creates an off twin-arm median lamp with stable defaults', () => {
    const twinArm = TwinArmMedianLightNode.parse({})
    expect(twinArm.type).toBe('streetscape:twin-arm-median-light')
    expect(twinArm.height).toBe(6)
    expect(twinArm.armLength).toBe(1.35)
    expect(twinArm.lightOn).toBe(false)
    expect(twinArm.intensity).toBe(1400)
    expect(() => TwinArmMedianLightNode.parse({ armLength: 0.4 })).toThrow()
    expect(() => TwinArmMedianLightNode.parse({ height: 31 })).toThrow()
  })

  test('registers the twin-arm median model with two opposing fixture spans', () => {
    expect(twinArmMedianLightDefinition.tool).toBeDefined()
    expect(twinArmMedianLightDefinition.preview).toBeDefined()
    expect(twinArmMedianLightDefinition.renderer).toBeDefined()
    expect(twinArmMedianLightDefinition.floorplan).toBeDefined()
    expect(twinArmMedianLightDefinition.handles).toHaveLength(3)
    const layout = resolveTwinArmMedianLightLayout(TwinArmMedianLightNode.parse({}))
    expect(layout.armLength).toBe(1.35)
    expect(layout.fixtureStartX + layout.fixtureLength).toBeGreaterThan(layout.armLength)
    expect(layout.armY).toBeGreaterThan(layout.poleTopY)
    expect(layout.fixtureWidth).toBeLessThan(0.5)
  })

  test('creates an off four-head area pole with stable defaults', () => {
    const areaLight = MultiHeadAreaLightNode.parse({})
    expect(areaLight.type).toBe('streetscape:multi-head-area-light')
    expect(areaLight.height).toBe(6)
    expect(areaLight.armLength).toBe(1.2)
    expect(areaLight.headCount).toBe(4)
    expect(areaLight.lightOn).toBe(false)
    expect(() => MultiHeadAreaLightNode.parse({ headCount: 2 })).toThrow()
    expect(() => MultiHeadAreaLightNode.parse({ headCount: 5 })).toThrow()
  })

  test('registers the area pole with three- and four-head radial layouts', () => {
    expect(multiHeadAreaLightDefinition.tool).toBeDefined()
    expect(multiHeadAreaLightDefinition.preview).toBeDefined()
    expect(multiHeadAreaLightDefinition.renderer).toBeDefined()
    expect(multiHeadAreaLightDefinition.floorplan).toBeDefined()
    expect(multiHeadAreaLightDefinition.handles).toHaveLength(3)
    const layout = resolveMultiHeadAreaLightLayout(MultiHeadAreaLightNode.parse({}))
    expect(areaHeadAngles(3)).toHaveLength(3)
    expect(areaHeadAngles(4)).toHaveLength(4)
    expect(layout.fixtureStartX + layout.fixtureLength).toBeGreaterThan(layout.armLength)
  })

  test('creates an off truss roadway lamp with stable defaults', () => {
    const trussLight = TrussRoadwayLightNode.parse({})
    expect(trussLight.type).toBe('streetscape:truss-roadway-light')
    expect(trussLight.height).toBe(6)
    expect(trussLight.armLength).toBe(2)
    expect(trussLight.braceDepth).toBe(0.75)
    expect(trussLight.lightOn).toBe(false)
    expect(() => TrussRoadwayLightNode.parse({ braceDepth: 0.2 })).toThrow()
    expect(() => TrussRoadwayLightNode.parse({ armLength: 3.6 })).toThrow()
  })

  test('registers the truss roadway model with a braced outreach', () => {
    expect(trussRoadwayLightDefinition.tool).toBeDefined()
    expect(trussRoadwayLightDefinition.preview).toBeDefined()
    expect(trussRoadwayLightDefinition.renderer).toBeDefined()
    expect(trussRoadwayLightDefinition.floorplan).toBeDefined()
    expect(trussRoadwayLightDefinition.handles).toHaveLength(3)
    const layout = resolveTrussRoadwayLightLayout(TrussRoadwayLightNode.parse({}))
    expect(layout.braceDepth).toBe(0.75)
    expect(layout.fixtureStartX + layout.fixtureLength).toBeGreaterThan(layout.armLength)
  })

  test('registers every remaining lamp archetype with off-by-default placement support', () => {
    for (const variant of CATALOG_LAMP_VARIANTS) {
      const node = variant.schema.parse({})
      expect(node.type).toBe(variant.kind)
      expect(node.lightOn).toBe(false)
      const definition = streetscapePlugin.nodes?.find((candidate) => candidate.kind === variant.kind)
      expect(definition?.tool).toBeDefined()
      expect(definition?.preview).toBeDefined()
      expect(definition?.renderer).toBeDefined()
      expect(definition?.floorplan).toBeDefined()
    }
  })

  test('registers the architectural wall arm as a Pascal wall-hosted node', () => {
    const definition = streetscapePlugin.nodes?.find(
      (candidate) => candidate.kind === 'streetscape:wall-arm-light',
    ) as any

    expect(definition?.capabilities.hostable).toEqual({ parents: ['wall'], align: 'face' })
    expect(definition?.capabilities.hostRefFields).toEqual(['wallId', 'wallT'])
    expect(definition?.capabilities.floorPlaced.applies(
      WallArmLightNode.parse({ wallId: 'wall:test', wallT: 0.5 }),
    )).toBe(false)
  })

  test('registers the wall pack as a cursor-positioned Pascal wall-hosted node', () => {
    const definition = streetscapePlugin.nodes?.find(
      (candidate) => candidate.kind === 'streetscape:wall-pack-light',
    ) as any
    const attached = WallPackLightNode.parse({
      position: [1.4, 1.85, 0.1],
      wallId: 'wall:test',
      wallT: 0.35,
      side: 'front',
    })

    expect(attached.wallId).toBe('wall:test')
    expect(attached.wallT).toBeCloseTo(0.35)
    expect(attached.side).toBe('front')
    expect(attached.position[1]).toBeCloseTo(1.85)
    expect(definition?.capabilities.hostable).toEqual({ parents: ['wall'], align: 'face' })
    expect(definition?.capabilities.hostRefFields).toEqual(['wallId', 'wallT'])
    expect(definition?.capabilities.floorPlaced.applies(attached)).toBe(false)
  })

  test('registers the tunnel luminaire as a Pascal ceiling-hosted node', () => {
    const definition = streetscapePlugin.nodes?.find(
      (candidate) => candidate.kind === 'streetscape:tunnel-luminaire',
    ) as any
    const attached = TunnelLuminaireNode.parse({ ceilingId: 'ceiling_test' })
    const legacy = TunnelLuminaireNode.parse({})

    expect(attached.attachTo).toBe('ceiling')
    expect(definition?.capabilities.hostable).toEqual({
      parents: ['ceiling'],
      align: 'bottom',
    })
    expect(definition?.capabilities.hostRefFields).toEqual(['ceilingId'])
    expect(definition?.capabilities.floorPlaced.applies(attached)).toBe(false)
    expect(definition?.capabilities.floorPlaced.applies(legacy)).toBe(true)
    expect(definition?.handles).toHaveLength(2)
    const heightField = definition?.parametrics.groups
      .flatMap((group: any) => group.fields)
      .find((field: any) => field.key === 'height')
    expect(heightField?.visibleIf(attached)).toBe(false)
  })

  test('registers the canopy light as a compact Pascal ceiling-hosted node', () => {
    const definition = streetscapePlugin.nodes?.find(
      (candidate) => candidate.kind === 'streetscape:canopy-soffit-light',
    ) as any
    const attached = CanopySoffitLightNode.parse({ ceilingId: 'ceiling_test' })
    const legacy = CanopySoffitLightNode.parse({})

    expect(attached.attachTo).toBe('ceiling')
    expect(definition?.capabilities.hostable).toEqual({
      parents: ['ceiling'],
      align: 'bottom',
    })
    expect(definition?.capabilities.hostRefFields).toEqual(['ceilingId'])
    expect(definition?.capabilities.floorPlaced.applies(attached)).toBe(false)
    expect(definition?.capabilities.floorPlaced.applies(legacy)).toBe(true)
    expect(definition?.handles).toHaveLength(2)
    const heightField = definition?.parametrics.groups
      .flatMap((group: any) => group.fields)
      .find((field: any) => field.key === 'height')
    expect(heightField?.visibleIf(attached)).toBe(false)
  })

  test('keeps roadway lamps at six metres and gives purpose-scaled lamps true defaults', () => {
    const nodes = [
      StreetLightNode.parse({}),
      PedestrianPostLightNode.parse({}),
      HeritageCrookLightNode.parse({}),
      CobraHeadLightNode.parse({}),
      TwinArmMedianLightNode.parse({}),
      MultiHeadAreaLightNode.parse({}),
      TrussRoadwayLightNode.parse({}),
      ...CATALOG_LAMP_VARIANTS
        .filter((variant) => variant.kind !== 'streetscape:high-mast-crown-light'
          && variant.kind !== 'streetscape:path-garden-light'
          && variant.kind !== 'streetscape:bollard-light'
          && variant.kind !== 'streetscape:wall-pack-light')
        .map((variant) => variant.schema.parse({})),
    ]
    for (const node of nodes) {
      expect(node.height).toBe(6)
    }
    expect(PathGardenLightNode.parse({}).height).toBe(0.78)
    expect(BollardLightNode.parse({}).height).toBe(0.72)
    expect(WallPackLightNode.parse({}).height).toBe(2.7)
    expect(() => StreetLightNode.parse({ height: 0.49 })).toThrow()
    expect(() => CATALOG_LAMP_VARIANTS[0].schema.parse({ height: 30.1 })).toThrow()
    const highMast = HighMastCrownLightNode.parse({})
    expect(highMast.height).toBe(18)
    expect(resolveHighMastCrownLightLayout(highMast).fixtureCenterRadius).toBe(1.8)
  })

  test('groups similar silhouettes behind shared side-menu style families', () => {
    expect(LAMP_VISUAL_FAMILIES.map((family) => family.id)).toEqual([
      'roadway-head',
      'post-top',
      'path-scale',
      'structure-mounted',
    ])
    expect(getCatalogLampStyleOptions('streetscape:shoebox-area-light').map((option) => option.value)).toContain('floodlight')
    expect(getCatalogLampStyleOptions('streetscape:traditional-post-top-lantern').map((option) => option.value)).toContain('globe')
    expect(getCatalogLampStyleOptions('streetscape:wall-pack-light').map((option) => option.value)).toContain('wall-arm')
  })

  test('removes the in-ground uplight from the catalog and registry', () => {
    expect(CATALOG_LAMP_VARIANTS.some((variant) => (variant.kind as string) === 'streetscape:in-ground-uplight')).toBe(false)
    expect(isCatalogLampKind('streetscape:in-ground-uplight')).toBe(false)
    expect(streetscapePlugin.nodes?.some((definition) => definition.kind === 'streetscape:in-ground-uplight')).toBe(false)
  })

  test('keeps the heritage crook smooth and joins its decorative brace', () => {
    const layout = resolveHeritageCrookLightLayout(HeritageCrookLightNode.parse({}))
    const { crookCurve, braceCurve } = buildHeritageCrookCurves(layout)
    const endTangent = crookCurve.getTangent(1)
    expect(Math.abs(endTangent.x)).toBeLessThan(0.05)
    expect(endTangent.y).toBeLessThan(-0.99)

    const braceEnd = braceCurve.getPoint(1)
    let braceGap = Number.POSITIVE_INFINITY
    for (let index = 0; index <= 200; index += 1) {
      braceGap = Math.min(
        braceGap,
        braceEnd.distanceTo(crookCurve.getPoint(index / 200)),
      )
    }
    expect(braceGap).toBeLessThan(0.01)

    let maxTangentStep = 0
    for (let index = 0; index < 64; index += 1) {
      maxTangentStep = Math.max(
        maxTangentStep,
        crookCurve
          .getTangent(index / 64)
          .angleTo(crookCurve.getTangent((index + 1) / 64)),
      )
    }
    expect(maxTangentStep).toBeLessThan(0.09)
  })

  test('creates a utility pole with stable defaults', () => {
    const utilityPole = UtilityPoleNode.parse({})
    expect(utilityPole.type).toBe('streetscape:utility-pole')
    expect(utilityPole.height).toBe(STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M)
    expect(utilityPole.crossarmLength).toBe(STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M)
    expect(utilityPole.assembly).toBe('tangent')
    expect(utilityPole.transformerMounted).toBe(true)
    expect(() => UtilityPoleNode.parse({ height: 5.9 })).toThrow()
    expect(() => UtilityPoleNode.parse({ crossarmLength: 4.6 })).toThrow()
  })

  test('registers placement, rendering, and floorplan support for utility poles', () => {
    expect(utilityPoleDefinition.tool).toBeDefined()
    expect(utilityPoleDefinition.preview).toBeDefined()
    expect(utilityPoleDefinition.renderer).toBeDefined()
    expect(utilityPoleDefinition.floorplan).toBeDefined()
    expect(utilityPoleDefinition.handles).toHaveLength(3)
  })

  test('exposes stable primary and neutral conductor attachment points', () => {
    const layout = resolveUtilityPoleLayout(UtilityPoleNode.parse({}))
    expect(layout.wireAttachments.map((attachment) => attachment.id)).toEqual([
      'phase-left',
      'phase-center',
      'phase-right',
      'neutral',
    ])
    expect(layout.wireAttachments[1]?.position[1]).toBeGreaterThan(
      layout.wireAttachments[0]?.position[1] ?? 0,
    )
    expect(layout.wireAttachments[3]?.position[1]).toBeLessThan(
      layout.wireAttachments[0]?.position[1] ?? 0,
    )
  })

  test('uses the visible height of a standard installed 35-foot residential pole', () => {
    const layout = resolveUtilityPoleLayout(UtilityPoleNode.parse({}))
    expect(layout.height).toBeCloseTo(8.9916, 4)
    expect(layout.crossarmLength).toBeCloseTo(2.4384, 4)
    expect(layout.poleBottomRadius * 2).toBeLessThan(0.4)
  })

  test('migrates only untouched 40-foot v1 pole defaults to the residential height', () => {
    const migrate = utilityPoleDefinition.migrate?.[1]
    expect(migrate?.({ height: 10.3632 })).toEqual({ height: 8.9916 })
    expect(migrate?.({ height: 12 })).toEqual({ height: 12 })
    expect(utilityPoleDefinition.migrate?.[2]?.({ height: 9 })).toEqual({
      height: 9,
      assembly: 'tangent',
    })
    expect(utilityPoleDefinition.migrate?.[2]?.({ assembly: 'dead-end' })).toEqual({
      assembly: 'dead-end',
    })
  })

  test('keeps streetscape placement tools armed until cancellation or tool change', () => {
    const store = useStreetscapeStore.getState()
    const panel = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')
    const placement = readFileSync(new URL('./placement.tsx', import.meta.url), 'utf8')

    expect('placementMode' in store).toBe(false)
    expect('setPlacementMode' in store).toBe(false)
    expect(panel).not.toContain("['single', 'continuous']")
    expect(placement).not.toContain("setMode('select')")
  })

  test('configures automatic road infrastructure from the Streetscape side menu', () => {
    const store = useStreetscapeStore.getState()
    expect(store.roadAutoInfrastructure.enabled).toBe(false)
    expect(Object.values(store.roadAutoInfrastructure.items).every((value) => !value)).toBe(true)

    store.setRoadAutoInfrastructureEnabled(false)
    expect(useStreetscapeStore.getState().roadAutoInfrastructure.enabled).toBe(false)
    store.setRoadAutoInfrastructureItem('streetscape:fire-hydrant', false)
    expect(
      useStreetscapeStore.getState().roadAutoInfrastructure.items['streetscape:fire-hydrant'],
    ).toBe(false)

    const panel = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('data-road-auto-infrastructure')
    expect(panel).toContain('Automatic infrastructure')
    expect(panel).toContain('Add automatically')
    const roadsideInspector = readFileSync(new URL('./roadside-decoration-rules.tsx', import.meta.url), 'utf8')
    expect(panel).not.toContain('Selected road items')
    expect(panel).not.toContain('data-roadside-item-delete')
    expect(roadsideInspector).toContain('Roadside item visibility')
    expect(roadsideInspector).toContain('ROAD_AUTO_INFRASTRUCTURE_OPTIONS.map')
    expect(roadsideInspector).not.toContain('Show lamps and signs')

    store.setRoadAutoInfrastructureEnabled(true)
    store.setRoadAutoInfrastructureItem('streetscape:fire-hydrant', true)
  })

  test('separates roads, lighting, signs, utilities, and map import into panel categories', () => {
    expect(useStreetscapeStore.getState().panelCategory).toBe('roads')
    useStreetscapeStore.getState().setPanelCategory('roads')
    expect(useStreetscapeStore.getState().panelCategory).toBe('roads')
    useStreetscapeStore.getState().setPanelCategory('signs')
    expect(useStreetscapeStore.getState().panelCategory).toBe('signs')
    useStreetscapeStore.getState().setPanelCategory('utilities')
    expect(useStreetscapeStore.getState().panelCategory).toBe('utilities')
    useStreetscapeStore.getState().setPanelCategory('map')
    expect(useStreetscapeStore.getState().panelCategory).toBe('map')
    useStreetscapeStore.getState().setPanelCategory('lighting')
    expect(useStreetscapeStore.getState().postTopLightOn).toBe(false)
    expect(useStreetscapeStore.getState().heritageCrookLightOn).toBe(false)
    expect(useStreetscapeStore.getState().cobraHeadLightOn).toBe(false)
    expect(useStreetscapeStore.getState().twinArmMedianLightOn).toBe(false)
    expect(useStreetscapeStore.getState().multiHeadAreaLightOn).toBe(false)
    expect(useStreetscapeStore.getState().trussRoadwayLightOn).toBe(false)
  })

  test('creates catalog-driven road signs with stable mounting defaults', () => {
    const sign = RoadSignNode.parse({})
    expect(sign.type).toBe('streetscape:road-sign')
    expect(sign.signId).toBe('stop')
    expect(sign.postHeight).toBe(2.1)
    expect(sign.mounting).toBe('single-post')
    expect(ROAD_SIGN_CATALOG).toHaveLength(8)
    const stop = ROAD_SIGN_CATALOG.find(({ id }) => id === 'stop')
    expect(stop?.width).toBeCloseTo(0.762)
    expect(stop?.postStyle).toBe('u-channel')
    expect(() => RoadSignNode.parse({ scale: 0.2 })).toThrow()
    expect(() => RoadSignNode.parse({ postHeight: 5 })).toThrow()
  })

  test('creates every catalog sign with a fresh persistent ID', () => {
    const occupiedIds = new Set<string>()
    const placed = ROAD_SIGN_CATALOG.map((entry) => {
      const sign = createRoadSignNode({ signId: entry.id }, occupiedIds)
      occupiedIds.add(sign.id)
      return sign
    })

    expect(new Set(placed.map((sign) => sign.id)).size).toBe(ROAD_SIGN_CATALOG.length)
    expect(placed.every((sign) => /^road-sign_[0-9a-z]{16}$/.test(sign.id))).toBe(true)

    const duplicateInput = createRoadSignNode({ id: placed[0]!.id, signId: 'stop' }, occupiedIds)
    expect(duplicateInput.id).not.toBe(placed[0]!.id)
    expect(occupiedIds.has(duplicateInput.id)).toBe(false)
  })

  test('keeps the placement preview out of the persistent sign ID space', () => {
    const preview = createRoadSignPreviewNode({ signId: 'warning' })
    expect(preview.id).toBe(ROAD_SIGN_PREVIEW_ID)
    expect(preview.id).not.toMatch(/^road-sign_[0-9a-z]{16}$/)
  })

  test('registers road sign placement, rendering, inspector, and floorplan support', () => {
    expect(roadSignDefinition.tool).toBeDefined()
    expect(roadSignDefinition.preview).toBeDefined()
    expect(roadSignDefinition.renderer).toBeDefined()
    expect(roadSignDefinition.floorplan).toBeDefined()
    expect(roadSignDefinition.handles).toHaveLength(3)
    const layout = resolveRoadSignLayout(RoadSignNode.parse({ signId: 'pedestrian-crossing' }))
    expect(layout.signCenterY).toBeGreaterThan(layout.postHeight)
    expect(layout.postCount).toBe(1)
    expect(layout.postStyle).toBe('u-channel')
    const doublePost = resolveRoadSignLayout(
      RoadSignNode.parse({ signId: 'directional', mounting: 'double-post' }),
    )
    expect(doublePost.postCount).toBe(2)
    expect(doublePost.postSpacing).toBeGreaterThan(0)
    const geometry = buildRoadSignPlateGeometry(doublePost)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    geometry.dispose()
  })

  test('keeps sign graphics vector-based and safely escapes custom text', () => {
    const svg = buildRoadSignGraphicSvg({ signId: 'directional', text: '<MAIN & 2nd>' })
    expect(svg).toContain('MAIN &amp; 2nd')
    expect(svg).not.toContain('<MAIN & 2nd>')
    expect(svg).toContain('<svg')
    expect(svg).toContain('MAIN &amp; 2nd')
  })

  test('keeps circular graphic strokes inside their texture bounds', () => {
    for (const entry of ROAD_SIGN_CATALOG.filter(({ shape }) => shape === 'circle')) {
      const svg = buildRoadSignGraphicSvg({ signId: entry.id })
      const circle = svg.match(/<circle[^>]*r="([0-9.]+)"[^>]*stroke-width="([0-9.]+)"/)
      expect(circle).not.toBeNull()

      const radius = Number(circle![1])
      const strokeWidth = Number(circle![2])
      expect(radius + strokeWidth / 2).toBeLessThanOrEqual(Math.min(entry.width, entry.height) / 2)
    }
  })

  test('keeps diamond graphic strokes inside their texture bounds', () => {
    for (const entry of ROAD_SIGN_CATALOG.filter(({ shape }) => shape === 'diamond')) {
      const svg = buildRoadSignGraphicSvg({ signId: entry.id })
      const polygon = svg.match(
        /<polygon points="([^"]+)"[^>]*stroke="[^"]+"[^>]*stroke-width="([0-9.]+)"/,
      )
      expect(polygon).not.toBeNull()

      const strokeWidth = Number(polygon![2])
      for (const point of polygon![1]!.split(' ')) {
        const [xText, yText] = point.split(',')
        const x = Number(xText)
        const y = Number(yText)
        expect(Math.abs(x) + strokeWidth / 2).toBeLessThanOrEqual(entry.width / 2)
        expect(Math.abs(y) + strokeWidth / 2).toBeLessThanOrEqual(entry.height / 2)
      }
    }
  })

  test('keeps diamond sign hardware inside the visible sign silhouette', () => {
    const layout = resolveRoadSignLayout(RoadSignNode.parse({ signId: 'warning' }))
    const bracketWidth = resolveRoadSignBracketWidth(layout)
    expect(bracketWidth).toBeGreaterThan(0.08)
    expect(bracketWidth).toBeLessThan(layout.width * 0.5)
  })

  test('resolves stable single- and double-post layouts for every sign', () => {
    for (const entry of ROAD_SIGN_CATALOG) {
      const singleLayout = resolveRoadSignLayout(RoadSignNode.parse({ signId: entry.id }))
      expect(resolveRoadSignPostPositions(singleLayout)).toEqual([0])

      const doubleLayout = resolveRoadSignLayout(
        RoadSignNode.parse({ signId: entry.id, mounting: 'double-post' }),
      )
      const positions = resolveRoadSignPostPositions(doubleLayout)
      expect(positions).toHaveLength(2)
      expect(positions[0]!).toBeLessThan(0)
      expect(positions[1]!).toBeGreaterThan(0)
      expect(positions[0]).toBe(-positions[1]!)
    }
  })

  test('keeps every sign face layer outside the plate depth', () => {
    expect(ROAD_SIGN_FACE_GRAPHIC_GAP_M).toBeGreaterThan(0.0015)
    expect(ROAD_SIGN_BACK_FACE_GAP_M).toBeGreaterThan(0.0015)

    for (const entry of ROAD_SIGN_CATALOG) {
      const layout = resolveRoadSignLayout(RoadSignNode.parse({ signId: entry.id }))
      const plate = buildRoadSignPlateGeometry(layout)
      const back = buildRoadSignBackGeometry(layout)
      plate.computeBoundingBox()
      back.computeBoundingBox()
      expect(plate.boundingBox!.min.z - back.boundingBox!.max.z).toBeGreaterThan(0.0015)
      plate.dispose()
      back.dispose()
    }
  })

  test('registers an automatic primary-and-neutral utility wire span', () => {
    const span = UtilityWireSpanNode.parse({
      fromPoleId: 'utility-pole_from',
      toPoleId: 'utility-pole_to',
    })
    expect(span.type).toBe('streetscape:utility-wire-span')
    expect(span.sagRatio).toBe(0.035)
    expect(utilityWireDefinition.renderer).toBeDefined()
    expect(utilityWireDefinition.floorplan).toBeDefined()
  })

  test('connects only to the nearest same-level pole inside the urban span limit', () => {
    const placed = UtilityPoleNode.parse({
      id: 'utility-pole_placed',
      parentId: 'level_test',
      position: [0, 0, 0],
    })
    const nearest = UtilityPoleNode.parse({
      id: 'utility-pole_nearest',
      parentId: 'level_test',
      position: [32, 0, 0],
    })
    const outsideRange = UtilityPoleNode.parse({
      id: 'utility-pole_far',
      parentId: 'level_test',
      position: [STANDARD_UTILITY_POLE_AUTO_CONNECT_DISTANCE_M + 0.1, 0, 0],
    })
    const otherLevel = UtilityPoleNode.parse({
      id: 'utility-pole_other-level',
      parentId: 'level_other',
      position: [2, 0, 0],
    })
    const nodes = Object.fromEntries(
      [placed, nearest, outsideRange, otherLevel].map((node) => [
        node.id,
        node as unknown as AnyNode,
      ]),
    )
    expect(findNearestUtilityPoleForConnection(placed, nodes)?.id).toBe(nearest.id)
  })

  test('builds three primary and one neutral sagging conductor curves between pole anchors', () => {
    const from = UtilityPoleNode.parse({
      id: 'utility-pole_curve-from',
      position: [0, 0, 0],
    })
    const to = UtilityPoleNode.parse({
      id: 'utility-pole_curve-to',
      position: [30, 0, 0],
    })
    const span = UtilityWireSpanNode.parse({
      fromPoleId: from.id,
      toPoleId: to.id,
    })
    const curves = buildUtilityConductorCurves(span, { node: from }, { node: to })
    expect(curves).toHaveLength(4)
    for (const { curve } of curves) {
      expect(curve.getPoint(0.5).y).toBeLessThan((curve.v0.y + curve.v2.y) / 2)
    }
  })

  test('splits a through-span when a new pole is placed inline', () => {
    const from = UtilityPoleNode.parse({
      id: 'utility-pole_inline-from',
      parentId: 'level_inline',
      position: [0, 0, 0],
    })
    const to = UtilityPoleNode.parse({
      id: 'utility-pole_inline-to',
      parentId: 'level_inline',
      position: [30, 0, 0],
    })
    const placed = UtilityPoleNode.parse({
      id: 'utility-pole_inline-placed',
      parentId: 'level_inline',
      position: [15, 0, STANDARD_UTILITY_POLE_INLINE_INSERT_DISTANCE_M - 0.5],
    })
    const span = UtilityWireSpanNode.parse({
      id: 'utility-wire-span_inline',
      parentId: 'level_inline',
      fromPoleId: from.id,
      toPoleId: to.id,
    })
    const nodes = Object.fromEntries(
      [from, to, placed, span].map((node) => [node.id, node as unknown as AnyNode]),
    )

    const insertion = findUtilityPoleInlineInsertion(placed, nodes)
    expect(insertion?.span.id).toBe(span.id)
    expect(insertion?.positionT).toBeCloseTo(0.5)
    expect(insertion?.distance).toBeCloseTo(STANDARD_UTILITY_POLE_INLINE_INSERT_DISTANCE_M - 0.5)
    expect(resolveUtilityPoleAutoConnect(placed, nodes)?.kind).toBe('inline')
  })

  test('keeps a nearby endpoint available for a T-junction branch', () => {
    const center = UtilityPoleNode.parse({
      id: 'utility-pole_junction-center',
      parentId: 'level_junction',
      position: [0, 0, 0],
    })
    const through = UtilityPoleNode.parse({
      id: 'utility-pole_junction-through',
      parentId: 'level_junction',
      position: [30, 0, 0],
    })
    const branch = UtilityPoleNode.parse({
      id: 'utility-pole_junction-branch',
      parentId: 'level_junction',
      position: [0, 0, 20],
    })
    const span = UtilityWireSpanNode.parse({
      id: 'utility-wire-span_junction',
      parentId: 'level_junction',
      fromPoleId: center.id,
      toPoleId: through.id,
    })
    const nodes = Object.fromEntries(
      [center, through, branch, span].map((node) => [node.id, node as unknown as AnyNode]),
    )

    expect(resolveUtilityPoleAutoConnect(branch, nodes)).toMatchObject({
      kind: 'branch',
      pole: { id: center.id },
    })
  })

  test('orients a new pole crossarm perpendicular to its connected line', () => {
    const from = UtilityPoleNode.parse({
      id: 'utility-pole_heading-from',
      parentId: 'level_heading',
      position: [0, 0, 0],
    })
    const to = UtilityPoleNode.parse({
      id: 'utility-pole_heading-to',
      parentId: 'level_heading',
      position: [30, 0, 0],
    })
    const placed = UtilityPoleNode.parse({
      id: 'utility-pole_heading-placed',
      parentId: 'level_heading',
      position: [15, 0, 0],
    })
    const span = UtilityWireSpanNode.parse({
      id: 'utility-wire-span_heading',
      parentId: 'level_heading',
      fromPoleId: from.id,
      toPoleId: to.id,
    })
    const nodes = Object.fromEntries(
      [from, to, placed, span].map((node) => [node.id, node as unknown as AnyNode]),
    )

    expect(utilityPoleCrossarmRotationY(0)).toBeCloseTo(-Math.PI / 2)
    expect(resolveUtilityPolePlacementRotation(placed, nodes)).toBeCloseTo(-Math.PI / 2)
  })
})
