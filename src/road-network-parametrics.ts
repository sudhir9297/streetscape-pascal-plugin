import { BaselineRoadCorrectionInspector } from "./baseline-road-correction-inspector";
import type { ParametricDescriptor } from "@pascal-app/core";
import type { AnyNodeId } from "@pascal-app/core";
import { RoadCrossSectionInspector } from "./road-network-cross-section-inspector";
import { RoadJunctionInspector } from "./road-network-junction-inspector";
import { RoadsideDecorationInspector } from "./roadside-decoration-rules";
import { RoadStylePresetLibrary } from "./road-network-preset-library";
import { RoadSplineCommandEditor } from "./road-network-spline-inspector";
import { RoadTerrainEditor } from "./road-network-terrain-inspector";
import type { RoadNetworkNode } from "./schema";

export const roadNetworkParametrics: ParametricDescriptor<RoadNetworkNode> = {
	onDeleteCascade: (node) =>
		Object.values(node.attachments ?? {}).map(
			(attachment) => attachment.assetNodeId as AnyNodeId,
		),
	groups: [
		{
			label: "Baseline correction",
			fields: [
				{
					key: "baselineCorrection",
					kind: "custom",
					component: BaselineRoadCorrectionInspector,
				},
			],
		},
		{
			label: "Style",
			fields: [
				{
					key: "presetLibrary",
					kind: "custom",
					component: RoadStylePresetLibrary,
				},
			],
		},
		{
			label: "Roadside",
			fields: [
				{
					key: "roadsideDecorationEditor",
					kind: "custom",
					component: RoadsideDecorationInspector,
				},
			],
		},
		{
			label: "Terrain",
			fields: [
				{
					key: "terrainOffset",
					kind: "number",
					unit: "m",
					min: -10,
					max: 10,
					step: 0.01,
				},
				{
					key: "terrainFalloff",
					kind: "number",
					unit: "m",
					min: 0,
					max: 50,
					step: 0.1,
				},
				{
					key: "embankmentSlope",
					kind: "number",
					min: 0.5,
					max: 8,
					step: 0.1,
				},
				{
					key: "excavationSlope",
					kind: "number",
					min: 0.25,
					max: 8,
					step: 0.1,
				},
				{
					key: "terrainEditor",
					kind: "custom",
					component: RoadTerrainEditor,
				},
			],
		},
		{
			label: "Road",
			fields: [
				{
					key: "crossSectionEditor",
					kind: "custom",
					component: RoadCrossSectionInspector,
				},
				{
					key: "splinePointEditor",
					kind: "custom",
					component: RoadSplineCommandEditor,
				},
			],
		},
		{
			label: "Junction",
			fields: [
				{
					key: "junctionEditor",
					kind: "custom",
					component: RoadJunctionInspector,
					visibleIf: (node) => Object.keys(node.junctions).length > 0,
				},
			],
		},
	],
};
