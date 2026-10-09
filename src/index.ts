import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { initializeStreetscape } from './plugin-lifecycle'
export { initializeStreetscape, disposeStreetscape } from './plugin-lifecycle'
export { migrateStreetscapeScene } from './scene-load-migration'
if (typeof window !== 'undefined') initializeStreetscape()
import { cobraHeadLightDefinition } from './cobra-head-light-definition'
import { STREETSCAPE_ICON } from './art'
import { heritageCrookLightDefinition } from './heritage-crook-light-definition'
import { postTopLightDefinition } from './post-top-light-definition'
import { multiHeadAreaLightDefinition } from './multi-head-area-light-definition'
import { streetLightDefinition } from './street-light-definition'
import { twinArmMedianLightDefinition } from './twin-arm-median-light-definition'
import { trussRoadwayLightDefinition } from './truss-roadway-light-definition'
import {
  bollardLightDefinition,
  canopySoffitLightDefinition,
  catenaryStreetLightDefinition,
  decorativeCandelabraLightDefinition,
  floodlightPoleDefinition,
  globePostTopLightDefinition,
  highMastCrownLightDefinition,
  pathGardenLightDefinition,
  shoeboxAreaLightDefinition,
  solarStreetLightDefinition,
  traditionalPostTopLanternDefinition,
  tunnelLuminaireDefinition,
  wallArmLightDefinition,
  wallPackLightDefinition,
} from './catalog-lamp-definition'
import { utilityPoleDefinition } from './utility-pole-definition'
import { utilityWireDefinition } from './utility-wire-definition'
import { roadSignDefinition } from './road-sign-definition'
import { roadNetworkDefinition } from './road-network-definition'
import {
  drainageInletDefinition,
  fireHydrantDefinition,
  manholeCoverDefinition,
  roadBarrierDefinition,
  trafficBollardDefinition,
  trafficSignalDefinition,
  drivewayDefinition,
  mailboxDefinition,
  parcelBoxDefinition,
  trashBinDefinition,
  recyclingBinDefinition,
  residentialGateDefinition,
  speedHumpDefinition,
} from './street-infrastructure-definition'

type PluginHostPanel = {
  id: string
  label: string
  icon: { kind: 'url'; src: string }
  component: () => Promise<{ default: React.ComponentType }>
  pluginId: string
  description: string
  creator: {
    name: string
    url?: string
  }
  pluginUrl: string
  defaultInstalled: boolean
}

/**
 * The Pascal Streetscape plugin manifest — the entire public surface of this
 * package. A host loads it through the same `loadPlugin` path the built-ins use:
 * streetscape node kinds plus one left-rail panel (`Streetscape`). The cast
 * mirrors the built-in bundle: `AnyNodeDefinition` is the hand-maintained union
 * today; the registry derives it post-migration.
 */
export const streetscapeLabPlugin: Plugin = {
  id: 'pascal:streetscape-lab',
  apiVersion: 1,
  nodes: [
    roadNetworkDefinition as unknown as AnyNodeDefinition,
    streetLightDefinition as unknown as AnyNodeDefinition,
    postTopLightDefinition as unknown as AnyNodeDefinition,
    heritageCrookLightDefinition as unknown as AnyNodeDefinition,
    cobraHeadLightDefinition as unknown as AnyNodeDefinition,
    twinArmMedianLightDefinition as unknown as AnyNodeDefinition,
    multiHeadAreaLightDefinition as unknown as AnyNodeDefinition,
    trussRoadwayLightDefinition as unknown as AnyNodeDefinition,
    highMastCrownLightDefinition as unknown as AnyNodeDefinition,
    shoeboxAreaLightDefinition as unknown as AnyNodeDefinition,
    floodlightPoleDefinition as unknown as AnyNodeDefinition,
    traditionalPostTopLanternDefinition as unknown as AnyNodeDefinition,
    globePostTopLightDefinition as unknown as AnyNodeDefinition,
    decorativeCandelabraLightDefinition as unknown as AnyNodeDefinition,
    pathGardenLightDefinition as unknown as AnyNodeDefinition,
    bollardLightDefinition as unknown as AnyNodeDefinition,
    catenaryStreetLightDefinition as unknown as AnyNodeDefinition,
    wallArmLightDefinition as unknown as AnyNodeDefinition,
    wallPackLightDefinition as unknown as AnyNodeDefinition,
    tunnelLuminaireDefinition as unknown as AnyNodeDefinition,
    canopySoffitLightDefinition as unknown as AnyNodeDefinition,
    solarStreetLightDefinition as unknown as AnyNodeDefinition,
    utilityPoleDefinition as unknown as AnyNodeDefinition,
    utilityWireDefinition as unknown as AnyNodeDefinition,
    trafficSignalDefinition as unknown as AnyNodeDefinition,
    drainageInletDefinition as unknown as AnyNodeDefinition,
    manholeCoverDefinition as unknown as AnyNodeDefinition,
    fireHydrantDefinition as unknown as AnyNodeDefinition,
    trafficBollardDefinition as unknown as AnyNodeDefinition,
    roadBarrierDefinition as unknown as AnyNodeDefinition,
    drivewayDefinition as unknown as AnyNodeDefinition,
    mailboxDefinition as unknown as AnyNodeDefinition,
    parcelBoxDefinition as unknown as AnyNodeDefinition,
    trashBinDefinition as unknown as AnyNodeDefinition,
    recyclingBinDefinition as unknown as AnyNodeDefinition,
    residentialGateDefinition as unknown as AnyNodeDefinition,
    speedHumpDefinition as unknown as AnyNodeDefinition,
    roadSignDefinition as unknown as AnyNodeDefinition,
  ],
}

export const streetscapeLabHostPanel: PluginHostPanel = {
  id: 'pascal:streetscape-lab:streetscape',
  label: 'Streetscape Lab',
  icon: { kind: 'url', src: STREETSCAPE_ICON },
  component: () => import('./presets-panel'),
  pluginId: streetscapeLabPlugin.id,
  description: 'Working version of the streetscape tools for testing new features.',
  creator: {
    name: 'Pascal',
    url: 'https://github.com/sudhir9297',
  },
  pluginUrl: 'https://github.com/sudhir9297/streetscape-pascal-plugin',
  defaultInstalled: true,
}

// Keep the original export names for consumers migrating this working copy.
export const streetscapePlugin = streetscapeLabPlugin
export const streetscapeHostPanel = streetscapeLabHostPanel

export { configureMapImportGateway } from './map-data-source'

export {
  CobraHeadLightNode,
  HeritageCrookLightNode,
  MultiHeadAreaLightNode,
  PedestrianPostLightNode,
  StreetLightNode,
  TwinArmMedianLightNode,
  TrussRoadwayLightNode,
  HighMastCrownLightNode,
  ShoeboxAreaLightNode,
  FloodlightPoleNode,
  TraditionalPostTopLanternNode,
  GlobePostTopLightNode,
  DecorativeCandelabraLightNode,
  PathGardenLightNode,
  BollardLightNode,
  CatenaryStreetLightNode,
  WallArmLightNode,
  WallPackLightNode,
  TunnelLuminaireNode,
  CanopySoffitLightNode,
  SolarStreetLightNode,
  UtilityPoleNode,
  UtilityPoleAssembly,
  UtilityWireSpanNode,
  TrafficSignalNode,
  DrainageInletNode,
  ManholeCoverNode,
  FireHydrantNode,
  TrafficBollardNode,
  RoadBarrierNode,
  DrivewayNode,
  MailboxNode,
  ParcelBoxNode,
  TrashBinNode,
  RecyclingBinNode,
  ResidentialGateNode,
  SpeedHumpNode,
  RoadSignNode,
  RoadNetworkNode,
  RoadEdgeAttachment,
  RoadAttachmentRef,
  RoadAttachmentAlignment,
  RoadGraphNode,
  RoadGraphEdge,
  RoadStylePreset,
  createRoadSignNode,
  createRoadSignPreviewNode,
  ROAD_SIGN_PREVIEW_ID,
} from './schema'
export { cobraHeadLightDefinition } from './cobra-head-light-definition'
export { heritageCrookLightDefinition } from './heritage-crook-light-definition'
export { postTopLightDefinition } from './post-top-light-definition'
export { streetLightDefinition } from './street-light-definition'
export { twinArmMedianLightDefinition } from './twin-arm-median-light-definition'
export { trussRoadwayLightDefinition } from './truss-roadway-light-definition'
export { multiHeadAreaLightDefinition } from './multi-head-area-light-definition'
export {
  bollardLightDefinition,
  canopySoffitLightDefinition,
  catenaryStreetLightDefinition,
  decorativeCandelabraLightDefinition,
  floodlightPoleDefinition,
  globePostTopLightDefinition,
  highMastCrownLightDefinition,
  pathGardenLightDefinition,
  shoeboxAreaLightDefinition,
  solarStreetLightDefinition,
  traditionalPostTopLanternDefinition,
  tunnelLuminaireDefinition,
  wallArmLightDefinition,
  wallPackLightDefinition,
} from './catalog-lamp-definition'
export { utilityPoleDefinition } from './utility-pole-definition'
export { utilityWireDefinition } from './utility-wire-definition'
export {
  trafficSignalDefinition,
  drainageInletDefinition,
  manholeCoverDefinition,
  fireHydrantDefinition,
  trafficBollardDefinition,
  roadBarrierDefinition,
  drivewayDefinition,
  mailboxDefinition,
  parcelBoxDefinition,
  trashBinDefinition,
  recyclingBinDefinition,
  residentialGateDefinition,
  speedHumpDefinition,
} from './street-infrastructure-definition'
export { roadSignDefinition } from './road-sign-definition'
export { roadNetworkDefinition } from './road-network-definition'
export {
  classifyRoadJunction,
  createDefaultRoadStyle,
  createEmptyRoadGraph,
  incidentRoadEdges,
  insertRoadSegment,
  mergeRoadGraphs,
  roadStyleWidth,
  splitRoadGraphComponents,
  type InsertRoadSegmentResult,
  type RoadJunctionKind,
  type RoadNetworkGraph,
  type RoadPoint,
} from './road-network-topology'
export { sampleRoadEdgePoints, type RoadGeometryPoint } from './road-network-geometry'
export {
  buildRoadAutoInfrastructure,
  buildRoadAutoInfrastructurePlan,
  planRoadAutoInfrastructureAttachmentMigration,
  DEFAULT_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
  FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
  type RoadAutoInfrastructureSettings,
  type RoadAutoInfrastructurePlan,
  type RoadAutoInfrastructureAttachmentMigrationPlan,
} from './road-auto-infrastructure'
export {
  buildSignalJunctionPlacements,
  createRoadAttachmentForPlacement,
  findRoadAttachmentTarget,
  resolveRoadAttachmentTransform,
  reanchorRoadAttachment,
  type RoadAttachmentAssetKind,
  type RoadAttachmentTarget,
  type RoadAttachmentTransform,
  type SignalJunctionPlacement,
} from './road-edge-attachments'
export { validateRoadGraph, type RoadValidationIssue } from './road-network-validation'
export {
  ROAD_SIGN_CATALOG,
  ROAD_SIGN_IDS,
  getRoadSignConfig,
  resolveRoadSignText,
  type RoadSignCatalogEntry,
  type RoadSignId,
  type RoadSignPostStyle,
} from './road-sign-config'
export {
  resolveRoadSignLayout,
  resolveRoadSignBracketWidth,
  resolveRoadSignPostPositions,
  ROAD_SIGN_BRACKET_DEPTH_M,
  ROAD_SIGN_BRACKET_HEIGHT_M,
  ROAD_SIGN_BACK_FACE_GAP_M,
  ROAD_SIGN_BRACKET_EDGE_CLEARANCE_M,
  ROAD_SIGN_EDGE_BEVEL_M,
  ROAD_SIGN_FACE_GRAPHIC_GAP_M,
  ROAD_SIGN_PLATE_THICKNESS_M,
  ROAD_SIGN_POST_DEPTH_M,
  ROAD_SIGN_POST_RADIUS_M,
  ROAD_SIGN_POST_THICKNESS_M,
  ROAD_SIGN_POST_WIDTH_M,
  type RoadSignLayout,
} from './road-sign-geometry'
export {
  CATALOG_LAMP_STYLE_OPTIONS,
  CATALOG_LAMP_VARIANTS,
  LAMP_VISUAL_FAMILIES,
  getCatalogLampConfig,
  getCatalogLampStyleOptions,
  resolveCatalogLampProjection,
} from './catalog-lamp-config'
export {
  STANDARD_LAMP_HEIGHT_M,
  STANDARD_LAMP_HEIGHT_MAX_M,
  STANDARD_LAMP_HEIGHT_MIN_M,
} from './lamp-constants'
export {
  findNearestUtilityPoleForConnection,
  findUtilityPoleInlineInsertion,
  resolveUtilityPoleAutoConnect,
  resolveUtilityPolePlacementRotation,
  STANDARD_UTILITY_POLE_AUTO_CONNECT_DISTANCE_M,
  STANDARD_UTILITY_POLE_INLINE_INSERT_DISTANCE_M,
  utilityPoleCrossarmRotationY,
} from './utility-wire-auto-connect'
export {
  resolveUtilityPoleLayout,
  STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M,
  STANDARD_UTILITY_POLE_EMBEDMENT_M,
  STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M,
  STANDARD_UTILITY_POLE_TOTAL_LENGTH_M,
  type UtilityPoleWireAttachment,
} from './utility-pole-geometry'
export {
  STREET_INFRASTRUCTURE_KINDS,
  STREET_INFRASTRUCTURE_VARIANTS,
  RESIDENTIAL_ROAD_ASSET_KINDS,
  getStreetInfrastructureVariant,
  isStreetInfrastructureKind,
  isResidentialRoadAssetKind,
  parseStreetInfrastructure,
  type StreetInfrastructureKind,
  type StreetInfrastructureNode,
  type StreetInfrastructureVariant,
} from './street-infrastructure-config'
export {
  TRAFFIC_SIGNAL_DIMENSIONS,
  resolveTrafficSignalLayout,
  resolveDrainageInletLayout,
  resolveManholeCoverLayout,
  resolveFireHydrantLayout,
  resolveFireHydrantOutletLayout,
  resolveResidentialRoadAssetLayout,
  type ResidentialRoadAssetLayout,
  type ResidentialRoadAssetNode,
} from './street-infrastructure-geometry'

export { persistStreetProject, loadStreetProject, captureLegacyStreetProject } from "./host/street-project-store"

export { persistVerifiedStreetProject, loadVerifiedStreetProject } from "./host/street-project-store"

export { adaptResolvedCurrentRoad, convertStreetProjectRoads } from './street-project-compatibility'
export { createImportedStreetProject, readImportedBaselineNetworks, resolveOsmSnapshotBaseline } from './osm-baseline-bridge'
export { StreetApplicationChangeSet, StreetIdentityReference, StreetChangeConflict, prepareStreetApplicationChangeSet, streetSceneContent } from './domain/application-change-set'
export { captureStreetChangePreconditions, prepareHostStreetChangeSet, commitHostStreetChangeSet } from './host/application-change-set'
export { prepareRoadSegmentCommand } from './road-network-tool'
export { prepareRoadEdgeDeletion, commitRoadEdgeDeletion } from './road-edge-delete-command'

export { prepareAttachedAssetEdit, commitAttachedAssetEdit } from "./host/attached-asset-edit"

export { compileStreet, type CompiledStreetPlan } from './street-compiler'
export { StreetSectionLayout, StreetSectionLayoutInterval, StreetTrafficLane, StreetSurfaceBand, summarizeStreetSectionInterval } from './domain/street-section-layout'
export { acceptStreetSectionLayout } from './host/section-layout-command'

export { compileLaneMovements, compileProjectLaneMovements } from "./lane-movement-graph";
export { acceptLaneMovementDecision } from "./host/lane-movement-command";
export { LaneMovementDecision, laneMovementId } from "./domain/lane-movement";
export { compileJunctionMovementPlan } from './street-junction-movement-plan';

export { createStreetScenario, selectStreetScenario, redesignStreetSectionLayout, redesignStreetProperty } from "./host/street-scenario-command";

export { resolveEffectiveStreetModel, compileStreetProject } from "./effective-street-model";
export { redesignStreetSectionStyle, lockStreetScenarioSection, lockStreetScenarioProperty, suppressStreetScenarioInventory } from "./host/street-scenario-command";

export { StreetSourceRefreshDiff, generateStreetSourceRefreshDiff, acquireStreetSourceRefresh } from "./source/street-source-refresh";

export { prepareStreetSourceMerge, resolveStreetSourceMerge } from "./source/street-source-merge";
export { acceptStreetSourceMerge } from "./host/street-source-merge-command";
