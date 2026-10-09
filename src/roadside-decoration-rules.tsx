"use client";
import { generatedSlotIdentity, retainsGeneratedProposal } from "./domain/generated-item-history";
import { useState } from "react";
import { useProposalPreview } from "./proposal-preview-store";

import { type AnyNode, type AnyNodeId, useScene } from "@pascal-app/core";
import { SliderControl, ToggleControl } from "@pascal-app/editor";
import {
	buildRoadCrossSection,
	buildRoadJunctionBands,
	roadCarriagewayWidth,
	resolveRoadSideComponents,
	ROAD_SIDE_COMPONENT_SPECS,
} from "./road-cross-section";
import {
	buildJunctionBoundarySidePaths,
	buildJunctionBoundaryGeometry,
	sampleRoadEdgePoints,
	type JunctionBoundaryApproach,
} from "./road-network-geometry";
import { DEFAULT_ROAD_STYLE_PRESETS } from "./road-style-presets";
import {
	ROAD_AUTO_INFRASTRUCTURE_OPTIONS,
	FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
} from "./road-auto-infrastructure-settings";
import { buildRoadAutoInfrastructurePlan } from "./road-auto-infrastructure";
import { applyRoadAutoInfrastructureClearances } from "./road-auto-infrastructure-style";
import { reanchorRoadAttachment } from "./road-edge-attachments";
import type {
	RoadEdgeAttachment,
	RoadGraphEdge,
	RoadNetworkNode,
	RoadsideDecoration,
	RoadStylePreset,
} from "./schema";
import {
	createRoadSignNode,
	RoadNetworkNode as RoadNetworkNodeSchema,
	RoadSignNode,
	StreetLightNode,
} from "./schema";

function edgeStyle(
	node: RoadNetworkNode,
	edge: RoadGraphEdge,
): RoadStylePreset {
	const styleId = node.applyStyleToAll ? node.activeStyleId : edge.styleId;
	return (
		node.stylePresets[styleId] ??
		DEFAULT_ROAD_STYLE_PRESETS[
			styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS
		] ??
		DEFAULT_ROAD_STYLE_PRESETS["local-street"]
	);
}

function sampledLength(points: Array<[number, number, number]>): number {
	return points.slice(1).reduce((sum, point, index) => {
		const previous = points[index]!;
		return (
			sum +
			Math.hypot(
				point[0] - previous[0],
				point[1] - previous[1],
				point[2] - previous[2],
			)
		);
	}, 0);
}

function sampledPolylinePoint(
	points: ReadonlyArray<readonly [number, number]>,
	distance: number,
): { index: number; point: readonly [number, number]; ratio: number } | null {
	let remaining = distance;
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index]!;
		const end = points[index + 1]!;
		const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
		if (remaining > length && index < points.length - 2) {
			remaining -= length;
			continue;
		}
		const ratio = Math.min(1, remaining / Math.max(length, 1e-6));
		return {
			index,
			point: [
				start[0] + (end[0] - start[0]) * ratio,
				start[1] + (end[1] - start[1]) * ratio,
			],
			ratio,
		};
	}
	return null;
}

function sampledPolylineLength(
	points: ReadonlyArray<readonly [number, number]>,
): number {
	return points.slice(1).reduce((sum, point, index) => {
		const previous = points[index]!;
		return sum + Math.hypot(point[0] - previous[0], point[1] - previous[1]);
	}, 0);
}

function stations(
	length: number,
	spacing: number,
	startInset: number,
	endInset: number,
): number[] {
	const result: number[] = [];
	for (
		let station = startInset;
		station <= length - endInset + 1e-6;
		station += spacing
	) {
		result.push(station);
	}
	return result;
}

export const ROADSIDE_LAMP_MIN_VERGE_WIDTH = 1;
export const ROADSIDE_LAMP_MIN_CORNER_SETBACK = 10;
export const ROADSIDE_LAMP_JUNCTION_MARGIN = 2;
export const ROADSIDE_SIGN_LAMP_MIN_SEPARATION = 3;

const VERGE_ELEVATION_OFFSET = ROAD_SIDE_COMPONENT_SPECS.find(
	(spec) => spec.kind === "verge",
)!.elevationOffset;

/** Give every used road style furnishing strips for generated lamps and signs. */
export function ensureRoadsideLampVerge(
	node: RoadNetworkNode,
): RoadNetworkNode["stylePresets"] | null {
	const styleIds = new Set([
		node.activeStyleId,
		...(!node.applyStyleToAll
			? Object.values(node.edges).map((edge) => edge.styleId)
			: []),
	]);
	const stylePresets = { ...node.stylePresets };
	let changed = false;
	for (const styleId of styleIds) {
		const style = stylePresets[styleId] ??
			DEFAULT_ROAD_STYLE_PRESETS[
				styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS
			] ?? { ...DEFAULT_ROAD_STYLE_PRESETS["local-street"], id: styleId };
		let nextStyle = style;
		for (const side of ["left", "right"] as const) {
			const components = resolveRoadSideComponents(nextStyle, side);
			if (components.vergeWidth >= ROADSIDE_LAMP_MIN_VERGE_WIDTH) continue;
			nextStyle = {
				...nextStyle,
				[side === "left" ? "leftSide" : "rightSide"]: {
					...components,
					vergeWidth: ROADSIDE_LAMP_MIN_VERGE_WIDTH,
				},
			};
			changed = true;
		}
		if (nextStyle !== style) stylePresets[styleId] = nextStyle;
	}
	return changed ? stylePresets : null;
}

function roadsideOuterOffset(
	style: RoadStylePreset,
	side: "left" | "right",
	extraOffset: number,
): number {
	const sideSign = side === "left" ? 1 : -1;
	return (
		sideSign *
		(buildRoadCrossSection(style).sides[side].outerOffset + extraOffset)
	);
}

function lampVergeOffset(
	style: RoadStylePreset,
	side: "left" | "right",
): number {
	const verge = buildRoadCrossSection(style).sides[side].components.find(
		(component) => component.kind === "verge",
	);
	return verge?.lateralOffset ?? roadsideOuterOffset(style, side, 0.5);
}

function resolvedRoadsideDecorationSpacing(
	spacing: number | undefined,
): number {
	return Number.isFinite(spacing) ? Math.min(100, Math.max(10, spacing!)) : 30;
}

function lampClearanceKey(nodeId: string, edgeId: string): string {
	return `${nodeId}:${edgeId}`;
}

function junctionApproach(
	node: RoadNetworkNode,
	nodeId: string,
	edge: RoadGraphEdge,
): JunctionBoundaryApproach | null {
	const points = sampleRoadEdgePoints(node, edge, 48);
	if (points.length < 2) return null;
	const from = edge.startNodeId === nodeId ? points[0]! : points.at(-1)!;
	const toward = edge.startNodeId === nodeId ? points[1]! : points.at(-2)!;
	return {
		angle: Math.atan2(toward[2] - from[2], toward[0] - from[0]),
		edgeId: edge.id,
		halfWidth: roadCarriagewayWidth(edgeStyle(node, edge)) / 2,
	};
}

function isMeaningfulTwoEdgeBend(
	approaches: JunctionBoundaryApproach[],
): boolean {
	if (approaches.length !== 2) return false;
	const delta = Math.abs(
		Math.atan2(
			Math.sin(approaches[0]!.angle - approaches[1]!.angle),
			Math.cos(approaches[0]!.angle - approaches[1]!.angle),
		),
	);
	return Math.abs(Math.PI - delta) > Math.PI / 18;
}

/** Match pole setbacks to the same curb-return envelope used by the road mesh. */
function roadsideLampEndClearances(node: RoadNetworkNode): Map<string, number> {
	const clearances = new Map<string, number>();
	for (const graphNode of Object.values(node.graphNodes)) {
		const incident = Object.values(node.edges).filter(
			(edge) =>
				edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
		);
		if (incident.length < 2) continue;
		const approaches = incident.flatMap((edge) => {
			const approach = junctionApproach(node, graphNode.id, edge);
			return approach ? [approach] : [];
		});
		if (approaches.length !== incident.length) continue;
		if (incident.length === 2 && !isMeaningfulTwoEdgeBend(approaches)) continue;
		const solution =
			incident.length >= 3
				? buildJunctionBoundaryGeometry(
						approaches,
						node.junctions?.[graphNode.id]?.cornerRadii ?? {},
					)
				: null;
		for (const edge of incident) {
			const style = edgeStyle(node, edge);
			const widthAwareFallback = Math.max(
				ROADSIDE_LAMP_MIN_CORNER_SETBACK,
				buildRoadCrossSection(style).totalWidth / 2 +
					ROADSIDE_LAMP_JUNCTION_MARGIN,
			);
			const junctionCut = solution?.approachCuts[edge.id] ?? 0;
			clearances.set(
				lampClearanceKey(graphNode.id, edge.id),
				Math.max(
					widthAwareFallback,
					junctionCut + ROADSIDE_LAMP_JUNCTION_MARGIN,
				),
			);
		}
	}
	return clearances;
}

/** Fill long rendered curb returns that edge-station lamps cannot reach. */
function addJunctionLighting(
	node: RoadNetworkNode,
	decorations: RoadNetworkNode["roadsideDecorations"],
	spacing: number,
): void {
	if (!node.roadsideLampsBothSides) return;
	for (const graphNode of Object.values(node.graphNodes)) {
		const incident = Object.values(node.edges).filter(
			(edge) =>
				edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
		);
		if (incident.length < 3) continue;
		const approaches = incident.flatMap((edge) => {
			const approach = junctionApproach(node, graphNode.id, edge);
			return approach ? [approach] : [];
		});
		if (approaches.length !== incident.length) continue;
		const solution = buildJunctionBoundaryGeometry(
			approaches,
			node.junctions?.[graphNode.id]?.cornerRadii ?? {},
		);
		const styles = incident.map((edge) => edgeStyle(node, edge));
		const vergeBand = buildRoadJunctionBands(styles).find(
			(band) => band.kind === "verge",
		);
		if (!vergeBand) continue;
		const vergeCenterOffset = vergeBand.outerWidth - vergeBand.width / 2;
		const primaryStyle =
			node.junctions?.[graphNode.id]?.primaryEdgeIds.flatMap((edgeId) => {
				const edge = node.edges[edgeId];
				return edge ? [edgeStyle(node, edge)] : [];
			})[0] ?? styles[0]!;
		const paths = buildJunctionBoundarySidePaths(solution, vergeCenterOffset);
		const innerPaths = buildJunctionBoundarySidePaths(solution);
		const endpointGap =
			ROADSIDE_LAMP_JUNCTION_MARGIN + ROADSIDE_SIGN_LAMP_MIN_SEPARATION + 0.25;
		for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
			const path = paths[pathIndex]!;
			const innerPath = innerPaths[pathIndex]!;
			const pathLength = sampledPolylineLength(path.points);
			const intervalCount = Math.ceil((pathLength + endpointGap * 2) / spacing);
			const fixtureCount = Math.max(0, intervalCount - 1);
			for (let index = 1; index <= fixtureCount; index += 1) {
				const distance =
					((pathLength + endpointGap * 2) * index) / intervalCount -
					endpointGap;
				const sample = sampledPolylinePoint(path.points, distance);
				if (!sample) continue;
				const innerStart = innerPath.points[sample.index]!;
				const innerEnd = innerPath.points[sample.index + 1]!;
				const innerPoint = [
					innerStart[0] + (innerEnd[0] - innerStart[0]) * sample.ratio,
					innerStart[1] + (innerEnd[1] - innerStart[1]) * sample.ratio,
				] as const;
				const inwardX = innerPoint[0] - sample.point[0];
				const inwardZ = innerPoint[1] - sample.point[1];
				const worldRotationY = Math.atan2(-inwardZ, inwardX);
				const isApproachSleeve =
					sample.index === 0 || sample.index === path.points.length - 2;
				const ruleId = isApproachSleeve
					? "junction-approach-lighting"
					: "junction-lighting";
				const id = [
					`roadside:${ruleId}`,
					graphNode.id,
					path.fromEdgeId,
					path.toEdgeId,
					index,
				].join(":");
				if (node.roadsideDecorationSuppressed?.[id] === true || retainsGeneratedProposal(node.generatedItemHistory,id,undefined,path.fromEdgeId,"streetscape:street-light")) continue;
				decorations[id] = {
					edgeId: path.fromEdgeId,
					id,
					kind: "lamp",
					lateralOffset: 0,
					ruleId,
					side: "right",
					station: distance,
					worldPosition: [
						graphNode.position[0] + sample.point[0],
						graphNode.position[1] + VERGE_ELEVATION_OFFSET,
						graphNode.position[2] + sample.point[1],
					],
					worldRotationY,
				};
			}
		}
	}
}

/** Derive deterministic lamps and signs from road semantics. */
export function buildRoadsideDecorations(
	node: RoadNetworkNode,
): RoadNetworkNode["roadsideDecorations"] {
	const decorations: RoadNetworkNode["roadsideDecorations"] = {};
	const spacing = resolvedRoadsideDecorationSpacing(
		node.roadsideDecorationSpacing,
	);
	const lampEndClearances = roadsideLampEndClearances(node);
	const degreeByNode = new Map<string, number>();
	for (const edge of Object.values(node.edges)) {
		degreeByNode.set(
			edge.startNodeId,
			(degreeByNode.get(edge.startNodeId) ?? 0) + 1,
		);
		degreeByNode.set(
			edge.endNodeId,
			(degreeByNode.get(edge.endNodeId) ?? 0) + 1,
		);
	}
	for (const edge of Object.values(node.edges).sort((a, b) =>
		a.id.localeCompare(b.id),
	)) {
		const style = edgeStyle(node, edge);
		const points = sampleRoadEdgePoints(node, edge, 36) as Array<
			[number, number, number]
		>;
		const length = sampledLength(points);
		const slots = new Map<string,number>();
		const add = (
			kind: RoadsideDecoration["kind"],
			side: "left" | "right",
			station: number,
			lateralOffset: number,
			ruleId: string,
			facing?: RoadsideDecoration["facing"],
		) => {
			const legacyKey = `roadside:${ruleId}:${edge.id}:${side}:${station.toFixed(2)}`;
            const group=JSON.stringify([ruleId,side,facing??"none"]),slot=slots.get(group)??0;slots.set(group,slot+1);
            const id = generatedSlotIdentity(ruleId,edge.id,side,`${facing??"none"}-${slot}`);
			if (node.roadsideDecorationSuppressed?.[id] === true || node.roadsideDecorationSuppressed?.[legacyKey] === true || retainsGeneratedProposal(node.generatedItemHistory,id,legacyKey,edge.id,kind==="lamp"?"streetscape:street-light":"streetscape:road-sign")) return;
			decorations[id] = {
				legacyKey,
				edgeId: edge.id,
				...(facing ? { facing } : {}),
				id,
				kind,
				lateralOffset,
				ruleId,
				side,
				station,
			};
		};

		if (edge.roadClass !== "alley") {
			const regularInset = Math.min(6, spacing / 2);
			const startInset = Math.max(
				regularInset,
				lampEndClearances.get(lampClearanceKey(edge.startNodeId, edge.id)) ?? 0,
			);
			const endInset = Math.max(
				regularInset,
				lampEndClearances.get(lampClearanceKey(edge.endNodeId, edge.id)) ?? 0,
			);
			const lampSides = node.roadsideLampsBothSides
				? (["left", "right"] as const)
				: (["right"] as const);
			const lampStations = stations(length, spacing, startInset, endInset);
			const endHasConnectedClearance = lampEndClearances.has(
				lampClearanceKey(edge.endNodeId, edge.id),
			);
			const endStation = length - endInset;
			if (
				endHasConnectedClearance &&
				endStation >= startInset &&
				!lampStations.some((station) => Math.abs(station - endStation) < 1e-3)
			) {
				lampStations.push(endStation);
			}
			lampStations.sort((left, right) => left - right);
			for (const station of lampStations) {
				for (const side of lampSides) {
					add(
						"lamp",
						side,
						station,
						lampVergeOffset(style, side),
						"regular-lighting",
					);
				}
			}
		}
		if (length > 8) {
			const startDegree = degreeByNode.get(edge.startNodeId) ?? 0;
			const endDegree = degreeByNode.get(edge.endNodeId) ?? 0;
			const startIsJunction = startDegree >= 3;
			const endIsJunction = endDegree >= 3;
			const startClearance =
				lampEndClearances.get(lampClearanceKey(edge.startNodeId, edge.id)) ??
				ROADSIDE_LAMP_MIN_CORNER_SETBACK;
			const endClearance =
				lampEndClearances.get(lampClearanceKey(edge.endNodeId, edge.id)) ??
				ROADSIDE_LAMP_MIN_CORNER_SETBACK;
			const drivingSide =
				node.regionalPack === "left-driving" ? "left" : "right";
			const sideForFacing = (facing: "forward" | "reverse") =>
				facing === "reverse"
					? drivingSide
					: drivingSide === "right"
						? "left"
						: "right";
			const addSign = (
				station: number,
				facing: "forward" | "reverse",
				ruleId: string,
			) => {
				const side = sideForFacing(facing);
				add(
					"sign",
					side,
					station,
					lampVergeOffset(style, side),
					ruleId,
					facing,
				);
			};
			if (startIsJunction && endIsJunction) {
				if (startClearance + endClearance + 4 <= length) {
					addSign(startClearance, "forward", "junction-signage");
					addSign(length - endClearance, "reverse", "junction-signage");
				}
			} else if (startIsJunction) {
				if (startClearance <= length - 2) {
					addSign(startClearance, "forward", "junction-signage");
				}
			} else if (endIsJunction) {
				if (endClearance <= length - 2) {
					addSign(length - endClearance, "reverse", "junction-signage");
				}
			} else if (endDegree === 1) {
				addSign(length - 4, "reverse", "terminal-signage");
			} else if (startDegree === 1) {
				addSign(4, "forward", "terminal-signage");
			}
		}
	}
	addJunctionLighting(node, decorations, spacing);
	return resolveLampSignCollisions(node, decorations);
}

export type RoadsideDecorationPreview = RoadsideDecoration & {
	position: [number, number, number];
	rotationY: number;
};

export function buildRoadsideDecorationPreviews(
	node: RoadNetworkNode,
): RoadsideDecorationPreview[] {
	return Object.values(node.roadsideDecorations ?? {}).flatMap((decoration) => {
		if (decoration.worldPosition && decoration.worldRotationY !== undefined) {
			return [
				{
					...decoration,
					position: [...decoration.worldPosition] as [number, number, number],
					rotationY: decoration.worldRotationY,
				},
			];
		}
		const edge = node.edges[decoration.edgeId];
		if (!edge) return [];
		const style = edgeStyle(node, edge);
		const points = sampleRoadEdgePoints(node, edge, 40) as Array<
			[number, number, number]
		>;
		const edgeLength = sampledLength(points);
		let remaining = decoration.station;
		for (let index = 0; index < points.length - 1; index += 1) {
			const start = points[index]!;
			const end = points[index + 1]!;
			const length = Math.hypot(
				end[0] - start[0],
				end[1] - start[1],
				end[2] - start[2],
			);
			if (remaining > length && index < points.length - 2) {
				remaining -= length;
				continue;
			}
			const ratio = Math.min(1, remaining / Math.max(length, 1e-6));
			const dx = end[0] - start[0];
			const dz = end[2] - start[2];
			const horizontal = Math.max(Math.hypot(dx, dz), 1e-6);
			const tangentAngle = Math.atan2(dz, dx);
			const signFacesForward = decoration.facing
				? decoration.facing === "forward"
				: decoration.station <= edgeLength / 2;
			const rotationY =
				decoration.kind === "lamp"
					? -tangentAngle +
						(decoration.side === "left" ? Math.PI / 2 : -Math.PI / 2)
					: -tangentAngle + (signFacesForward ? Math.PI / 2 : -Math.PI / 2);
			return [
				{
					...decoration,
					position: [
						start[0] +
							dx * ratio -
							(dz / horizontal) * decoration.lateralOffset,
						start[1] + (end[1] - start[1]) * ratio + VERGE_ELEVATION_OFFSET,
						start[2] +
							dz * ratio +
							(dx / horizontal) * decoration.lateralOffset,
					],
					rotationY,
				},
			];
		}
		return [];
	});
}

export type MaterializedRoadsideDecorationSelection = {
	attachment: RoadEdgeAttachment;
	networkPatch: Partial<RoadNetworkNode>;
	node: StreetLightNode | RoadSignNode;
	selection: { selectedIds: [string] };
};

/** Promote an embedded decoration to a normal scene node so selection targets only that item. */
export function materializeRoadsideDecorationSelection(
	network: RoadNetworkNode,
	decorationId: string,
	occupiedIds: Iterable<string>,
): MaterializedRoadsideDecorationSelection | null {
	const decoration = network.roadsideDecorations?.[decorationId];
	if (!decoration) return null;
	const preview = buildRoadsideDecorationPreviews(network).find(
		(candidate) => candidate.id === decorationId,
	);
	if (!preview) return null;

	const occupied = new Set(occupiedIds);
	const sharedNode = {
		parentId: network.parentId,
		position: [...preview.position] as [number, number, number],
		rotation: [0, preview.rotationY, 0] as [number, number, number],
		visible: network.showRoadsideDecorations
			? network.roadsideItemVisibility?.[decoration.kind] !== false
			: network.roadsideItemVisibility?.[decoration.kind] === true,
		metadata: {
			generatedBy: "road-auto-infrastructure",
            generatedItemAccepted:false,
			roadAutoInfrastructureKey: decorationId,
            ...(decoration.legacyKey?{roadAutoInfrastructureLegacyKey:decoration.legacyKey}:{}),
			roadEdgeId: decoration.edgeId,
			roadNetworkId: network.id,
			roadStation: decoration.station,
			roadsideItemKind: decoration.kind,
		},
	};
	let node: StreetLightNode | RoadSignNode;
	if (decoration.kind === "lamp") {
		let lamp = StreetLightNode.parse(sharedNode);
		while (occupied.has(lamp.id))
			lamp = StreetLightNode.parse({ ...lamp, id: undefined });
		node = lamp;
	} else {
		node = createRoadSignNode({ ...sharedNode, signId: "stop" }, occupied);
	}

	const attachmentId = `${node.id}:road`;
	const provisional: RoadEdgeAttachment = {
		id: attachmentId,
		edgeId: decoration.edgeId,
		assetNodeId: node.id,
		kind: decoration.kind,
		station: decoration.station,
		lateralOffset: decoration.lateralOffset,
		verticalOffset: 0,
		alignment: "free",
		side: decoration.side,
		placementMode: "generated",
		generatedKey: decorationId,
	};
	const attachment = reanchorRoadAttachment(network, provisional, node);
	if (!attachment) return null;
	const roadAttachment = {
		networkNodeId: network.id,
		attachmentId,
		side: attachment.side,
	};
	node =
		decoration.kind === "lamp"
			? StreetLightNode.parse({ ...node, roadAttachment })
			: RoadSignNode.parse({ ...node, roadAttachment });
	const { [decorationId]: _selected, ...roadsideDecorations } =
		network.roadsideDecorations;
	return {
		attachment,
		networkPatch: {
			attachments: { ...network.attachments, [attachmentId]: attachment },
			roadsideDecorations,
			roadsideDecorationSuppressed: {
				...(network.roadsideDecorationSuppressed ?? {}),
				[decorationId]: true,
			},
		},
		node,
		selection: { selectedIds: [node.id] },
	};
}

/** @deprecated Use materializeRoadsideDecorationSelection. */
export const materializeRoadsideLampSelection =
	materializeRoadsideDecorationSelection;

/** Preserve sign visibility while keeping a nearby fixture wherever the road has room. */
function resolveLampSignCollisions(
	node: RoadNetworkNode,
	decorations: RoadNetworkNode["roadsideDecorations"],
): RoadNetworkNode["roadsideDecorations"] {
	let resolved = { ...decorations };
	const minimumLampSeparation = Math.min(
		6,
		resolvedRoadsideDecorationSpacing(node.roadsideDecorationSpacing) / 2,
	);
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const previews = buildRoadsideDecorationPreviews({
			...node,
			roadsideDecorations: resolved,
		});
		const signs = previews.filter((decoration) => decoration.kind === "sign");
		const collisions = previews.flatMap((lamp) => {
			if (lamp.kind !== "lamp") return [];
			const sign = signs
				.map((candidate) => ({
					candidate,
					distance: Math.hypot(
						lamp.position[0] - candidate.position[0],
						lamp.position[1] - candidate.position[1],
						lamp.position[2] - candidate.position[2],
					),
				}))
				.filter(({ distance }) => distance < ROADSIDE_SIGN_LAMP_MIN_SEPARATION)
				.sort((left, right) => left.distance - right.distance)[0]?.candidate;
			return sign ? [{ lamp, sign }] : [];
		});
		if (collisions.length === 0) return resolved;
		for (const { lamp, sign } of collisions) {
			delete resolved[lamp.id];
			if (lamp.worldPosition) continue;
			if (lamp.edgeId !== sign.edgeId) continue;
			const direction = sign.facing === "forward" ? 1 : -1;
			const station =
				sign.station +
				direction * (ROADSIDE_SIGN_LAMP_MIN_SEPARATION + (attempt + 1) * 0.25);
			const edge = node.edges[lamp.edgeId];
			if (!edge) continue;
			const edgeLength = sampledLength(
				sampleRoadEdgePoints(node, edge, 36) as Array<[number, number, number]>,
			);
			if (station <= 0 || station >= edgeLength) continue;
			const id = `roadside:${lamp.ruleId}:${lamp.edgeId}:${lamp.side}:${station.toFixed(2)}`;
			const overlapsExistingLamp = Object.values(resolved).some(
				(candidate) =>
					candidate.kind === "lamp" &&
					!candidate.worldPosition &&
					candidate.edgeId === lamp.edgeId &&
					candidate.side === lamp.side &&
					Math.abs(candidate.station - station) < minimumLampSeparation,
			);
			if (!overlapsExistingLamp) resolved[id] = { ...lamp, id, station };
		}
	}
	const finalPreviews = buildRoadsideDecorationPreviews({
		...node,
		roadsideDecorations: resolved,
	});
	const finalSigns = finalPreviews.filter(
		(decoration) => decoration.kind === "sign",
	);
	const unsafeLampIds = new Set(
		finalPreviews.flatMap((lamp) =>
			lamp.kind === "lamp" &&
			finalSigns.some(
				(sign) =>
					Math.hypot(
						lamp.position[0] - sign.position[0],
						lamp.position[1] - sign.position[1],
						lamp.position[2] - sign.position[2],
					) < ROADSIDE_SIGN_LAMP_MIN_SEPARATION,
			)
				? [lamp.id]
				: [],
		),
	);
	return Object.fromEntries(
		Object.entries(resolved).filter(([id]) => !unsafeLampIds.has(id)),
	);
}

export function RoadsideDecorationInspector({
	node,
	onUpdate,
}: {
	node: RoadNetworkNode;
	onUpdate: (patch: Partial<RoadNetworkNode>) => void;
}) {
	const spacing = resolvedRoadsideDecorationSpacing(
		node.roadsideDecorationSpacing,
	);
	const previewVisible = useProposalPreview(
		(state) => !state.hidden.has(node.id),
	);
	const itemVisibility = node.roadsideItemVisibility ?? {};
	const generatedCount = useScene(
		(state) =>
			Object.values(state.nodes).filter((candidate) => {
				const metadata = candidate.metadata;
				return (
					metadata &&
					typeof metadata === "object" &&
					!Array.isArray(metadata) &&
					(metadata as Record<string, unknown>).generatedBy ===
						"road-auto-infrastructure" &&
					(metadata as Record<string, unknown>).roadNetworkId === node.id
				);
			}).length,
	);
	const visibilityOptions = [
		{ key: "lamp", label: "Roadside lamps" },
		{ key: "sign", label: "Roadside signs" },
		...ROAD_AUTO_INFRASTRUCTURE_OPTIONS.map((option) => ({
			key: option.kind,
			label: option.label,
		})),
	];
	const [reviewWidening, setReviewWidening] = useState(false);
	const usedStyles = new Set(
		node.applyStyleToAll
			? [node.activeStyleId]
			: Object.values(node.edges).map((edge) => edge.styleId),
	);
	const proposedStyles = Object.fromEntries(
		Object.entries(node.stylePresets).map(([id, style]) => [
			id,
			usedStyles.has(id)
				? applyRoadAutoInfrastructureClearances(
						style,
						FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
					)
				: style,
		]),
	);
	const widthChanges = Object.entries(proposedStyles).flatMap(([id, style]) => {
		const before = buildRoadCrossSection(node.stylePresets[id]!).totalWidth;
		const after = buildRoadCrossSection(style).totalWidth;
		return after > before ? [{ id, before, after }] : [];
	});
	const proposedNetwork = RoadNetworkNodeSchema.parse({
		...node,
		stylePresets: proposedStyles,
	});
	const proposedPlacements = reviewWidening
		? buildRoadAutoInfrastructurePlan({
				network: proposedNetwork,
				edgeIds: Object.keys(node.edges),
				existingNodes: Object.values(useScene.getState().nodes),
				settings: FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
			}).nodes.length
		: 0;
	const autoFill = (acceptWidening = false) => {
		const scene = useScene.getState();
		const allEnabled = FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS;
		const roadsideItemVisibility = Object.fromEntries(
			visibilityOptions.map((option) => [
				option.key,
				itemVisibility[option.key] ?? true,
			]),
		);
		const stylePresets = acceptWidening ? proposedStyles : node.stylePresets;
		const network = RoadNetworkNodeSchema.parse({
			...node,
			roadsideAutoFillEnabled: true,
			roadsideItemVisibility,
			stylePresets,
		});
		const plan = buildRoadAutoInfrastructurePlan({
			edgeIds: Object.keys(network.edges),
			existingNodes: Object.values(scene.nodes),
			network,
			settings: allEnabled,
		});
		scene.applyNodeChanges({
			update: [
				{
					id: node.id as AnyNodeId,
					data: {
						attachments: { ...network.attachments, ...plan.attachments },
						roadsideAutoFillEnabled: true,
						roadsideItemVisibility,
						stylePresets,
					} as Partial<AnyNode>,
				},
			],
			create: plan.nodes.map((generated) => ({
				node: generated as unknown as AnyNode,
				parentId: node.parentId as AnyNodeId,
			})),
		});
	};
	return (
		<div aria-label="Roadside decorations" className="flex flex-col gap-2">
			<button
				type="button"
				aria-pressed={previewVisible}
				onClick={() =>
					useProposalPreview.getState().setVisible(node.id, !previewVisible)
				}
			>
				{previewVisible
					? "Hide generated proposals"
					: "Show generated proposals"}
			</button>
			<button
				aria-label="Auto-fill roadside"
				className="rounded-md border border-sidebar-border bg-sidebar-accent px-2.5 py-2 font-medium text-sidebar-foreground text-xs transition-colors hover:bg-sidebar-accent/70"
				onClick={() => autoFill()}
				type="button"
			>
				{generatedCount > 0 ? "Refresh auto-fill" : "Auto-fill roadside"}
			</button>
			{widthChanges.length > 0 && (
				<button type="button" onClick={() => setReviewWidening(true)}>
					Review furnishing widths
				</button>
			)}
			{reviewWidening && (
				<div aria-label="Furnishing width proposal">
					{widthChanges.map((change) => (
						<p key={change.id}>
							{change.id}: {change.before.toFixed(2)} m →{" "}
							{change.after.toFixed(2)} m
						</p>
					))}
					<p>
						{proposedPlacements} new placements after widening. Existing strips
						and adjusted items are retained.
					</p>
					<button
						type="button"
						onClick={() => {
							autoFill(true);
							setReviewWidening(false);
						}}
					>
						Apply widths and furnishings
					</button>
					<button type="button" onClick={() => setReviewWidening(false)}>
						Cancel width proposal
					</button>
				</div>
			)}
			<span className="text-[10px] leading-snug text-sidebar-foreground/50">
				{generatedCount > 0
					? `${generatedCount} generated items stay aligned with this road.`
					: "Generate roadside items and keep them aligned as the road changes."}
			</span>
			<div
				aria-label="Roadside item visibility"
				className="flex flex-col gap-1"
			>
				{visibilityOptions.map((option) => (
					<ToggleControl
						checked={itemVisibility[option.key] === true}
						key={option.key}
						label={option.label}
						onChange={(visible) => {
							onUpdate({
								roadsideItemVisibility: {
									...itemVisibility,
									[option.key]: visible,
								},
							});
						}}
					/>
				))}
			</div>
			<div aria-label="Roadside lamp sides">
				<ToggleControl
					checked={node.roadsideLampsBothSides ?? false}
					label="Lamps on both sides"
					onChange={(roadsideLampsBothSides) =>
						onUpdate({ roadsideLampsBothSides })
					}
				/>
			</div>
			<div aria-label="Roadside decoration spacing">
				<SliderControl
					label="Spacing"
					max={100}
					min={10}
					onChange={(roadsideDecorationSpacing) =>
						onUpdate({ roadsideDecorationSpacing })
					}
					precision={0}
					step={1}
					unit="m"
					value={spacing}
				/>
			</div>
		</div>
	);
}
