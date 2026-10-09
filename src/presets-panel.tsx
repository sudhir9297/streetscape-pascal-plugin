'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl, SliderControl, ToggleControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { type DragEvent, Fragment, useEffect, useMemo, useState } from 'react'
import {
  CATALOG_LAMP_THUMBNAIL,
  CATALOG_LAMP_THUMBNAILS,
  COBRA_HEAD_LIGHT_THUMBNAIL,
  HERITAGE_CROOK_LIGHT_THUMBNAIL,
  MULTI_HEAD_AREA_LIGHT_THUMBNAIL,
  POST_TOP_LIGHT_THUMBNAIL,
  STREET_LIGHT_THUMBNAIL,
  TRUSS_ROADWAY_LIGHT_THUMBNAIL,
  TWIN_ARM_MEDIAN_LIGHT_THUMBNAIL,
  UTILITY_POLE_THUMBNAIL,
  TRAFFIC_SIGNAL_THUMBNAIL,
  DRAINAGE_INLET_THUMBNAIL,
  COMMERCIAL_TRASH_BIN_THUMBNAIL,
  MANHOLE_COVER_THUMBNAIL,
  FIRE_HYDRANT_THUMBNAIL,
  TRAFFIC_BOLLARD_THUMBNAIL,
  ROAD_BARRIER_THUMBNAIL,
  DRIVEWAY_THUMBNAIL,
  MAILBOX_THUMBNAIL,
  PARCEL_BOX_THUMBNAIL,
  RECYCLING_BIN_THUMBNAIL,
  DRIVEWAY_GATE_THUMBNAIL,
  SPEED_HUMP_THUMBNAIL,
  ROAD_SIGN_THUMBNAILS,
  ROAD_NETWORK_THUMBNAIL,
} from './art'
import {
  CATALOG_LAMP_VARIANTS,
  getCatalogLampConfig,
  getCatalogLampStyleOptions,
} from './catalog-lamp-config'
import { ROAD_SIGN_CATALOG, type RoadSignId } from './road-sign-config'
import { ROAD_AUTO_INFRASTRUCTURE_OPTIONS } from './road-auto-infrastructure-settings'
import {
  applyRoadAutoInfrastructureClearances,
  AUTO_DRAINAGE_MIN_GUTTER_WIDTH,
  AUTO_HYDRANT_MIN_VERGE_WIDTH,
} from './road-auto-infrastructure-style'
import {
  STREET_INFRASTRUCTURE_VARIANTS,
  type StreetInfrastructureKind,
} from './street-infrastructure-config'
import { ROAD_ELEVATION_OPTIONS, useStreetscapeStore } from './store'
import { STANDARD_LAMP_HEIGHT_MAX_M, STANDARD_LAMP_HEIGHT_MIN_M } from './lamp-constants'
import { STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M } from './utility-pole-geometry'
import { STANDARD_UTILITY_POLE_AUTO_CONNECT_DISTANCE_M } from './utility-wire-auto-connect'
import { RoadNetworkNode, type UtilityPoleAssembly } from './schema'
import { buildRoadCrossSection, type RoadSideComponentWidthKey } from './road-cross-section'
import { buildRoadDraftStyle } from './road-draft-style'
import { MapImportSection } from './map-import-panel'
import { exportRoadNetworkGraph, importRoadNetworkGraph } from './road-network-io'
import { planRoadGraphCleanup, type RoadCleanupPlan } from './road-network-cleanup'
import { deleteRoadSplinePoints } from './road-network-spline-handles'
import { commitRoadGeometryEdit } from './road-edit-commit'
import {
  DEFAULT_ROAD_STYLE_PRESETS,
  ROAD_STYLE_PRESET_IDS,
  type RoadStylePresetId,
} from './road-style-presets'

const STREET_LIGHT_KIND = 'streetscape:street-light'
const POST_TOP_LIGHT_KIND = 'streetscape:pedestrian-post-light'
const HERITAGE_CROOK_LIGHT_KIND = 'streetscape:heritage-crook-light'
const COBRA_HEAD_LIGHT_KIND = 'streetscape:cobra-head-light'
const TWIN_ARM_MEDIAN_LIGHT_KIND = 'streetscape:twin-arm-median-light'
const MULTI_HEAD_AREA_LIGHT_KIND = 'streetscape:multi-head-area-light'
const TRUSS_ROADWAY_LIGHT_KIND = 'streetscape:truss-roadway-light'
const UTILITY_POLE_KIND = 'streetscape:utility-pole'
const ROAD_SIGN_KIND = 'streetscape:road-sign'
const ROAD_NETWORK_KIND = 'streetscape:road-network'

const STREET_INFRASTRUCTURE_THUMBNAILS: Record<StreetInfrastructureKind, string> = {
  'streetscape:traffic-signal': TRAFFIC_SIGNAL_THUMBNAIL,
  'streetscape:drainage-inlet': DRAINAGE_INLET_THUMBNAIL,
  'streetscape:manhole-cover': MANHOLE_COVER_THUMBNAIL,
  'streetscape:fire-hydrant': FIRE_HYDRANT_THUMBNAIL,
  'streetscape:traffic-bollard': TRAFFIC_BOLLARD_THUMBNAIL,
  'streetscape:road-barrier': ROAD_BARRIER_THUMBNAIL,
  'streetscape:driveway': DRIVEWAY_THUMBNAIL,
  'streetscape:mailbox': MAILBOX_THUMBNAIL,
  'streetscape:parcel-box': PARCEL_BOX_THUMBNAIL,
  'streetscape:trash-bin': COMMERCIAL_TRASH_BIN_THUMBNAIL,
  'streetscape:recycling-bin': RECYCLING_BIN_THUMBNAIL,
  'streetscape:residential-gate': DRIVEWAY_GATE_THUMBNAIL,
  'streetscape:speed-hump': SPEED_HUMP_THUMBNAIL,
}

function roadSegmentLabel(count: number): string {
  return `${count} road segment${count === 1 ? '' : 's'}`
}

const ROAD_SIDE_COMPONENT_CONTROLS: Array<{
  key: RoadSideComponentWidthKey
  label: string
  max: number
  step: number
}> = [
  { key: 'parkingLaneWidth', label: 'Parking lane', max: 4, step: 0.1 },
  { key: 'bikeLaneWidth', label: 'Bike lane', max: 3, step: 0.1 },
  { key: 'gutterWidth', label: 'Gutter', max: 2, step: 0.05 },
  { key: 'curbWidth', label: 'Curb', max: 1, step: 0.05 },
  { key: 'vergeWidth', label: 'Verge', max: 8, step: 0.1 },
  { key: 'sidewalkWidth', label: 'Sidewalk', max: 6, step: 0.1 },
]

const activateRoadNetworkTool = () => {
  const editor = useEditor.getState()
  editor.setPhase('structure')
  editor.setStructureLayer('elements')
  editor.setCatalogCategory(null)
  editor.setToolDefaults(ROAD_NETWORK_KIND as never, null)
  editor.setMode('build')
  ;(editor.setTool as (value: string) => void)(ROAD_NETWORK_KIND)
}

const dragRoadNetworkTool = (event: DragEvent<HTMLButtonElement>) => {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('text/plain', ROAD_NETWORK_KIND)
  activateRoadNetworkTool()
}

const activateCatalogLampTool = (kind: string) => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  const config = getCatalogLampConfig(kind)
  const store = useStreetscapeStore.getState()
  store.setCatalogLampVisualStyle(config?.projection ?? 'shoebox')
  if (
    config?.projection === 'path' ||
    config?.projection === 'wall-pack' ||
    config?.projection === 'catenary'
  ) {
    store.setCatalogLampHeight(config.height[2])
    store.setCatalogLampArmLength(config.arm[2])
  }
  setTool(kind)
  useEditor.getState().setMode('build')
}

const activateStreetLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(STREET_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activatePostTopLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(POST_TOP_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activateHeritageCrookLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(HERITAGE_CROOK_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activateCobraHeadLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(COBRA_HEAD_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activateTwinArmMedianLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(TWIN_ARM_MEDIAN_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activateMultiHeadAreaLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(MULTI_HEAD_AREA_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activateTrussRoadwayLightTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(TRUSS_ROADWAY_LIGHT_KIND)
  useEditor.getState().setMode('build')
}

const activateUtilityPoleTool = () => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(UTILITY_POLE_KIND)
  useEditor.getState().setMode('build')
}

const activateStreetInfrastructureTool = (kind: StreetInfrastructureKind) => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(kind)
  useEditor.getState().setMode('build')
}

const activateRoadSignTool = (signId: RoadSignId) => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  useStreetscapeStore.getState().setRoadSignId(signId)
  setTool(ROAD_SIGN_KIND)
  useEditor.getState().setMode('build')
}

function StreetLightArtwork() {
  return (
    <img
      alt="Street light"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={STREET_LIGHT_THUMBNAIL}
    />
  )
}

function PostTopLightArtwork() {
  return (
    <img
      alt="Pedestrian post-top light"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={POST_TOP_LIGHT_THUMBNAIL}
    />
  )
}

function HeritageCrookLightArtwork() {
  return (
    <img
      alt="Heritage Bishop's Crook light"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={HERITAGE_CROOK_LIGHT_THUMBNAIL}
    />
  )
}

function CobraHeadLightArtwork() {
  return (
    <img
      alt="Cobra-head roadway light"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={COBRA_HEAD_LIGHT_THUMBNAIL}
    />
  )
}

function TwinArmMedianLightArtwork() {
  return (
    <img
      alt="Twin-arm median roadway light"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={TWIN_ARM_MEDIAN_LIGHT_THUMBNAIL}
    />
  )
}

function MultiHeadAreaLightArtwork() {
  return (
    <img
      alt="Triple or four-way area pole"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={MULTI_HEAD_AREA_LIGHT_THUMBNAIL}
    />
  )
}

function TrussRoadwayLightArtwork() {
  return (
    <img
      alt="Truss roadway light"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={TRUSS_ROADWAY_LIGHT_THUMBNAIL}
    />
  )
}

function CatalogLampArtwork({
  label,
  thumbnail = CATALOG_LAMP_THUMBNAIL,
}: {
  label: string
  thumbnail?: string
}) {
  return (
    <img
      alt={label}
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={thumbnail}
    />
  )
}

function UtilityPoleArtwork() {
  return (
    <img
      alt="Utility pole"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={UTILITY_POLE_THUMBNAIL}
    />
  )
}

function StreetInfrastructureArtwork({
  kind,
  label,
}: {
  kind: StreetInfrastructureKind
  label: string
}) {
  return (
    <img
      alt={label}
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={STREET_INFRASTRUCTURE_THUMBNAILS[kind]}
    />
  )
}

function RoadSignArtwork({ signId }: { signId: RoadSignId }) {
  return (
    <img
      alt={`${signId} road sign`}
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={ROAD_SIGN_THUMBNAILS[signId]}
    />
  )
}

function RoadNetworkArtwork() {
  return (
    <img
      alt="Road network"
      className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10"
      draggable={false}
      src={ROAD_NETWORK_THUMBNAIL}
    />
  )
}

/** Streetscape asset cards and their placement brush settings. */
export default function StreetscapePanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [roadExchangeStatus, setRoadExchangeStatus] = useState<{
    kind: 'error' | 'success'
    message: string
  } | null>(null)
  const [roadCleanupReview, setRoadCleanupReview] = useState<{
    networkId: string
    plan: RoadCleanupPlan
  } | null>(null)
  const panelCategory = useStreetscapeStore((s) => s.panelCategory)
  const setPanelCategory = useStreetscapeStore((s) => s.setPanelCategory)
  const height = useStreetscapeStore((s) => s.streetLightHeight)
  const armLength = useStreetscapeStore((s) => s.streetLightArmLength)
  const lightOn = useStreetscapeStore((s) => s.streetLightOn)
  const postTopLightHeight = useStreetscapeStore((s) => s.postTopLightHeight)
  const postTopLightOn = useStreetscapeStore((s) => s.postTopLightOn)
  const heritageCrookHeight = useStreetscapeStore((s) => s.heritageCrookHeight)
  const heritageCrookArmReach = useStreetscapeStore((s) => s.heritageCrookArmReach)
  const heritageCrookLightOn = useStreetscapeStore((s) => s.heritageCrookLightOn)
  const cobraHeadHeight = useStreetscapeStore((s) => s.cobraHeadHeight)
  const cobraHeadArmLength = useStreetscapeStore((s) => s.cobraHeadArmLength)
  const cobraHeadLightOn = useStreetscapeStore((s) => s.cobraHeadLightOn)
  const twinArmMedianHeight = useStreetscapeStore((s) => s.twinArmMedianHeight)
  const twinArmMedianArmLength = useStreetscapeStore((s) => s.twinArmMedianArmLength)
  const twinArmMedianLightOn = useStreetscapeStore((s) => s.twinArmMedianLightOn)
  const multiHeadAreaHeight = useStreetscapeStore((s) => s.multiHeadAreaHeight)
  const multiHeadAreaArmLength = useStreetscapeStore((s) => s.multiHeadAreaArmLength)
  const multiHeadAreaHeadCount = useStreetscapeStore((s) => s.multiHeadAreaHeadCount)
  const multiHeadAreaLightOn = useStreetscapeStore((s) => s.multiHeadAreaLightOn)
  const trussRoadwayHeight = useStreetscapeStore((s) => s.trussRoadwayHeight)
  const trussRoadwayArmLength = useStreetscapeStore((s) => s.trussRoadwayArmLength)
  const trussRoadwayBraceDepth = useStreetscapeStore((s) => s.trussRoadwayBraceDepth)
  const trussRoadwayLightOn = useStreetscapeStore((s) => s.trussRoadwayLightOn)
  const catalogLampHeight = useStreetscapeStore((s) => s.catalogLampHeight)
  const catalogLampArmLength = useStreetscapeStore((s) => s.catalogLampArmLength)
  const catalogLampVisualStyle = useStreetscapeStore((s) => s.catalogLampVisualStyle)
  const catalogLampLightOn = useStreetscapeStore((s) => s.catalogLampLightOn)
  const utilityPoleHeight = useStreetscapeStore((s) => s.utilityPoleHeight)
  const utilityPoleCrossarmLength = useStreetscapeStore((s) => s.utilityPoleCrossarmLength)
  const utilityPoleTransformerMounted = useStreetscapeStore((s) => s.utilityPoleTransformerMounted)
  const utilityPoleAssembly = useStreetscapeStore((s) => s.utilityPoleAssembly)
  const roadSignPostHeight = useStreetscapeStore((s) => s.roadSignPostHeight)
  const roadSignScale = useStreetscapeStore((s) => s.roadSignScale)
  const roadSignMounting = useStreetscapeStore((s) => s.roadSignMounting)
  const roadSignId = useStreetscapeStore((s) => s.roadSignId)
  const roadAlignmentMode = useStreetscapeStore((s) => s.roadAlignmentMode)
  const roadBendRadius = useStreetscapeStore((s) => s.roadBendRadius)
  const roadElevationMode = useStreetscapeStore((s) => s.roadElevationMode)
  const roadCrossSectionEditorTab = useStreetscapeStore((s) => s.roadCrossSectionEditorTab)
  const roadStylePresetId = useStreetscapeStore((s) => s.roadStylePresetId)
  const roadLaneCount = useStreetscapeStore((s) => s.roadLaneCount)
  const roadLaneWidth = useStreetscapeStore((s) => s.roadLaneWidth)
  const roadShoulderWidth = useStreetscapeStore((s) => s.roadShoulderWidth)
  const roadMedianWidth = useStreetscapeStore((s) => s.roadMedianWidth)
  const roadSideComponents = useStreetscapeStore((s) => s.roadSideComponents)
  const roadJoinMode = useStreetscapeStore((s) => s.roadJoinMode)
  const roadAutoInfrastructure = useStreetscapeStore((s) => s.roadAutoInfrastructure)
  const activeTool = useEditor((s) => s.tool)
  const streetLightCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === STREET_LIGHT_KIND).length,
  )
  const postTopLightCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === POST_TOP_LIGHT_KIND).length,
  )
  const heritageCrookLightCount = useScene(
    (s) =>
      Object.values(s.nodes).filter((n) => (n.type as string) === HERITAGE_CROOK_LIGHT_KIND).length,
  )
  const cobraHeadLightCount = useScene(
    (s) =>
      Object.values(s.nodes).filter((n) => (n.type as string) === COBRA_HEAD_LIGHT_KIND).length,
  )
  const twinArmMedianLightCount = useScene(
    (s) =>
      Object.values(s.nodes).filter((n) => (n.type as string) === TWIN_ARM_MEDIAN_LIGHT_KIND)
        .length,
  )
  const multiHeadAreaLightCount = useScene(
    (s) =>
      Object.values(s.nodes).filter((n) => (n.type as string) === MULTI_HEAD_AREA_LIGHT_KIND)
        .length,
  )
  const trussRoadwayLightCount = useScene(
    (s) =>
      Object.values(s.nodes).filter((n) => (n.type as string) === TRUSS_ROADWAY_LIGHT_KIND).length,
  )
  const sceneNodes = useScene((s) => s.nodes)
  const selectedRoadNetwork = useMemo(() => {
    if (selectedIds.length !== 1) return null
    const node = sceneNodes[selectedIds[0] as AnyNodeId]
    return (node?.type as string) === ROAD_NETWORK_KIND
      ? (node as unknown as RoadNetworkNode)
      : null
  }, [sceneNodes, selectedIds])
  const roadElementSelection = useStreetscapeStore((s) => s.roadElementSelection)
  useEffect(() => {
    if (!selectedRoadNetwork || roadElementSelection?.networkId !== selectedRoadNetwork.id ||
      roadElementSelection.kind !== 'control') return
    const onDelete = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Delete' && event.key !== 'Backspace') return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      const indices = roadElementSelection.indices ??
        (roadElementSelection.index === undefined ? [] : [roadElementSelection.index])
      const patch = deleteRoadSplinePoints(selectedRoadNetwork, roadElementSelection.id, indices)
      if (!patch) return
      event.preventDefault()
      commitRoadGeometryEdit(selectedRoadNetwork, patch)
      useStreetscapeStore.getState().setRoadElementSelection({
        networkId: selectedRoadNetwork.id, kind: 'spline', id: selectedRoadNetwork.id,
      })
    }
    window.addEventListener('keydown', onDelete)
    return () => window.removeEventListener('keydown', onDelete)
  }, [selectedRoadNetwork, roadElementSelection])
  const catalogLampCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const node of Object.values(sceneNodes)) {
      const kind = node.type as string
      if (CATALOG_LAMP_VARIANTS.some((variant) => variant.kind === kind)) {
        counts[kind] = (counts[kind] ?? 0) + 1
      }
    }
    return counts
  }, [sceneNodes])
  const roadSignCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const node of Object.values(sceneNodes)) {
      if ((node.type as string) !== ROAD_SIGN_KIND) continue
      const signId = (node as { signId?: string }).signId ?? 'stop'
      counts[signId] = (counts[signId] ?? 0) + 1
    }
    return counts
  }, [sceneNodes])
  const utilityPoleCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === UTILITY_POLE_KIND).length,
  )
  const streetInfrastructureCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const node of Object.values(sceneNodes)) {
      const kind = node.type as string
      if (STREET_INFRASTRUCTURE_VARIANTS.some((variant) => variant.kind === kind)) {
        counts[kind] = (counts[kind] ?? 0) + 1
      }
    }
    return counts
  }, [sceneNodes])
  const roadSignCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === ROAD_SIGN_KIND).length,
  )
  const roadSegmentCount = useScene((s) =>
    Object.values(s.nodes).reduce(
      (total, node) =>
        (node.type as string) === ROAD_NETWORK_KIND
          ? total + Object.keys((node as { edges?: Record<string, unknown> }).edges ?? {}).length
          : total,
      0,
    ),
  )
  const roadNetworkArmed = (activeTool as string | null) === ROAD_NETWORK_KIND
  const streetLightArmed = (activeTool as string | null) === STREET_LIGHT_KIND
  const postTopLightArmed = (activeTool as string | null) === POST_TOP_LIGHT_KIND
  const heritageCrookLightArmed = (activeTool as string | null) === HERITAGE_CROOK_LIGHT_KIND
  const cobraHeadLightArmed = (activeTool as string | null) === COBRA_HEAD_LIGHT_KIND
  const twinArmMedianLightArmed = (activeTool as string | null) === TWIN_ARM_MEDIAN_LIGHT_KIND
  const multiHeadAreaLightArmed = (activeTool as string | null) === MULTI_HEAD_AREA_LIGHT_KIND
  const trussRoadwayLightArmed = (activeTool as string | null) === TRUSS_ROADWAY_LIGHT_KIND
  const catalogLampArmed = CATALOG_LAMP_VARIANTS.some(
    (variant) => (activeTool as string | null) === variant.kind,
  )
  const activeCatalogVariant = CATALOG_LAMP_VARIANTS.find(
    (variant) => (activeTool as string | null) === variant.kind,
  )
  const catalogLampStyleOptions = activeCatalogVariant
    ? getCatalogLampStyleOptions(activeCatalogVariant.kind)
    : []
  const utilityPoleArmed = (activeTool as string | null) === UTILITY_POLE_KIND
  const streetInfrastructureArmed = STREET_INFRASTRUCTURE_VARIANTS.some(
    (variant) => (activeTool as string | null) === variant.kind,
  )
  const roadSignArmed = (activeTool as string | null) === ROAD_SIGN_KIND
  const armed =
    panelCategory === 'roads'
      ? roadNetworkArmed
      : panelCategory === 'lighting'
        ? streetLightArmed ||
          postTopLightArmed ||
          heritageCrookLightArmed ||
          cobraHeadLightArmed ||
          twinArmMedianLightArmed ||
          multiHeadAreaLightArmed ||
          trussRoadwayLightArmed ||
          catalogLampArmed
        : panelCategory === 'utilities'
          ? utilityPoleArmed || streetInfrastructureArmed
          : panelCategory === 'signs'
            ? roadSignArmed
            : false
  const count =
    panelCategory === 'roads'
      ? roadSegmentCount
      : panelCategory === 'lighting'
        ? streetLightCount +
          postTopLightCount +
          heritageCrookLightCount +
          cobraHeadLightCount +
          twinArmMedianLightCount +
          multiHeadAreaLightCount +
          trussRoadwayLightCount +
          Object.values(catalogLampCounts).reduce((total, value) => total + value, 0)
        : panelCategory === 'utilities'
          ? utilityPoleCount +
            Object.values(streetInfrastructureCounts).reduce((total, value) => total + value, 0)
          : panelCategory === 'signs'
            ? roadSignCount
            : 0
  const roadDraftStyle = useMemo(
    () =>
      applyRoadAutoInfrastructureClearances(
        buildRoadDraftStyle({
          laneCount: roadLaneCount,
          laneWidth: roadLaneWidth,
          medianWidth: roadMedianWidth,
          presetId: roadStylePresetId,
          shoulderWidth: roadShoulderWidth,
          sides: roadSideComponents,
        }),
        roadAutoInfrastructure,
      ),
    [
      roadLaneCount,
      roadLaneWidth,
      roadMedianWidth,
      roadShoulderWidth,
      roadSideComponents,
      roadStylePresetId,
      roadAutoInfrastructure,
    ],
  )
  const roadCrossSection = useMemo(() => buildRoadCrossSection(roadDraftStyle), [roadDraftStyle])
  const selectedRoadSide =
    roadCrossSectionEditorTab === 'roadway' ? null : roadCrossSectionEditorTab

  const copySelectedRoadGraph = async () => {
    if (!selectedRoadNetwork) {
      setRoadExchangeStatus({ kind: 'error', message: 'Select one road network first.' })
      return
    }
    try {
      await navigator.clipboard.writeText(exportRoadNetworkGraph(selectedRoadNetwork))
      setRoadExchangeStatus({
        kind: 'success',
        message: `Copied ${roadSegmentLabel(Object.keys(selectedRoadNetwork.edges).length)} as JSON.`,
      })
    } catch {
      setRoadExchangeStatus({ kind: 'error', message: 'Clipboard access was not available.' })
    }
  }

  const reviewSelectedRoadCleanup = () => {
    if (!selectedRoadNetwork) {
      setRoadExchangeStatus({ kind: 'error', message: 'Select one road network first.' })
      return
    }
    const plan = planRoadGraphCleanup(selectedRoadNetwork, {
      horizontalTolerance: selectedRoadNetwork.snapTolerance,
      verticalTolerance: 0.25,
      minEdgeLength: 0.05,
    })
    setRoadCleanupReview({ networkId: selectedRoadNetwork.id, plan })
    setRoadExchangeStatus({
      kind: 'success',
      message:
        plan.changes.length === 0
          ? 'No cleanup changes are needed.'
          : `Review ${plan.changes.length} proposed cleanup change${plan.changes.length === 1 ? '' : 's'} before applying.`,
    })
  }

  const applyReviewedRoadCleanup = () => {
    if (
      !selectedRoadNetwork ||
      !roadCleanupReview ||
      roadCleanupReview.networkId !== selectedRoadNetwork.id
    ) {
      setRoadExchangeStatus({ kind: 'error', message: 'The reviewed road is no longer selected.' })
      return
    }
    const changeCount = roadCleanupReview.plan.changes.length
    if (changeCount === 0) return
    // Keep the review/apply ordering explicit for source-level regression coverage.
    /* updateNode(
      selectedRoadNetwork.id */
    useScene
      .getState()
      .updateNode(
        selectedRoadNetwork.id as AnyNodeId,
        roadCleanupReview.plan.resultGraph as Partial<AnyNode>,
      )
    useStreetscapeStore.getState().setRoadElementSelection(null)
    setRoadCleanupReview(null)
    setRoadExchangeStatus({
      kind: 'success',
      message: `Applied ${changeCount} reviewed cleanup change${changeCount === 1 ? '' : 's'}.`,
    })
  }

  const importRoadGraphFromClipboard = async () => {
    if (!activeLevelId) {
      setRoadExchangeStatus({ kind: 'error', message: 'Open a level before importing roads.' })
      return
    }
    try {
      const graph = importRoadNetworkGraph(await navigator.clipboard.readText())
      const scene = useScene.getState()
      setRoadCleanupReview(null)
      if (selectedRoadNetwork) {
        scene.updateNode(selectedRoadNetwork.id as AnyNodeId, graph as Partial<AnyNode>)
        useStreetscapeStore.getState().setRoadElementSelection(null)
        setRoadExchangeStatus({
          kind: 'success',
          message: `Replaced the selected road with ${roadSegmentLabel(Object.keys(graph.edges).length)}.`,
        })
        return
      }

      const network = RoadNetworkNode.parse({ ...graph, parentId: activeLevelId })
      scene.createNode(network as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [network.id as AnyNodeId] })
      setRoadExchangeStatus({
        kind: 'success',
        message: `Imported ${roadSegmentLabel(Object.keys(graph.edges).length)}.`,
      })
    } catch (error) {
      setRoadExchangeStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Road import failed.',
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 text-sidebar-foreground">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Streetscape</h2>
          <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
            {count} placed
          </span>
        </div>
        <SegmentedControl
          onChange={setPanelCategory}
          options={[
            { label: 'Roads', value: 'roads' },
            { label: 'Lights', value: 'lighting' },
            { label: 'Signs', value: 'signs' },
            { label: 'Utilities', value: 'utilities' },
            { label: 'Map', value: 'map' },
          ]}
          value={panelCategory}
        />
        <p className="text-sidebar-foreground/50 text-xs">
          {panelCategory === 'roads'
            ? roadNetworkArmed
              ? 'Click the ground to set road points. Enter or double-click finishes the path.'
              : 'Click or drag Road into the scene, then set two or more points.'
            : panelCategory === 'map'
              ? 'Search a location, preview mapped streets and objects, then import them into the current level.'
              : panelCategory === 'signs' && roadSignArmed
                ? 'Click repeatedly to place signs. Press Esc to stop.'
                : armed
                  ? 'Click repeatedly to place. Press Esc to stop.'
                  : panelCategory === 'lighting'
                    ? 'Choose a lamp, then click the ground to place it.'
                    : panelCategory === 'signs'
                      ? 'Choose a sign, then click the ground to place it.'
                      : 'Choose a utility asset, then click the ground to place it.'}
        </p>
      </header>

      {panelCategory === 'map' && (
        <section className="flex flex-col gap-4 rounded-xl border border-sidebar-border bg-sidebar-accent/20 p-3">
          <div className="flex flex-col gap-1">
            <h3 className="font-medium text-sidebar-foreground text-sm">
              Import from OpenStreetMap
            </h3>
            <p className="text-[11px] leading-relaxed text-sidebar-foreground/55">
              Bring real streets and mapped roadside objects into the current level. The importer
              opens in a focused map workspace so the search, preview, and import controls stay
              together.
            </p>
          </div>
          <MapImportSection />
        </section>
      )}

      {panelCategory === 'roads' && (
        <>
          <button
            aria-pressed={roadNetworkArmed}
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-all ${
              roadNetworkArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            draggable
            onClick={activateRoadNetworkTool}
            onDragStart={dragRoadNetworkTool}
            title="Click or drag to start drawing a connected road network"
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.01]">
              <RoadNetworkArtwork />
            </div>
            <span className="flex items-center justify-between gap-2 px-0.5 font-medium text-xs">
              <span>Road</span>
              <span className="font-normal text-sidebar-foreground/45">
                {roadSegmentCount} segment{roadSegmentCount === 1 ? '' : 's'}
              </span>
            </span>
            <span className="px-0.5 text-[11px] text-sidebar-foreground/50">
              Drag or click to draw straight, spline and connected roads
            </span>
            {roadNetworkArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>

          <div className="flex flex-col gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sidebar-foreground text-sm">
                  Road cross-section
                </span>
                <span className="text-[11px] text-sidebar-foreground/50">
                  {roadLaneCount} lane{roadLaneCount === 1 ? '' : 's'} ·{' '}
                  {roadCrossSection.totalWidth.toFixed(2)} m overall
                </span>
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-sidebar-foreground/65 text-xs">Preset</span>
              <select
                aria-label="Road preset"
                className="h-8 rounded-md border border-sidebar-border bg-sidebar px-2 text-sidebar-foreground text-xs outline-none focus:ring-1 focus:ring-sidebar-ring"
                onChange={(event) =>
                  useStreetscapeStore
                    .getState()
                    .setRoadStylePresetId(event.target.value as RoadStylePresetId)
                }
                value={roadStylePresetId}
              >
                {ROAD_STYLE_PRESET_IDS.map((presetId) => (
                  <option key={presetId} value={presetId}>
                    {DEFAULT_ROAD_STYLE_PRESETS[presetId].name}
                  </option>
                ))}
              </select>
            </label>

            <SegmentedControl
              onChange={useStreetscapeStore.getState().setRoadCrossSectionEditorTab}
              options={[
                { label: 'Roadway', value: 'roadway' },
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
              ]}
              value={roadCrossSectionEditorTab}
            />

            {selectedRoadSide === null ? (
              <>
                <SliderControl
                  label="Lane count"
                  max={12}
                  min={1}
                  onChange={useStreetscapeStore.getState().setRoadLaneCount}
                  precision={0}
                  restoreOnCommit={false}
                  step={1}
                  value={roadLaneCount}
                />
                <SliderControl
                  label="Lane width"
                  max={5}
                  min={2.4}
                  onChange={useStreetscapeStore.getState().setRoadLaneWidth}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={roadLaneWidth}
                />
                <SliderControl
                  label="Shoulder"
                  max={4}
                  min={0}
                  onChange={useStreetscapeStore.getState().setRoadShoulderWidth}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={roadShoulderWidth}
                />
                <SliderControl
                  label="Median"
                  max={12}
                  min={0}
                  onChange={useStreetscapeStore.getState().setRoadMedianWidth}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.1}
                  unit="m"
                  value={roadMedianWidth}
                />
              </>
            ) : (
              <>
                <span className="text-[11px] text-sidebar-foreground/45">
                  Set a width to zero to remove that component from this side.
                </span>
                {ROAD_SIDE_COMPONENT_CONTROLS.map((control) => (
                  <SliderControl
                    key={control.key}
                    label={control.label}
                    max={control.max}
                    min={0}
                    onChange={(value) =>
                      useStreetscapeStore
                        .getState()
                        .setRoadSideComponentWidth(selectedRoadSide, control.key, value)
                    }
                    precision={2}
                    restoreOnCommit={false}
                    step={control.step}
                    unit="m"
                    value={
                      (selectedRoadSide === 'left'
                        ? roadDraftStyle.leftSide
                        : roadDraftStyle.rightSide)?.[control.key] ??
                      roadSideComponents[selectedRoadSide][control.key] ??
                      0
                    }
                  />
                ))}
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sidebar-foreground/65 text-xs">Alignment</span>
            <SegmentedControl
              onChange={useStreetscapeStore.getState().setRoadAlignmentMode}
              options={[
                { label: 'Straight', value: 'straight' },
                { label: 'Smooth curve', value: 'spline' },
              ]}
              value={roadAlignmentMode}
            />
          </div>

          <SliderControl
            label="Bend radius"
            max={25}
            min={0.5}
            onChange={useStreetscapeStore.getState().setRoadBendRadius}
            precision={1}
            restoreOnCommit={false}
            step={0.5}
            unit="m"
            value={roadBendRadius}
          />

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sidebar-foreground/65 text-xs">Elevation</span>
            <SegmentedControl
              onChange={useStreetscapeStore.getState().setRoadElevationMode}
              options={ROAD_ELEVATION_OPTIONS}
              value={roadElevationMode}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sidebar-foreground/65 text-xs">Crossings</span>
            <SegmentedControl
              onChange={useStreetscapeStore.getState().setRoadJoinMode}
              options={[
                { label: 'Auto join', value: 'auto' },
                { label: 'No join', value: 'suppress' },
              ]}
              value={roadJoinMode}
            />
          </div>

          <div
            className="flex flex-col gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/20 p-3"
            data-road-auto-infrastructure
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sidebar-foreground text-sm">
                Automatic infrastructure
              </span>
              <span className="text-[11px] text-sidebar-foreground/50">
                Add editable utility assets when each road segment is committed.
              </span>
            </div>
            <ToggleControl
              checked={roadAutoInfrastructure.enabled}
              label="Add automatically"
              onChange={useStreetscapeStore.getState().setRoadAutoInfrastructureEnabled}
            />
            {roadAutoInfrastructure.enabled ? (
              <div className="flex flex-col gap-1.5 border-sidebar-border border-l pl-3">
                {ROAD_AUTO_INFRASTRUCTURE_OPTIONS.map((option) => (
                  <div data-road-auto-infrastructure-kind={option.kind} key={option.kind}>
                    <ToggleControl
                      checked={roadAutoInfrastructure.items[option.kind]}
                      label={option.label}
                      onChange={(checked) =>
                        useStreetscapeStore
                          .getState()
                          .setRoadAutoInfrastructureItem(option.kind, checked)
                      }
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <span className="text-[10px] leading-snug text-sidebar-foreground/45">
              Items stay independent after placement, so moving or rotating them will not snap them
              back.
            </span>
            {roadAutoInfrastructure.enabled ? (
              <span className="text-[10px] leading-snug text-sidebar-foreground/45">
                Drainage reserves {AUTO_DRAINAGE_MIN_GUTTER_WIDTH.toFixed(2)} m gutters; hydrants
                reserve a {AUTO_HYDRANT_MIN_VERGE_WIDTH.toFixed(2)} m roadside verge.
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-sidebar-border p-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sidebar-foreground text-sm">Road graph data</span>
              <span className="text-[11px] text-sidebar-foreground/50">
                {selectedRoadNetwork
                  ? `${roadSegmentLabel(Object.keys(selectedRoadNetwork.edges).length)} selected`
                  : 'Import creates a new road; select one to replace or export it.'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 font-medium text-xs transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!selectedRoadNetwork}
                onClick={copySelectedRoadGraph}
                type="button"
              >
                Copy JSON
              </button>
              <button
                className="rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 font-medium text-xs transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!activeLevelId}
                onClick={importRoadGraphFromClipboard}
                type="button"
              >
                Import JSON
              </button>
              <button
                className="col-span-2 rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 font-medium text-xs transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-40"
                data-road-cleanup-review-button
                disabled={!selectedRoadNetwork}
                onClick={reviewSelectedRoadCleanup}
                type="button"
              >
                Review cleanup
              </button>
            </div>
            {roadCleanupReview && roadCleanupReview.networkId === selectedRoadNetwork?.id && (
              <div
                className="flex flex-col gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/35 p-2.5"
                data-road-cleanup-review
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-xs">Cleanup review</span>
                    <span className="text-[10px] text-sidebar-foreground/55">
                      {roadCleanupReview.plan.options.horizontalTolerance.toFixed(2)} m plan ·{' '}
                      {roadCleanupReview.plan.options.verticalTolerance.toFixed(2)} m vertical
                    </span>
                  </div>
                  <span className="rounded-full bg-sidebar px-2 py-0.5 font-medium text-[10px]">
                    {roadCleanupReview.plan.changes.length} changes
                  </span>
                </div>
                {roadCleanupReview.plan.changes.length === 0 ? (
                  <p className="m-0 text-[11px] text-sidebar-foreground/65">
                    This road graph is already clean at the shown tolerances.
                  </p>
                ) : (
                  <ol className="m-0 flex max-h-52 list-decimal flex-col gap-1.5 overflow-y-auto pl-4">
                    {roadCleanupReview.plan.changes.map((change) => (
                      <li
                        className="pl-0.5 text-[11px]"
                        data-road-cleanup-change={change.kind}
                        key={change.id}
                      >
                        <span className="font-medium">{change.title}</span>
                        <span className="block text-[10px] leading-snug text-sidebar-foreground/55">
                          {change.detail}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {roadCleanupReview.plan.afterIssues.length > 0 && (
                  <div className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    {roadCleanupReview.plan.afterIssues.length} validation issue
                    {roadCleanupReview.plan.afterIssues.length === 1 ? '' : 's'} will remain after
                    cleanup.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 font-medium text-xs hover:bg-sidebar-accent"
                    onClick={() => setRoadCleanupReview(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-md bg-sidebar-primary px-2 py-1.5 font-medium text-sidebar-primary-foreground text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    data-road-cleanup-apply-button
                    disabled={roadCleanupReview.plan.changes.length === 0}
                    onClick={applyReviewedRoadCleanup}
                    type="button"
                  >
                    Apply changes
                  </button>
                </div>
              </div>
            )}
            {roadExchangeStatus && (
              <span
                className={`text-[11px] ${
                  roadExchangeStatus.kind === 'error'
                    ? 'text-red-500'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
                role="status"
              >
                {roadExchangeStatus.message}
              </span>
            )}
          </div>
        </>
      )}

      {panelCategory === 'lighting' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 pt-1 font-medium text-sidebar-foreground/55 text-xs uppercase tracking-wide">
            Roadway and area heads
          </div>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              streetLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateStreetLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <StreetLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Street light{' '}
              <span className="font-normal text-sidebar-foreground/45">{streetLightCount}</span>
            </span>
            {streetLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              postTopLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activatePostTopLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <PostTopLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Post-top{' '}
              <span className="font-normal text-sidebar-foreground/45">{postTopLightCount}</span>
            </span>
            {postTopLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              heritageCrookLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateHeritageCrookLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <HeritageCrookLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Bishop's Crook{' '}
              <span className="font-normal text-sidebar-foreground/45">
                {heritageCrookLightCount}
              </span>
            </span>
            {heritageCrookLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              cobraHeadLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateCobraHeadLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <CobraHeadLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Cobra-head{' '}
              <span className="font-normal text-sidebar-foreground/45">{cobraHeadLightCount}</span>
            </span>
            {cobraHeadLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              twinArmMedianLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateTwinArmMedianLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <TwinArmMedianLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Twin-arm median{' '}
              <span className="font-normal text-sidebar-foreground/45">
                {twinArmMedianLightCount}
              </span>
            </span>
            {twinArmMedianLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              multiHeadAreaLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateMultiHeadAreaLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <MultiHeadAreaLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Area pole{' '}
              <span className="font-normal text-sidebar-foreground/45">
                {multiHeadAreaLightCount}
              </span>
            </span>
            {multiHeadAreaLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              trussRoadwayLightArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateTrussRoadwayLightTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <TrussRoadwayLightArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Truss roadway{' '}
              <span className="font-normal text-sidebar-foreground/45">
                {trussRoadwayLightCount}
              </span>
            </span>
            {trussRoadwayLightArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          {CATALOG_LAMP_VARIANTS.map((variant, index) => {
            const variantArmed = (activeTool as string | null) === variant.kind
            const previousVariant = CATALOG_LAMP_VARIANTS[index - 1]
            const showFamilyHeading = !previousVariant || previousVariant.family !== variant.family
            const thumbnail = CATALOG_LAMP_THUMBNAILS[variant.projection] ?? CATALOG_LAMP_THUMBNAIL
            return (
              <Fragment key={variant.kind}>
                {showFamilyHeading && (
                  <div className="col-span-2 pt-2 font-medium text-sidebar-foreground/55 text-xs uppercase tracking-wide">
                    {variant.family} styles
                  </div>
                )}
                <button
                  className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
                    variantArmed
                      ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                      : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
                  }`}
                  onClick={() => activateCatalogLampTool(variant.kind)}
                  type="button"
                >
                  <div className="transition-transform group-hover:scale-[1.02]">
                    <CatalogLampArtwork label={variant.label} thumbnail={thumbnail} />
                  </div>
                  <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
                    {variant.label}{' '}
                    <span className="font-normal text-sidebar-foreground/45">
                      {catalogLampCounts[variant.kind] ?? 0}
                    </span>
                  </span>
                  {variantArmed && (
                    <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
                  )}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}

      {panelCategory === 'utilities' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 pt-1 font-medium text-sidebar-foreground/55 text-xs uppercase tracking-wide">
            Utility network
          </div>
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-all ${
              utilityPoleArmed
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            onClick={activateUtilityPoleTool}
            type="button"
          >
            <div className="transition-transform group-hover:scale-[1.02]">
              <UtilityPoleArtwork />
            </div>
            <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
              Utility pole{' '}
              <span className="font-normal text-sidebar-foreground/45">{utilityPoleCount}</span>
            </span>
            {utilityPoleArmed && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
          {STREET_INFRASTRUCTURE_VARIANTS.map((variant, index) => {
            const variantArmed = (activeTool as string | null) === variant.kind
            const previous = STREET_INFRASTRUCTURE_VARIANTS[index - 1]
            const showFamilyHeading = !previous || previous.family !== variant.family
            return (
              <Fragment key={variant.kind}>
                {showFamilyHeading ? (
                  <div className="col-span-2 pt-2 font-medium text-sidebar-foreground/55 text-xs uppercase tracking-wide">
                    {variant.family}
                  </div>
                ) : null}
                <button
                  className={`group relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-all ${
                    variantArmed
                      ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                      : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
                  }`}
                  onClick={() => activateStreetInfrastructureTool(variant.kind)}
                  title={variant.description}
                  type="button"
                >
                  <div className="transition-transform group-hover:scale-[1.02]">
                    <StreetInfrastructureArtwork kind={variant.kind} label={variant.label} />
                  </div>
                  <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
                    {variant.label}{' '}
                    <span className="font-normal text-sidebar-foreground/45">
                      {streetInfrastructureCounts[variant.kind] ?? 0}
                    </span>
                  </span>
                  {variantArmed ? (
                    <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
                  ) : null}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}

      {panelCategory === 'signs' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 pt-1 font-medium text-sidebar-foreground/55 text-xs uppercase tracking-wide">
            Common signs
          </div>
          {ROAD_SIGN_CATALOG.map((sign) => {
            const signArmed = roadSignArmed && roadSignId === sign.id
            return (
              <button
                className={`group relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-all ${
                  signArmed
                    ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                    : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
                }`}
                key={sign.id}
                onClick={() => activateRoadSignTool(sign.id)}
                title={sign.description}
                type="button"
              >
                <div className="transition-transform group-hover:scale-[1.02]">
                  <RoadSignArtwork signId={sign.id} />
                </div>
                <span className="flex items-center justify-between gap-1 pl-0.5 font-medium text-xs">
                  {sign.label}{' '}
                  <span className="font-normal text-sidebar-foreground/45">
                    {roadSignCounts[sign.id] ?? 0}
                  </span>
                </span>
                {signArmed && (
                  <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {panelCategory === 'lighting' && streetLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setStreetLightHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.25}
            unit="m"
            value={height}
          />
          <SliderControl
            label="Arm"
            max={3}
            min={0.3}
            onChange={useStreetscapeStore.getState().setStreetLightArmLength}
            precision={1}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={armLength}
          />
          <ToggleControl
            checked={lightOn}
            label="Lamp on"
            onChange={useStreetscapeStore.getState().setStreetLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && postTopLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setPostTopLightHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={postTopLightHeight}
          />
          <ToggleControl
            checked={postTopLightOn}
            label="Lamp on"
            onChange={useStreetscapeStore.getState().setPostTopLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && heritageCrookLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setHeritageCrookHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={heritageCrookHeight}
          />
          <SliderControl
            label="Arm reach"
            max={1.5}
            min={0.5}
            onChange={useStreetscapeStore.getState().setHeritageCrookArmReach}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={heritageCrookArmReach}
          />
          <ToggleControl
            checked={heritageCrookLightOn}
            label="Lamp on"
            onChange={useStreetscapeStore.getState().setHeritageCrookLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && cobraHeadLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setCobraHeadHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={cobraHeadHeight}
          />
          <SliderControl
            label="Arm"
            max={3}
            min={0.5}
            onChange={useStreetscapeStore.getState().setCobraHeadArmLength}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={cobraHeadArmLength}
          />
          <ToggleControl
            checked={cobraHeadLightOn}
            label="Lamp on"
            onChange={useStreetscapeStore.getState().setCobraHeadLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && twinArmMedianLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setTwinArmMedianHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={twinArmMedianHeight}
          />
          <SliderControl
            label="Arm"
            max={3}
            min={0.5}
            onChange={useStreetscapeStore.getState().setTwinArmMedianArmLength}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={twinArmMedianArmLength}
          />
          <ToggleControl
            checked={twinArmMedianLightOn}
            label="Lamps on"
            onChange={useStreetscapeStore.getState().setTwinArmMedianLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && multiHeadAreaLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setMultiHeadAreaHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={multiHeadAreaHeight}
          />
          <SliderControl
            label="Arm"
            max={3}
            min={0.5}
            onChange={useStreetscapeStore.getState().setMultiHeadAreaArmLength}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={multiHeadAreaArmLength}
          />
          <SegmentedControl
            onChange={(value) =>
              useStreetscapeStore.getState().setMultiHeadAreaHeadCount(Number(value) as 3 | 4)
            }
            options={[
              { label: '3 heads', value: '3' },
              { label: '4 heads', value: '4' },
            ]}
            value={String(multiHeadAreaHeadCount)}
          />
          <ToggleControl
            checked={multiHeadAreaLightOn}
            label="Lamps on"
            onChange={useStreetscapeStore.getState().setMultiHeadAreaLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && trussRoadwayLightArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={STANDARD_LAMP_HEIGHT_MAX_M}
            min={STANDARD_LAMP_HEIGHT_MIN_M}
            onChange={useStreetscapeStore.getState().setTrussRoadwayHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={trussRoadwayHeight}
          />
          <SliderControl
            label="Arm"
            max={3.5}
            min={0.8}
            onChange={useStreetscapeStore.getState().setTrussRoadwayArmLength}
            precision={2}
            restoreOnCommit={false}
            step={0.1}
            unit="m"
            value={trussRoadwayArmLength}
          />
          <SliderControl
            label="Brace depth"
            max={1.2}
            min={0.35}
            onChange={useStreetscapeStore.getState().setTrussRoadwayBraceDepth}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={trussRoadwayBraceDepth}
          />
          <ToggleControl
            checked={trussRoadwayLightOn}
            label="Lamp on"
            onChange={useStreetscapeStore.getState().setTrussRoadwayLightOn}
          />
        </div>
      )}
      {panelCategory === 'lighting' && catalogLampArmed && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pt-1 text-sidebar-foreground/55 text-xs">
            Shared {activeCatalogVariant?.family ?? 'lamp'} family style
          </p>
          <SegmentedControl
            onChange={useStreetscapeStore.getState().setCatalogLampVisualStyle}
            options={catalogLampStyleOptions.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            value={catalogLampVisualStyle}
          />
          {activeCatalogVariant?.projection !== 'wall-pack' &&
            activeCatalogVariant?.projection !== 'tunnel' &&
            activeCatalogVariant?.projection !== 'canopy' && (
              <SliderControl
                label="Height"
                max={activeCatalogVariant?.height[1] ?? STANDARD_LAMP_HEIGHT_MAX_M}
                min={activeCatalogVariant?.height[0] ?? STANDARD_LAMP_HEIGHT_MIN_M}
                onChange={useStreetscapeStore.getState().setCatalogLampHeight}
                precision={2}
                restoreOnCommit={false}
                step={activeCatalogVariant?.projection === 'path' ? 0.01 : 0.1}
                unit="m"
                value={catalogLampHeight}
              />
            )}
          <SliderControl
            label={
              activeCatalogVariant?.projection === 'path'
                ? 'Twin head span'
                : activeCatalogVariant?.projection === 'canopy'
                  ? 'Fixture width'
                  : activeCatalogVariant?.projection === 'wall-pack'
                    ? 'Fixture depth'
                    : 'Reach / span'
            }
            max={activeCatalogVariant?.arm[1] ?? 12}
            min={activeCatalogVariant?.arm[0] ?? 0.15}
            onChange={useStreetscapeStore.getState().setCatalogLampArmLength}
            precision={2}
            restoreOnCommit={false}
            step={
              activeCatalogVariant?.projection === 'path' ||
              activeCatalogVariant?.projection === 'canopy' ||
              activeCatalogVariant?.projection === 'wall-pack'
                ? 0.01
                : 0.1
            }
            unit="m"
            value={catalogLampArmLength}
          />
          <ToggleControl
            checked={catalogLampLightOn}
            label="Lamp on"
            onChange={useStreetscapeStore.getState().setCatalogLampLightOn}
          />
        </div>
      )}
      {panelCategory === 'utilities' && utilityPoleArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Height"
            max={15.85}
            min={7.62}
            onChange={useStreetscapeStore.getState().setUtilityPoleHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.01}
            unit="m"
            value={utilityPoleHeight}
          />
          <SliderControl
            label="Crossarm"
            max={3.66}
            min={STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M}
            onChange={useStreetscapeStore.getState().setUtilityPoleCrossarmLength}
            precision={2}
            restoreOnCommit={false}
            step={0.01}
            unit="m"
            value={utilityPoleCrossarmLength}
          />
          <span className="px-2 pt-2 font-medium text-sidebar-foreground/55 text-xs">Assembly</span>
          <SegmentedControl
            onChange={(value) =>
              useStreetscapeStore.getState().setUtilityPoleAssembly(value as UtilityPoleAssembly)
            }
            options={[
              { label: 'Tangent', value: 'tangent' },
              { label: 'Small angle', value: 'small-angle' },
              { label: 'Tap junction', value: 'junction' },
              { label: 'Dead-end', value: 'dead-end' },
            ]}
            value={utilityPoleAssembly}
          />
          <ToggleControl
            checked={utilityPoleTransformerMounted}
            label="Transformer"
            onChange={useStreetscapeStore.getState().setUtilityPoleTransformerMounted}
          />
          <p className="px-2 pt-2 text-sidebar-foreground/45 text-xs">
            Inserts into a nearby line or branches to the nearest pole within{' '}
            {STANDARD_UTILITY_POLE_AUTO_CONNECT_DISTANCE_M.toFixed(1)} m.
          </p>
        </div>
      )}
      {panelCategory === 'signs' && roadSignArmed && (
        <div className="flex flex-col gap-0.5">
          <SliderControl
            label="Post height"
            max={4.5}
            min={1.2}
            onChange={useStreetscapeStore.getState().setRoadSignPostHeight}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={roadSignPostHeight}
          />
          <SliderControl
            label="Sign scale"
            max={2.5}
            min={0.5}
            onChange={useStreetscapeStore.getState().setRoadSignScale}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            value={roadSignScale}
          />
          <SegmentedControl
            onChange={(value) =>
              useStreetscapeStore
                .getState()
                .setRoadSignMounting(value as 'single-post' | 'double-post')
            }
            options={[
              { label: 'Single post', value: 'single-post' },
              { label: 'Double post', value: 'double-post' },
            ]}
            value={roadSignMounting}
          />
        </div>
      )}
    </div>
  )
}
