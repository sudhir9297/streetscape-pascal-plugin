import type { RoadNetworkNode } from "./schema";

const ROAD_RUNTIME_DEFAULT_KEYS = [
	"terrainOffset",
	"terrainFalloff",
	"embankmentSlope",
	"excavationSlope",
	"maxRoadGrade",
	"bridgeDeckThickness",
	"bridgeBarrierHeight",
	"bridgePierSpacing",
	"bridgePierDiameter",
	"bridgeMinimumClearance",
	"roadsideDecorations",
	"roadsideDecorationSpacing",
	"roadsideLampsBothSides",
	"showRoadsideDecorations",
	"roadsideItemVisibility",
	"roadsideDecorationSuppressed",
	"roadsideAutoFillEnabled",
	"roadsideItemSuppressed",
	"generatedItemHistory",
] as const satisfies ReadonlyArray<keyof RoadNetworkNode>;

/** Fill fields added after a local scene's road node was already mounted. */
export function roadRuntimeDefaultsPatch(
	storeNode: Partial<RoadNetworkNode>,
	normalizedNode: RoadNetworkNode,
): Partial<RoadNetworkNode> {
	return Object.fromEntries(
		ROAD_RUNTIME_DEFAULT_KEYS.flatMap((key) =>
			storeNode[key] === undefined ? [[key, normalizedNode[key]]] : [],
		),
	) as Partial<RoadNetworkNode>;
}
