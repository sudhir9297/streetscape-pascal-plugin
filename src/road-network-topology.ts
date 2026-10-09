import { splitStreetSectionLayout } from "./domain/street-section-layout-split";
import { buildRoadCrossSection } from "./road-cross-section";
import {
	sampleRoadAlignmentPoints,
	sampleRoadEdgePoints,
} from "./road-network-geometry";
import { splitRoadVerticalProfile } from "./road-network-vertical-profile";
import {
	DEFAULT_ROAD_STYLE_ID,
	DEFAULT_ROAD_STYLE_PRESETS,
} from "./road-style-presets";
import type {
	RoadEdgeAttachment,
	RoadGraphEdge,
	RoadGraphNode,
	RoadJunction,
	RoadNetworkNode,
	RoadStylePreset,
} from "./schema";

export type RoadPoint = readonly [number, number, number];
export type RoadJunctionKind =
	| "isolated"
	| "dead-end"
	| "straight"
	| "bend-l"
	| "bend-v"
	| "tee"
	| "y"
	| "four-way-plus"
	| "four-way-x"
	| "multi-leg";

export type RoadNetworkGraph = Pick<
	RoadNetworkNode,
	| "graphNodes"
	| "edges"
	| "attachments"
	| "junctions"
	| "stylePresets"
	| "activeStyleId"
>;

export type InsertRoadSegmentResult = {
	edgeIdRemap: Record<string, string[]>;
	graph: RoadNetworkGraph;
	createdNodeIds: string[];
	createdEdgeIds: string[];
	splitEdgeIds: string[];
	status: "inserted" | "duplicate" | "too-short";
};

export type RoadInsertOptions = {
	alignment?: RoadPoint[];
	bendRadius?: number;
	tangentLength?: number;
	joinMode?: RoadGraphEdge["joinMode"];
	tolerance?: number;
	level?: number;
	elevationMode?: RoadGraphNode["elevationMode"];
	overlapGroup?: string;
	styleId?: string;
	roadClass?: RoadGraphEdge["roadClass"];
	stackLevel?: number;
	verticalTolerance?: number;
};

export type RoadInsertionOperation =
	| "create-cross"
	| "create-tee"
	| "duplicate"
	| "extend-road"
	| "join-endpoints"
	| "new-road"
	| "no-connection"
	| "too-short";

export type RoadInsertionPreview = {
	operation: RoadInsertionOperation;
	result: InsertRoadSegmentResult;
};

export type RoadDraftSnapTarget = {
	distance: number;
	edgeId?: string;
	kind: "centerline" | "node";
	nodeId?: string;
	point: [number, number, number];
};

const EPSILON = 1e-6;

function distanceXZ(a: RoadPoint, b: RoadPoint): number {
	return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function nextId(prefix: string, occupied: Record<string, unknown>): string {
	let index = Object.keys(occupied).length + 1;
	let id = `${prefix}_${index}`;
	while (id in occupied) id = `${prefix}_${++index}`;
	return id;
}

function cloneGraph(graph: RoadNetworkGraph): RoadNetworkGraph {
	return {
		graphNodes: { ...graph.graphNodes },
		edges: { ...graph.edges },
		attachments: Object.fromEntries(
			Object.entries(graph.attachments ?? {}).map(([id, attachment]) => [
				id,
				{ ...attachment },
			]),
		),
		junctions: Object.fromEntries(
			Object.entries(graph.junctions ?? {}).map(([nodeId, junction]) => [
				nodeId,
				{
					...junction,
					primaryEdgeIds: [...junction.primaryEdgeIds],
					approachControls: { ...(junction.approachControls ?? {}) },
					cornerRadii: { ...junction.cornerRadii },
				},
			]),
		),
		stylePresets: { ...graph.stylePresets },
		activeStyleId: graph.activeStyleId,
	};
}

function availableInnerId(
	id: string,
	occupied: Record<string, unknown>,
): string {
	if (!(id in occupied)) return id;
	let suffix = 2;
	let candidate = `${id}__${suffix}`;
	while (candidate in occupied) candidate = `${id}__${++suffix}`;
	return candidate;
}

/**
 * Combine independently stored road components before inserting a segment
 * that may join them. Inner node/edge IDs are local to a scene node, so any
 * collisions are remapped rather than silently overwriting graph data.
 */
/** Allocate a style identity without changing an existing road's cross section. */
export function assignRoadStylePreset(
	graph: RoadNetworkGraph,
	style: RoadStylePreset,
): string {
	const existing = graph.stylePresets[style.id];
	const id =
		existing && JSON.stringify(existing) !== JSON.stringify(style)
			? availableInnerId(style.id, graph.stylePresets)
			: style.id;
	graph.stylePresets[id] = { ...style, id };
	return id;
}

export function mergeRoadGraphs(sources: RoadNetworkGraph[]): {
	attachmentIdMaps: Array<Record<string, string>>;
	edgeIdMaps: Array<Record<string, string>>;
	graph: RoadNetworkGraph;
	nodeIdMaps: Array<Record<string, string>>;
	styleIdMaps: Array<Record<string, string>>;
} {
	const graph: RoadNetworkGraph = {
		graphNodes: {},
		edges: {},
		attachments: {},
		junctions: {},
		stylePresets: {},
		activeStyleId: sources[0]?.activeStyleId ?? DEFAULT_ROAD_STYLE_ID,
	};
	const nodeIdMaps: Array<Record<string, string>> = [];
	const edgeIdMaps: Array<Record<string, string>> = [];
	const attachmentIdMaps: Array<Record<string, string>> = [];
	const styleIdMaps: Array<Record<string, string>> = [];

	for (const source of sources) {
		const styleIdMap: Record<string, string> = {};
		for (const [id, style] of Object.entries(source.stylePresets)) {
			styleIdMap[id] = assignRoadStylePreset(graph, style);
		}
		styleIdMaps.push(styleIdMap);
		const nodeIdMap: Record<string, string> = {};
		for (const node of Object.values(source.graphNodes)) {
			const id = availableInnerId(node.id, graph.graphNodes);
			nodeIdMap[node.id] = id;
			graph.graphNodes[id] = { ...node, id, position: [...node.position] };
		}
		nodeIdMaps.push(nodeIdMap);

		const edgeIdMap: Record<string, string> = {};
		for (const edge of Object.values(source.edges)) {
			edgeIdMap[edge.id] = availableInnerId(edge.id, {
				...graph.edges,
				...Object.fromEntries(Object.values(edgeIdMap).map((id) => [id, true])),
			});
		}
		for (const edge of Object.values(source.edges)) {
			const id = edgeIdMap[edge.id]!;
			graph.edges[id] = {
				...edge,
				id,
				styleId:
					styleIdMap[
						(source as Partial<RoadNetworkNode>).applyStyleToAll
							? source.activeStyleId
							: edge.styleId
					] ?? edge.styleId,
				startNodeId: nodeIdMap[edge.startNodeId] ?? edge.startNodeId,
				endNodeId: nodeIdMap[edge.endNodeId] ?? edge.endNodeId,
				alignment: edge.alignment.map((point) => [...point]),
				...(edge.parentEdgeId
					? { parentEdgeId: edgeIdMap[edge.parentEdgeId] ?? edge.parentEdgeId }
					: {}),
			};
		}
		const attachmentIdMap: Record<string, string> = {};
		for (const attachment of Object.values(source.attachments ?? {})) {
			attachmentIdMap[attachment.id] = availableInnerId(attachment.id, {
				...graph.attachments,
				...Object.fromEntries(
					Object.values(attachmentIdMap).map((id) => [id, true]),
				),
			});
		}
		for (const attachment of Object.values(source.attachments ?? {})) {
			const edgeId = edgeIdMap[attachment.edgeId];
			if (!edgeId) continue;
			const id = attachmentIdMap[attachment.id]!;
			graph.attachments[id] = { ...attachment, id, edgeId };
		}
		for (const junction of Object.values(source.junctions ?? {})) {
			const nodeId = nodeIdMap[junction.nodeId];
			if (!nodeId) continue;
			graph.junctions[nodeId] = {
				...junction,
				nodeId,
				primaryEdgeIds: junction.primaryEdgeIds.flatMap((edgeId) =>
					edgeIdMap[edgeId] ? [edgeIdMap[edgeId]!] : [],
				),
				approachControls: Object.fromEntries(
					Object.entries(junction.approachControls ?? {}).flatMap(
						([edgeId, control]) =>
							edgeIdMap[edgeId] ? [[edgeIdMap[edgeId]!, control]] : [],
					),
				),
				cornerRadii: Object.fromEntries(
					Object.entries(junction.cornerRadii).flatMap(([key, radius]) => {
						const pair = parseRoadJunctionCornerKey(key);
						if (!pair) return [];
						const first = edgeIdMap[pair[0]];
						const second = edgeIdMap[pair[1]];
						return first && second
							? [[roadJunctionCornerKey(first, second), radius]]
							: [];
					}),
				),
			};
		}
		edgeIdMaps.push(edgeIdMap);
		attachmentIdMaps.push(attachmentIdMap);
	}

	if (Object.keys(graph.stylePresets).length === 0) {
		graph.stylePresets = createEmptyRoadGraph().stylePresets;
	}
	reconcileRoadJunctions(graph);
	return { attachmentIdMaps, edgeIdMaps, graph, nodeIdMaps, styleIdMaps };
}

/** One selectable road scene node per connected graph component. */
export function splitRoadGraphComponents(
	source: RoadNetworkGraph,
): RoadNetworkGraph[] {
	const adjacency = new Map<string, Set<string>>();
	for (const nodeId of Object.keys(source.graphNodes))
		adjacency.set(nodeId, new Set());
	for (const edge of Object.values(source.edges)) {
		if (!adjacency.has(edge.startNodeId) || !adjacency.has(edge.endNodeId))
			continue;
		adjacency.get(edge.startNodeId)!.add(edge.endNodeId);
		adjacency.get(edge.endNodeId)!.add(edge.startNodeId);
	}

	const visited = new Set<string>();
	const components: RoadNetworkGraph[] = [];
	for (const firstNodeId of Object.keys(source.graphNodes)) {
		if (visited.has(firstNodeId)) continue;
		const pending = [firstNodeId];
		const componentNodeIds = new Set<string>();
		while (pending.length > 0) {
			const nodeId = pending.pop()!;
			if (visited.has(nodeId)) continue;
			visited.add(nodeId);
			componentNodeIds.add(nodeId);
			for (const adjacentId of adjacency.get(nodeId) ?? []) {
				if (!visited.has(adjacentId)) pending.push(adjacentId);
			}
		}

		const graphNodes = Object.fromEntries(
			Object.entries(source.graphNodes).filter(([nodeId]) =>
				componentNodeIds.has(nodeId),
			),
		);
		const edges = Object.fromEntries(
			Object.entries(source.edges).filter(
				([, edge]) =>
					componentNodeIds.has(edge.startNodeId) &&
					componentNodeIds.has(edge.endNodeId),
			),
		);
		const attachments = Object.fromEntries(
			Object.entries(source.attachments ?? {}).filter(
				([, attachment]) => attachment.edgeId in edges,
			),
		);
		const junctions = Object.fromEntries(
			Object.entries(source.junctions ?? {}).filter(([nodeId]) =>
				componentNodeIds.has(nodeId),
			),
		);
		const component = {
			graphNodes,
			edges,
			attachments,
			junctions,
			stylePresets: { ...source.stylePresets },
			activeStyleId: source.activeStyleId,
		};
		reconcileRoadJunctions(component);
		components.push(component);
	}
	return components;
}

export function createDefaultRoadStyle(): RoadStylePreset {
	return { ...DEFAULT_ROAD_STYLE_PRESETS[DEFAULT_ROAD_STYLE_ID] };
}

export function createEmptyRoadGraph(): RoadNetworkGraph {
	const stylePresets = Object.fromEntries(
		Object.entries(DEFAULT_ROAD_STYLE_PRESETS).map(([id, style]) => [
			id,
			{ ...style },
		]),
	) as Record<string, RoadStylePreset>;
	return {
		graphNodes: {},
		edges: {},
		attachments: {},
		junctions: {},
		stylePresets,
		activeStyleId: DEFAULT_ROAD_STYLE_ID,
	};
}

export function roadStyleWidth(style: RoadStylePreset): number {
	return buildRoadCrossSection(style).totalWidth;
}

export function incidentRoadEdges(
	graph: RoadNetworkGraph,
	nodeId: string,
): RoadGraphEdge[] {
	return Object.values(graph.edges).filter(
		(edge) => edge.startNodeId === nodeId || edge.endNodeId === nodeId,
	);
}

export function roadJunctionCornerKey(
	firstEdgeId: string,
	secondEdgeId: string,
): string {
	return [firstEdgeId, secondEdgeId].sort().join("::");
}

export function parseRoadJunctionCornerKey(
	key: string,
): readonly [string, string] | null {
	const parts = key.split("::");
	return parts.length === 2 && parts[0] && parts[1]
		? [parts[0], parts[1]]
		: null;
}

function edgeDirectionAtNode(
	graph: RoadNetworkGraph,
	nodeId: string,
	edge: RoadGraphEdge,
): readonly [number, number] | null {
	const points = sampleRoadEdgePoints(graph, edge, 48);
	if (points.length < 2) return null;
	const nodeAtStart = edge.startNodeId === nodeId;
	const nodePoint = nodeAtStart ? points[0]! : points.at(-1)!;
	const adjacentPoint = nodeAtStart ? points[1]! : points.at(-2)!;
	const direction = [
		adjacentPoint[0] - nodePoint[0],
		adjacentPoint[2] - nodePoint[2],
	] as const;
	return Math.hypot(direction[0], direction[1]) > EPSILON ? direction : null;
}

const ROAD_CLASS_PRIORITY: Record<RoadGraphEdge["roadClass"], number> = {
	alley: 0,
	service: 1,
	local: 2,
	collector: 3,
	arterial: 4,
	highway: 5,
};

/** Ordered primary-road candidates, best geometric continuation first. */
export function roadJunctionPrimaryCandidates(
	graph: RoadNetworkGraph,
	nodeId: string,
): Array<readonly [string, string]> {
	const approaches = incidentRoadEdges(graph, nodeId).flatMap((edge) => {
		const direction = edgeDirectionAtNode(graph, nodeId, edge);
		return direction ? [{ edge, direction }] : [];
	});
	const candidates: Array<{
		pair: readonly [string, string];
		angle: number;
		classPriority: number;
		width: number;
	}> = [];
	for (let first = 0; first < approaches.length; first++) {
		for (let second = first + 1; second < approaches.length; second++) {
			const left = approaches[first]!;
			const right = approaches[second]!;
			const leftStyle = graph.stylePresets[left.edge.styleId];
			const rightStyle = graph.stylePresets[right.edge.styleId];
			candidates.push({
				pair: [left.edge.id, right.edge.id].sort() as [string, string],
				angle: angleBetween(left.direction, right.direction),
				classPriority:
					ROAD_CLASS_PRIORITY[left.edge.roadClass] +
					ROAD_CLASS_PRIORITY[right.edge.roadClass],
				width:
					(leftStyle ? roadStyleWidth(leftStyle) : 0) +
					(rightStyle ? roadStyleWidth(rightStyle) : 0),
			});
		}
	}
	return candidates
		.sort(
			(left, right) =>
				right.angle - left.angle ||
				right.classPriority - left.classPriority ||
				right.width - left.width ||
				left.pair.join(":").localeCompare(right.pair.join(":")),
		)
		.map(({ pair }) => pair);
}

function roadJunctionCornerPairs(
	graph: RoadNetworkGraph,
	nodeId: string,
): Array<readonly [string, string]> {
	const approaches = incidentRoadEdges(graph, nodeId)
		.flatMap((edge) => {
			const direction = edgeDirectionAtNode(graph, nodeId, edge);
			return direction
				? [{ edgeId: edge.id, angle: Math.atan2(direction[1], direction[0]) }]
				: [];
		})
		.sort((left, right) => left.angle - right.angle);
	if (approaches.length < 3) return [];
	return approaches.map(
		(approach, index) =>
			[
				approach.edgeId,
				approaches[(index + 1) % approaches.length]!.edgeId,
			] as const,
	);
}

function isPersistentJunctionKind(
	kind: RoadJunctionKind,
): kind is RoadJunction["kind"] {
	return (
		kind === "tee" ||
		kind === "y" ||
		kind === "four-way-plus" ||
		kind === "four-way-x" ||
		kind === "multi-leg"
	);
}

function derivedRoadJunction(
	graph: RoadNetworkGraph,
	nodeId: string,
): RoadJunction | null {
	const kind = classifyRoadJunction(graph, nodeId);
	if (!isPersistentJunctionKind(kind)) return null;
	const previous = graph.junctions?.[nodeId];
	const incidentIds = new Set(
		incidentRoadEdges(graph, nodeId).map((edge) => edge.id),
	);
	const manualPrimary =
		previous?.primaryMode === "manual" &&
		previous.primaryEdgeIds.length === 2 &&
		previous.primaryEdgeIds.every((edgeId) => incidentIds.has(edgeId));
	const primaryEdgeIds = manualPrimary
		? [...previous.primaryEdgeIds]
		: [...(roadJunctionPrimaryCandidates(graph, nodeId)[0] ?? [])];
	const cornerRadii = Object.fromEntries(
		roadJunctionCornerPairs(graph, nodeId).map(([first, second]) => {
			const key = roadJunctionCornerKey(first, second);
			return [key, previous?.cornerRadii[key] ?? 6];
		}),
	);
	return {
		nodeId,
		kind,
		treatment: previous?.treatment ?? "auto",
		approachControls: Object.fromEntries(
			Object.entries(previous?.approachControls ?? {}).filter(([edgeId]) =>
				incidentIds.has(edgeId),
			),
		),
		primaryMode: manualPrimary ? "manual" : "auto",
		primaryEdgeIds,
		cornerRadii,
		manualBoundaryEnabled: previous?.manualBoundaryEnabled ?? false,
		manualBoundaryPoints: (previous?.manualBoundaryPoints ?? []).map(
			(point) => [point[0], point[1]],
		),
		solverStatus:
			previous?.manualBoundaryEnabled || previous?.solverStatus === "manual"
				? "manual"
				: kind === "multi-leg"
					? "warning"
					: "auto",
	};
}

/**
 * Regenerate derived junction records while preserving explicit treatment,
 * manual primary-road choices, and the radii of corners that still exist.
 */
export function reconcileRoadJunctions(
	graph: RoadNetworkGraph,
): RoadNetworkGraph {
	const next: Record<string, RoadJunction> = {};
	for (const nodeId of Object.keys(graph.graphNodes)) {
		const junction = derivedRoadJunction(graph, nodeId);
		if (junction) next[nodeId] = junction;
	}
	graph.junctions = next;
	return graph;
}

export type RoadJunctionNeighborhoodResult = {
	graph: RoadNetworkGraph;
	reclassifiedNodeIds: string[];
};

/**
 * Reconcile only edited nodes and their immediate graph neighbors. A moved
 * node changes the approach direction seen by each neighbor, while an edge
 * deletion changes the degree of its two endpoints. Junction records outside
 * that one-hop neighborhood are retained by reference.
 */
export function reconcileRoadJunctionNeighborhood(
	graph: RoadNetworkGraph,
	seedNodeIds: Iterable<string>,
): RoadJunctionNeighborhoodResult {
	const affected = new Set(seedNodeIds);
	for (const nodeId of [...affected]) {
		for (const edge of incidentRoadEdges(graph, nodeId)) {
			affected.add(
				edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId,
			);
		}
	}
	const reclassifiedNodeIds = [...affected].sort();
	const next = { ...(graph.junctions ?? {}) };
	for (const nodeId of reclassifiedNodeIds) {
		const junction = derivedRoadJunction(graph, nodeId);
		if (junction) next[nodeId] = junction;
		else delete next[nodeId];
	}
	graph.junctions = next;
	return { graph, reclassifiedNodeIds };
}

function angleBetween(
	a: readonly [number, number],
	b: readonly [number, number],
): number {
	const aLength = Math.hypot(a[0], a[1]);
	const bLength = Math.hypot(b[0], b[1]);
	if (aLength < EPSILON || bLength < EPSILON) return 0;
	const dot = (a[0] * b[0] + a[1] * b[1]) / (aLength * bLength);
	return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function incidentDirections(
	graph: RoadNetworkGraph,
	nodeId: string,
): Array<readonly [number, number]> {
	const node = graph.graphNodes[nodeId];
	if (!node) return [];
	return incidentRoadEdges(graph, nodeId).flatMap((edge) => {
		const otherId =
			edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId;
		const other = graph.graphNodes[otherId];
		if (!other) return [];
		return [
			[
				other.position[0] - node.position[0],
				other.position[2] - node.position[2],
			] as const,
		];
	});
}

export function classifyRoadJunction(
	graph: RoadNetworkGraph,
	nodeId: string,
): RoadJunctionKind {
	const directions = incidentDirections(graph, nodeId);
	if (directions.length === 0) return "isolated";
	if (directions.length === 1) return "dead-end";
	if (directions.length >= 5) return "multi-leg";

	const pairs: Array<{ a: number; b: number; angle: number }> = [];
	for (let a = 0; a < directions.length; a++) {
		for (let b = a + 1; b < directions.length; b++) {
			pairs.push({ a, b, angle: angleBetween(directions[a]!, directions[b]!) });
		}
	}
	pairs.sort((left, right) => right.angle - left.angle);
	const widest = pairs[0]?.angle ?? 0;
	const degrees = (widest * 180) / Math.PI;

	if (directions.length === 2) {
		if (degrees >= 165) return "straight";
		if (degrees >= 75 && degrees <= 105) return "bend-l";
		return "bend-v";
	}

	if (directions.length === 3) return degrees >= 150 ? "tee" : "y";

	// Degree four: two nearly-opposite through pairs form a conventional
	// crossing. The acute angle between those axes distinguishes orthogonal
	// plus geometry from a skewed X geometry without relying on world rotation.
	const first = pairs[0];
	if (!first) return "four-way-x";
	const remaining = [0, 1, 2, 3].filter(
		(index) => index !== first.a && index !== first.b,
	);
	const secondAngle = angleBetween(
		directions[remaining[0]!]!,
		directions[remaining[1]!]!,
	);
	if (
		first.angle < (165 * Math.PI) / 180 ||
		secondAngle < (165 * Math.PI) / 180
	) {
		return "four-way-x";
	}
	const axisAngle = angleBetween(
		directions[first.a]!,
		directions[remaining[0]!]!,
	);
	const acuteAxisAngle = Math.min(axisAngle, Math.PI - axisAngle);
	const axisDegrees = (acuteAxisAngle * 180) / Math.PI;
	return axisDegrees >= 75 && axisDegrees <= 105
		? "four-way-plus"
		: "four-way-x";
}

export function roadBendTangentLength(
	graph: RoadNetworkGraph,
	nodeId: string,
	radius: number,
): number {
	const node = graph.graphNodes[nodeId];
	const edges = incidentRoadEdges(graph, nodeId);
	if (!node || edges.length !== 2 || radius <= 0) return 0;
	const vectors = edges.flatMap((edge) => {
		const otherId =
			edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId;
		const other = graph.graphNodes[otherId];
		if (!other) return [];
		const length = distanceXZ(node.position, other.position);
		if (length < EPSILON) return [];
		return [
			{
				length,
				direction: [
					(other.position[0] - node.position[0]) / length,
					(other.position[2] - node.position[2]) / length,
				] as const,
			},
		];
	});
	if (vectors.length !== 2) return 0;
	const interiorAngle = angleBetween(
		vectors[0]!.direction,
		vectors[1]!.direction,
	);
	if (interiorAngle < 1e-3 || Math.PI - interiorAngle < 1e-3) return 0;
	return Math.min(
		radius / Math.tan(interiorAngle / 2),
		vectors[0]!.length * 0.45,
		vectors[1]!.length * 0.45,
	);
}

export function roadBendRadiusForTangentLength(
	graph: RoadNetworkGraph,
	nodeId: string,
	tangentLength: number,
): number {
	const directions = incidentDirections(graph, nodeId);
	if (directions.length !== 2) return 0.1;
	const interiorAngle = angleBetween(directions[0]!, directions[1]!);
	if (interiorAngle < 1e-3 || Math.PI - interiorAngle < 1e-3) return 0.1;
	return Math.min(
		1000,
		Math.max(0.1, tangentLength * Math.tan(interiorAngle / 2)),
	);
}

export type RoadEdgeProjection = {
	distance: number;
	t: number;
	point: [number, number, number];
};

function projectPointToSegment(
	point: RoadPoint,
	start: RoadPoint,
	end: RoadPoint,
): RoadEdgeProjection {
	const dx = end[0] - start[0];
	const dz = end[2] - start[2];
	const lengthSquared = dx * dx + dz * dz;
	const rawT =
		lengthSquared < EPSILON
			? 0
			: ((point[0] - start[0]) * dx + (point[2] - start[2]) * dz) /
				lengthSquared;
	const t = Math.max(0, Math.min(1, rawT));
	const projected: [number, number, number] = [
		start[0] + dx * t,
		start[1] + (end[1] - start[1]) * t,
		start[2] + dz * t,
	];
	return { distance: distanceXZ(point, projected), t, point: projected };
}

type ConnectionContext = Pick<RoadGraphNode, "level" | "elevationMode"> & {
	joinMode: RoadGraphEdge["joinMode"];
	overlapGroup?: string;
	stackLevel: number;
	verticalTolerance: number;
};

function edgeAllowsConnection(
	edge: RoadGraphEdge,
	existingPoint: RoadPoint,
	candidatePoint: RoadPoint,
	context: ConnectionContext,
): boolean {
	if (context.joinMode === "suppress" || edge.joinMode === "suppress")
		return false;
	if (edge.stackLevel !== context.stackLevel) return false;
	if ((edge.overlapGroup ?? null) !== (context.overlapGroup ?? null))
		return false;
	return (
		Math.abs(existingPoint[1] - candidatePoint[1]) <= context.verticalTolerance
	);
}

function nodeAllowsConnection(
	graph: RoadNetworkGraph,
	node: RoadGraphNode,
	candidatePoint: RoadPoint,
	context: ConnectionContext,
): boolean {
	const incident = incidentRoadEdges(graph, node.id);
	if (incident.length === 0) {
		return (
			Math.abs(node.position[1] - candidatePoint[1]) <=
			context.verticalTolerance
		);
	}
	return incident.some((edge) =>
		edgeAllowsConnection(edge, node.position, candidatePoint, context),
	);
}

function addGraphNode(
	graph: RoadNetworkGraph,
	position: RoadPoint,
	template?: Pick<RoadGraphNode, "level" | "elevationMode">,
): string {
	const id = nextId("road-point", graph.graphNodes);
	graph.graphNodes[id] = {
		id,
		position: [position[0], position[1], position[2]],
		level: template?.level ?? 0,
		elevationMode: template?.elevationMode ?? "ground",
		terminal: false,
	};
	return id;
}

function addGraphEdge(
	graph: RoadNetworkGraph,
	startNodeId: string,
	endNodeId: string,
	template?: Partial<RoadGraphEdge>,
): string {
	const id = nextId("road-edge", graph.edges);
	graph.edges[id] = {
		id,
		startNodeId,
		endNodeId,
		alignment: template?.alignment?.map((point) => [...point]) ?? [],
		profileMode: template?.profileMode ?? "legacy",
		verticalProfile:
			template?.verticalProfile?.map((point) => ({ ...point })) ?? [],
		styleId: template?.styleId ?? graph.activeStyleId,
		direction: template?.direction ?? "both",
		...(template?.osmSource ? { osmSource: template.osmSource } : {}),
		...(template?.turnLanes ? { turnLanes: template.turnLanes } : {}),
		...(template?.sectionLayout ? { sectionLayout: structuredClone(template.sectionLayout) } : {}),
		...(template?.osmVertical ? { osmVertical: template.osmVertical } : {}),
		roadClass: template?.roadClass ?? "local",
		joinMode: template?.joinMode ?? "auto",
		stackLevel: template?.stackLevel ?? 0,
		...(template?.overlapGroup ? { overlapGroup: template.overlapGroup } : {}),
		...(template?.parentEdgeId ? { parentEdgeId: template.parentEdgeId } : {}),
	};
	return id;
}

function lerpPoint(
	a: RoadPoint,
	b: RoadPoint,
	t: number,
): [number, number, number] {
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	];
}

/** Return the interior alignment points for a normalized subsection of an edge. */
function sliceAlignment(
	start: RoadPoint,
	alignment: RoadPoint[],
	end: RoadPoint,
	fromT: number,
	toT: number,
): Array<[number, number, number]> {
	const from = Math.max(0, Math.min(1, fromT));
	const to = Math.max(from, Math.min(1, toT));
	if (alignment.length === 0 || to - from <= EPSILON) return [];
	if (from <= EPSILON && to >= 1 - EPSILON) {
		return alignment.map((point) => [...point] as [number, number, number]);
	}
	// Topology projections use the same 48-segment sampling request. Keep the
	// authored points that fall inside this subsection and add one sampled
	// midpoint when necessary. This preserves the spline's shape without
	// exposing dozens of renderer samples as editable floor-plan handles.
	const points = sampleRoadAlignmentPoints(
		[...start] as [number, number, number],
		alignment.map((point) => [...point] as [number, number, number]),
		[...end] as [number, number, number],
		48,
	);
	const segmentCount = points.length - 1;
	if (segmentCount < 1) return [];
	const authoredParameters = alignment.flatMap((_, index) => {
		const t = (index + 1) / (alignment.length + 1);
		return t > from + EPSILON && t < to - EPSILON ? [t] : [];
	});
	const midpoint = (from + to) / 2;
	const parameters = [...authoredParameters];
	if (!parameters.some((t) => Math.abs(t - midpoint) < EPSILON))
		parameters.push(midpoint);

	const pointAt = (t: number): [number, number, number] => {
		const scaled = Math.max(0, Math.min(1, t)) * segmentCount;
		const index = Math.min(Math.floor(scaled), segmentCount - 1);
		return lerpPoint(points[index]!, points[index + 1]!, scaled - index);
	};
	return parameters.sort((left, right) => left - right).map(pointAt);
}

function findNearbyNode(
	graph: RoadNetworkGraph,
	point: RoadPoint,
	tolerance: number,
	context: ConnectionContext,
): RoadGraphNode | null {
	let nearest: RoadGraphNode | null = null;
	let nearestDistance = tolerance;
	for (const node of Object.values(graph.graphNodes)) {
		if (!nodeAllowsConnection(graph, node, point, context)) continue;
		const distance = distanceXZ(node.position, point);
		if (distance <= nearestDistance) {
			nearest = node;
			nearestDistance = distance;
		}
	}
	return nearest;
}

function stationAtEdgeParameter(
	graph: RoadNetworkGraph,
	edge: RoadGraphEdge,
	t: number,
): number {
	const points = sampleRoadEdgePoints(graph, edge, 48);
	const segmentCount = points.length - 1;
	if (segmentCount < 1) return 0;
	const scaled = Math.max(0, Math.min(1, t)) * segmentCount;
	const completeSegments = Math.min(Math.floor(scaled), segmentCount);
	let station = 0;
	for (let index = 0; index < completeSegments; index++) {
		station += distanceXZ(points[index]!, points[index + 1]!);
	}
	if (completeSegments < segmentCount) {
		station +=
			distanceXZ(points[completeSegments]!, points[completeSegments + 1]!) *
			(scaled - completeSegments);
	}
	return station;
}

function remapSplitEdgeAttachments(
	attachments: Record<string, RoadEdgeAttachment>,
	firstEdgeId: string,
	secondEdgeId: string,
	splitStation: number,
): void {
	for (const [id, attachment] of Object.entries(attachments)) {
		if (
			attachment.edgeId !== firstEdgeId ||
			attachment.station <= splitStation + EPSILON
		)
			continue;
		attachments[id] = {
			...attachment,
			edgeId: secondEdgeId,
			station: Math.max(0, attachment.station - splitStation),
		};
	}
}

function splitEdgeAt(
	graph: RoadNetworkGraph,
	edgeId: string,
	nodeId: string,
	t = 0.5,
	edgeIdRemap?: Record<string, string[]>,
): string | null {
	const edge = graph.edges[edgeId];
	if (!edge || edge.startNodeId === nodeId || edge.endNodeId === nodeId)
		return null;
	const start = graph.graphNodes[edge.startNodeId];
	const end = graph.graphNodes[edge.endNodeId];
	if (!start || !end) return null;
	const splitStation = stationAtEdgeParameter(graph, edge, t);
	const [firstProfile, secondProfile] =
		edge.profileMode === "designed"
			? splitRoadVerticalProfile(edge.verticalProfile ?? [], splitStation)
			: [edge.verticalProfile ?? [], edge.verticalProfile ?? []];
	const [firstLayout, secondLayout] = edge.sectionLayout
		? splitStreetSectionLayout(edge.sectionLayout, splitStation)
		: [undefined, undefined];
	const originalEndNodeId = edge.endNodeId;
	const osmSource = edge.osmSource?.span
		? {
				...edge.osmSource,
				span: { ...edge.osmSource.span, coverage: "conservative" as const },
			}
		: edge.osmSource;
	graph.edges[edgeId] = {
		...edge,
		endNodeId: nodeId,
		osmSource,
		alignment: sliceAlignment(
			start.position,
			edge.alignment,
			end.position,
			0,
			t,
		),
		verticalProfile: firstProfile,
		...(firstLayout ? { sectionLayout: firstLayout } : {}),
		...(edge.turnLanes ? { turnLanes: { start: edge.turnLanes.start } } : {}),
	};
	const secondEdgeId = addGraphEdge(graph, nodeId, originalEndNodeId, {
		...edge,
		osmSource,
		alignment: sliceAlignment(
			start.position,
			edge.alignment,
			end.position,
			t,
			1,
		),
		verticalProfile: secondProfile,
		...(secondLayout ? { sectionLayout: secondLayout } : {}),
		...(edge.turnLanes ? { turnLanes: { end: edge.turnLanes.end } } : {}),
		parentEdgeId: edge.parentEdgeId ?? edge.id,
	});
	remapSplitEdgeAttachments(
		graph.attachments,
		edgeId,
		secondEdgeId,
		splitStation,
	);
	if (edgeIdRemap) {
		for (const [originalId, descendants] of Object.entries(edgeIdRemap)) {
			if (descendants.includes(edgeId))
				edgeIdRemap[originalId] = descendants.flatMap((id) =>
					id === edgeId ? [edgeId, secondEdgeId] : [id],
				);
		}
	}
	return secondEdgeId;
}

/** Split with an explicit one-to-many identity map for downstream selections/references. */
export function splitRoadEdgeWithIdentityRemap(
	graph: RoadNetworkGraph,
	edgeId: string,
	nodeId: string,
	t: number,
): { secondEdgeId: string | null; edgeIdRemap: Record<string, string[]> } {
	const secondEdgeId = splitEdgeAt(graph, edgeId, nodeId, t);
	return {
		secondEdgeId,
		edgeIdRemap: {
			[edgeId]: secondEdgeId
				? [edgeId, secondEdgeId]
				: graph.edges[edgeId]
					? [edgeId]
					: [],
		},
	};
}

/** Split one existing edge at an already-created graph node. */
export function splitRoadEdgeAtNode(
	graph: RoadNetworkGraph,
	edgeId: string,
	nodeId: string,
	t: number,
): string | null {
	return splitEdgeAt(graph, edgeId, nodeId, t);
}

/** Add a graph node for a reviewed topology repair. */
export function addRoadGraphNode(
	graph: RoadNetworkGraph,
	position: RoadPoint,
	template?: Pick<RoadGraphNode, "level" | "elevationMode">,
): string {
	return addGraphNode(graph, position, template);
}

function projectPointToEdge(
	graph: RoadNetworkGraph,
	edge: RoadGraphEdge,
	point: RoadPoint,
): RoadEdgeProjection | null {
	const points = sampleRoadEdgePoints(graph, edge, 48);
	if (points.length < 2) return null;
	let best: RoadEdgeProjection | null = null;
	const segmentCount = points.length - 1;
	for (let index = 0; index < segmentCount; index++) {
		const projection = projectPointToSegment(
			point,
			points[index]!,
			points[index + 1]!,
		);
		const candidate = {
			...projection,
			t: (index + projection.t) / segmentCount,
		};
		if (!best || candidate.distance < best.distance) best = candidate;
	}
	return best;
}

export function projectRoadPointToEdge(
	graph: RoadNetworkGraph,
	edgeId: string,
	point: RoadPoint,
): RoadEdgeProjection | null {
	const edge = graph.edges[edgeId];
	return edge ? projectPointToEdge(graph, edge, point) : null;
}

/**
 * Resolve the magnetic Road-tool cursor without changing topology. Existing
 * graph nodes win over centerlines; curve centerlines use the same sampled
 * projection and elevation/join rules as the eventual insertion.
 */
export function snapRoadDraftPoint(
	graph: RoadNetworkGraph,
	point: RoadPoint,
	options: RoadInsertOptions & { nodeTolerance?: number } = {},
): RoadDraftSnapTarget | null {
	const tolerance = options.tolerance ?? 0.5;
	const context: ConnectionContext = {
		level: options.level ?? 0,
		elevationMode: options.elevationMode ?? "ground",
		joinMode: options.joinMode ?? "auto",
		...(options.overlapGroup ? { overlapGroup: options.overlapGroup } : {}),
		stackLevel: options.stackLevel ?? options.level ?? 0,
		verticalTolerance: options.verticalTolerance ?? 0.25,
	};
	const nearby = findNearbyNode(
		graph,
		point,
		options.nodeTolerance ?? tolerance,
		context,
	);
	if (nearby) {
		return {
			distance: distanceXZ(nearby.position, point),
			kind: "node",
			nodeId: nearby.id,
			point: [...nearby.position],
		};
	}

	let best: { edge: RoadGraphEdge; projection: RoadEdgeProjection } | null =
		null;
	for (const edge of Object.values(graph.edges)) {
		const projection = projectPointToEdge(graph, edge, point);
		if (!projection || projection.t <= EPSILON || projection.t >= 1 - EPSILON)
			continue;
		if (!edgeAllowsConnection(edge, projection.point, point, context)) continue;
		if (
			projection.distance <= tolerance &&
			(!best || projection.distance < best.projection.distance)
		) {
			best = { edge, projection };
		}
	}
	return best
		? {
				distance: best.projection.distance,
				edgeId: best.edge.id,
				kind: "centerline",
				point: [...best.projection.point] as [number, number, number],
			}
		: null;
}

function resolveEndpoint(
	graph: RoadNetworkGraph,
	point: RoadPoint,
	tolerance: number,
	context: ConnectionContext,
	splitEdgeIds: string[],
	edgeIdRemap: Record<string, string[]>,
): { nodeId: string; created: boolean } {
	const nearby = findNearbyNode(graph, point, tolerance, context);
	if (nearby) return { nodeId: nearby.id, created: false };

	let best: { edge: RoadGraphEdge; projection: RoadEdgeProjection } | null =
		null;
	for (const edge of Object.values(graph.edges)) {
		const start = graph.graphNodes[edge.startNodeId];
		const end = graph.graphNodes[edge.endNodeId];
		if (!start || !end) continue;
		const projection = projectPointToEdge(graph, edge, point);
		if (!projection) continue;
		if (!edgeAllowsConnection(edge, projection.point, point, context)) continue;
		if (projection.t <= EPSILON || projection.t >= 1 - EPSILON) continue;
		if (
			projection.distance <= tolerance &&
			(!best || projection.distance < best.projection.distance)
		) {
			best = { edge, projection };
		}
	}

	if (best) {
		const nodeId = addGraphNode(graph, best.projection.point, context);
		splitEdgeAt(graph, best.edge.id, nodeId, best.projection.t, edgeIdRemap);
		splitEdgeIds.push(best.edge.id);
		return { nodeId, created: true };
	}
	return { nodeId: addGraphNode(graph, point, context), created: true };
}

type Intersection = {
	existingPoint: [number, number, number];
	tNew: number;
	tExisting: number;
	point: [number, number, number];
};

function segmentIntersection(
	a: RoadPoint,
	b: RoadPoint,
	c: RoadPoint,
	d: RoadPoint,
): Intersection | null {
	const rX = b[0] - a[0];
	const rZ = b[2] - a[2];
	const sX = d[0] - c[0];
	const sZ = d[2] - c[2];
	const denominator = rX * sZ - rZ * sX;
	if (Math.abs(denominator) < EPSILON) return null;
	const cax = c[0] - a[0];
	const caz = c[2] - a[2];
	const tNew = (cax * sZ - caz * sX) / denominator;
	const tExisting = (cax * rZ - caz * rX) / denominator;
	if (
		tNew < -EPSILON ||
		tNew > 1 + EPSILON ||
		tExisting < -EPSILON ||
		tExisting > 1 + EPSILON
	) {
		return null;
	}
	const clampedNew = Math.max(0, Math.min(1, tNew));
	const clampedExisting = Math.max(0, Math.min(1, tExisting));
	return {
		existingPoint: [
			c[0] + sX * clampedExisting,
			c[1] + (d[1] - c[1]) * clampedExisting,
			c[2] + sZ * clampedExisting,
		],
		tNew: clampedNew,
		tExisting: clampedExisting,
		point: [
			a[0] + rX * clampedNew,
			a[1] + (b[1] - a[1]) * clampedNew,
			a[2] + rZ * clampedNew,
		],
	};
}

function pathIntersections(
	newPoints: RoadPoint[],
	existingPoints: RoadPoint[],
): Intersection[] {
	const intersections: Intersection[] = [];
	const newSegmentCount = newPoints.length - 1;
	const existingSegmentCount = existingPoints.length - 1;
	if (newSegmentCount < 1 || existingSegmentCount < 1) return intersections;
	for (let newIndex = 0; newIndex < newSegmentCount; newIndex++) {
		for (
			let existingIndex = 0;
			existingIndex < existingSegmentCount;
			existingIndex++
		) {
			const intersection = segmentIntersection(
				newPoints[newIndex]!,
				newPoints[newIndex + 1]!,
				existingPoints[existingIndex]!,
				existingPoints[existingIndex + 1]!,
			);
			if (!intersection) continue;
			const normalized = {
				existingPoint: intersection.existingPoint,
				point: intersection.point,
				tNew: (newIndex + intersection.tNew) / newSegmentCount,
				tExisting:
					(existingIndex + intersection.tExisting) / existingSegmentCount,
			};
			if (
				normalized.tNew <= EPSILON ||
				normalized.tNew >= 1 - EPSILON ||
				normalized.tExisting <= EPSILON ||
				normalized.tExisting >= 1 - EPSILON
			)
				continue;
			if (
				intersections.some(
					(candidate) => distanceXZ(candidate.point, normalized.point) < 1e-4,
				)
			)
				continue;
			intersections.push(normalized);
		}
	}
	return intersections;
}

export type RoadEdgeCrossing = {
	firstT: number;
	firstPoint: [number, number, number];
	point: [number, number, number];
	secondPoint: [number, number, number];
	secondT: number;
	verticalDistance: number;
};

/** Interior sampled-centerline crossings between edges in two stored networks. */
export function roadEdgeCrossingsBetweenGraphs(
	firstGraph: RoadNetworkGraph,
	firstEdgeId: string,
	secondGraph: RoadNetworkGraph,
	secondEdgeId: string,
): RoadEdgeCrossing[] {
	const first = firstGraph.edges[firstEdgeId];
	const second = secondGraph.edges[secondEdgeId];
	if (!first || !second) return [];
	const intersections = pathIntersections(
		sampleRoadEdgePoints(firstGraph, first, 48),
		sampleRoadEdgePoints(secondGraph, second, 48),
	);
	return intersections.map((intersection) => ({
		firstT: intersection.tNew,
		firstPoint: [...intersection.point],
		point: [
			(intersection.point[0] + intersection.existingPoint[0]) / 2,
			(intersection.point[1] + intersection.existingPoint[1]) / 2,
			(intersection.point[2] + intersection.existingPoint[2]) / 2,
		],
		secondPoint: [...intersection.existingPoint],
		secondT: intersection.tExisting,
		verticalDistance: Math.abs(
			intersection.point[1] - intersection.existingPoint[1],
		),
	}));
}

/** Interior sampled-centerline crossings between two edges in one network. */
export function roadEdgeCrossings(
	graph: RoadNetworkGraph,
	firstEdgeId: string,
	secondEdgeId: string,
): RoadEdgeCrossing[] {
	return roadEdgeCrossingsBetweenGraphs(
		graph,
		firstEdgeId,
		graph,
		secondEdgeId,
	);
}

function hasEdgeBetween(
	graph: RoadNetworkGraph,
	a: string,
	b: string,
): boolean {
	return Object.values(graph.edges).some(
		(edge) =>
			(edge.startNodeId === a && edge.endNodeId === b) ||
			(edge.startNodeId === b && edge.endNodeId === a),
	);
}

/**
 * Insert a same-level road segment into the graph. Endpoints snap to existing
 * nodes before edges, mid-edge hits split once, and true crossings split both
 * centerlines into a shared topology node. Different elevation modes cross
 * visually without being connected.
 */
export function insertRoadSegment(
	source: RoadNetworkGraph,
	startPoint: RoadPoint,
	endPoint: RoadPoint,
	options: RoadInsertOptions = {},
): InsertRoadSegmentResult {
	const graph = cloneGraph(source);
	const edgeIdRemap = Object.fromEntries(
		Object.keys(source.edges).map((id) => [id, [id]]),
	);
	if (distanceXZ(startPoint, endPoint) < 0.05) {
		return {
			edgeIdRemap,
			graph,
			createdNodeIds: [],
			createdEdgeIds: [],
			splitEdgeIds: [],
			status: "too-short",
		};
	}
	const tolerance = options.tolerance ?? 0.5;
	const context: ConnectionContext = {
		level: options.level ?? 0,
		elevationMode: options.elevationMode ?? "ground",
		joinMode: options.joinMode ?? "auto",
		...(options.overlapGroup ? { overlapGroup: options.overlapGroup } : {}),
		stackLevel: options.stackLevel ?? options.level ?? 0,
		verticalTolerance: options.verticalTolerance ?? 0.25,
	};
	const splitEdgeIds: string[] = [];
	const createdNodeIds: string[] = [];
	const createdEdgeIds: string[] = [];
	const start = resolveEndpoint(
		graph,
		startPoint,
		tolerance,
		context,
		splitEdgeIds,
		edgeIdRemap,
	);
	if (start.created) createdNodeIds.push(start.nodeId);
	const end = resolveEndpoint(
		graph,
		endPoint,
		tolerance,
		context,
		splitEdgeIds,
		edgeIdRemap,
	);
	if (end.created) createdNodeIds.push(end.nodeId);
	if (
		start.nodeId === end.nodeId ||
		hasEdgeBetween(graph, start.nodeId, end.nodeId)
	) {
		reconcileRoadJunctions(graph);
		return {
			edgeIdRemap,
			graph,
			createdNodeIds,
			createdEdgeIds,
			splitEdgeIds,
			status: "duplicate",
		};
	}

	const startNode = graph.graphNodes[start.nodeId]!;
	const endNode = graph.graphNodes[end.nodeId]!;
	const crossings: Array<{
		edgeId: string;
		nodeId: string;
		t: number;
		tExisting: number;
	}> = [];
	const previewEdge: RoadGraphEdge = {
		id: "__road-insert-preview__",
		startNodeId: start.nodeId,
		endNodeId: end.nodeId,
		alignment: options.alignment?.map((point) => [...point]) ?? [],
		profileMode: "legacy",
		verticalProfile: [],
		styleId: options.styleId ?? graph.activeStyleId,
		direction: "both",
		roadClass: options.roadClass ?? "local",
		joinMode: context.joinMode,
		stackLevel: context.stackLevel,
		...(context.overlapGroup ? { overlapGroup: context.overlapGroup } : {}),
	};
	const newPath = sampleRoadEdgePoints(graph, previewEdge, 48);
	const edgeSnapshot = Object.values(graph.edges);
	for (const edge of edgeSnapshot) {
		const edgeStart = graph.graphNodes[edge.startNodeId];
		const edgeEnd = graph.graphNodes[edge.endNodeId];
		if (!edgeStart || !edgeEnd) continue;
		const existingPath = sampleRoadEdgePoints(graph, edge, 48);
		for (const intersection of pathIntersections(newPath, existingPath)) {
			if (
				!edgeAllowsConnection(
					edge,
					intersection.existingPoint,
					intersection.point,
					context,
				)
			)
				continue;
			const nearby = findNearbyNode(
				graph,
				intersection.point,
				tolerance * 0.25,
				context,
			);
			const nodeId =
				nearby?.id ?? addGraphNode(graph, intersection.point, context);
			if (!nearby) createdNodeIds.push(nodeId);
			crossings.push({
				edgeId: edge.id,
				nodeId,
				t: intersection.tNew,
				tExisting: intersection.tExisting,
			});
		}
	}

	const crossingsByEdge = new Map<string, typeof crossings>();
	for (const crossing of crossings) {
		crossingsByEdge.set(crossing.edgeId, [
			...(crossingsByEdge.get(crossing.edgeId) ?? []),
			crossing,
		]);
	}
	for (const [edgeId, edgeCrossings] of crossingsByEdge) {
		let upperT = 1;
		for (const crossing of [...edgeCrossings].sort(
			(a, b) => b.tExisting - a.tExisting,
		)) {
			const relativeT = crossing.tExisting / upperT;
			splitEdgeAt(graph, edgeId, crossing.nodeId, relativeT, edgeIdRemap);
			upperT = crossing.tExisting;
		}
		splitEdgeIds.push(edgeId);
	}

	const chain = [
		{ nodeId: start.nodeId, t: 0 },
		...crossings.sort((a, b) => a.t - b.t),
		{ nodeId: end.nodeId, t: 1 },
	].filter(
		(item, index, values) =>
			index === 0 || item.nodeId !== values[index - 1]?.nodeId,
	);

	for (let index = 0; index < chain.length - 1; index++) {
		const a = chain[index]!.nodeId;
		const b = chain[index + 1]!.nodeId;
		if (a === b || hasEdgeBetween(graph, a, b)) continue;
		createdEdgeIds.push(
			addGraphEdge(graph, a, b, {
				alignment: sliceAlignment(
					startNode.position,
					options.alignment ?? [],
					endNode.position,
					chain[index]!.t,
					chain[index + 1]!.t,
				),
				styleId: options.styleId ?? graph.activeStyleId,
				roadClass: options.roadClass ?? "local",
				joinMode: context.joinMode,
				stackLevel: context.stackLevel,
				...(context.overlapGroup ? { overlapGroup: context.overlapGroup } : {}),
			}),
		);
	}

	const bendRadius = Math.min(1000, Math.max(0.1, options.bendRadius ?? 5));
	for (const graphNode of Object.values(graph.graphNodes)) {
		if (graphNode.curveRadius !== undefined) continue;
		const kind = classifyRoadJunction(graph, graphNode.id);
		if (kind !== "bend-l" && kind !== "bend-v") continue;
		const curveRadius =
			options.tangentLength === undefined
				? bendRadius
				: roadBendRadiusForTangentLength(
						graph,
						graphNode.id,
						options.tangentLength,
					);
		graph.graphNodes[graphNode.id] = {
			...graphNode,
			curveRadius,
			tangentLength: roadBendTangentLength(graph, graphNode.id, curveRadius),
		};
	}

	reconcileRoadJunctions(graph);

	return {
		edgeIdRemap,
		graph,
		createdNodeIds,
		createdEdgeIds,
		splitEdgeIds: [...new Set(splitEdgeIds)],
		status: createdEdgeIds.length > 0 ? "inserted" : "duplicate",
	};
}

function hasPlanInteraction(
	graph: RoadNetworkGraph,
	startPoint: RoadPoint,
	endPoint: RoadPoint,
	options: RoadInsertOptions,
): boolean {
	const tolerance = options.tolerance ?? 0.5;
	const previewGraph = cloneGraph(graph);
	previewGraph.graphNodes.__preview_start__ = {
		id: "__preview_start__",
		position: [...startPoint],
		level: options.level ?? 0,
		elevationMode: options.elevationMode ?? "ground",
		terminal: false,
	};
	previewGraph.graphNodes.__preview_end__ = {
		id: "__preview_end__",
		position: [...endPoint],
		level: options.level ?? 0,
		elevationMode: options.elevationMode ?? "ground",
		terminal: false,
	};
	const previewEdge: RoadGraphEdge = {
		id: "__preview_edge__",
		startNodeId: "__preview_start__",
		endNodeId: "__preview_end__",
		alignment: options.alignment?.map((point) => [...point]) ?? [],
		profileMode: "legacy",
		verticalProfile: [],
		styleId: options.styleId ?? graph.activeStyleId,
		direction: "both",
		roadClass: options.roadClass ?? "local",
		joinMode: options.joinMode ?? "auto",
		stackLevel: options.stackLevel ?? options.level ?? 0,
		...(options.overlapGroup ? { overlapGroup: options.overlapGroup } : {}),
	};
	const previewPath = sampleRoadEdgePoints(previewGraph, previewEdge, 48);
	for (const edge of Object.values(graph.edges)) {
		const edgePath = sampleRoadEdgePoints(graph, edge, 48);
		if (pathIntersections(previewPath, edgePath).length > 0) return true;
		const startProjection = projectPointToEdge(graph, edge, startPoint);
		const endProjection = projectPointToEdge(graph, edge, endPoint);
		if ((startProjection?.distance ?? Infinity) <= tolerance) return true;
		if ((endProjection?.distance ?? Infinity) <= tolerance) return true;
	}
	return false;
}

/** Classify what the next road click will do without mutating scene state. */
export function previewRoadInsertion(
	source: RoadNetworkGraph,
	startPoint: RoadPoint,
	endPoint: RoadPoint,
	options: RoadInsertOptions = {},
): RoadInsertionPreview {
	const result = insertRoadSegment(source, startPoint, endPoint, options);
	if (result.status === "too-short") return { operation: "too-short", result };
	if (result.status === "duplicate") return { operation: "duplicate", result };
	if (result.splitEdgeIds.length > 0) {
		return {
			operation:
				result.createdEdgeIds.length > 1 ? "create-cross" : "create-tee",
			result,
		};
	}
	if (
		result.createdNodeIds.length >= 2 &&
		hasPlanInteraction(source, startPoint, endPoint, options)
	) {
		return { operation: "no-connection", result };
	}
	if (result.createdNodeIds.length === 0)
		return { operation: "join-endpoints", result };
	if (result.createdNodeIds.length === 1)
		return { operation: "extend-road", result };
	return { operation: "new-road", result };
}
