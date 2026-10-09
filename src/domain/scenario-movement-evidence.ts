import type { StreetScenarioReference } from "./street-project";
import type { OsmMovementEvidence } from "../source/osm-movement-evidence";
/** Suppressing a mapped connectivity relation never relaxes legal turn restrictions. */
export function resolveScenarioMovementEvidence(
	evidence: OsmMovementEvidence | undefined,
	scenario: StreetScenarioReference | null | undefined,
) {
	if (!evidence) return undefined;
	const excluded = new Set(
		Object.values(scenario?.inventorySuppressions ?? {}).flatMap((s) =>
			s.target.category === "laneConnectivity"
				? [`osm~relation~${s.target.itemId}`]
				: [],
		),
	);
	return {
		...evidence,
		constraints: evidence.constraints.filter(
			(c) => c.kind !== "connectivity" || !excluded.has(c.featureId),
		),
	};
}
