import { resolveScenarioMovementEvidence } from "./domain/scenario-movement-evidence";
import type { RoadNetworkNode } from "./schema";
import type { StreetProject } from "./domain/street-project";
import type {
	LaneEndpoint,
	LaneMovementDecision,
	LaneMovementGraph,
	LaneMovementLink,
} from "./domain/lane-movement";
import { laneMovementId } from "./domain/lane-movement";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import { readResolvedCurrentRoad } from "./street-project-compatibility";
import {
	isSupportedOsmMovementAllowed,
	type OsmMovementEvidence,
} from "./source/osm-movement-evidence";

type Input = { roadId: string; network: RoadNetworkNode };
const sorted = <T extends { id: string }>(items: T[]) =>
	items.sort((a, b) => a.id.localeCompare(b.id));

/** Pure junction lane graph. Pending guesses are never accepted by compilation. */
export function compileLaneMovements(
	inputs: readonly Input[],
	evidence?: OsmMovementEvidence,
	decisions: Readonly<Record<string, LaneMovementDecision>> = {},
): LaneMovementGraph {
	const graph: LaneMovementGraph = {
		format: "street-lane-movements",
		schemaVersion: 1,
		policyVersion: 1,
		lanes: [],
		links: [],
		diagnostics: [],
	};
	const vectors = new Map<string, [number, number]>();
	const warn = (code: string, targetId: string, message: string) =>
		graph.diagnostics.push({ code, targetId, message });
	for (const { roadId, network } of [...inputs].sort((a, b) =>
		a.roadId.localeCompare(b.roadId),
	)) {
		for (const edge of sorted(Object.values(network.edges))) {
			const style = network.stylePresets[network.applyStyleToAll ? network.activeStyleId : edge.styleId];
			if (!style) continue;
			const path = sampleRoadEdgePoints(network, edge);
			if (path.length < 2) continue;
			for (const end of ["start", "end"] as const) {
				const nodeId = end === "start" ? edge.startNodeId : edge.endNodeId,
					node = network.graphNodes[nodeId];
				if (!node) continue;
				const interval =
					end === "start"
						? edge.sectionLayout?.intervals[0]
						: edge.sectionLayout?.intervals.at(-1);
				const lanes: Array<{
					id: string;
					direction: "forward" | "backward" | "both";
					use: "general" | "bus" | "turning" | "bicycle" | "parking";
					width: number;
					startWidth?: number;
					endWidth?: number;
				}> =
					interval?.lanes ??
					Array.from({ length: style.laneCount }, (_, index) => ({
						id: `lane:${index + 1}`,
						direction:
							style.laneDirections?.[index] ??
							(edge.direction === "forward"
								? "forward"
								: edge.direction === "reverse"
									? "backward"
									: style.laneCount === 1
										? "both"
										: (
													network.regionalPack === "left-driving"
														? index >= Math.ceil(style.laneCount / 2)
														: index < Math.floor(style.laneCount / 2)
												)
											? "backward"
											: "forward"),
						use: style.laneUses?.[index] ?? "general",
						width: style.laneWidths?.[index] ?? style.laneWidth,
					}));
				for (const direction of ["forward", "reverse"] as const) {
					if (edge.direction !== "both" && edge.direction !== direction)
						continue;
					const physical = lanes.filter(
						(l) =>
							(l.direction === "both" ||
								l.direction ===
									(direction === "forward" ? "forward" : "backward")) &&
							l.use !== "bicycle" &&
							l.use !== "parking" &&
							((end === "start" ? l.startWidth : l.endWidth) ?? l.width) > 1e-6,
					);
					if (direction === "reverse") physical.reverse();
					const role =
						(end === "end") === (direction === "forward")
							? "incoming"
							: "outgoing";
					const at = end === "start" ? path[0]! : path.at(-1)!;
					const other =
						end === "start"
							? path.find((p) => Math.hypot(p[0] - at[0], p[2] - at[2]) > 1e-6)
							: [...path]
									.reverse()
									.find((p) => Math.hypot(p[0] - at[0], p[2] - at[2]) > 1e-6);
					if (!other) continue;
					physical.forEach((lane, index) => {
						const id = JSON.stringify([
							"lane-end",
							roadId,
							edge.id,
							interval?.id ?? "whole-span",
							lane.id,
							direction,
							nodeId,
							role,
						]);
						const endpoint: LaneEndpoint = {
							id,
							roadId,
							edgeId: edge.id,
							laneId: lane.id,
							intervalId: interval?.id ?? "whole-span",
							junctionId: JSON.stringify([roadId, nodeId]),
							nodeId,
							role,
							direction,
							number: index + 1,
							use: lane.use as LaneEndpoint["use"],
							wayId: edge.osmSource?.wayId ?? null,
							viaNodeId:
								node.osmTopologyOrigin?.kind === "source"
									? node.osmTopologyOrigin.nodeId
									: null,
						};
						graph.lanes.push(endpoint);
						vectors.set(
							id,
							role === "incoming"
								? [at[0] - other[0], at[2] - other[2]]
								: [other[0] - at[0], other[2] - at[2]],
						);
					});
				}
			}
		}
	}
	const junctions = new Map<string, LaneEndpoint[]>();
	for (const lane of graph.lanes)
		junctions.set(lane.junctionId, [
			...(junctions.get(lane.junctionId) ?? []),
			lane,
		]);
	for (const lanes of junctions.values()) {
		const incoming = lanes.filter((l) => l.role === "incoming"),
			outgoing = lanes.filter((l) => l.role === "outgoing");
		for (const from of incoming)
			for (const to of outgoing) {
				const id = laneMovementId(from.id, to.id),
					decision = decisions[id];
				const hasEvidence =
					evidence && from.wayId !== null && to.wayId !== null;
				const query = {
					fromWayId: from.wayId!,
					toWayId: to.wayId!,
					viaNodeId: from.viaNodeId ?? -1,
					fromDirection: from.direction,
					toDirection: to.direction,
				};
				if (hasEvidence && !isSupportedOsmMovementAllowed(evidence, query))
					continue;
				const sameEdge = from.edgeId === to.edgeId;
				const onlyUTurn =
					hasEvidence &&
					evidence.constraints.some(
						(c) =>
							c.kind === "only" &&
							c.fromWayId === from.wayId &&
							c.toWayId === to.wayId &&
							c.viaNodeId === from.viaNodeId,
					);
				if (sameEdge && !onlyUTurn) continue;
				const a = vectors.get(from.id)!,
					b = vectors.get(to.id)!;
				const angle =
					(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) *
						180) /
					Math.PI;
				const turn: LaneMovementLink["turn"] =
					Math.abs(angle) > 150
						? "reverse"
						: Math.abs(angle) < 30
							? "through"
							: angle > 0
								? "right"
								: "left";
				const connections = hasEvidence
					? evidence.constraints.filter(
							(c) =>
								c.kind === "connectivity" &&
								c.fromWayId === from.wayId &&
								c.toWayId === to.wayId &&
								c.viaNodeId === from.viaNodeId &&
								c.fromDirection === from.direction &&
								c.toDirection === to.direction,
						)
					: [];
				const mapped = connections.flatMap((c) =>
					c.lanes
						.filter((l) => l.from === from.number && l.to === to.number)
						.map((l) => ({ constraint: c, lane: l })),
				);
				const fromRoad = hasEvidence
					? evidence.roads.find((r) => r.wayId === from.wayId)
					: undefined;
				const turns =
					fromRoad?.turnLanes[
						from.direction === "forward"
							? "turn:lanes:forward"
							: "turn:lanes:backward"
					] ??
					(fromRoad?.direction !== "both"
						? fromRoad?.turnLanes["turn:lanes"]
						: undefined);
				const indications = turns?.[from.number - 1];
				const matchesTurn =
					!indications ||
					indications.some(
						(t) =>
							t === "" ||
							t === "none" ||
							(turn === "through"
								? t === "through"
								: turn === "reverse"
									? t === "reverse"
									: t.endsWith(turn)),
					);
				// Turn indications constrain lane suggestions, not legal corrections; restriction relations remain binding.
				const targetLanes = outgoing.filter(
					(l) => l.edgeId === to.edgeId && l.direction === to.direction,
				);
				const desired = Math.min(from.number, targetLanes.length);
				const explicit = mapped.length > 0;
				const link: LaneMovementLink = {
					id,
					fromLaneId: from.id,
					toLaneId: to.id,
					junctionId: from.junctionId,
					turn,
					basis: decision
						? "correction"
						: explicit
							? "source-connectivity"
							: "inferred",
					evidenceIds: mapped.map((m) => m.constraint.featureId),
					status: decision?.status ?? (explicit ? "accepted" : "pending"),
					suggested:
						explicit ||
						(connections.length === 0 && matchesTurn && to.number === desired),
					requiresLaneChange: mapped.some((m) => m.lane.requiresLaneChange),
					reason:
						decision?.reason ??
						(explicit
							? "Mapped lane connectivity."
							: connections.length
								? "Alternative lane link differs from mapped connectivity; requires explicit review."
								: matchesTurn
									? "Lane order and approach geometry suggest this link; requires review."
									: "Lane link differs from mapped turn indications; requires explicit review."),
				};
				graph.links.push(link);
			}
	}
	const links = new Set(graph.links.map((l) => l.id));
	for (const decision of Object.values(decisions))
		if (!links.has(decision.id))
			warn(
				"stale-movement-decision",
				decision.id,
				"The reviewed link is unavailable after a topology, section or legal-evidence change. It was not reassigned.",
			);
	if (evidence)
		for (const d of evidence.diagnostics) warn(d.code, d.featureId, d.message);
	sorted(graph.lanes);
	sorted(graph.links);
	graph.diagnostics.sort(
		(a, b) =>
			a.targetId.localeCompare(b.targetId) || a.code.localeCompare(b.code),
	);
	return graph;
}

export function compileProjectLaneMovements(
	project: StreetProject,
): LaneMovementGraph {
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const reports = [
		baseline.resolutionEvidence,
		...(Array.isArray(baseline.resolutionEvidence?.imports)
			? baseline.resolutionEvidence.imports
			: []),
	].flatMap((value) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return [];
		const report = value.movements as unknown as
			| OsmMovementEvidence
			| undefined;
		return report?.format === "osm-movement-evidence" ? [report] : [];
	});
	const evidence: OsmMovementEvidence | undefined = reports.length
		? {
				format: "osm-movement-evidence",
				schemaVersion: 1,
				mode: "motor_vehicle",
				roads: [
					...new Map(
						reports.flatMap((r) => r.roads).map((r) => [r.wayId, r]),
					).values(),
				],
				constraints: [
					...new Map(
						reports.flatMap((r) => r.constraints).map((c) => [c.featureId, c]),
					).values(),
				],
				diagnostics: reports.flatMap((r) => r.diagnostics),
			}
		: undefined;
	return compileLaneMovements(
		Object.keys(baseline.roads)
			.sort()
			.map((roadId) => ({
				roadId,
				network: readResolvedCurrentRoad(
					project,
					baseline.id,
					roadId,
					project.activeScenarioId,
				),
			})),
		resolveScenarioMovementEvidence(evidence, project.activeScenarioId === null ? null : project.scenarios[project.activeScenarioId]),
		baseline.laneMovementDecisions,
	);
}
