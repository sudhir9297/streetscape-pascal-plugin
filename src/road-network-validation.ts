import {
	parseRoadJunctionCornerKey,
	type RoadNetworkGraph,
} from "./road-network-topology";
import { roadVerticalProfileSummary } from "./road-network-vertical-profile";
import { roadBridgeClearanceChecks } from "./road-network-bridge";
import type { RoadNetworkNode } from "./schema";

export type RoadValidationIssue = {
	code:
		| "duplicate-edge"
		| "curve-radius-does-not-fit"
		| "isolated-node"
		| "invalid-junction-corner"
		| "invalid-junction-primary"
		| "missing-junction-node"
		| "missing-junction-record"
		| "missing-endpoint"
		| "missing-style"
		| "non-finite-position"
		| "non-finite-alignment"
		| "invalid-vertical-profile"
		| "excessive-grade"
		| "insufficient-bridge-clearance"
		| "self-edge"
		| "section-span-changed"
  | "junction-width-review"
  | "junction-short-approach"
  | "junction-uturn-marking-review"
		| "short-edge";
	severity: "error" | "warning";
	message: string;
	nodeId?: string;
	edgeId?: string;
	point?: readonly [number, number, number];
};

export function validateRoadGraph(
	graph: RoadNetworkGraph,
	maxRoadGrade = 0.12,
	clearancePeers: RoadNetworkNode[] = [],
): RoadValidationIssue[] {
	const issues: RoadValidationIssue[] = [];
	const incidentCount: Record<string, number> = Object.fromEntries(
		Object.keys(graph.graphNodes).map((id) => [id, 0]),
	);
	const pairs = new Map<string, string>();
	for (const edge of Object.values(graph.edges)) {
		const start = graph.graphNodes[edge.startNodeId];
		const end = graph.graphNodes[edge.endNodeId];
		if (!start || !end) {
			issues.push({
				code: "missing-endpoint",
				severity: "error",
				edgeId: edge.id,
				message: `Edge ${edge.id} references a missing endpoint.`,
			});
			continue;
		}
		incidentCount[start.id] = (incidentCount[start.id] ?? 0) + 1;
		incidentCount[end.id] = (incidentCount[end.id] ?? 0) + 1;
		if (start.id === end.id) {
			issues.push({
				code: "self-edge",
				severity: "error",
				edgeId: edge.id,
				message: `Edge ${edge.id} loops back to the same node.`,
			});
		}
		const length = Math.hypot(
			end.position[0] - start.position[0],
			end.position[2] - start.position[2],
		);
		if (length < 0.05) {
			issues.push({
				code: "short-edge",
				severity: "error",
				edgeId: edge.id,
				message: `Edge ${edge.id} is shorter than 0.05 m.`,
			});
		}
		if (!graph.stylePresets[edge.styleId]) {
			issues.push({
				code: "missing-style",
				severity: "warning",
				edgeId: edge.id,
				message: `Edge ${edge.id} uses missing style ${edge.styleId}.`,
			});
		}
		if (edge.alignment.some((point) => !point.every(Number.isFinite))) {
			issues.push({
				code: "non-finite-alignment",
				severity: "error",
				edgeId: edge.id,
				message: `Edge ${edge.id} has a non-finite alignment control point.`,
			});
		}
		if (edge.profileMode === "designed") {
			const profile = edge.verticalProfile ?? [];
			const invalid = profile.some(
				(point, index) =>
					![point.station, point.elevation, point.curveLength].every(
						Number.isFinite,
					) ||
					point.station < 0 ||
					point.curveLength < 0 ||
					(index > 0 && point.station <= (profile[index - 1]?.station ?? -1)),
			);
			if (invalid) {
				issues.push({
					code: "invalid-vertical-profile",
					severity: "error",
					edgeId: edge.id,
					message: `Edge ${edge.id} has invalid or unordered vertical-profile points.`,
				});
			} else {
				const summary = roadVerticalProfileSummary(graph, edge);
				if (summary.maxAbsGrade > maxRoadGrade) {
					issues.push({
						code: "excessive-grade",
						severity: "warning",
						edgeId: edge.id,
						message: `Edge ${edge.id} reaches ${(summary.maxAbsGrade * 100).toFixed(1)}% grade, above the ${(maxRoadGrade * 100).toFixed(1)}% advisory limit.`,
					});
				}
			}
		}
		const pair = [start.id, end.id].sort().join(":");
		const duplicate = pairs.get(pair);
		if (duplicate) {
			issues.push({
				code: "duplicate-edge",
				severity: "error",
				edgeId: edge.id,
				message: `Edges ${duplicate} and ${edge.id} connect the same nodes.`,
			});
		} else pairs.set(pair, edge.id);
	}
	for (const node of Object.values(graph.graphNodes)) {
		if (!node.position.every(Number.isFinite)) {
			issues.push({
				code: "non-finite-position",
				severity: "error",
				nodeId: node.id,
				message: `Node ${node.id} has a non-finite position.`,
			});
		}
		if ((incidentCount[node.id] ?? 0) === 0) {
			issues.push({
				code: "isolated-node",
				severity: "warning",
				nodeId: node.id,
				message: `Node ${node.id} is not connected to a road edge.`,
			});
		}
		if (node.curveRadius !== undefined) {
			const incident = Object.values(graph.edges).filter(
				(edge) => edge.startNodeId === node.id || edge.endNodeId === node.id,
			);
			if (incident.length === 2) {
				const neighbors = incident.flatMap((edge) => {
					const otherId =
						edge.startNodeId === node.id ? edge.endNodeId : edge.startNodeId;
					const other = graph.graphNodes[otherId];
					if (!other) return [];
					const dx = other.position[0] - node.position[0];
					const dz = other.position[2] - node.position[2];
					const length = Math.hypot(dx, dz);
					return length > 1e-6
						? [{ direction: [dx / length, dz / length] as const, length }]
						: [];
				});
				if (neighbors.length === 2) {
					const dot =
						neighbors[0]!.direction[0] * neighbors[1]!.direction[0] +
						neighbors[0]!.direction[1] * neighbors[1]!.direction[1];
					const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
					const idealTangent =
						node.curveRadius / Math.max(Math.tan(angle / 2), 1e-6);
					const available =
						Math.min(neighbors[0]!.length, neighbors[1]!.length) * 0.45;
					if (idealTangent > available + 1e-4) {
						issues.push({
							code: "curve-radius-does-not-fit",
							severity: "warning",
							nodeId: node.id,
							message: `The ${node.curveRadius.toFixed(1)} m bend radius is reduced to fit its adjacent roads.`,
						});
					}
				}
			}
		}
	}
	const junctions = graph.junctions ?? {};
	for (const [nodeId, junction] of Object.entries(junctions)) {
		const node = graph.graphNodes[nodeId];
		if (!node) {
			issues.push({
				code: "missing-junction-node",
				severity: "error",
				nodeId,
				message: `Junction ${nodeId} references a missing graph node.`,
			});
			continue;
		}
		const incidentIds = new Set(
			Object.values(graph.edges)
				.filter(
					(edge) => edge.startNodeId === nodeId || edge.endNodeId === nodeId,
				)
				.map((edge) => edge.id),
		);
		if (junction.primaryEdgeIds.some((edgeId) => !incidentIds.has(edgeId))) {
			issues.push({
				code: "invalid-junction-primary",
				severity: "warning",
				nodeId,
				message: `Junction ${nodeId} has a primary road that is no longer incident.`,
			});
		}
		if (
			Object.keys(junction.cornerRadii).some((key) => {
				const pair = parseRoadJunctionCornerKey(key);
				return !pair || !incidentIds.has(pair[0]) || !incidentIds.has(pair[1]);
			})
		) {
			issues.push({
				code: "invalid-junction-corner",
				severity: "warning",
				nodeId,
				message: `Junction ${nodeId} has a curb corner that references a removed approach.`,
			});
		}
	}
	for (const [nodeId, count] of Object.entries(incidentCount)) {
		if (count >= 3 && !junctions[nodeId]) {
			issues.push({
				code: "missing-junction-record",
				severity: "warning",
				nodeId,
				message: `Junction ${nodeId} needs its editable state regenerated.`,
			});
		}
	}
	const candidate = graph as RoadNetworkGraph & Partial<RoadNetworkNode>;
	if (typeof candidate.id === "string") {
		for (const check of roadBridgeClearanceChecks(
			candidate as RoadNetworkNode,
			clearancePeers,
		)) {
			issues.push({
				code: "insufficient-bridge-clearance",
				severity: "warning",
				edgeId: check.bridgeEdgeId,
				point: check.point,
				message: `Bridge ${check.bridgeEdgeId} has ${check.clearance.toFixed(2)} m clearance above ${check.lowerEdgeId}; ${check.required.toFixed(2)} m is required by the current scene setting.`,
			});
		}
	}
	return issues;
}

export function roadGraphHasBlockingIssues(graph: RoadNetworkGraph): boolean {
	return validateRoadGraph(graph).some((issue) => issue.severity === "error");
}

export function roadValidationIssuePoint(
	graph: RoadNetworkGraph,
	issue: RoadValidationIssue,
): readonly [number, number, number] | null {
	if (issue.point?.every(Number.isFinite)) return issue.point;
	if (issue.nodeId) {
		const point = graph.graphNodes[issue.nodeId]?.position;
		return point?.every(Number.isFinite) ? point : null;
	}
	if (issue.edgeId) {
		const edge = graph.edges[issue.edgeId];
		const start = edge ? graph.graphNodes[edge.startNodeId] : undefined;
		const end = edge ? graph.graphNodes[edge.endNodeId] : undefined;
		if (
			start &&
			end &&
			[...start.position, ...end.position].every(Number.isFinite)
		) {
			return [
				(start.position[0] + end.position[0]) / 2,
				(start.position[1] + end.position[1]) / 2,
				(start.position[2] + end.position[2]) / 2,
			];
		}
		return start?.position.every(Number.isFinite) ? start.position : null;
	}
	return null;
}
