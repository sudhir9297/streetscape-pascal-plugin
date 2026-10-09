import type { AnyNodeId } from "@pascal-app/core";
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DrainageInletNode,
  DrivewayNode,
  FireHydrantNode,
  MailboxNode,
  ManholeCoverNode,
  ParcelBoxNode,
  TrafficSignalNode,
  TrafficBollardNode,
  RoadBarrierNode,
  RoadNetworkNode,
  RecyclingBinNode,
  ResidentialGateNode,
  SpeedHumpNode,
  TrashBinNode,
} from './schema'
import {
  STREET_INFRASTRUCTURE_VARIANTS,
  parseStreetInfrastructure,
} from './street-infrastructure-config'
import {
  drainageInletDefinition,
  drivewayDefinition,
  fireHydrantDefinition,
  mailboxDefinition,
  manholeCoverDefinition,
  roadBarrierDefinition,
  parcelBoxDefinition,
  residentialGateDefinition,
  speedHumpDefinition,
  trafficBollardDefinition,
  trafficSignalDefinition,
} from './street-infrastructure-definition'
import { buildStreetInfrastructureFloorplan } from './street-infrastructure-floorplan'
import { getStreetInfrastructureParametrics } from './street-infrastructure-parametrics'
import { roadNetworkParametrics } from './road-network-parametrics'
import {
  buildDrivewayPlan,
  resolveDrainageInletLayout,
  resolveFireHydrantLayout,
  resolveFireHydrantOutletLayout,
  resolveManholeCoverLayout,
  resolveTrafficSignalHeadLayout,
  resolveTrafficSignalLayout,
  resolveTrafficBollardLayout,
  resolveRoadBarrierLayout,
  resolveResidentialRoadAssetLayout,
} from './street-infrastructure-geometry'
import {
  resolveMailboxOpenPose,
  resolveParcelBoxOpenPose,
  StreetInfrastructureModel,
} from './street-infrastructure-model'
import { resolveDrivewayGateOpenPose } from './driveway-gate-operation'

describe('street infrastructure catalog', () => {

  test('removes and suppresses a generated attachment when its asset is deleted', () => {
    const asset = FireHydrantNode.parse({
      roadAttachment: {
        networkNodeId: 'road-network_test',
        attachmentId: 'hydrant:road',
      },
    })
    const road = RoadNetworkNode.parse({
      id: 'road-network_test',
      attachments: {
        'hydrant:road': {
          id: 'hydrant:road',
          edgeId: 'edge_1',
          assetNodeId: asset.id,
          kind: 'asset',
          station: 4,
          lateralOffset: 3,
          verticalOffset: 0,
          alignment: 'curb',
          generatedKey: 'auto:hydrant:1',
        },
      },
    })
    const descriptor = getStreetInfrastructureParametrics(asset.type)
    const patches = descriptor.onDelete?.(asset, {
      [road.id]: road,
      [asset.id]: asset,
    } as never, new Set<AnyNodeId>([asset.id as AnyNodeId]), new Set<AnyNodeId>([asset.id as AnyNodeId])) ?? []

    expect(patches).toHaveLength(1)
    expect((patches[0]!.data as any).attachments).toEqual({})
    expect((patches[0]!.data as any).roadsideItemSuppressed['auto:hydrant:1']).toBe(true)
    expect(roadNetworkParametrics.onDeleteCascade?.(road, {} as never, new Set(), new Set<AnyNodeId>([road.id as AnyNodeId])) as unknown)
      .toEqual([asset.id as string])
  })
  test('registers six stable utility-menu asset families', () => {
    expect(STREET_INFRASTRUCTURE_VARIANTS.map((variant) => variant.kind)).toEqual([
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
    ])
    for (const definition of [
      trafficSignalDefinition,
      drainageInletDefinition,
      manholeCoverDefinition,
      fireHydrantDefinition,
      trafficBollardDefinition,
      roadBarrierDefinition,
    ]) {
      expect(definition.renderer).toBeDefined()
      expect(definition.preview).toBeDefined()
      expect(definition.tool).toBeDefined()
      expect(definition.floorplan).toBeDefined()
      expect(definition.parametrics).toBeDefined()
    }
  })

  test('lets every placed utility move freely in plan and along elevation', () => {
    for (const definition of [
      trafficSignalDefinition,
      drainageInletDefinition,
      manholeCoverDefinition,
      fireHydrantDefinition,
      trafficBollardDefinition,
      roadBarrierDefinition,
    ]) {
      expect(definition.capabilities.movable?.axes).toEqual(['x', 'y', 'z'])
      const handles = Array.isArray(definition.handles) ? definition.handles : []
      const elevation = handles.find(
        (handle) => handle.kind === 'linear-resize' && handle.axis === 'y',
      )
      expect(elevation?.kind).toBe('linear-resize')
      if (elevation?.kind !== 'linear-resize') continue
      const node = definition.schema.parse({
        position: [1, 0.25, 3],
        roadAttachment: {
          networkNodeId: 'road-network_test',
          attachmentId: 'utility:road',
          side: 'left',
        },
      })
      expect(elevation.currentValue(node)).toBe(0.25)
      expect(elevation.apply(node, 1.5, {} as never)).toMatchObject({
        position: [1, 1.5, 3],
        roadAttachment: undefined,
      })
    }
  })

  test('extends a driveway from either end and centers its elevation tracker', () => {
    const handles = Array.isArray(drivewayDefinition.handles)
      ? drivewayDefinition.handles
      : []
    const lengthHandles = handles.filter(
      (handle) => handle.kind === 'linear-resize' && handle.axis === 'z',
    )
    expect(lengthHandles).toHaveLength(2)

    const start = lengthHandles.find(
      (handle) => handle.kind === 'linear-resize' && handle.anchor === 'max',
    )
    const end = lengthHandles.find(
      (handle) => handle.kind === 'linear-resize' && handle.anchor === 'min',
    )
    expect(start?.kind).toBe('linear-resize')
    expect(end?.kind).toBe('linear-resize')
    if (start?.kind !== 'linear-resize' || end?.kind !== 'linear-resize') return

    const node = DrivewayNode.parse({
      length: 6,
      position: [10, 0.4, 20],
      rotation: [0, Math.PI / 2, 0],
      roadAttachment: {
        networkNodeId: 'road-network_test',
        attachmentId: 'driveway_test:road',
        side: 'left',
      },
    })
    expect(start.apply(node, 8, {} as never)).toMatchObject({
      length: 8,
      position: [9, 0.4, 20],
      roadAttachment: undefined,
    })
    expect(end.apply(node, 8, {} as never)).toMatchObject({
      length: 8,
      position: [11, 0.4, 20],
      roadAttachment: undefined,
    })
    expect(start.placement.position(node, {} as never)[2]).toBeLessThan(-node.length / 2)
    expect(end.placement.position(node, {} as never)[2]).toBeGreaterThan(node.length / 2)

    const elevation = handles.find(
      (handle) => handle.kind === 'linear-resize' && handle.axis === 'y',
    )
    expect(elevation?.kind).toBe('linear-resize')
    if (elevation?.kind !== 'linear-resize') return
    const elevationPosition = elevation.placement.position(node, {} as never)
    expect(elevationPosition[0]).toBe(0)
    expect(elevationPosition[2]).toBe(0)
    expect(elevation.apply(node, 1.25, {} as never)).toMatchObject({
      position: [10, 1.25, 20],
      roadAttachment: undefined,
    })

    const curvedRight = DrivewayNode.parse({
      drivewayShape: 'curved-right',
      curveAmount: 3,
      length: 6,
    })
    const rightPlan = buildDrivewayPlan(curvedRight)
    const rightEndPoint = rightPlan.centerline.at(-1)!
    const rightArrowPoint = end.placement.position(curvedRight, {} as never)
    expect(rightArrowPoint[0]).toBeGreaterThan(rightEndPoint[0])
    expect(rightArrowPoint[2]).toBeGreaterThan(rightEndPoint[1])
    expect(end.placement.rotationY?.(curvedRight, {} as never)).toBeGreaterThan(0)
    expect(end.apply(curvedRight, 8, {} as never)).toMatchObject({
      curveAmount: 5,
      length: 8,
      position: [1, 0, 1],
    })

    const curvedLeft = DrivewayNode.parse({
      drivewayShape: 'curved-left',
      curveAmount: 3,
      length: 6,
    })
    const leftPlan = buildDrivewayPlan(curvedLeft)
    const leftEndPoint = leftPlan.centerline.at(-1)!
    const leftArrowPoint = end.placement.position(curvedLeft, {} as never)
    expect(leftArrowPoint[0]).toBeLessThan(leftEndPoint[0])
    expect(leftArrowPoint[2]).toBeGreaterThan(leftEndPoint[1])
    expect(end.placement.rotationY?.(curvedLeft, {} as never)).toBeLessThan(0)

    const straight = DrivewayNode.parse({ drivewayShape: 'straight', length: 6 })
    expect(end.placement.rotationY?.(straight, {} as never)).toBe(0)
    expect(end.apply(straight, 8, {} as never)).toMatchObject({
      curveAmount: 2.5,
      length: 8,
      position: [0, 0, 1],
    })
  })

  test('keeps all new cards inside the existing Utilities category', () => {
    const panel = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain("panelCategory === 'utilities'")
    expect(panel).toContain('STREET_INFRASTRUCTURE_VARIANTS.map')
    expect(panel).toContain('{variant.family}')
    expect(panel).not.toContain("value: 'infrastructure'")
  })

  test('parses safe defaults for every new node', () => {
    expect(TrafficSignalNode.parse({})).toMatchObject({
      type: 'streetscape:traffic-signal',
      mount: 'mast-arm',
      headLayout: 'three-section',
      headCount: 'two',
      signalState: 'red',
      backplate: true,
      reflectiveBorder: true,
      redColor: '#f13b32',
      yellowColor: '#ffc338',
      greenColor: '#35c76d',
    })
    expect(DrainageInletNode.parse({})).toMatchObject({
      type: 'streetscape:drainage-inlet',
      inletType: 'combination',
      gratePattern: 'bicycle-safe',
    })
    expect(ManholeCoverNode.parse({})).toMatchObject({
      type: 'streetscape:manhole-cover',
      treadPattern: 'radial',
    })
    expect(FireHydrantNode.parse({})).toMatchObject({
      type: 'streetscape:fire-hydrant',
      barrelType: 'dry-barrel',
      outletLayout: 'two-hose-one-pumper',
      height: 1.25,
    })
    expect(TrafficBollardNode.parse({})).toMatchObject({
      type: 'streetscape:traffic-bollard',
      style: 'steel',
      height: 0.9,
    })
    expect(RoadBarrierNode.parse({})).toMatchObject({
      type: 'streetscape:road-barrier',
      barrierType: 'jersey',
      length: 2,
    })
    expect(DrivewayNode.parse({})).toMatchObject({
      type: 'streetscape:driveway',
      drivewayShape: 'straight',
      curveAmount: 2.5,
    })
    expect(ParcelBoxNode.parse({})).toMatchObject({
      type: 'streetscape:parcel-box',
      operationState: 0,
      bodyColor: '#242829',
    })
    expect(SpeedHumpNode.parse({})).toMatchObject({
      type: 'streetscape:speed-hump',
      width: 5.8,
      length: 0.5,
      height: 0.07,
      bodyColor: '#25282b',
      accentColor: '#f2b632',
    })
    for (const variant of STREET_INFRASTRUCTURE_VARIANTS) {
      expect(parseStreetInfrastructure(variant.kind, {}).type).toBe(variant.kind)
    }
  })

  test('renders the speed hump as a narrow alternating modular rubber strip', () => {
    const node = SpeedHumpNode.parse({})
    const layout = resolveResidentialRoadAssetLayout(node)
    expect(layout.footprintDepth).toBe(0.5)
    expect(layout.footprintWidth).toBe(5.8)

    const markup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node }))
    expect(markup).toContain('name="modular-rubber-speed-hump"')
    expect(markup.match(/name="speed-hump-module"/g)?.length).toBeGreaterThanOrEqual(10)
    expect(markup).not.toContain('name="speed-hump-chevron-tread"')
    expect(markup).not.toContain('name="speed-hump-white-reflector"')
    expect(markup).not.toContain('name="speed-hump-bolt-recess"')

    const floorplan = buildStreetInfrastructureFloorplan(node, {} as never)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind !== 'group') return
    const fills = floorplan.children
      .filter((child) => child.kind === 'polygon')
      .map((child) => child.kind === 'polygon' ? child.fill : undefined)
    expect(fills).toContain('#25282b')
    expect(fills).toContain('#f2b632')

    const thumbnail = readFileSync(new URL('./assets/speed-hump-thumbnail-v2.webp', import.meta.url))
    expect(thumbnail.subarray(0, 4).toString()).toBe('RIFF')
    expect(thumbnail.subarray(8, 12).toString()).toBe('WEBP')
    expect(thumbnail.byteLength).toBeGreaterThan(10_000)
    const panel = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain("'streetscape:speed-hump': SPEED_HUMP_THUMBNAIL")
  })

  test('renders the mailbox as a black arched box with one raised red flag', () => {
    const node = MailboxNode.parse({})
    expect(node).toMatchObject({
      width: 0.4,
      length: 0.5,
      height: 1.65,
      bodyColor: '#17191a',
      accentColor: '#e23a31',
      operationState: 0,
    })

    const markup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node }))
    expect(markup).toContain('name="mailbox-arched-shell"')
    expect(markup).toContain('name="mailbox-front-door"')
    expect(markup).toContain('name="mailbox-raised-flag"')
    expect(markup.match(/name="mailbox-flag-arm"/g)).toHaveLength(1)
    expect(markup).not.toContain('name="mailbox-post-crossbar"')

    const descriptor = getStreetInfrastructureParametrics('streetscape:mailbox')
    expect(descriptor.groups[0]?.label).toBe('Open Animation')
    expect(descriptor.groups[0]?.fields[0]).toMatchObject({ key: 'open', kind: 'custom' })
    const keyboardAction = mailboxDefinition.keyboardActions?.e
    expect(keyboardAction?.appliesTo(node as never)).toBe(true)
    expect(keyboardAction?.appliesTo(DrivewayNode.parse({}) as never)).toBe(false)

    expect(resolveMailboxOpenPose(0).doorAngle).toBe(-0)
    expect(resolveMailboxOpenPose(1).doorAngle).toBeLessThan(-1.5)
    const openMarkup = renderToStaticMarkup(createElement(StreetInfrastructureModel, {
      node: MailboxNode.parse({ operationState: 1 }),
    }))
    expect(openMarkup).not.toBe(markup)

    const legacyLayout = resolveResidentialRoadAssetLayout(MailboxNode.parse({
      width: 0.46,
      length: 0.32,
      height: 1.18,
      bodyColor: '#263b32',
      accentColor: '#bd4336',
    }))
    expect(legacyLayout.width).toBe(0.4)
    expect(legacyLayout.length).toBe(0.5)
    expect(legacyLayout.height).toBe(1.65)
    expect(legacyLayout.footprintDepth).toBe(0.5)
  })

  test('renders fixed mailbox handle mounts without a dynamic child list', () => {
    const source = readFileSync(new URL('./street-infrastructure-model.tsx', import.meta.url), 'utf8')
    const mailboxModel = source.slice(
      source.indexOf('function CurbsideMailboxModel'),
      source.indexOf('function DrivewaySurface'),
    )

    expect(mailboxModel).not.toContain("([-1, 1] as const).map")
  })

  test('resizes the speed hump width from either outer-end arrow', () => {
    const handles = Array.isArray(speedHumpDefinition.handles)
      ? speedHumpDefinition.handles
      : []
    const widthHandles = handles.filter(
      (handle) => handle.kind === 'linear-resize' && handle.axis === 'x',
    )
    expect(widthHandles).toHaveLength(2)

    const left = widthHandles.find(
      (handle) => handle.kind === 'linear-resize' && handle.anchor === 'max',
    )
    const right = widthHandles.find(
      (handle) => handle.kind === 'linear-resize' && handle.anchor === 'min',
    )
    expect(left?.kind).toBe('linear-resize')
    expect(right?.kind).toBe('linear-resize')
    if (left?.kind !== 'linear-resize' || right?.kind !== 'linear-resize') return

    const node = SpeedHumpNode.parse({ position: [10, 0, 20], width: 6 })
    expect(left.placement.position(node, {} as never)[0]).toBeLessThan(-node.width / 2)
    expect(right.placement.position(node, {} as never)[0]).toBeGreaterThan(node.width / 2)
    expect(left.placement.position(node, {} as never)[1]).toBe(node.height / 2)
    expect(right.placement.position(node, {} as never)[1]).toBe(node.height / 2)
    expect(left.placement.rotationY?.(node, {} as never)).toBe(Math.PI)
    expect(right.placement.rotationY?.(node, {} as never)).toBe(0)
    expect(left.apply(node, 8, {} as never)).toMatchObject({
      width: 8,
      position: [9, 0, 20],
      roadAttachment: undefined,
    })
    expect(right.apply(node, 8, {} as never)).toMatchObject({
      width: 8,
      position: [11, 0, 20],
      roadAttachment: undefined,
    })
  })

  test('resolves finite layouts for all visible variants', () => {
    for (const mount of ['post', 'mast-arm', 'span-wire'] as const) {
      const layout = resolveTrafficSignalLayout(TrafficSignalNode.parse({ mount }))
      expect(layout.supportHeight).toBeGreaterThan(2)
      expect(layout.faceCenters.every((center) => center.every(Number.isFinite))).toBe(true)
      expect(layout.footprintWidth).toBeGreaterThan(0)
    }
    for (const headLayout of [
      'three-section',
      'three-section-turn',
      'four-section-turn',
      'five-section-cluster',
    ] as const) {
      const head = resolveTrafficSignalHeadLayout(TrafficSignalNode.parse({ headLayout }))
      expect(head.sections.length).toBeGreaterThanOrEqual(3)
      expect(head.width).toBeGreaterThan(0.3)
      expect(head.height).toBeGreaterThan(1)
    }
    for (const gratePattern of [
      'bicycle-safe',
      'reticuline',
      'parallel',
      'curved-vane',
    ] as const) {
      const layout = resolveDrainageInletLayout(DrainageInletNode.parse({ gratePattern }))
      expect(layout.bars.length).toBeGreaterThan(3)
      expect(layout.bars.every((bar) => Object.values(bar).every(Number.isFinite))).toBe(true)
    }
    const cover = resolveManholeCoverLayout(ManholeCoverNode.parse({ diameter: 0.8 }))
    expect(cover.frameRadius).toBeGreaterThan(cover.radius)
    expect(cover.rimRadius).toBeLessThan(cover.radius)
    expect(cover.centerReliefRadius).toBeLessThan(cover.rimRadius)
    const hydrant = resolveFireHydrantLayout(FireHydrantNode.parse({ height: 1.1 }))
    expect(hydrant.height).toBe(1.1)
    expect(hydrant.flangeRadius).toBeGreaterThan(hydrant.barrelRadius)
    expect(hydrant.bonnetTopY + hydrant.stemNutHeight).toBeLessThanOrEqual(hydrant.height)
    expect(hydrant.barrelHeight / (hydrant.barrelRadius * 2)).toBeGreaterThan(2)
    expect(resolveFireHydrantOutletLayout(FireHydrantNode.parse({}))).toHaveLength(3)
    const bollard = resolveTrafficBollardLayout(TrafficBollardNode.parse({}))
    expect(bollard.height).toBe(0.9)
    expect(bollard.baseRadius).toBeGreaterThan(bollard.radius)
    const barrier = resolveRoadBarrierLayout(RoadBarrierNode.parse({ barrierType: 'guardrail' }))
    expect(barrier.length).toBe(2)
    expect(barrier.beamY).toBeGreaterThan(0)
    const wetHydrant = resolveFireHydrantLayout(FireHydrantNode.parse({ barrelType: 'wet-barrel' }))
    expect(wetHydrant.isWetBarrel).toBe(true)
    expect(wetHydrant.bonnetRadius).toBeLessThan(hydrant.bonnetRadius)

    const trafficPlan = buildStreetInfrastructureFloorplan(
      TrafficSignalNode.parse({ mount: 'mast-arm', signalState: 'red' }),
      {} as never,
    )
    expect(trafficPlan.kind).toBe('group')
    if (trafficPlan.kind === 'group') {
      expect(trafficPlan.children.filter((child) => child.kind === 'line').length).toBeGreaterThanOrEqual(1)
      expect(trafficPlan.children.filter((child) => child.kind === 'polygon').length).toBeGreaterThanOrEqual(4)
      expect(trafficPlan.children.filter((child) => child.kind === 'circle').length).toBeGreaterThanOrEqual(4)
    }
  })

  test('sanitizes legacy residential nodes before building buffer geometry', () => {
    const legacyDriveway = {
      type: 'streetscape:driveway',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      bodyColor: '#777b78',
      accentColor: '#b7b2a6',
    } as unknown as DrivewayNode

    const layout = resolveResidentialRoadAssetLayout(legacyDriveway)
    expect([layout.width, layout.length, layout.height, layout.depth, layout.footprintWidth, layout.footprintDepth].every(Number.isFinite)).toBe(true)

    const plan = buildDrivewayPlan(legacyDriveway)
    expect(plan.outline.flat().every(Number.isFinite)).toBe(true)

    expect(() => renderToStaticMarkup(createElement(StreetInfrastructureModel, { node: legacyDriveway }))).not.toThrow()

    const legacyParcelBox = {
      type: 'streetscape:parcel-box',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      width: 0.7,
      length: 0.48,
      height: 1.22,
      depth: 0.12,
      bodyColor: '#242829',
      accentColor: '#d9d0b5',
    } as unknown as ParcelBoxNode
    const parcelMarkup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node: legacyParcelBox }))
    expect(parcelMarkup).not.toContain('NaN')
  })

  test('keeps parcel cabinet side-wall list items keyed at the list boundary', () => {
    const modelSource = readFileSync(new URL('./street-infrastructure-model.tsx', import.meta.url), 'utf8')
    for (const keyExpression of [
      '<group key={`parcel-side-wall:${side}`',
      '<group key={`parcel-front-side-rail:${side}`',
      '<group key={`parcel-reveal-horizontal:${vertical}`',
      '<group key={`parcel-reveal-vertical:${horizontal}`',
      '<group key={`parcel-lid-hinge:${side}`',
    ]) {
      expect(modelSource).toContain(keyExpression)
    }
  })

  test('keeps commercial trash-bin detail lists keyed at their list boundaries', () => {
    const modelSource = readFileSync(new URL('./street-infrastructure-model.tsx', import.meta.url), 'utf8')
    for (const keyExpression of [
      '<group key={`commercial-bin-gusset:${face}:${offset}`',
      '<group key={`commercial-bin-front-rib:${offset}`',
      '<group key={`commercial-bin-side-rib:${side}`',
      '<group key={`commercial-bin-lid-rib:${offset}`',
      '<group key={`commercial-bin-hinge:${offset}`',
      '<group key={`commercial-bin-handle-post:${side}:${end}`',
      '<group key={`commercial-bin-caster-fork:${fork}`',
    ]) {
      expect(modelSource).toContain(keyExpression)
    }
  })

  test('keeps every drainage side-menu setting wired to the resolver and renderer', () => {
    const descriptor = getStreetInfrastructureParametrics('streetscape:drainage-inlet')
    const fields = descriptor.groups.flatMap((group) => group.fields)
    expect(fields.map((field) => field.key)).toEqual([
      'inletType',
      'gratePattern',
      'width',
      'length',
      'curbHeight',
      'metalColor',
      'wetness',
      'position',
    ])
    const inletType = fields.find((field) => field.key === 'inletType')
    expect(inletType?.kind).toBe('enum')
    if (inletType?.kind === 'enum') {
      expect(inletType.options).toEqual(['grate', 'curb-opening', 'combination', 'sweeper-combination'])
    }
    const curbHeight = fields.find((field) => field.key === 'curbHeight')
    expect(curbHeight?.visibleIf?.(DrainageInletNode.parse({ inletType: 'grate' }))).toBe(false)
    expect(curbHeight?.visibleIf?.(DrainageInletNode.parse({ inletType: 'curb-opening' }))).toBe(true)
  })

  test('offers straight and adjustable curved driveway shapes', () => {
    const descriptor = getStreetInfrastructureParametrics('streetscape:driveway')
    const fields = descriptor.groups.flatMap((group) => group.fields)
    const shape = fields.find((field) => field.key === 'drivewayShape')
    const curveAmount = fields.find((field) => field.key === 'curveAmount')
    expect(shape?.kind).toBe('enum')
    if (shape?.kind === 'enum') {
      expect(shape.options).toEqual(['straight', 'curved-left', 'curved-right'])
    }
    expect(curveAmount?.visibleIf?.(DrivewayNode.parse({ drivewayShape: 'straight' }))).toBe(false)
    expect(curveAmount?.visibleIf?.(DrivewayNode.parse({ drivewayShape: 'curved-left' }))).toBe(true)

    const straight = buildDrivewayPlan(DrivewayNode.parse({ drivewayShape: 'straight' }))
    const left = buildDrivewayPlan(DrivewayNode.parse({ drivewayShape: 'curved-left', curveAmount: 3 }))
    const right = buildDrivewayPlan(DrivewayNode.parse({ drivewayShape: 'curved-right', curveAmount: 3 }))
    expect(straight.outline).toHaveLength(4)
    expect(left.outline.length).toBeGreaterThan(20)
    expect(left.centerline.at(-1)?.[0]).toBeCloseTo(-right.centerline.at(-1)![0])
    expect(left.centerline.at(-1)?.[0]).toBeLessThan(left.centerline[0]![0])
    expect(right.centerline.at(-1)?.[0]).toBeGreaterThan(right.centerline[0]![0])

    const layout = resolveResidentialRoadAssetLayout(
      DrivewayNode.parse({ drivewayShape: 'curved-right', curveAmount: 3 }),
    )
    expect(layout.footprintWidth).toBeGreaterThan(layout.width)
  })

  test('exposes one scrubbed parcel-box animation through the side menu and E key', () => {
    const descriptor = getStreetInfrastructureParametrics('streetscape:parcel-box')
    expect(descriptor.groups[0]?.label).toBe('Open Animation')
    expect(descriptor.groups[0]?.fields[0]).toMatchObject({ key: 'open', kind: 'custom' })

    const keyboardAction = parcelBoxDefinition.keyboardActions?.e
    const parcelBox = ParcelBoxNode.parse({})
    expect(keyboardAction?.appliesTo(parcelBox as never)).toBe(true)
    expect(keyboardAction?.appliesTo(DrivewayNode.parse({}) as never)).toBe(false)

    expect(resolveParcelBoxOpenPose(0)).toMatchObject({
      accessDoorAngle: -0,
      lidAngle: 0,
    })
    const partlyOpenPose = resolveParcelBoxOpenPose(0.42)
    expect(partlyOpenPose.lidProgress).toBeGreaterThan(0.7)
    expect(partlyOpenPose.accessDoorProgress).toBeGreaterThan(0)
    const openPose = resolveParcelBoxOpenPose(1)
    expect(openPose.lidProgress).toBe(1)
    expect(openPose.accessDoorProgress).toBe(1)

    const closedMarkup = renderToStaticMarkup(
      createElement(StreetInfrastructureModel, { node: parcelBox }),
    )
    const openMarkup = renderToStaticMarkup(
      createElement(StreetInfrastructureModel, {
        node: ParcelBoxNode.parse({ operationState: 1 }),
      }),
    )
    expect(closedMarkup).toContain('name="parcel-cabinet-shell"')
    expect(closedMarkup).toContain('name="parcel-top-lid"')
    expect(closedMarkup).toContain('name="parcel-access-door"')
    expect(closedMarkup).toContain('name="parcel-door-lock-bezel"')
    expect(closedMarkup).not.toContain('parcel-intake-side')
    expect(openMarkup).not.toBe(closedMarkup)
  })

  test('uses the curved driveway outline in floorplan and 3D views', () => {
    const node = DrivewayNode.parse({ drivewayShape: 'curved-right', curveAmount: 3 })
    const floorplan = buildStreetInfrastructureFloorplan(node, {} as never)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind === 'group') {
      const surface = floorplan.children.find((child) => child.kind === 'polygon')
      expect(surface?.kind).toBe('polygon')
      if (surface?.kind === 'polygon') expect(surface.points.length).toBeGreaterThan(20)
    }
    const markup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node }))
    expect(markup).toContain('name="driveway-base"')
    expect(markup).toContain('name="driveway-finish"')
  })

  test('renders the driveway gate as two framed, cross-braced timber leaves', () => {
    const node = ResidentialGateNode.parse({})
    expect(node).toMatchObject({
      width: 3.6,
      height: 1.65,
      bodyColor: '#8a4f2b',
      accentColor: '#202326',
      operationState: 0,
    })

    const markup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node }))
    expect(markup).toContain('name="timber-driveway-gate"')
    expect(markup).toContain('name="gate-left-leaf"')
    expect(markup).toContain('name="gate-right-leaf"')
    expect(markup).toContain('name="gate-center-latch"')

    const floorplan = buildStreetInfrastructureFloorplan(node, {} as never)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind === 'group') {
      expect(floorplan.children.filter((child) => child.kind === 'line')).toHaveLength(2)
      expect(floorplan.children.filter((child) => child.kind === 'circle')).toHaveLength(3)
    }
  })

  test('animates both driveway-gate leaves through the inspector and E key', () => {
    const descriptor = getStreetInfrastructureParametrics('streetscape:residential-gate')
    expect(descriptor.groups[0]?.label).toBe('Open Animation')
    expect(descriptor.groups[0]?.fields[0]).toMatchObject({ key: 'open', kind: 'custom' })

    const keyboardAction = residentialGateDefinition.keyboardActions?.e
    const closedGate = ResidentialGateNode.parse({})
    expect(keyboardAction?.appliesTo(closedGate as never)).toBe(true)
    expect(keyboardAction?.appliesTo(DrivewayNode.parse({}) as never)).toBe(false)

    const closedPose = resolveDrivewayGateOpenPose(0)
    const openPose = resolveDrivewayGateOpenPose(1)
    expect(closedPose).toMatchObject({ leftLeafAngle: 0, rightLeafAngle: -0 })
    expect(openPose.leftLeafAngle).toBeGreaterThan(1.5)
    expect(openPose.rightLeafAngle).toBeLessThan(-1.5)

    const closedMarkup = renderToStaticMarkup(
      createElement(StreetInfrastructureModel, { node: closedGate }),
    )
    const openGate = ResidentialGateNode.parse({ operationState: 1 })
    const openMarkup = renderToStaticMarkup(
      createElement(StreetInfrastructureModel, { node: openGate }),
    )
    expect(openMarkup).not.toBe(closedMarkup)

    const closedFloorplan = buildStreetInfrastructureFloorplan(closedGate, {} as never)
    const openFloorplan = buildStreetInfrastructureFloorplan(openGate, {} as never)
    expect(openFloorplan).not.toEqual(closedFloorplan)
    expect(resolveResidentialRoadAssetLayout(openGate).footprintDepth).toBeGreaterThan(
      resolveResidentialRoadAssetLayout(closedGate).footprintDepth,
    )
  })

  test('matches the reference green wheelie-bin silhouette for recycling', () => {
    const recycling = RecyclingBinNode.parse({})
    expect(recycling.bodyColor).toBe('#087345')
    expect(recycling.accentColor).toBe('#0a6b42')

    const recyclingMarkup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node: recycling }))
    for (const feature of [
      'reference-green-wheelie-bin',
      'bin-tapered-body',
      'bin-moulded-collar',
      'bin-hinged-lid',
      'bin-lid-raised-panel',
      'bin-rubber-wheel',
      'bin-rear-handle',
    ]) {
      expect(recyclingMarkup).toContain(feature)
    }
    expect(recyclingMarkup).toContain('bin-recycling-marking')

    const floorplan = buildStreetInfrastructureFloorplan(recycling, {} as never)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind === 'group') {
      expect(floorplan.children.filter((child) => child.kind === 'circle')).toHaveLength(2)
    }

    const thumbnail = readFileSync(new URL('./assets/recycling-bin-thumbnail-v2.webp', import.meta.url))
    expect(thumbnail.subarray(0, 4).toString()).toBe('RIFF')
    expect(thumbnail.subarray(8, 12).toString()).toBe('WEBP')
    expect(thumbnail.byteLength).toBeGreaterThan(10_000)
  })

  test('renders the trash bin as a wide four-caster commercial container', () => {
    const trash = TrashBinNode.parse({})
    const recycling = RecyclingBinNode.parse({})
    const legacyTrash = TrashBinNode.parse({
      width: 0.58,
      length: 0.66,
      height: 1.05,
      bodyColor: '#087345',
      accentColor: '#0a6b42',
    })
    const trashMarkup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node: trash }))
    const recyclingMarkup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node: recycling }))
    const legacyTrashMarkup = renderToStaticMarkup(createElement(StreetInfrastructureModel, { node: legacyTrash }))

    expect(trash.width).toBeGreaterThan(recycling.width * 2)
    expect(resolveResidentialRoadAssetLayout(legacyTrash).width).toBe(trash.width)
    expect(trashMarkup).toContain('name="commercial-trash-bin"')
    expect(legacyTrashMarkup).toContain('name="commercial-trash-bin"')
    expect(trashMarkup.match(/name="trash-bin-caster"/g)).toHaveLength(4)
    expect(recyclingMarkup).toContain('name="reference-green-wheelie-bin"')
    expect(recyclingMarkup).not.toContain('name="commercial-trash-bin"')

    const floorplan = buildStreetInfrastructureFloorplan(trash, {} as never)
    expect(floorplan.kind).toBe('group')
    if (floorplan.kind === 'group') {
      expect(floorplan.children.filter((child) => child.kind === 'circle')).toHaveLength(4)
    }

    const thumbnail = readFileSync(new URL('./assets/commercial-trash-bin-thumbnail.svg', import.meta.url), 'utf8')
    expect(thumbnail).toContain('Commercial four-caster trash bin')
    expect(thumbnail).toContain('#2f713b')
    const panel = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain("'streetscape:trash-bin': COMMERCIAL_TRASH_BIN_THUMBNAIL")
    expect(panel).toContain("'streetscape:recycling-bin': RECYCLING_BIN_THUMBNAIL")
  })

  test('keeps enlarged and clamped inlet variants inside their selection footprints', () => {
    for (const inletType of ['grate', 'curb-opening', 'combination', 'sweeper-combination'] as const) {
      for (const [width, length] of [[0.3, 0.5], [0.82, 1.2], [1.5, 2.5]] as const) {
        const node = DrainageInletNode.parse({ inletType, width, length, curbHeight: 0.3 })
        const layout = resolveDrainageInletLayout(node)
        const footprint = (drainageInletDefinition.capabilities.floorPlaced as any).footprint(node as any)
        const outerSurfaceHalfLength = (layout.length + 0.16) / 2
        const outerSurfaceHalfWidth = (layout.width + 0.16) / 2
        const outerCurbHalfLength = layout.curbOpeningLength / 2 + layout.curbDepth / 2
        const outerCurbHalfDepth = layout.curbDepth / 2

        expect(footprint.dimensions[0]).toBeGreaterThanOrEqual(
          2 * Math.max(outerSurfaceHalfLength, layout.hasCurbOpening
            ? Math.abs(layout.curbOpeningOffsetX) + outerCurbHalfLength
            : 0),
        )
        expect(footprint.dimensions[2]).toBeGreaterThanOrEqual(
          2 * Math.max(outerSurfaceHalfWidth, layout.hasCurbOpening
            ? layout.curbCenterZ + outerCurbHalfDepth
            : 0),
        )
        const floorplan = buildStreetInfrastructureFloorplan(node, {} as never)
        if (floorplan.kind === 'group') {
          const points = floorplan.children
            .filter((child) => child.kind === 'polygon')
            .flatMap((child) => child.points)
          expect(Math.max(...points.map(([x]) => Math.abs(x)))).toBeLessThanOrEqual(
            footprint.dimensions[0] / 2 + 0.0001,
          )
          expect(Math.max(...points.map(([, z]) => Math.abs(z)))).toBeLessThanOrEqual(
            footprint.dimensions[2] / 2 + 0.0001,
          )
        }
      }
    }
  })

  test('seats the curb opening against the grate surround edge', () => {
    const node = DrainageInletNode.parse({ inletType: 'combination', width: 1.2, length: 1.8 })
    const layout = resolveDrainageInletLayout(node)
    const grateOuterEdge = layout.width / 2 + layout.surroundOverhang
    const curbInnerEdge = layout.curbCenterZ - layout.curbDepth / 2

    expect(curbInnerEdge).toBeCloseTo(grateOuterEdge, 5)
  })

  test('mirrors curb openings to the attached road side', () => {
    const left = buildStreetInfrastructureFloorplan(
      DrainageInletNode.parse({ inletType: 'combination' }),
      {} as never,
    )
    const right = buildStreetInfrastructureFloorplan(
      DrainageInletNode.parse({
        inletType: 'combination',
        roadAttachment: {
          networkNodeId: 'road-network_test',
          attachmentId: 'drainage_test:road',
          side: 'right',
        },
      }),
      {} as never,
    )
    const curbCenter = (floorplan: typeof left) => {
      if (floorplan.kind !== 'group') return 0
      const polygon = floorplan.children.at(-2)
      if (!polygon || polygon.kind !== 'polygon') return 0
      return polygon.points.reduce((sum, point) => sum + point[1], 0) / polygon.points.length
    }
    expect(curbCenter(left)).toBeGreaterThan(0)
    expect(curbCenter(right)).toBeLessThan(0)
  })

  test('keeps manhole cover depth layers apart', () => {
    const manhole = resolveManholeCoverLayout(ManholeCoverNode.parse({}))
    expect(manhole.frameHeight).toBeLessThan(0.06)
    expect(manhole.treadY + manhole.treadHeight / 2).toBeCloseTo(0.106, 3)
    expect(manhole.coverBackingTopY).toBeLessThan(manhole.coverBottomY - 0.002)
    expect(manhole.coverBottomY).toBeGreaterThan(manhole.frameHeight + 0.002)
    expect(manhole.rimBottomY).toBeGreaterThan(manhole.coverTopY + 0.002)
    expect(manhole.treadBottomY).toBeGreaterThan(manhole.coverTopY + 0.002)
  })

  test('renders every family and its major visual variants', () => {
    const previousConsoleError = console.error
    const renderErrors: string[] = []
    console.error = (...args) => renderErrors.push(args.join(' '))
    try {
      const nodes = [
        ...(['post', 'mast-arm', 'span-wire'] as const).flatMap((mount) =>
          ([
            'three-section',
            'three-section-turn',
            'four-section-turn',
            'five-section-cluster',
          ] as const).map((headLayout) =>
            TrafficSignalNode.parse({
              mount,
              headLayout,
              signalState: headLayout === 'three-section' ? 'green' : 'green-arrow',
            }),
          ),
        ),
        ...(['grate', 'curb-opening', 'combination', 'sweeper-combination'] as const).flatMap((inletType) =>
          (['bicycle-safe', 'reticuline', 'parallel', 'curved-vane'] as const).map((gratePattern) =>
            DrainageInletNode.parse({ inletType, gratePattern, width: 0.82, length: 1.2, curbHeight: 0.18, wetness: 0.8 }),
          ),
        ),
        ...(['radial', 'grid', 'rings'] as const).map((treadPattern) =>
          ManholeCoverNode.parse({ treadPattern }),
        ),
        ...(['dry-barrel', 'wet-barrel'] as const).flatMap((barrelType) =>
          (['two-hose-one-pumper', 'two-hose', 'one-hose'] as const).map((outletLayout) =>
            FireHydrantNode.parse({ barrelType, outletLayout }),
          ),
        ),
        ...(['steel', 'flexible', 'reflective'] as const).map((style) =>
          TrafficBollardNode.parse({ style }),
        ),
        ...(['jersey', 'guardrail', 'water-filled', 'crowd-control'] as const).map((barrierType) =>
          RoadBarrierNode.parse({ barrierType }),
        ),
      ]
      for (const node of nodes) {
        const markup = renderToStaticMarkup(
          createElement(StreetInfrastructureModel, { node }),
        )
        expect(markup.length).toBeGreaterThan(100)
        const floorplan = buildStreetInfrastructureFloorplan(node, {} as never)
        expect(floorplan.kind).toBe('group')
      }
      for (const inletType of ['grate', 'curb-opening', 'combination', 'sweeper-combination'] as const) {
        for (const gratePattern of ['bicycle-safe', 'reticuline', 'parallel', 'curved-vane'] as const) {
          const node = DrainageInletNode.parse({ inletType, gratePattern, width: 0.82, length: 1.2, curbHeight: 0.18 })
          const layout = resolveDrainageInletLayout(node)
          for (const bar of layout.bars) {
            const halfX = Math.abs(Math.cos(bar.rotationY)) * bar.width / 2 + Math.abs(Math.sin(bar.rotationY)) * bar.length / 2
            const halfZ = Math.abs(Math.sin(bar.rotationY)) * bar.width / 2 + Math.abs(Math.cos(bar.rotationY)) * bar.length / 2
            expect(Math.abs(bar.x) + halfX).toBeLessThanOrEqual(node.length / 2 + 0.0001)
            expect(Math.abs(bar.z) + halfZ).toBeLessThanOrEqual(node.width / 2 + 0.0001)
          }
        }
      }
      for (const treadPattern of ['radial', 'grid', 'rings'] as const) {
        const floorplan = buildStreetInfrastructureFloorplan(
          ManholeCoverNode.parse({ treadPattern }),
          {} as never,
        )
        expect(floorplan.kind).toBe('group')
        if (floorplan.kind === 'group') {
          expect(floorplan.children.some((child) => child.kind === 'line' || child.kind === 'circle')).toBe(true)
        }
      }
      expect(renderErrors.some((message) => message.includes('Each child in a list'))).toBe(false)
    } finally {
      console.error = previousConsoleError
    }
  })
})
