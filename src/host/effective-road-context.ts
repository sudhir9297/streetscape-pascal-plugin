import type { AnyNode, AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "../schema";
import { readResolvedCurrentRoad } from "../street-project-compatibility";
import { readStreetProjectView } from "./street-project-persistence";
/** Scenario compilation reads the document; scene nodes remain disposable projections. */
export function resolveScenarioRoadContext(
	node: RoadNetworkNode,
	resolve?: (id: AnyNodeId) => AnyNode | undefined,
): RoadNetworkNode {
	if (!resolve) return node;
	const seen = new Set<string>();
	let ancestor = resolve(node.parentId as AnyNodeId);
	while (ancestor && !seen.has(ancestor.id)) {
		seen.add(ancestor.id);
		if (ancestor.type === "site") {
			const doc = readStreetProjectView(ancestor);
			const binding = doc?.projection.bindings.find(
				(b) => b.category === "roads" && b.nodeIds.includes(node.id),
			);
			if (doc && binding && doc.project.activeScenarioId !== null) {
				const road = readResolvedCurrentRoad(
					doc.project,
					doc.project.activeBaselineRevisionId,
					binding.featureId,
					doc.project.activeScenarioId,
				);
				return RoadNetworkNode.parse({
					...node,
					metadata: {
						...node.metadata,
						...(road.metadata.osmMovementEvidence
							? { osmMovementEvidence: road.metadata.osmMovementEvidence }
							: {}),
					},
					graphNodes: road.graphNodes,
					edges: road.edges,
					stylePresets: road.stylePresets,
					activeStyleId: road.activeStyleId,
					applyStyleToAll: road.applyStyleToAll,
					attachments: road.attachments,
					junctions: road.junctions,
					osmMappedSurfaces: road.osmMappedSurfaces,
					osmCrossings: road.osmCrossings,
					osmLaneConnectivity: road.osmLaneConnectivity,
				});
			}
		}
		ancestor = resolve(ancestor.parentId as AnyNodeId);
	}
	return node;
}
