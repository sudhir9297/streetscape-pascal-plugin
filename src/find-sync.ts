import { type AnyNode, emitter } from "@pascal-app/core";
import { isCatalogLampKind } from "./catalog-lamp-config";
import type {
	CobraHeadLightNode,
	HeritageCrookLightNode,
	MultiHeadAreaLightNode,
	PedestrianPostLightNode,
	StreetLightNode,
	TwinArmMedianLightNode,
	TrussRoadwayLightNode,
	UtilityPoleNode,
} from "./schema";
import { useStreetscapeStore } from "./store";
import { STANDARD_LAMP_HEIGHT_M } from "./lamp-constants";
import {
	STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M,
	STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M,
} from "./utility-pole-geometry";
import type { RoadSignId } from "./road-sign-config";

/**
 * "Find in catalog" sync. The editor's node action menu emits
 * `selection:find-node`; the plugin opens the selected node's category and
 * mirrors it into the matching placement brush. Module-level (imported by the
 * plugin manifest) so the listener is live from plugin load, even while the
 * panel has never mounted.
 */

const findNodeEmitter = emitter as unknown as {
	on: (type: "selection:find-node", handler: (node: AnyNode) => void) => void;
	off: (type: "selection:find-node", handler: (node: AnyNode) => void) => void;
};

function handleFindNode(node: AnyNode) {
	const store = useStreetscapeStore.getState();
	if (isCatalogLampKind(node.type as string)) {
		store.setPanelCategory("lighting");
		const catalogLamp = node as unknown as {
			height?: number;
			armLength?: number;
			visualStyle?: string;
			lightOn?: boolean;
		};
		store.setCatalogLampHeight(catalogLamp.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setCatalogLampArmLength(catalogLamp.armLength ?? 1.2);
		store.setCatalogLampVisualStyle(catalogLamp.visualStyle ?? "shoebox");
		store.setCatalogLampLightOn(catalogLamp.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:street-light") {
		store.setPanelCategory("lighting");
		const streetLight = node as unknown as StreetLightNode;
		store.setStreetLightHeight(streetLight.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setStreetLightArmLength(streetLight.armLength ?? 1.2);
		store.setStreetLightOn(streetLight.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:pedestrian-post-light") {
		store.setPanelCategory("lighting");
		const postTopLight = node as unknown as PedestrianPostLightNode;
		store.setPostTopLightHeight(postTopLight.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setPostTopLightOn(postTopLight.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:heritage-crook-light") {
		store.setPanelCategory("lighting");
		const crookLight = node as unknown as HeritageCrookLightNode;
		store.setHeritageCrookHeight(crookLight.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setHeritageCrookArmReach(crookLight.armReach ?? 0.9);
		store.setHeritageCrookLightOn(crookLight.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:cobra-head-light") {
		store.setPanelCategory("lighting");
		const cobraHead = node as unknown as CobraHeadLightNode;
		store.setCobraHeadHeight(cobraHead.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setCobraHeadArmLength(cobraHead.armLength ?? 1.25);
		store.setCobraHeadLightOn(cobraHead.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:twin-arm-median-light") {
		store.setPanelCategory("lighting");
		const twinArm = node as unknown as TwinArmMedianLightNode;
		store.setTwinArmMedianHeight(twinArm.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setTwinArmMedianArmLength(twinArm.armLength ?? 1.35);
		store.setTwinArmMedianLightOn(twinArm.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:multi-head-area-light") {
		store.setPanelCategory("lighting");
		const areaLight = node as unknown as MultiHeadAreaLightNode;
		store.setMultiHeadAreaHeight(areaLight.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setMultiHeadAreaArmLength(areaLight.armLength ?? 1.2);
		store.setMultiHeadAreaHeadCount(areaLight.headCount ?? 4);
		store.setMultiHeadAreaLightOn(areaLight.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:truss-roadway-light") {
		store.setPanelCategory("lighting");
		const trussLight = node as unknown as TrussRoadwayLightNode;
		store.setTrussRoadwayHeight(trussLight.height ?? STANDARD_LAMP_HEIGHT_M);
		store.setTrussRoadwayArmLength(trussLight.armLength ?? 2);
		store.setTrussRoadwayBraceDepth(trussLight.braceDepth ?? 0.75);
		store.setTrussRoadwayLightOn(trussLight.lightOn ?? false);
	}
	if ((node.type as string) === "streetscape:utility-pole") {
		store.setPanelCategory("utilities");
		const utilityPole = node as unknown as UtilityPoleNode;
		store.setUtilityPoleHeight(
			utilityPole.height ?? STANDARD_UTILITY_POLE_EXPOSED_HEIGHT_M,
		);
		store.setUtilityPoleCrossarmLength(
			utilityPole.crossarmLength ?? STANDARD_UTILITY_POLE_CROSSARM_LENGTH_M,
		);
		store.setUtilityPoleTransformerMounted(
			utilityPole.transformerMounted ?? true,
		);
	}
	if ((node.type as string) === "streetscape:road-sign") {
		store.setPanelCategory("signs");
		const sign = node as unknown as {
			signId?: RoadSignId;
			postHeight?: number;
			scale?: number;
			mounting?: "single-post" | "double-post";
		};
		store.setRoadSignId(sign.signId ?? "stop");
		store.setRoadSignPostHeight(sign.postHeight ?? 2.1);
		store.setRoadSignScale(sign.scale ?? 1);
		store.setRoadSignMounting(sign.mounting ?? "single-post");
	}
}

export function initializeFindSync(): () => void {
	findNodeEmitter.on("selection:find-node", handleFindNode);
	return () => findNodeEmitter.off("selection:find-node", handleFindNode);
}
