import type { RoadNetworkNode } from "./schema";
import type { LaneMovementGraph } from "./domain/lane-movement";
import type { CompiledStreetLayout } from "./street-compiler-layout";
import { sectionEndpointStyle } from "./street-section-endpoint-style";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import { roadCarriagewayWidth } from "./road-cross-section";
import { resolveRoadRegionalPack } from "./road-regional-packs";
import {
	arrowPolygons,
	orientedRectangle,
	pointAtDistance,
	yieldTeeth,
	type RoadMarkingPolygon,
} from "./road-network-markings";
import type { RoadTurn } from "./road-turn-arrows";
import type { RoadValidationIssue } from "./road-network-validation";

/** Visual proposals describe hardware only. No phases, timing or right-of-way is inferred. */
export function compileJunctionMovementPlan(
	node: RoadNetworkNode,
	layout: CompiledStreetLayout,
	movements: LaneMovementGraph,
) {
	const markings: RoadMarkingPolygon[] = [];
	const crossings: Array<{
		id: string;
		junctionId: string;
		edgeId: string;
		movementIds: string[];
		points: readonly (readonly [number, number, number])[];
		basis: "mapped" | "control-proposal";
		status: "pending";
	}> = [];
	const signals: Array<{
		id: string;
		junctionId: string;
		edgeId: string;
		laneIds: string[];
		movementIds: string[];
		position: readonly [number, number, number];
		status: "pending";
		basis: "accepted-control";
	}> = [];
	const diagnostics: RoadValidationIssue[] = [];
	const color = resolveRoadRegionalPack(node).markingColor;
	const accepted = movements.links.filter((l) => l.status === "accepted");
	const laneById = new Map(movements.lanes.map((l) => [l.id, l]));
	const crossingLinks = (edgeId: string, junctionId: string) =>
		accepted
			.filter((l) =>
				[laneById.get(l.fromLaneId), laneById.get(l.toLaneId)].some(
					(lane) => lane?.edgeId === edgeId && lane.nodeId === junctionId,
				),
			)
			.map((l) => l.id);
	for (const surface of layout.junctionSurfaces) {
		const junctionId = surface.graphNode.id;
		const mouths = Object.keys(surface.solution.approachCuts)
			.map((id) => {
				const edge = node.edges[id]!;
				const base =
					node.stylePresets[
						node.applyStyleToAll ? node.activeStyleId : edge.styleId
					];
				return base
					? roadCarriagewayWidth(sectionEndpointStyle(base, edge, junctionId))
					: 0;
			})
			.filter((w) => w > 0);
		const incompatible =
			mouths.length > 1 &&
			Math.max(...mouths) > 2 * Math.min(...mouths) &&
			!surface.manualBoundary;
		if (incompatible)
			diagnostics.push({
				code: "junction-width-review",
				severity: "warning",
				message: `${junctionId}: incompatible approach widths; retaining the surface fallback and withholding automatic junction markings. Review a manual boundary.`,
			});
		for (const [edgeId, cut] of Object.entries(surface.solution.approachCuts)) {
			const edge = node.edges[edgeId]!;
			const base =
				node.stylePresets[
					node.applyStyleToAll ? node.activeStyleId : edge.styleId
				];
			if (!base?.markings || incompatible) continue;
			const style = sectionEndpointStyle(base, edge, junctionId);
			const start = edge.startNodeId === junctionId;
			const path = sampleRoadEdgePoints(node, edge, 96);
			if (!start) path.reverse();
			const length = path
				.slice(1)
				.reduce(
					(s, p, i) => s + Math.hypot(p[0] - path[i]![0], p[2] - path[i]![2]),
					0,
				);
			const interval = start
				? edge.sectionLayout?.intervals[0]
				: edge.sectionLayout?.intervals.at(-1);
			const available = Math.min(
				length,
				interval ? interval.end - interval.start : length,
			);
			if (available < cut + 13) {
				diagnostics.push({
					code: "junction-short-approach",
					severity: "warning",
					edgeId,
					message: `${junctionId}: approach or endpoint section is too short for arrows and controls; manual review required. Markings were withheld.`,
				});
				continue;
			}
			const lanes = movements.lanes.filter(
				(l) =>
					l.edgeId === edgeId &&
					l.nodeId === junctionId &&
					l.role === "incoming",
			);
			const links = accepted.filter((l) =>
				lanes.some((lane) => lane.id === l.fromLaneId),
			);
			const elevated = path.map((p) => [p[0], p[1] + 0.016, p[2]] as const);
			const widthsAt = (distance: number) =>
				interval
					? interval.lanes.map((l) => {
							const station = start ? distance : length - distance;
							const t = Math.max(
								0,
								Math.min(
									1,
									(station - interval.start) / (interval.end - interval.start),
								),
							);
							return (
								(l.startWidth ?? l.width) +
								((l.endWidth ?? l.width) - (l.startWidth ?? l.width)) * t
							);
						})
					: (style.laneWidths ??
						Array.from({ length: style.laneCount }, () => style.laneWidth));
			const median = interval ? 0 : style.medianWidth;
			const totalAt = (distance: number) =>
				widthsAt(distance).reduce((a, b) => a + b, 0) + median;
			const laneOffset = (laneId: string, distance = cut + 10.5) => {
				const widths = widthsAt(distance),
					total = totalAt(distance);
				const index = interval
					? interval.lanes.findIndex((l) => l.id === laneId)
					: Number(laneId.split(":").at(-1)) - 1;
				return {
					width: widths[index] ?? style.laneWidth,
					offset:
						total / 2 -
						widths.slice(0, index).reduce((a, b) => a + b, 0) -
						(index >= Math.floor(widths.length / 2) ? median : 0) -
						(widths[index] ?? style.laneWidth) / 2,
				};
			};
			const arrow = pointAtDistance(elevated, cut + 10.5)!;
			for (const lane of lanes) {
				const laneLinks = links.filter((l) => l.fromLaneId === lane.id);
				const turns = [
					...new Set(
						laneLinks
							.map((l) => l.turn)
							.filter((t): t is RoadTurn => t !== "reverse"),
					),
				];
				if (laneLinks.some((l) => l.turn === "reverse"))
					diagnostics.push({
						code: "junction-uturn-marking-review",
						severity: "warning",
						edgeId,
						message:
							"Accepted U-turn retained in the movement graph; no unsupported U-turn arrow was drawn.",
					});
				const physical = laneOffset(lane.laneId);
				for (const points of arrowPolygons(
					arrow,
					start ? physical.offset : -physical.offset,
					turns,
					physical.width,
				))
					markings.push({
						edgeId,
						junctionId,
						kind: "direction-arrow",
						color,
						points,
						movementIds: laneLinks.map((l) => l.id),
					});
			}
			if (!lanes.length) continue;
			const junction = node.junctions[junctionId];
			const explicit = junction?.approachControls?.[edgeId];
			const control =
				explicit && explicit !== "auto"
					? explicit
					: junction && ["stop", "yield", "signal"].includes(junction.treatment)
						? junction.treatment
						: "none";
			const offsets = lanes.map((l) => laneOffset(l.laneId, cut + 5.5));
			const min = Math.min(...offsets.map((l) => l.offset - l.width / 2)),
				max = Math.max(...offsets.map((l) => l.offset + l.width / 2));
			const center = ((start ? 1 : -1) * (min + max)) / 2;
			const controlSample = pointAtDistance(elevated, cut + 5.5)!;
			if (control !== "none") {
				const polygons =
					control === "yield"
						? yieldTeeth(controlSample, center, max - min)
						: [orientedRectangle(controlSample, center, max - min, 0.35)];
				for (const points of polygons)
					markings.push({
						edgeId,
						junctionId,
						kind: control === "yield" ? "yield-line" : "stop-line",
						color,
						points,
						movementIds: links.map((l) => l.id),
					});
			}
			if (control === "signal") {
				const p = pointAtDistance(elevated, cut + 6.5)!;
				const lateral = totalAt(cut + 6.5) / 2 + 0.75;
				signals.push({
					id: `signal:${junctionId}:${edgeId}`,
					junctionId,
					edgeId,
					laneIds: lanes.map((l) => l.id),
					movementIds: links.map((l) => l.id),
					position: [
						p.point[0] - p.direction[1] * lateral,
						p.point[1],
						p.point[2] + p.direction[0] * lateral,
					],
					status: "pending",
					basis: "accepted-control",
				});
			}
			if (control !== "none") {
				const sample = pointAtDistance(elevated, cut + 2.7)!;
				const points = orientedRectangle(sample, 0, totalAt(cut + 2.7), 3.8);
				crossings.push({
					id: `crossing:${junctionId}:${edgeId}`,
					junctionId,
					edgeId,
					movementIds: crossingLinks(edgeId, junctionId),
					points,
					basis: "control-proposal",
					status: "pending",
				});
				for (let bar = 0; bar < 6; bar++)
					markings.push({
						edgeId,
						junctionId,
						kind: "crosswalk",
						color,
						points: orientedRectangle(
							pointAtDistance(elevated, cut + 1 + bar * 0.68)!,
							0,
							totalAt(cut + 1 + bar * 0.68),
							0.34,
						),
						movementIds: links.map((l) => l.id),
					});
			}
		}
		for (const crossing of node.osmCrossings.filter(
			(c) =>
				c.kind === "crossing" &&
				c.associatedEdgeId &&
				surface.solution.approachCuts[c.associatedEdgeId] !== undefined,
		)) {
			if (
				Math.hypot(
					crossing.point[0] - surface.graphNode.position[0],
					crossing.point[2] - surface.graphNode.position[2],
				) >
				surface.solution.maxExtent + 10
			)
				continue;
			crossings.push({
				id: `mapped-crossing:${junctionId}:${crossing.id}`,
				junctionId,
				edgeId: crossing.associatedEdgeId!,
				movementIds: crossingLinks(crossing.associatedEdgeId!, junctionId),
				points: [crossing.point],
				basis: "mapped",
				status: "pending",
			});
		}
	}
	return {
		format: "street-junction-movement-plan" as const,
		movements,
		markings,
		crossings,
		signalProposals: signals,
		diagnostics,
	};
}
