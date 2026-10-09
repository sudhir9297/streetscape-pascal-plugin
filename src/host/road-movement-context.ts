import { resolveScenarioMovementEvidence } from "../domain/scenario-movement-evidence";
import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import type { RoadNetworkNode } from "../schema";
import { readStreetProjectView } from "./street-project-persistence";
import { compileLaneMovements } from "../lane-movement-graph";
import { decodeStoredReport } from "../report-storage";
import type { OsmMovementEvidence } from "../source/osm-movement-evidence";

/** Resolve document decisions through the existing projection; live geometry stays explicit. */
export function roadMovementContext(
	node: RoadNetworkNode,
	resolve?: (id: AnyNodeId) => AnyNode | undefined,
) {
	if (!resolve) return undefined;
	let ancestor = resolve(node.parentId as AnyNodeId);
	const seen = new Set<string>();
	while (ancestor && !seen.has(ancestor.id)) {
		seen.add(ancestor.id);
		const stored =
			ancestor.type === "site"
				? readStreetProjectView(ancestor)
				: undefined;
		const binding = stored?.projection.bindings.find(
			(b) => b.category === "roads" && b.nodeIds.includes(node.id),
		);
		if (stored && binding) {
			const evidence = decodeStoredReport(node.metadata?.osmMovementEvidence) as
				| OsmMovementEvidence
				| undefined;
			const decisions =
				stored.project.baselineRevisions[
					stored.project.activeBaselineRevisionId
				]!.laneMovementDecisions;
			// Geometry edits invalidate lane endpoints rather than reusing a stale graph.
			return compileLaneMovements(
				[{ roadId: binding.featureId, network: node }],
				resolveScenarioMovementEvidence(evidence?.format === "osm-movement-evidence" ? evidence : undefined, stored.project.activeScenarioId === null ? null : stored.project.scenarios[stored.project.activeScenarioId]),
				decisions,
			);
		}
		ancestor = resolve(ancestor.parentId as AnyNodeId);
	}
	return undefined;
}
