import { GeneratedItemHistory } from "./domain/generated-item-history";
import { StreetSectionLayout } from "./domain/street-section-layout"
import { BaseNode, generateId, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { BOLLARD_LIGHT_DIMENSIONS } from './bollard-light-geometry'
import {
  STANDARD_LAMP_HEIGHT_M,
  STANDARD_LAMP_HEIGHT_MAX_M,
  STANDARD_LAMP_HEIGHT_MIN_M,
} from './lamp-constants'
import { ROAD_SIGN_IDS } from './road-sign-config'
import { DEFAULT_ROAD_STYLE_ID, DEFAULT_ROAD_STYLE_PRESETS } from './road-style-presets'
import {
  STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M,
  STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M,
} from './utility-pole-geometry'
import { WALL_ARM_LIGHT_DIMENSIONS } from './wall-arm-light-geometry'

/** A reverse reference from a placeable asset back to its road-edge anchor. */
export const RoadAttachmentAlignment = z.enum(['free', 'carriageway', 'gutter', 'curb', 'junction'])
export type RoadAttachmentAlignment = z.infer<typeof RoadAttachmentAlignment>

export const RoadAttachmentRef = z.object({
  networkNodeId: z.string().min(1),
  attachmentId: z.string().min(1),
  /** The authored road side lets two-sided assets mirror their curb hardware. */
  side: z.enum(['left', 'right']).optional(),
})
export type RoadAttachmentRef = z.infer<typeof RoadAttachmentRef>

/** A catalog-driven roadside sign with a reusable plate, graphic, and post. */
export const RoadSignNode = BaseNode.extend({
  id: objectId('road-sign'),
  type: nodeType('streetscape:road-sign'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  signId: z.enum(ROAD_SIGN_IDS).default('stop'),
  postHeight: z.number().min(1.2).max(4.5).default(2.1),
  scale: z.number().min(0.5).max(2.5).default(1),
  mounting: z.enum(['single-post', 'double-post']).default('single-post'),
  text: z.string().max(32).default(''),
  postColor: z.string().default('#687177'),
  backColor: z.string().default('#747d83'),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type RoadSignNode = z.infer<typeof RoadSignNode>

export type RoadSignNodeInput = z.input<typeof RoadSignNode>

/**
 * Preview nodes are rendered locally and never inserted into the scene store.
 * Giving the preview a stable, clearly non-persistent ID keeps it out of the
 * same identity space as placed signs.
 */
export const ROAD_SIGN_PREVIEW_ID = 'road-sign_preview'

/**
 * Create a placed road sign with an ID that is fresh against the current
 * scene. The core schema generates IDs by default, but it cannot know which
 * IDs are already in the host scene; this boundary can.
 */
export function createRoadSignNode(
  input: RoadSignNodeInput,
  occupiedIds: Iterable<string> = [],
): RoadSignNode {
  const occupied = new Set(occupiedIds)
  const { id: _ignoredId, ...draft } = input

  let id = generateId('road-sign')
  while (occupied.has(id)) id = generateId('road-sign')

  return RoadSignNode.parse({ ...draft, id })
}

/** Create the local-only node used by the road-sign placement preview. */
export function createRoadSignPreviewNode(input: RoadSignNodeInput): RoadSignNode {
  const { id: _ignoredId, ...draft } = input
  return RoadSignNode.parse({ ...draft, id: ROAD_SIGN_PREVIEW_ID })
}

/** A swept-arm roadway pole with a low-profile full-cutoff LED luminaire. */
export const StreetLightNode = BaseNode.extend({
  id: objectId('street-light'),
  type: nodeType('streetscape:street-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.3).max(3).default(1.2),
  poleColor: z.string().default('#48535b'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd9a3'),
  intensity: z.number().min(0).max(5000).default(1200),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type StreetLightNode = z.infer<typeof StreetLightNode>

/** A pedestrian-scale pole with a centered, downward-facing post-top luminaire. */
export const PedestrianPostLightNode = BaseNode.extend({
  id: objectId('pedestrian-post-light'),
  type: nodeType('streetscape:pedestrian-post-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  poleColor: z.string().default('#30343b'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd9a3'),
  intensity: z.number().min(0).max(3000).default(650),
})

export type PedestrianPostLightNode = z.infer<typeof PedestrianPostLightNode>

/** A heritage pole with a curved Bishop's Crook arm and pendant teardrop lamp. */
export const HeritageCrookLightNode = BaseNode.extend({
  id: objectId('heritage-crook-light'),
  type: nodeType('streetscape:heritage-crook-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armReach: z.number().min(0.5).max(1.5).default(0.9),
  poleColor: z.string().default('#24272b'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd5a0'),
  intensity: z.number().min(0).max(3500).default(750),
})

export type HeritageCrookLightNode = z.infer<typeof HeritageCrookLightNode>

/** A classic swept mast-arm roadway pole with a broad cobra-head luminaire. */
export const CobraHeadLightNode = BaseNode.extend({
  id: objectId('cobra-head-light'),
  type: nodeType('streetscape:cobra-head-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.5).max(3).default(1.25),
  poleColor: z.string().default('#363b40'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1400),
})

export type CobraHeadLightNode = z.infer<typeof CobraHeadLightNode>

/** A median pole carrying opposing full-cutoff LED roadway fixtures. */
export const TwinArmMedianLightNode = BaseNode.extend({
  id: objectId('twin-arm-median-light'),
  type: nodeType('streetscape:twin-arm-median-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.5).max(3).default(1.35),
  poleColor: z.string().default('#363b40'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1400),
})

export type TwinArmMedianLightNode = z.infer<typeof TwinArmMedianLightNode>

/** A junction or parking-area pole with three or four radial roadway heads. */
export const MultiHeadAreaLightNode = BaseNode.extend({
  id: objectId('multi-head-area-light'),
  type: nodeType('streetscape:multi-head-area-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.5).max(3).default(1.2),
  headCount: z.union([z.literal(3), z.literal(4)]).default(4),
  poleColor: z.string().default('#363b40'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1200),
})

export type MultiHeadAreaLightNode = z.infer<typeof MultiHeadAreaLightNode>

/** A fitted pipe-truss roadway pole carrying a full-cutoff LED luminaire. */
export const TrussRoadwayLightNode = BaseNode.extend({
  id: objectId('truss-roadway-light'),
  type: nodeType('streetscape:truss-roadway-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.8).max(3.5).default(2),
  braceDepth: z.number().min(0.35).max(1.2).default(0.75),
  poleColor: z.string().default('#596166'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1400),
})

export type TrussRoadwayLightNode = z.infer<typeof TrussRoadwayLightNode>

/** A tapered high mast with a lowering ring and six outward-aimed LED luminaires. */
export const HighMastCrownLightNode = BaseNode.extend({
  id: objectId('high-mast-crown-light'),
  type: nodeType('streetscape:high-mast-crown-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z.number().min(STANDARD_LAMP_HEIGHT_MIN_M).max(STANDARD_LAMP_HEIGHT_MAX_M).default(18),
  armLength: z.number().min(0.9).max(3).default(1.8),
  visualStyle: z.string().default('high-mast'),
  poleColor: z.string().default('#667178'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#f4f0dc'),
  intensity: z.number().min(0).max(10000).default(7200),
})

export type HighMastCrownLightNode = z.infer<typeof HighMastCrownLightNode>

/** Square parking-area pole carrying one low-profile LED luminaire. */
export const ShoeboxAreaLightNode = BaseNode.extend({
  id: objectId('shoebox-area-light'),
  type: nodeType('streetscape:shoebox-area-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.35).max(2.5).default(0.65),
  visualStyle: z.string().default('shoebox'),
  poleColor: z.string().default('#4a535a'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(10000).default(2200),
})

export type ShoeboxAreaLightNode = z.infer<typeof ShoeboxAreaLightNode>

/** Projector/floodlight pole with a tilted rectangular floodlight head. */
export const FloodlightPoleNode = BaseNode.extend({
  id: objectId('floodlight-pole'),
  type: nodeType('streetscape:floodlight-pole'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.4).max(2.5).default(0.9),
  visualStyle: z.string().default('floodlight'),
  poleColor: z.string().default('#343a40'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#fff0c2'),
  intensity: z.number().min(0).max(12000).default(2800),
})

export type FloodlightPoleNode = z.infer<typeof FloodlightPoleNode>

/** Traditional post-top lantern with a pitched cap and transparent panes. */
export const TraditionalPostTopLanternNode = BaseNode.extend({
  id: objectId('traditional-post-top-lantern'),
  type: nodeType('streetscape:traditional-post-top-lantern'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.4).max(1.4).default(0.7),
  visualStyle: z.string().default('lantern'),
  poleColor: z.string().default('#25282d'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd9a3'),
  intensity: z.number().min(0).max(3500).default(650),
})

export type TraditionalPostTopLanternNode = z.infer<typeof TraditionalPostTopLanternNode>

/** Prismatic acorn post-top lamp with a decorative civic pole. */
export const GlobePostTopLightNode = BaseNode.extend({
  id: objectId('globe-post-top-light'),
  type: nodeType('streetscape:globe-post-top-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.3).max(1).default(0.55),
  visualStyle: z.string().default('globe'),
  poleColor: z.string().default('#30343b'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffe0ad'),
  intensity: z.number().min(0).max(3000).default(520),
})

export type GlobePostTopLightNode = z.infer<typeof GlobePostTopLightNode>

/** Decorative three-light candelabra with a raised centre and scroll arms. */
export const DecorativeCandelabraLightNode = BaseNode.extend({
  id: objectId('decorative-candelabra-light'),
  type: nodeType('streetscape:decorative-candelabra-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.5).max(2).default(1.15),
  visualStyle: z.string().default('candelabra'),
  poleColor: z.string().default('#25282d'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd5a0'),
  intensity: z.number().min(0).max(6000).default(1100),
})

export type DecorativeCandelabraLightNode = z.infer<typeof DecorativeCandelabraLightNode>

/** Professional twin-head low-voltage light for paths and planting beds. */
export const PathGardenLightNode = BaseNode.extend({
  id: objectId('path-garden-light'),
  type: nodeType('streetscape:path-garden-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z.number().min(0.55).max(STANDARD_LAMP_HEIGHT_MAX_M).default(0.78),
  /** The shared reach parameter controls the opposed head span. */
  armLength: z.number().min(0.2).max(0.8).default(0.46),
  visualStyle: z.string().default('path'),
  poleColor: z.string().default('#343b37'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffe0b2'),
  intensity: z.number().min(0).max(1200).default(240),
})

export type PathGardenLightNode = z.infer<typeof PathGardenLightNode>

/** Low bollard light for pedestrian paths, plazas, and planting beds. */
export const BollardLightNode = BaseNode.extend({
  id: objectId('bollard-light'),
  type: nodeType('streetscape:bollard-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(BOLLARD_LIGHT_DIMENSIONS.minHeight)
    // Values above the current product range remain readable so saved scenes
    // from the former shared six-metre catalog contract can be migrated by
    // resolveBollardLightLayout. Placement and handles use the tighter range.
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(BOLLARD_LIGHT_DIMENSIONS.defaultHeight),
  armLength: z.number().min(0.15).max(0.5).default(0.25),
  visualStyle: z.string().default('bollard'),
  poleColor: z.string().default('#30363a'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffe2b8'),
  intensity: z.number().min(0).max(1000).default(180),
})

export type BollardLightNode = z.infer<typeof BollardLightNode>

/** Twin-optic roadway luminaire suspended from a catenary between tapered poles. */
export const CatenaryStreetLightNode = BaseNode.extend({
  id: objectId('catenary-street-light'),
  type: nodeType('streetscape:catenary-street-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(2).max(12).default(6),
  visualStyle: z.string().default('catenary'),
  poleColor: z.string().default('#363b40'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1300),
})

export type CatenaryStreetLightNode = z.infer<typeof CatenaryStreetLightNode>

/** Architectural wall bracket with an integrated low-profile LED roadway head. */
export const WallArmLightNode = BaseNode.extend({
  id: objectId('wall-arm-light'),
  type: nodeType('streetscape:wall-arm-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** Pascal wall-host metadata. Position is wall-local; `height` owns elevation. */
  wallId: z.string().optional(),
  wallT: z.number().min(0).max(1).optional(),
  side: z.enum(['front', 'back']).optional(),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.5).max(3).default(WALL_ARM_LIGHT_DIMENSIONS.defaultArmLength),
  visualStyle: z.string().default('wall-arm'),
  poleColor: z.string().default('#363b40'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1100),
})

export type WallArmLightNode = z.infer<typeof WallArmLightNode>

/** Full-cutoff architectural LED wall pack mounted directly to a facade. */
export const WallPackLightNode = BaseNode.extend({
  id: objectId('wall-pack-light'),
  type: nodeType('streetscape:wall-pack-light'),
  /** Pascal wall-host metadata. Position is the exact wall-local cursor anchor. */
  wallId: z.string().optional(),
  wallT: z.number().min(0).max(1).optional(),
  side: z.enum(['front', 'back']).optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z.number().min(STANDARD_LAMP_HEIGHT_MIN_M).max(STANDARD_LAMP_HEIGHT_MAX_M).default(2.7),
  /** Housing projection from the wall; legacy values are clamped by the model. */
  armLength: z.number().min(0.2).max(0.8).default(0.3),
  visualStyle: z.string().default('wall-pack'),
  poleColor: z.string().default('#443a32'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#fff0c2'),
  intensity: z.number().min(0).max(3000).default(700),
})

export type WallPackLightNode = z.infer<typeof WallPackLightNode>

/** Sealed continuous-line LED luminaire for tunnel and underpass ceilings. */
export const TunnelLuminaireNode = BaseNode.extend({
  id: objectId('tunnel-luminaire'),
  type: nodeType('streetscape:tunnel-luminaire'),
  /** Pascal host contract: this fixture mounts to the underside of a ceiling. */
  attachTo: z.literal('ceiling').default('ceiling'),
  /** The selected ceiling host; null keeps legacy level-hosted scenes readable. */
  ceilingId: z.string().nullable().default(null),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.8).max(4).default(2.2),
  visualStyle: z.string().default('tunnel'),
  poleColor: z.string().default('#7a8388'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#e9f2ff'),
  intensity: z.number().min(0).max(7000).default(1800),
})

export type TunnelLuminaireNode = z.infer<typeof TunnelLuminaireNode>

/** Recessed canopy/soffit fixture; armLength stores the square face width. */
export const CanopySoffitLightNode = BaseNode.extend({
  id: objectId('canopy-soffit-light'),
  type: nodeType('streetscape:canopy-soffit-light'),
  attachTo: z.literal('ceiling').default('ceiling'),
  ceilingId: z.string().nullable().default(null),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  // Keep the legacy upper bound so scenes authored with the former span-based
  // control still parse; the layout resolver scales those values on render.
  armLength: z.number().min(0.34).max(2.5).default(0.42),
  visualStyle: z.string().default('canopy'),
  poleColor: z.string().default('#d5d9d8'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#fff3d2'),
  intensity: z.number().min(0).max(5000).default(1200),
})

export type CanopySoffitLightNode = z.infer<typeof CanopySoffitLightNode>

/** Single-sided solar street light with integrated PV, battery and roadway optics. */
export const SolarStreetLightNode = BaseNode.extend({
  id: objectId('solar-street-light'),
  type: nodeType('streetscape:solar-street-light'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z
    .number()
    .min(STANDARD_LAMP_HEIGHT_MIN_M)
    .max(STANDARD_LAMP_HEIGHT_MAX_M)
    .default(STANDARD_LAMP_HEIGHT_M),
  armLength: z.number().min(0.5).max(3).default(1.3),
  visualStyle: z.string().default('solar'),
  poleColor: z.string().default('#3c4348'),
  lightOn: z.boolean().default(false),
  lightColor: z.string().default('#ffd39a'),
  intensity: z.number().min(0).max(5000).default(1000),
})

export type SolarStreetLightNode = z.infer<typeof SolarStreetLightNode>

export const UtilityPoleAssembly = z.enum(['tangent', 'small-angle', 'junction', 'dead-end'])
export type UtilityPoleAssembly = z.infer<typeof UtilityPoleAssembly>

/** A wood, three-phase distribution pole with a lower neutral and optional transformer. */
export const UtilityPoleNode = BaseNode.extend({
  id: objectId('utility-pole'),
  type: nodeType('streetscape:utility-pole'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z.number().min(7.62).max(15.85).default(STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M),
  crossarmLength: z
    .number()
    .min(STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M)
    .max(3.66)
    .default(STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M),
  assembly: UtilityPoleAssembly.default('tangent'),
  woodColor: z.string().default('#765033'),
  transformerMounted: z.boolean().default(true),
  transformerColor: z.string().default('#66716d'),
})

export type UtilityPoleNode = z.infer<typeof UtilityPoleNode>

/** An automatically managed three-primary-plus-neutral span between two utility poles. */
export const UtilityWireSpanNode = BaseNode.extend({
  id: objectId('utility-wire-span'),
  type: nodeType('streetscape:utility-wire-span'),
  fromPoleId: z.string().min(1),
  toPoleId: z.string().min(1),
  conductorColor: z.string().default('#25292b'),
  sagRatio: z.number().min(0.01).max(0.08).default(0.035),
})

export type UtilityWireSpanNode = z.infer<typeof UtilityWireSpanNode>

/** A modular vehicle signal with field-realistic head layouts and support hardware. */
export const TrafficSignalNode = BaseNode.extend({
  id: objectId('traffic-signal'),
  type: nodeType('streetscape:traffic-signal'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, Math.PI, 0]),
  mount: z.enum(['post', 'mast-arm', 'span-wire']).default('mast-arm'),
  headLayout: z
    .enum(['three-section', 'three-section-turn', 'four-section-turn', 'five-section-cluster'])
    .default('three-section'),
  signalState: z
    .enum(['dark', 'red', 'yellow', 'flashing-yellow', 'green', 'green-arrow'])
    .default('red'),
  headCount: z.enum(['one', 'two']).default('two'),
  visorStyle: z.enum(['cap', 'tunnel', 'none']).default('tunnel'),
  supportHeight: z.number().min(2.4).max(8).default(5.8),
  armReach: z.number().min(1).max(12).default(5.8),
  backplate: z.boolean().default(true),
  reflectiveBorder: z.boolean().default(true),
  cabinet: z.boolean().default(true),
  streetNameSign: z.boolean().default(true),
  poleColor: z.string().default('#596268'),
  housingColor: z.string().default('#23282a'),
  redColor: z.string().default('#f13b32'),
  yellowColor: z.string().default('#ffc338'),
  greenColor: z.string().default('#35c76d'),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type TrafficSignalNode = z.infer<typeof TrafficSignalNode>

/** A shallow road-drainage inlet with interchangeable grate patterns. */
export const DrainageInletNode = BaseNode.extend({
  id: objectId('drainage-inlet'),
  type: nodeType('streetscape:drainage-inlet'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  inletType: z
    .enum(['grate', 'curb-opening', 'combination', 'sweeper-combination'])
    .default('combination'),
  gratePattern: z
    .enum(['bicycle-safe', 'reticuline', 'parallel', 'curved-vane'])
    .default('bicycle-safe'),
  width: z.number().min(0.3).max(1.5).default(0.62),
  length: z.number().min(0.5).max(2.5).default(1.05),
  curbHeight: z.number().min(0.08).max(0.3).default(0.15),
  metalColor: z.string().default('#41484a'),
  wetness: z.number().min(0).max(1).default(0),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type DrainageInletNode = z.infer<typeof DrainageInletNode>

/** A flush access cover with configurable tread patterns and finish. */
export const ManholeCoverNode = BaseNode.extend({
  id: objectId('manhole-cover'),
  type: nodeType('streetscape:manhole-cover'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  diameter: z.number().min(0.45).max(1.2).default(0.7),
  treadPattern: z.enum(['radial', 'grid', 'rings']).default('radial'),
  metalColor: z.string().default('#4a4d4b'),
  wetness: z.number().min(0).max(1).default(0),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type ManholeCoverNode = z.infer<typeof ManholeCoverNode>

/** A configurable above-ground fire hydrant with dry- and wet-barrel silhouettes. */
export const FireHydrantNode = BaseNode.extend({
  id: objectId('fire-hydrant'),
  type: nodeType('streetscape:fire-hydrant'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z.number().min(0.65).max(1.8).default(1.25),
  barrelType: z.enum(['dry-barrel', 'wet-barrel']).default('dry-barrel'),
  outletLayout: z
    .enum(['two-hose-one-pumper', 'two-hose', 'one-hose'])
    .default('two-hose-one-pumper'),
  bodyColor: z.string().default('#c73c32'),
  bonnetColor: z.string().default('#b9302b'),
  capColor: z.string().default('#8f2421'),
  weathering: z.number().min(0).max(1).default(0.08),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type FireHydrantNode = z.infer<typeof FireHydrantNode>

/** A standalone traffic-control bollard for edges, crossings, and protected corners. */
export const TrafficBollardNode = BaseNode.extend({
  id: objectId('traffic-bollard'),
  type: nodeType('streetscape:traffic-bollard'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  style: z.enum(['steel', 'flexible', 'reflective']).default('steel'),
  height: z.number().min(0.45).max(1.5).default(0.9),
  radius: z.number().min(0.06).max(0.3).default(0.11),
  bodyColor: z.string().default('#3c4548'),
  reflectiveColor: z.string().default('#f4e9b0'),
  baseColor: z.string().default('#737a78'),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type TrafficBollardNode = z.infer<typeof TrafficBollardNode>

/** A standalone roadside barrier segment with common scene-layout treatments. */
export const RoadBarrierNode = BaseNode.extend({
  id: objectId('road-barrier'),
  type: nodeType('streetscape:road-barrier'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  barrierType: z.enum(['jersey', 'guardrail', 'water-filled', 'crowd-control']).default('jersey'),
  length: z.number().min(0.5).max(8).default(2),
  height: z.number().min(0.25).max(1.8).default(0.8),
  width: z.number().min(0.12).max(1.2).default(0.32),
  bodyColor: z.string().default('#c84b36'),
  accentColor: z.string().default('#ffffff'),
  metalColor: z.string().default('#5c6668'),
  roadAttachment: RoadAttachmentRef.optional(),
})

export type RoadBarrierNode = z.infer<typeof RoadBarrierNode>

/** Shared shape for small residential frontage and road-edge assets. */
function residentialRoadAssetSchema<Prefix extends string, Type extends string>(
  prefix: Prefix,
  type: Type,
  defaults: {
    width: number
    length: number
    height: number
    depth: number
    bodyColor: string
    accentColor: string
  },
) {
  return BaseNode.extend({
    id: objectId(prefix),
    type: nodeType(type),
    position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
    rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
    width: z.number().min(0.1).max(20).default(defaults.width),
    length: z.number().min(0.1).max(20).default(defaults.length),
    height: z.number().min(0.05).max(4).default(defaults.height),
    depth: z.number().min(0.05).max(4).default(defaults.depth),
    bodyColor: z.string().default(defaults.bodyColor),
    accentColor: z.string().default(defaults.accentColor),
    roadAttachment: RoadAttachmentRef.optional(),
  })
}

/** A paved residential driveway / parking apron. */
export const DrivewayNode = residentialRoadAssetSchema('driveway', 'streetscape:driveway', {
  width: 3.2,
  length: 5.5,
  height: 0.12,
  depth: 0.12,
  bodyColor: '#777b78',
  accentColor: '#b7b2a6',
}).extend({
  drivewayShape: z.enum(['straight', 'curved-left', 'curved-right']).default('straight'),
  /** Lateral displacement between the road end and the far end of a curved driveway. */
  curveAmount: z.number().min(0.25).max(20).default(2.5),
})
export type DrivewayNode = z.infer<typeof DrivewayNode>

/** A curbside post mailbox. */
export const MailboxNode = residentialRoadAssetSchema('mailbox', 'streetscape:mailbox', {
  width: 0.4,
  length: 0.5,
  height: 1.65,
  depth: 0.12,
  bodyColor: '#17191a',
  accentColor: '#e23a31',
}).extend({
  /** Front-door animation position: 0 is closed and 1 is folded fully open. */
  operationState: z.number().min(0).max(1).default(0),
})
export type MailboxNode = z.infer<typeof MailboxNode>

/** A larger curbside parcel-delivery box. */
export const ParcelBoxNode = residentialRoadAssetSchema('parcel-box', 'streetscape:parcel-box', {
  width: 0.72,
  length: 0.58,
  height: 1.28,
  depth: 0.12,
  bodyColor: '#242829',
  accentColor: '#777d7b',
}).extend({
  /** Shared top-lid and front-access-door animation position. */
  operationState: z.number().min(0).max(1).default(0),
})
export type ParcelBoxNode = z.infer<typeof ParcelBoxNode>

/** A reinforced four-caster commercial refuse container. */
export const TrashBinNode = residentialRoadAssetSchema('trash-bin', 'streetscape:trash-bin', {
  width: 1.35,
  length: 0.86,
  height: 1.2,
  depth: 0.06,
  bodyColor: '#2f713b',
  accentColor: '#367f43',
})
export type TrashBinNode = z.infer<typeof TrashBinNode>

/** A wheeled household recycling bin. */
export const RecyclingBinNode = residentialRoadAssetSchema(
  'recycling-bin',
  'streetscape:recycling-bin',
  {
    width: 0.58,
    length: 0.66,
    height: 1.05,
    depth: 0.06,
    bodyColor: '#087345',
    accentColor: '#0a6b42',
  },
)
export type RecyclingBinNode = z.infer<typeof RecyclingBinNode>

/** A framed, double-leaf timber driveway gate with dark metal hardware. */
export const ResidentialGateNode = residentialRoadAssetSchema(
  'residential-gate',
  'streetscape:residential-gate',
  {
    width: 3.6,
    length: 0.16,
    height: 1.65,
    depth: 0.1,
    bodyColor: '#8a4f2b',
    accentColor: '#202326',
  },
).extend({
  /** Shared open position for the two swing leaves. */
  operationState: z.number().min(0).max(1).default(0),
})
export type ResidentialGateNode = z.infer<typeof ResidentialGateNode>

/** A narrow modular rubber speed hump spanning the carriageway. */
export const SpeedHumpNode = residentialRoadAssetSchema('speed-hump', 'streetscape:speed-hump', {
  width: 5.8,
  length: 0.5,
  height: 0.07,
  depth: 0.02,
  bodyColor: '#25282b',
  accentColor: '#f2b632',
})
export type SpeedHumpNode = z.infer<typeof SpeedHumpNode>

/** A topological point shared by one or more road centerline edges. */
const RoadGraphNodeSchema = z.object({
  id: z.string().min(1),
  osmTopologyOrigin: z.discriminatedUnion('kind', [
    z.object({kind:z.literal('source'), nodeId:z.number().int().positive()}),
    z.object({kind:z.literal('derived'), reason:z.enum(['scope-boundary','simple-graph-adapter']), wayIds:z.array(z.number().int().positive())}),
  ]).optional(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  level: z.number().int().default(0),
  elevationMode: z.enum(['ground', 'bridge']).default('ground'),
  curveRadius: z.number().min(0.1).max(1000).optional(),
  tangentLength: z.number().min(0).max(1000).optional(),
  terminal: z.boolean().default(false),
})

export const RoadGraphNode = z.preprocess(
  (value) =>
    value &&
    typeof value === 'object' &&
    (value as { elevationMode?: unknown }).elevationMode === 'tunnel'
      ? { ...value, elevationMode: 'ground' }
      : value,
  RoadGraphNodeSchema,
)

export type RoadGraphNode = z.infer<typeof RoadGraphNode>

/** Optional authored widths for one side of a road, ordered from carriageway outward. */
export const RoadSideComponents = z.object({
  parkingLaneWidth: z.number().min(0).max(4).default(0),
  busLaneWidth: z.number().min(0).max(4).optional(),
  bikeLaneWidth: z.number().min(0).max(3).default(0),
  gutterWidth: z.number().min(0).max(2).default(0),
  curbWidth: z.number().min(0).max(1).default(0),
  vergeWidth: z.number().min(0).max(8).default(0),
  sidewalkWidth: z.number().min(0).max(6).default(0),
})

export type RoadSideComponents = z.infer<typeof RoadSideComponents>

/** A reusable cross-section and visual treatment shared by road edges. */
export const RoadStylePreset = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  laneCount: z.number().int().min(1).max(12).default(2),
  laneWidth: z.number().min(2.4).max(5).default(3.25),
  /** Ordered physical lane widths. Falls back to laneWidth for legacy styles. */
  laneWidths: z.array(z.number().min(2.4).max(5)).max(12).optional(),
  /** Ordered OSM traffic direction for each physical lane. */
  laneDirections: z.array(z.enum(['forward', 'backward', 'both'])).max(12).optional(),
  /** Imported lane use without forcing unsupported uses into roadside bands. */
  laneUses: z.array(z.enum(['general', 'bus', 'bicycle', 'parking', 'turning'])).max(12).optional(),
  /** Records whether imported dimensions came from OSM or from an estimate. */
  dimensionSources: z.record(
    z.string(),
    z.object({
      kind: z.enum(['mapped', 'derived', 'default']),
      tag: z.string().optional(),
    }),
  ).optional(),
  shoulderWidth: z.number().min(0).max(4).default(0.5),
  sidewalkWidth: z.number().min(0).max(6).default(0.5),
  medianWidth: z.number().min(0).max(12).default(0),
  /** Pavement depth below the authored driving-surface elevation. */
  surfaceThickness: z.number().min(0.02).max(1).default(0.14),
  surfaceColor: z.string().default('#3f4246'),
  /** Optional so existing authored styles retain their appearance. */
  surfaceMaterial: z.enum(['asphalt', 'concrete', 'paving-stones']).optional(),
  surfaceSource: z
    .object({
      kind: z.enum(['mapped', 'default']),
      tag: z.string().optional(),
    })
    .optional(),
  markingColor: z.string().default('#f3f1df'),
  markings: z.boolean().default(true),
  leftSide: RoadSideComponents.optional(),
  rightSide: RoadSideComponents.optional(),
})

export type RoadStylePreset = z.infer<typeof RoadStylePreset>

/** An interior point of the independently authored road vertical profile. */
export const RoadVerticalProfilePoint = z.object({
  id: z.string().min(1),
  station: z.number().min(0),
  elevation: z.number(),
  curveLength: z.number().min(0).max(1000).default(0),
  /** Optional link used by the direct 3D alignment-point elevation grip. */
  alignmentPointIndex: z.number().int().min(0).optional(),
})

export type RoadVerticalProfilePoint = z.infer<typeof RoadVerticalProfilePoint>

/** One directed centerline edge. Direction controls traffic, not graph traversal. */
const RoadGraphEdgeSchema = z.object({
  /** Derived projection of the authoritative semantic section layout. */
  sectionLayout: StreetSectionLayout.optional(),
  id: z.string().min(1),
  startNodeId: z.string().min(1),
  endNodeId: z.string().min(1),
  alignment: z.array(z.tuple([z.number(), z.number(), z.number()])).default([]),
  profileMode: z.enum(['legacy', 'designed']).default('legacy'),
  verticalProfile: z.array(RoadVerticalProfilePoint).default([]),
  styleId: z.string().min(1).default('local-street'),
  direction: z.enum(['both', 'forward', 'reverse']).default('both'),
  roadClass: z
    .enum(['alley', 'local', 'collector', 'arterial', 'highway', 'service'])
    .default('local'),
  joinMode: z.enum(['auto', 'suppress']).default('auto'),
	stackLevel: z.number().int().min(0).default(0),
	/** Raw OSM vertical facts. Layer is ordering metadata, never metres. */
	osmVertical: z.object({
		layer: z.number().int().optional(),
		ele: z.number().optional(),
		bridge: z.boolean().optional(),
		tunnel: z.boolean().optional(),
	}).optional(),
  /** How the imported vertical profile was established. */
  verticalSource: z.object({
    kind: z.enum(['mapped', 'terrain', 'estimated']),
    clearanceMeters: z.number().positive().optional(),
  }).optional(),
  overlapGroup: z.string().min(1).optional(),
  parentEdgeId: z.string().optional(),
  /** Original OSM facts, retained independently of editable road styles. */
  osmSource: z
    .object({
      wayId: z.number().int(),
      nodeIds: z.array(z.number().int()).optional(),
      /** Fractional indices in nodeIds; geometry simplification does not erase source coverage. */
      span: z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), coverage: z.enum(["exact", "conservative"]) }).refine(value => value.end >= value.start).optional(),
      tags: z.record(z.string(), z.string()),
    })
    .optional(),
  /** Mapped lane indications at original way endpoints, in driver left-to-right order. */
  turnLanes: z.object({ start: z.string().optional(), end: z.string().optional() }).optional(),
})

export const RoadGraphEdge = z.preprocess(
  (value) =>
    value &&
    typeof value === 'object' &&
    typeof (value as { stackLevel?: unknown }).stackLevel === 'number' &&
    (value as { stackLevel: number }).stackLevel < 0
      ? { ...value, stackLevel: 0 }
      : value,
  RoadGraphEdgeSchema,
)

export type RoadGraphEdge = z.infer<typeof RoadGraphEdge>

export const RoadsideDecoration = z.object({
  legacyKey: z.string().min(1).optional(),
  id: z.string().min(1),
  edgeId: z.string().min(1),
  kind: z.enum(['lamp', 'sign']),
  side: z.enum(['left', 'right']),
  station: z.number().min(0),
  lateralOffset: z.number(),
  ruleId: z.string().min(1),
  /** Direction the visible sign face points along the directed edge. */
  facing: z.enum(['forward', 'reverse']).optional(),
  /** Generated junction fixtures can anchor directly to a rendered curb return. */
  worldPosition: z.tuple([z.number(), z.number(), z.number()]).optional(),
  worldRotationY: z.number().optional(),
})

export type RoadsideDecoration = z.infer<typeof RoadsideDecoration>

const RoadOpeningProfileSample = z.object({
  /** Distance out from the carriageway edge through the roadside bands. */
  outwardOffset: z.number().min(0).max(20),
  /** First driveway edge, measured along the directed road from the attachment station. */
  startOffset: z.number().min(-20).max(20),
  /** Second driveway edge, measured along the directed road from the attachment station. */
  endOffset: z.number().min(-20).max(20),
})

const RoadsideDecorations = z.preprocess(
  (value) => {
    if (!(value && typeof value === 'object') || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).filter(([, decoration]) => {
        if (!(decoration && typeof decoration === 'object')) return true
        const kind = (decoration as { kind?: unknown }).kind
        return kind !== 'tree' && kind !== 'guardrail'
      }),
    )
  },
  z.record(z.string(), RoadsideDecoration),
)

/**
 * A scene asset anchored by distance along a directed road edge. Stations are
 * measured in metres from the edge's start node so the anchor can be remapped
 * without moving the asset when topology splits that edge.
 */
export const RoadEdgeAttachment = z.object({
  id: z.string().min(1),
  edgeId: z.string().min(1),
  assetNodeId: z.string().min(1),
  kind: z.enum(['sign', 'lamp', 'asset']).default('asset'),
  station: z.number().min(0).default(0),
  /** Signed distance beyond the projected station, primarily for adjusted endpoint items. */
  longitudinalOffset: z.number().optional(),
  lateralOffset: z.number().default(0),
  verticalOffset: z.number().default(0),
  /** Width of a real opening cut through roadside bands for this attachment. */
  roadOpeningWidth: z.number().min(0.1).max(20).optional(),
  /** Signed road-chainage shift from the asset anchor to the opening mouth. */
  roadOpeningOffset: z.number().min(-20).max(20).optional(),
  /** Sampled driveway edges used to cut a shape-following opening through roadside bands. */
  roadOpeningProfile: z.array(RoadOpeningProfileSample).min(2).max(65).optional(),
  /** Yaw relative to the directed road tangent. */
  headingOffset: z.number().optional(),
  alignment: RoadAttachmentAlignment.default('free'),
  side: z.enum(['left', 'right']).optional(),
  /** Generated anchors may reflow; adjusted anchors preserve user-authored offsets. */
  placementMode: z.enum(['generated', 'adjusted']).optional(),
  /** Stable identity used to reconcile an automatically generated asset. */
  generatedKey: z.string().min(1).optional(),
  /** Junction-originated signal assets are kept grouped for idempotent actions. */
  junctionId: z.string().min(1).optional(),
})

export type RoadEdgeAttachment = z.infer<typeof RoadEdgeAttachment>

/** A persistent, editable description of a generated road junction. */
export const RoadJunction = z.object({
  nodeId: z.string().min(1),
  kind: z.enum(['tee', 'y', 'four-way-plus', 'four-way-x', 'multi-leg']),
  treatment: z.enum(['auto', 'stop', 'yield', 'signal', 'roundabout']).default('auto'),
  primaryMode: z.enum(['auto', 'manual']).default('auto'),
  primaryEdgeIds: z.array(z.string().min(1)).max(2).default([]),
  approachControls: z
    .record(z.string(), z.enum(['auto', 'none', 'stop', 'yield', 'signal']))
    .default({}),
  cornerRadii: z.record(z.string(), z.number().min(0.5).max(100)).default({}),
  manualBoundaryEnabled: z.boolean().default(false),
  manualBoundaryPoints: z
    .array(z.tuple([z.number().min(-1000).max(1000), z.number().min(-1000).max(1000)]))
    .default([]),
  solverStatus: z.enum(['auto', 'warning', 'manual']).default('auto'),
})

export type RoadJunction = z.infer<typeof RoadJunction>

/**
 * One connected road component lives in each scene node. This keeps junction
 * regeneration deterministic while making disconnected road systems
 * independently selectable in the editor.
 */
export const RoadNetworkNode = BaseNode.extend({
  id: objectId('road-network'),
  type: nodeType('streetscape:road-network'),
  graphNodes: z.record(z.string(), RoadGraphNode).default({}),
  edges: z.record(z.string(), RoadGraphEdge).default({}),
  roadsideDecorations: RoadsideDecorations.default({}),
  roadsideDecorationSpacing: z.number().min(10).max(100).default(30),
  roadsideLampsBothSides: z.boolean().default(false),
  showRoadsideDecorations: z.boolean().default(false),
  /** Per-road visibility for generated roadside decorations/assets. */
  roadsideItemVisibility: z.record(z.string(), z.boolean()).default({}),
  /** Individual generated lamp/sign IDs removed by the user. */
  roadsideDecorationSuppressed: z.record(z.string(), z.boolean()).default({}),
  /** Whether this road should keep its generated roadside inventory reconciled. */
  roadsideAutoFillEnabled: z.boolean().default(false),
  /** Generated scene-asset keys explicitly removed by the user. */
  roadsideItemSuppressed: z.record(z.string(), z.boolean()).default({}),
  generatedItemHistory: GeneratedItemHistory.default({}),
  attachments: z.record(z.string(), RoadEdgeAttachment).default({}),
  junctions: z.record(z.string(), RoadJunction).default({}),
  /** Supplemental OSM geometry in network-local coordinates, retained for surface reconstruction. */
  osmMappedSurfaces: z.array(z.object({
    id: z.number().int(),
    kind: z.enum(['road-area', 'sidewalk', 'cycleway', 'pedestrian-area', 'kerb', 'crossing']),
	partIndex: z.number().int().min(0).optional(),
    sourceType: z.enum(['way', 'relation']).default('way'),
    sourceNodeIds: z.array(z.number().int()).default([]),
    associatedEdgeIds: z.array(z.string()).default([]),
    side: z.enum(['left', 'right', 'center']).default('center'),
    confidence: z.enum(['high', 'medium']).default('medium'),
    distanceMeters: z.number().min(0).default(0),
    widthMeters: z.number().positive().optional(),
    widthSource: z.enum(['mapped', 'estimated']).optional(),
    tags: z.record(z.string(), z.string()),
    points: z.array(z.tuple([z.number(), z.number(), z.number()])),
    holes: z.array(z.array(z.tuple([z.number(), z.number(), z.number()]))).optional(),
  })).default([]),
  /** Mapped crossing nodes used to lower kerbs and place tactile transitions. */
  osmCrossings: z.array(z.object({
    id: z.number().int(),
    kind: z.enum(['crossing', 'kerb']).default('crossing'),
    associatedEdgeId: z.string().optional(),
    point: z.tuple([z.number(), z.number(), z.number()]),
    rotationY: z.number().default(0),
    tags: z.record(z.string(), z.string()),
  })).default([]),
  /** Raw OSM connectivity relations whose from/to ways belong to this network. */
  osmLaneConnectivity: z.array(z.object({
    id: z.number().int(),
    members: z.array(z.object({
      type: z.enum(['node', 'way', 'relation']),
      ref: z.number().int(),
      role: z.string(),
    })),
    tags: z.record(z.string(), z.string()),
  })).default([]),
  stylePresets: z.record(z.string(), RoadStylePreset).default({
    ...DEFAULT_ROAD_STYLE_PRESETS,
  }),
  activeStyleId: z.string().min(1).default(DEFAULT_ROAD_STYLE_ID),
  applyStyleToAll: z.boolean().default(true),
  regionalPack: z.enum(['right-driving', 'left-driving']).default('right-driving'),
  snapTolerance: z.number().min(0.05).max(5).default(0.5),
  /** Vertical clearance between a conformed road centerline and the terrain. */
  terrainOffset: z.number().min(-10).max(10).default(0.05),
  /** Width of the blended terrain shoulder beyond the generated road footprint. */
  terrainFalloff: z.number().min(0).max(50).default(2.5),
  /** Horizontal run per metre of rise for generated fill slopes. */
  embankmentSlope: z.number().min(0.5).max(8).default(2),
  /** Horizontal run per metre of rise for generated cut slopes. */
  excavationSlope: z.number().min(0.25).max(8).default(1.5),
  /** Advisory grade threshold shown by the independent vertical-profile editor. */
  maxRoadGrade: z.number().min(0.01).max(1).default(0.12),
  /** Structural slab depth below bridge-mode road surfaces. */
  bridgeDeckThickness: z.number().min(0.2).max(3).default(0.65),
  /** Height of the continuous concrete barrier at each bridge deck edge. */
  bridgeBarrierHeight: z.number().min(0.5).max(2).default(1.05),
  /** Maximum nominal distance between generated bridge pier bents. */
  bridgePierSpacing: z.number().min(4).max(80).default(18),
  /** Diameter of each generated bridge pier column. */
  bridgePierDiameter: z.number().min(0.4).max(4).default(1.1),
  /** Advisory vertical clearance required beneath a bridge deck. */
  bridgeMinimumClearance: z.number().min(1).max(12).default(4.5),
})

export type RoadNetworkNode = z.infer<typeof RoadNetworkNode>
