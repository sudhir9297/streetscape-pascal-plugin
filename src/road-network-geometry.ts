import { CatmullRomCurve3, Vector3 } from "three";
import { applyRoadVerticalProfile } from "./road-network-vertical-profile";
import type { RoadGraphEdge, RoadNetworkNode } from "./schema";

export type RoadGeometryPoint = [number, number, number];

export type RoadRenderPath = {
	cornerPointIndices: number[];
	cornerNodeIds: string[];
	edgeIds: string[];
	startNodeId: string;
	endNodeId: string;
	points: RoadGeometryPoint[];
};

export type JunctionApproach = {
	angle: number;
	halfWidth: number;
};

export type JunctionBoundaryApproach = JunctionApproach & {
	edgeId: string;
};

export type JunctionBoundaryCorner = {
	center: readonly [number, number] | null;
	effectiveRadius: number;
	fromEdgeId: string;
	innerPoints: Array<readonly [number, number]>;
	outerDirection: readonly [number, number];
	requestedRadius: number;
	toEdgeId: string;
};

export type JunctionBoundaryGeometryData = RoadSurfaceGeometryData & {
	approachCuts: Record<string, number>;
	approaches: JunctionBoundaryApproach[];
	boundary: Array<readonly [number, number]>;
	corners: JunctionBoundaryCorner[];
	maxExtent: number;
};

export type RoadSurfaceGeometryData = {
	indices: number[];
	positions: number[];
};

export type RoadRibbonGeometryOptions = {
	elevationOffset?: number;
	lateralOffset?: number;
	surfaceThickness: number;
	width: number;
};

/** Follow the same outward offset used by generated junction side bands. */
export function offsetJunctionBoundaryCornerPoints(
	corner: JunctionBoundaryCorner,
	offset: number,
): Array<readonly [number, number]> {
	const safeOffset = Math.max(0, offset);
	if (corner.center && corner.effectiveRadius > 0) {
		const radius = Math.max(0.05, corner.effectiveRadius - safeOffset);
		return corner.innerPoints.map(([x, z]) => {
			const dx = x - corner.center![0];
			const dz = z - corner.center![1];
			const length = Math.max(Math.hypot(dx, dz), 1e-6);
			return [
				corner.center![0] + (dx / length) * radius,
				corner.center![1] + (dz / length) * radius,
			] as const;
		});
	}
	return corner.innerPoints.map(([x, z]) => [
		x + corner.outerDirection[0] * safeOffset,
		z + corner.outerDirection[1] * safeOffset,
	] as const);
}

export type JunctionBoundarySidePath = {
	fromEdgeId: string;
	points: Array<readonly [number, number]>;
	toEdgeId: string;
};

/**
 * Trace each continuous roadside between adjacent approach openings, including
 * both straight approach sleeves and the curb-return curve between them.
 */
export function buildJunctionBoundarySidePaths(
	solution: Pick<
		JunctionBoundaryGeometryData,
		"approachCuts" | "approaches" | "corners"
	>,
	offset = 0,
): JunctionBoundarySidePath[] {
	if (
		solution.approaches.length < 3 ||
		solution.corners.length !== solution.approaches.length
	) return [];
	const safeOffset = Math.max(0, offset);
	return solution.corners.flatMap((corner, index) => {
		const from = solution.approaches[index]!;
		const to = solution.approaches[(index + 1) % solution.approaches.length]!;
		const fromCut = solution.approachCuts[from.edgeId];
		const toCut = solution.approachCuts[to.edgeId];
		if (fromCut === undefined || toCut === undefined) return [];
		const fromDirection = [Math.cos(from.angle), Math.sin(from.angle)] as const;
		const fromLeft = [-fromDirection[1], fromDirection[0]] as const;
		const toDirection = [Math.cos(to.angle), Math.sin(to.angle)] as const;
		const toLeft = [-toDirection[1], toDirection[0]] as const;
		const fromLeftCap = [
			fromDirection[0] * fromCut + fromLeft[0] * (from.halfWidth + safeOffset),
			fromDirection[1] * fromCut + fromLeft[1] * (from.halfWidth + safeOffset),
		] as const;
		const toRightCap = [
			toDirection[0] * toCut - toLeft[0] * (to.halfWidth + safeOffset),
			toDirection[1] * toCut - toLeft[1] * (to.halfWidth + safeOffset),
		] as const;
		return [{
			fromEdgeId: from.edgeId,
			points: [
				fromLeftCap,
				...offsetJunctionBoundaryCornerPoints(corner, safeOffset),
				toRightCap,
			],
			toEdgeId: to.edgeId,
		}];
	});
}

/**
 * Build the exact indexed ribbon consumed by the 3D road renderer.
 *
 * Keeping this as a pure function makes the production mesh deterministic and
 * lets geometry fixtures guard the actual vertex/index buffers, rather than a
 * parallel approximation used only by tests.
 */
export function buildRoadRibbonGeometry(
	points: ReadonlyArray<readonly [number, number, number]>,
	options: RoadRibbonGeometryOptions,
): RoadSurfaceGeometryData {
	if (points.length < 2) return { indices: [], positions: [] };
	const halfWidth = options.width / 2;
	const lateralOffset = options.lateralOffset ?? 0;
	const elevationOffset = options.elevationOffset ?? 0;
	const positions: number[] = [];
	for (let index = 0; index < points.length; index++) {
		const point = points[index]!;
		const previous = points[Math.max(0, index - 1)]!;
		const next = points[Math.min(points.length - 1, index + 1)]!;
		const dx = next[0] - previous[0];
		const dz = next[2] - previous[2];
		const length = Math.max(Math.hypot(dx, dz), 1e-6);
		const normalX = -dz / length;
		const normalZ = dx / length;
		const centerX = point[0] + normalX * lateralOffset;
		const centerZ = point[2] + normalZ * lateralOffset;
		const y = point[1] + elevationOffset;
		positions.push(
			centerX + normalX * halfWidth,
			y,
			centerZ + normalZ * halfWidth,
		);
		positions.push(
			centerX - normalX * halfWidth,
			y,
			centerZ - normalZ * halfWidth,
		);
	}
	const indices: number[] = [];
	for (let index = 0; index < points.length - 1; index++) {
		const left = index * 2;
		const right = left + 1;
		const nextLeft = left + 2;
		const nextRight = left + 3;
		indices.push(left, nextLeft, right, nextLeft, nextRight, right);
	}
	return { indices, positions };
}

export type RoadTerminalEnd = {
	angle: number;
	direction: readonly [number, number];
	edgeId: string;
	nodeId: string;
	point: RoadGeometryPoint;
};

function pointsAreCoincident(
	start: RoadGeometryPoint,
	end: RoadGeometryPoint,
): boolean {
	return (
		Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 1e-6
	);
}

/**
 * Sample an interpolating, centripetal Catmull-Rom road spline. Alignment
 * points are authored points on the road, rather than off-curve Bézier
 * controls, so the rendered centerline runs through every click and handle.
 */
export function sampleRoadAlignmentPoints(
	start: RoadGeometryPoint,
	alignment: ReadonlyArray<RoadGeometryPoint>,
	end: RoadGeometryPoint,
	curveSegments = 20,
): RoadGeometryPoint[] {
	const authored = [start, ...alignment, end].reduce<RoadGeometryPoint[]>(
		(points, point) => {
			const candidate = [...point] as RoadGeometryPoint;
			if (!points.at(-1) || !pointsAreCoincident(points.at(-1)!, candidate))
				points.push(candidate);
			return points;
		},
		[],
	);
	if (authored.length <= 2) return authored;

	const curve = new CatmullRomCurve3(
		authored.map((point) => new Vector3(...point)),
		false,
		"centripetal",
	);
	const spanCount = authored.length - 1;
	const segmentsPerSpan = Math.max(
		2,
		Math.ceil(Math.max(4, curveSegments) / spanCount),
	);
	return curve
		.getPoints(spanCount * segmentsPerSpan)
		.map((point) => [point.x, point.y, point.z]);
}

/** Resolve a road edge into renderable centerline samples. */
export function sampleRoadEdgePoints(
	network: Pick<RoadNetworkNode, "graphNodes">,
	edge: RoadGraphEdge,
	curveSegments = 20,
): RoadGeometryPoint[] {
	const start = network.graphNodes[edge.startNodeId];
	const end = network.graphNodes[edge.endNodeId];
	if (!start || !end) return [];
	// Ordinary OSM vertices describe a mapped polyline, not spline handles.
	// Circular routes can interpolate through their vertices; ordinary corners
	// stay on their source spans. Designed profiles use the editor's spline.
	const sourceJunction = edge.osmSource?.tags.junction;
	const circularSource = sourceJunction === "circular" || sourceJunction === "roundabout";
	if (edge.osmSource && !circularSource && edge.profileMode !== "designed") {
		return [start.position, ...edge.alignment, end.position].map(
			point => [...point] as RoadGeometryPoint,
		);
	}
	if (edge.profileMode === "designed") {
		const planStart: RoadGeometryPoint = [
			start.position[0],
			0,
			start.position[2],
		];
		const planEnd: RoadGeometryPoint = [end.position[0], 0, end.position[2]];
		const planAlignment = edge.alignment.map(
			(point) => [point[0], 0, point[2]] as RoadGeometryPoint,
		);
		const planPoints =
			planAlignment.length === 0
				? Array.from({ length: Math.max(2, curveSegments + 1) }, (_, index) => {
						const mix = index / Math.max(1, curveSegments);
						return [
							planStart[0] + (planEnd[0] - planStart[0]) * mix,
							0,
							planStart[2] + (planEnd[2] - planStart[2]) * mix,
						] as RoadGeometryPoint;
					})
				: sampleRoadAlignmentPoints(
						planStart,
						planAlignment,
						planEnd,
						curveSegments,
					);
		return applyRoadVerticalProfile(
			planPoints,
			edge.verticalProfile,
			start.position[1],
			end.position[1],
		);
	}
	if (edge.alignment.length === 0) {
		return [[...start.position], [...end.position]];
	}
	return sampleRoadAlignmentPoints(
		start.position,
		edge.alignment,
		end.position,
		curveSegments,
	);
}

/**
 * Find the graph's true open ends and their outward plan tangents. The tangent
 * follows sampled curved geometry, so continuation arrows do not fall back to
 * an inaccurate endpoint chord.
 */
export function roadTerminalEnds(
	network: Pick<RoadNetworkNode, "edges" | "graphNodes">,
): RoadTerminalEnd[] {
	const incidentByNode = new Map<string, RoadGraphEdge[]>();
	for (const edge of Object.values(network.edges)) {
		for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
			const incident = incidentByNode.get(nodeId) ?? [];
			incident.push(edge);
			incidentByNode.set(nodeId, incident);
		}
	}

	return Object.values(network.graphNodes).flatMap((graphNode) => {
		const incident = incidentByNode.get(graphNode.id) ?? [];
		if (incident.length !== 1) return [];
		const edge = incident[0]!;
		const sampled = sampleRoadEdgePoints(network, edge, 48);
		const ordered =
			edge.startNodeId === graphNode.id ? sampled : [...sampled].reverse();
		if (ordered.length < 2) return [];
		const point = ordered[0]!;
		const towardRoad = ordered[1]!;
		const dx = point[0] - towardRoad[0];
		const dz = point[2] - towardRoad[2];
		const length = Math.hypot(dx, dz);
		if (length < 1e-6) return [];
		const direction = [dx / length, dz / length] as const;
		return [
			{
				angle: Math.atan2(direction[1], direction[0]),
				direction,
				edgeId: edge.id,
				nodeId: graphNode.id,
				point: [...graphNode.position] as RoadGeometryPoint,
			},
		];
	});
}

/**
 * Group road edges into the centerline paths consumed by the ribbon renderer.
 * Compatible edges flow through degree-two nodes as one path so carriageways,
 * sidewalks, medians, and markings share one corner join instead of crossing
 * as independent square-ended strips.
 */
export function buildRoadRenderPaths(
	network: Pick<RoadNetworkNode, "edges" | "graphNodes">,
	canMerge: (left: RoadGraphEdge, right: RoadGraphEdge) => boolean = (
		left,
		right,
	) => left.styleId === right.styleId,
): RoadRenderPath[] {
	const edges = Object.values(network.edges);
	const incident = new Map<string, RoadGraphEdge[]>();
	for (const edge of edges) {
		incident.set(edge.startNodeId, [
			...(incident.get(edge.startNodeId) ?? []),
			edge,
		]);
		incident.set(edge.endNodeId, [
			...(incident.get(edge.endNodeId) ?? []),
			edge,
		]);
	}

	const visited = new Set<string>();
	const paths: RoadRenderPath[] = [];
	const otherNodeId = (edge: RoadGraphEdge, nodeId: string) =>
		edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId;
	const orientedPoints = (edge: RoadGraphEdge, fromNodeId: string) => {
		const points = sampleRoadEdgePoints(network, edge);
		return edge.startNodeId === fromNodeId ? points : points.reverse();
	};
	const mergeCandidate = (nodeId: string, current: RoadGraphEdge) => {
		const connected = incident.get(nodeId) ?? [];
		if (connected.length !== 2) return null;
		const candidate =
			connected[0]?.id === current.id ? connected[1] : connected[0];
		if (
			!candidate ||
			visited.has(candidate.id) ||
			!canMerge(current, candidate)
		)
			return null;
		return candidate;
	};

	for (const edge of edges) {
		if (visited.has(edge.id)) continue;
		visited.add(edge.id);
		const path: RoadRenderPath = {
			cornerPointIndices: [],
			cornerNodeIds: [],
			edgeIds: [edge.id],
			startNodeId: edge.startNodeId,
			endNodeId: edge.endNodeId,
			points: sampleRoadEdgePoints(network, edge),
		};

		let leftEdge = edge;
		let leftNodeId = edge.startNodeId;
		while (true) {
			const candidate = mergeCandidate(leftNodeId, leftEdge);
			if (!candidate) break;
			visited.add(candidate.id);
			const outerNodeId = otherNodeId(candidate, leftNodeId);
			const candidatePoints = orientedPoints(candidate, outerNodeId);
			const prefixLength = candidatePoints.length - 1;
			path.points = [...candidatePoints.slice(0, -1), ...path.points];
			path.cornerPointIndices = [
				prefixLength,
				...path.cornerPointIndices.map((index) => index + prefixLength),
			];
			path.cornerNodeIds.unshift(leftNodeId);
			path.edgeIds.unshift(candidate.id);
			path.startNodeId = outerNodeId;
			leftEdge = candidate;
			leftNodeId = outerNodeId;
		}

		let rightEdge = edge;
		let rightNodeId = edge.endNodeId;
		while (true) {
			const candidate = mergeCandidate(rightNodeId, rightEdge);
			if (!candidate) break;
			visited.add(candidate.id);
			const candidatePoints = orientedPoints(candidate, rightNodeId);
			path.cornerPointIndices.push(path.points.length - 1);
			path.cornerNodeIds.push(rightNodeId);
			path.points.push(...candidatePoints.slice(1));
			path.edgeIds.push(candidate.id);
			path.endNodeId = otherNodeId(candidate, rightNodeId);
			rightEdge = candidate;
			rightNodeId = path.endNodeId;
		}

		paths.push(path);
	}
	return paths;
}

/** Replace selected hard graph corners with render-time tangent curves. */
export function smoothRoadRenderPath(
	points: ReadonlyArray<readonly [number, number, number]>,
	cornerPointIndices: number[],
	radius: number | ReadonlyArray<number>,
	segments = 8,
): RoadGeometryPoint[] {
	const radii = typeof radius === "number" ? null : radius;
	if (
		points.length < 3 ||
		(typeof radius === "number" && radius <= 0) ||
		cornerPointIndices.length === 0
	) {
		return points.map((point) => [...point] as RoadGeometryPoint);
	}
	const corners = new Map(
		cornerPointIndices.map((pointIndex, index) => [pointIndex, index]),
	);
	const sampleCount = Math.max(2, Math.floor(segments));
	const result: RoadGeometryPoint[] = [[...points[0]!] as RoadGeometryPoint];
	for (let index = 1; index < points.length - 1; index++) {
		const previous = points[index - 1]!;
		const corner = points[index]!;
		const next = points[index + 1]!;
		const cornerIndex = corners.get(index);
		if (cornerIndex === undefined) {
			result.push([...corner] as RoadGeometryPoint);
			continue;
		}
		const incomingLength = Math.hypot(
			corner[0] - previous[0],
			corner[2] - previous[2],
		);
		const outgoingLength = Math.hypot(next[0] - corner[0], next[2] - corner[2]);
		if (incomingLength < 1e-6 || outgoingLength < 1e-6) continue;
		const towardPrevious = [
			(previous[0] - corner[0]) / incomingLength,
			(previous[2] - corner[2]) / incomingLength,
		] as const;
		const towardNext = [
			(next[0] - corner[0]) / outgoingLength,
			(next[2] - corner[2]) / outgoingLength,
		] as const;
		const dot =
			towardPrevious[0] * towardNext[0] + towardPrevious[1] * towardNext[1];
		const interiorAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
		if (interiorAngle < 1e-3 || Math.PI - interiorAngle < 1e-3) {
			result.push([...corner] as RoadGeometryPoint);
			continue;
		}
		const requestedRadius = Math.max(
			0,
			radii?.[cornerIndex] ?? (radius as number),
		);
		if (requestedRadius <= 0) {
			result.push([...corner] as RoadGeometryPoint);
			continue;
		}
		const idealCut = requestedRadius / Math.tan(interiorAngle / 2);
		const cut = Math.min(
			idealCut,
			incomingLength * 0.45,
			outgoingLength * 0.45,
		);
		const effectiveRadius = cut * Math.tan(interiorAngle / 2);
		const entry: RoadGeometryPoint = [
			corner[0] + towardPrevious[0] * cut,
			corner[1],
			corner[2] + towardPrevious[1] * cut,
		];
		const exit: RoadGeometryPoint = [
			corner[0] + towardNext[0] * cut,
			corner[1],
			corner[2] + towardNext[1] * cut,
		];
		const bisectorLength = Math.hypot(
			towardPrevious[0] + towardNext[0],
			towardPrevious[1] + towardNext[1],
		);
		if (bisectorLength < 1e-6) {
			result.push([...corner] as RoadGeometryPoint);
			continue;
		}
		const centerDistance = effectiveRadius / Math.sin(interiorAngle / 2);
		const center = [
			corner[0] +
				((towardPrevious[0] + towardNext[0]) / bisectorLength) * centerDistance,
			corner[2] +
				((towardPrevious[1] + towardNext[1]) / bisectorLength) * centerDistance,
		] as const;
		const startAngle = Math.atan2(entry[2] - center[1], entry[0] - center[0]);
		const endAngle = Math.atan2(exit[2] - center[1], exit[0] - center[0]);
		const sweep = angularDelta(endAngle, startAngle);
		result.push(entry);
		for (let sample = 1; sample <= sampleCount; sample++) {
			const t = sample / sampleCount;
			const angle = startAngle + sweep * t;
			result.push([
				center[0] + Math.cos(angle) * effectiveRadius,
				entry[1] + (exit[1] - entry[1]) * t,
				center[1] + Math.sin(angle) * effectiveRadius,
			]);
		}
	}
	result.push([...points.at(-1)!] as RoadGeometryPoint);
	return result;
}

function trimPathStart(
	points: RoadGeometryPoint[],
	distance: number,
): RoadGeometryPoint[] {
	if (distance <= 0) return points;
	const trimmed = points.map((point) => [...point] as RoadGeometryPoint);
	let remaining = distance;
	while (trimmed.length >= 2) {
		const start = trimmed[0]!;
		const next = trimmed[1]!;
		const length = Math.hypot(next[0] - start[0], next[2] - start[2]);
		if (length <= remaining + 1e-6) {
			remaining -= length;
			trimmed.shift();
			continue;
		}
		const t = remaining / Math.max(length, 1e-6);
		trimmed[0] = [
			start[0] + (next[0] - start[0]) * t,
			start[1] + (next[1] - start[1]) * t,
			start[2] + (next[2] - start[2]) * t,
		];
		break;
	}
	return trimmed;
}

/** Trim decorative ribbons back from generated intersection-center surfaces. */
export function trimRoadRenderPath(
	points: ReadonlyArray<readonly [number, number, number]>,
	startDistance: number,
	endDistance: number,
): RoadGeometryPoint[] {
	const fromStart = trimPathStart(
		points.map((point) => [...point] as RoadGeometryPoint),
		startDistance,
	);
	return trimPathStart(fromStart.reverse(), endDistance).reverse();
}

function angularDelta(left: number, right: number): number {
	return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

function positiveAngularDelta(left: number, right: number): number {
	const delta = (left - right) % (Math.PI * 2);
	return delta < 0 ? delta + Math.PI * 2 : delta;
}

function intersectParametricLines(
	firstPoint: readonly [number, number],
	firstDirection: readonly [number, number],
	secondPoint: readonly [number, number],
	secondDirection: readonly [number, number],
): {
	firstT: number;
	point: readonly [number, number];
	secondT: number;
} | null {
	const denominator =
		firstDirection[0] * secondDirection[1] -
		firstDirection[1] * secondDirection[0];
	if (Math.abs(denominator) < 1e-6) return null;
	const dx = secondPoint[0] - firstPoint[0];
	const dz = secondPoint[1] - firstPoint[1];
	const firstT =
		(dx * secondDirection[1] - dz * secondDirection[0]) / denominator;
	const secondT =
		(dx * firstDirection[1] - dz * firstDirection[0]) / denominator;
	return {
		firstT,
		secondT,
		point: [
			firstPoint[0] + firstDirection[0] * firstT,
			firstPoint[1] + firstDirection[1] * firstT,
		],
	};
}

function appendUniquePoint(
	points: Array<readonly [number, number]>,
	point: readonly [number, number],
): void {
	const previous = points.at(-1);
	if (
		previous &&
		Math.hypot(previous[0] - point[0], previous[1] - point[1]) < 1e-5
	)
		return;
	points.push(point);
}

function junctionCornerKey(firstEdgeId: string, secondEdgeId: string): string {
	return [firstEdgeId, secondEdgeId].sort().join("::");
}

type SolvedJunctionCorner = JunctionBoundaryCorner & {
	fromDistance: number;
	toDistance: number;
};

function solveJunctionCorner(
	from: JunctionBoundaryApproach,
	to: JunctionBoundaryApproach,
	requestedRadius: number,
	arcSegments: number,
): SolvedJunctionCorner {
	const fromDirection = [Math.cos(from.angle), Math.sin(from.angle)] as const;
	const toDirection = [Math.cos(to.angle), Math.sin(to.angle)] as const;
	const fromLeft = [-fromDirection[1], fromDirection[0]] as const;
	const toLeft = [-toDirection[1], toDirection[0]] as const;
	const gap = positiveAngularDelta(to.angle, from.angle);
	const fallbackDistance = Math.max(
		from.halfWidth,
		to.halfWidth,
		requestedRadius,
		0.5,
	);
	const outerDirection = [
		Math.cos(from.angle + gap / 2),
		Math.sin(from.angle + gap / 2),
	] as const;
	const fromBoundary = [
		fromLeft[0] * from.halfWidth,
		fromLeft[1] * from.halfWidth,
	] as const;
	const toBoundary = [
		-toLeft[0] * to.halfWidth,
		-toLeft[1] * to.halfWidth,
	] as const;

	// Opposing or reflex approaches form a continuous side rather than a curb
	// return. A straight connector closes a T junction without inventing a bulb.
	if (gap >= Math.PI - 1e-4) {
		const fromPoint = [
			fromBoundary[0] + fromDirection[0] * fallbackDistance,
			fromBoundary[1] + fromDirection[1] * fallbackDistance,
		] as const;
		const toPoint = [
			toBoundary[0] + toDirection[0] * fallbackDistance,
			toBoundary[1] + toDirection[1] * fallbackDistance,
		] as const;
		return {
			center: null,
			effectiveRadius: 0,
			fromDistance: fallbackDistance,
			fromEdgeId: from.edgeId,
			innerPoints: [fromPoint, toPoint],
			outerDirection,
			requestedRadius,
			toDistance: fallbackDistance,
			toEdgeId: to.edgeId,
		};
	}

	const radius = Math.max(0.5, requestedRadius);
	const firstOffset = [
		fromBoundary[0] + fromLeft[0] * radius,
		fromBoundary[1] + fromLeft[1] * radius,
	] as const;
	const secondOffset = [
		toBoundary[0] - toLeft[0] * radius,
		toBoundary[1] - toLeft[1] * radius,
	] as const;
	const intersection = intersectParametricLines(
		firstOffset,
		fromDirection,
		secondOffset,
		toDirection,
	);
	if (!intersection || intersection.firstT < 0 || intersection.secondT < 0) {
		const fromPoint = [
			fromBoundary[0] + fromDirection[0] * fallbackDistance,
			fromBoundary[1] + fromDirection[1] * fallbackDistance,
		] as const;
		const toPoint = [
			toBoundary[0] + toDirection[0] * fallbackDistance,
			toBoundary[1] + toDirection[1] * fallbackDistance,
		] as const;
		return {
			center: null,
			effectiveRadius: 0,
			fromDistance: fallbackDistance,
			fromEdgeId: from.edgeId,
			innerPoints: [fromPoint, toPoint],
			outerDirection,
			requestedRadius,
			toDistance: fallbackDistance,
			toEdgeId: to.edgeId,
		};
	}

	const center = intersection.point;
	const fromPoint = [
		center[0] - fromLeft[0] * radius,
		center[1] - fromLeft[1] * radius,
	] as const;
	const toPoint = [
		center[0] + toLeft[0] * radius,
		center[1] + toLeft[1] * radius,
	] as const;
	const startAngle = Math.atan2(
		fromPoint[1] - center[1],
		fromPoint[0] - center[0],
	);
	const endAngle = Math.atan2(toPoint[1] - center[1], toPoint[0] - center[0]);
	const sweep = angularDelta(endAngle, startAngle);
	const segmentCount = Math.max(2, Math.floor(arcSegments));
	const innerPoints = Array.from({ length: segmentCount + 1 }, (_, index) => {
		const angle = startAngle + sweep * (index / segmentCount);
		return [
			center[0] + Math.cos(angle) * radius,
			center[1] + Math.sin(angle) * radius,
		] as const;
	});
	return {
		center,
		effectiveRadius: radius,
		fromDistance: intersection.firstT,
		fromEdgeId: from.edgeId,
		innerPoints,
		outerDirection,
		requestedRadius,
		toDistance: intersection.secondT,
		toEdgeId: to.edgeId,
	};
}

/**
 * Solve a closed, star-shaped junction patch from adjacent approach offsets.
 * The result alternates approach caps with per-corner tangent fillets, so
 * unequal widths meet without the oversized circular disk used previously.
 */
export function buildJunctionBoundaryGeometry(
	approaches: JunctionBoundaryApproach[],
	cornerRadii: Record<string, number>,
	arcSegments = 10,
): JunctionBoundaryGeometryData {
	const empty: JunctionBoundaryGeometryData = {
		approachCuts: {},
		approaches: [],
		boundary: [],
		corners: [],
		indices: [],
		maxExtent: 0,
		positions: [],
	};
	if (approaches.length < 3) return empty;
	const sorted = [...approaches].sort(
		(left, right) => left.angle - right.angle,
	);
	const corners = sorted.map((approach, index) => {
		const next = sorted[(index + 1) % sorted.length]!;
		const radius =
			cornerRadii[junctionCornerKey(approach.edgeId, next.edgeId)] ?? 6;
		return solveJunctionCorner(approach, next, radius, arcSegments);
	});
	const approachCuts: Record<string, number> = {};
	for (let index = 0; index < sorted.length; index++) {
		const approach = sorted[index]!;
		const previousCorner =
			corners[(index - 1 + corners.length) % corners.length]!;
		const nextCorner = corners[index]!;
		approachCuts[approach.edgeId] = Math.max(
			approach.halfWidth,
			previousCorner.toDistance,
			nextCorner.fromDistance,
		);
	}

	const boundary: Array<readonly [number, number]> = [];
	for (let index = 0; index < sorted.length; index++) {
		const approach = sorted[index]!;
		const direction = [
			Math.cos(approach.angle),
			Math.sin(approach.angle),
		] as const;
		const left = [-direction[1], direction[0]] as const;
		const previousCorner =
			corners[(index - 1 + corners.length) % corners.length]!;
		const nextCorner = corners[index]!;
		const cut = approachCuts[approach.edgeId]!;
		appendUniquePoint(boundary, previousCorner.innerPoints.at(-1)!);
		appendUniquePoint(boundary, [
			direction[0] * cut - left[0] * approach.halfWidth,
			direction[1] * cut - left[1] * approach.halfWidth,
		]);
		appendUniquePoint(boundary, [
			direction[0] * cut + left[0] * approach.halfWidth,
			direction[1] * cut + left[1] * approach.halfWidth,
		]);
		for (const point of nextCorner.innerPoints)
			appendUniquePoint(boundary, point);
	}
	if (
		boundary.length > 1 &&
		Math.hypot(
			boundary[0]![0] - boundary.at(-1)![0],
			boundary[0]![1] - boundary.at(-1)![1],
		) < 1e-5
	) {
		boundary.pop();
	}
	const positions = [0, 0, 0];
	for (const [x, z] of boundary) positions.push(x, 0, z);
	const indices: number[] = [];
	for (let index = 0; index < boundary.length; index++) {
		indices.push(0, index + 1, ((index + 1) % boundary.length) + 1);
	}
	return {
		approachCuts,
		approaches: sorted,
		boundary,
		corners,
		indices,
		maxExtent: Math.max(0, ...boundary.map(([x, z]) => Math.hypot(x, z))),
		positions,
	};
}

function appendSidewalkQuad(
	positions: number[],
	indices: number[],
	innerStart: readonly [number, number],
	innerEnd: readonly [number, number],
	outerStart: readonly [number, number],
	outerEnd: readonly [number, number],
): void {
	const base = positions.length / 3;
	positions.push(
		innerStart[0],
		0,
		innerStart[1],
		outerStart[0],
		0,
		outerStart[1],
		innerEnd[0],
		0,
		innerEnd[1],
		outerEnd[0],
		0,
		outerEnd[1],
	);
	indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

/** Build curb-return sidewalks plus the approach sleeves that meet road strips. */
export function buildJunctionBoundarySidewalkGeometry(
	solution: Pick<
		JunctionBoundaryGeometryData,
		"approachCuts" | "approaches" | "corners"
	>,
	width: number,
	innerOffset = 0,
): RoadSurfaceGeometryData {
	const positions: number[] = [];
	const indices: number[] = [];
	if (width <= 0) return { indices, positions };
	const safeInnerOffset = Math.max(0, innerOffset);
	for (const corner of solution.corners) {
		if (corner.innerPoints.length < 2) continue;
		const innerPoints = safeInnerOffset === 0
			? corner.innerPoints
			: offsetJunctionBoundaryCornerPoints(corner, safeInnerOffset);
		const outerPoints = offsetJunctionBoundaryCornerPoints(
			corner,
			safeInnerOffset + width,
		);
		for (let index = 0; index < innerPoints.length - 1; index++) {
			const innerStart = innerPoints[index]!;
			const innerEnd = innerPoints[index + 1]!;
			const outerStart = outerPoints[index]!;
			const outerEnd = outerPoints[index + 1]!;
			appendSidewalkQuad(
				positions,
				indices,
				innerStart,
				innerEnd,
				outerStart,
				outerEnd,
			);
		}
	}
	for (let index = 0; index < solution.approaches.length; index++) {
		const approach = solution.approaches[index]!;
		const previousCorner =
			solution.corners[
				(index - 1 + solution.corners.length) % solution.corners.length
			]!;
		const nextCorner = solution.corners[index]!;
		const previousPoint = previousCorner.innerPoints.at(-1);
		const nextPoint = nextCorner.innerPoints[0];
		const cut = solution.approachCuts[approach.edgeId];
		if (!previousPoint || !nextPoint || cut === undefined) continue;
		const direction = [
			Math.cos(approach.angle),
			Math.sin(approach.angle),
		] as const;
		const left = [-direction[1], direction[0]] as const;
		const rightCap = [
			direction[0] * cut - left[0] * approach.halfWidth,
			direction[1] * cut - left[1] * approach.halfWidth,
		] as const;
		const leftCap = [
			direction[0] * cut + left[0] * approach.halfWidth,
			direction[1] * cut + left[1] * approach.halfWidth,
		] as const;
		const rightInnerStart = safeInnerOffset === 0
			? previousPoint
			: [
				previousPoint[0] - left[0] * safeInnerOffset,
				previousPoint[1] - left[1] * safeInnerOffset,
			] as const;
		const rightInnerEnd = safeInnerOffset === 0
			? rightCap
			: [
				rightCap[0] - left[0] * safeInnerOffset,
				rightCap[1] - left[1] * safeInnerOffset,
			] as const;
		const rightOuterStart = [
			previousPoint[0] - left[0] * (safeInnerOffset + width),
			previousPoint[1] - left[1] * (safeInnerOffset + width),
		] as const;
		const rightOuterEnd = [
			rightCap[0] - left[0] * (safeInnerOffset + width),
			rightCap[1] - left[1] * (safeInnerOffset + width),
		] as const;
		const leftInnerStart = safeInnerOffset === 0
			? leftCap
			: [
				leftCap[0] + left[0] * safeInnerOffset,
				leftCap[1] + left[1] * safeInnerOffset,
			] as const;
		const leftInnerEnd = safeInnerOffset === 0
			? nextPoint
			: [
				nextPoint[0] + left[0] * safeInnerOffset,
				nextPoint[1] + left[1] * safeInnerOffset,
			] as const;
		const leftOuterStart = [
			leftCap[0] + left[0] * (safeInnerOffset + width),
			leftCap[1] + left[1] * (safeInnerOffset + width),
		] as const;
		const leftOuterEnd = [
			nextPoint[0] + left[0] * (safeInnerOffset + width),
			nextPoint[1] + left[1] * (safeInnerOffset + width),
		] as const;
		appendSidewalkQuad(
			positions,
			indices,
			rightInnerStart,
			rightInnerEnd,
			rightOuterStart,
			rightOuterEnd,
		);
		appendSidewalkQuad(
			positions,
			indices,
			leftInnerStart,
			leftInnerEnd,
			leftOuterStart,
			leftOuterEnd,
		);
	}
	return { indices, positions };
}

function pointFallsInsideApproach(
	radius: number,
	angle: number,
	approach: JunctionApproach,
): boolean {
	const delta = angularDelta(angle, approach.angle);
	const forward = radius * Math.cos(delta);
	const lateral = Math.abs(radius * Math.sin(delta));
	return forward > 0 && lateral < approach.halfWidth + 0.02;
}

/**
 * Build the pale kerb/sidewalk annulus around a generated junction while
 * cutting openings wherever a carriageway enters the circle.
 */
export function buildJunctionSidewalkGeometry(
	innerRadius: number,
	width: number,
	approaches: JunctionApproach[],
	angularSegments = 128,
	radialSegments = 4,
): RoadSurfaceGeometryData {
	const positions: number[] = [];
	const indices: number[] = [];
	if (innerRadius <= 0 || width <= 0 || approaches.length < 2)
		return { indices, positions };
	const safeAngularSegments = Math.max(24, Math.floor(angularSegments));
	const safeRadialSegments = Math.max(1, Math.floor(radialSegments));
	for (let radialIndex = 0; radialIndex < safeRadialSegments; radialIndex++) {
		const inner = innerRadius + (width * radialIndex) / safeRadialSegments;
		const outer =
			innerRadius + (width * (radialIndex + 1)) / safeRadialSegments;
		const middleRadius = (inner + outer) / 2;
		for (let angleIndex = 0; angleIndex < safeAngularSegments; angleIndex++) {
			const startAngle = (angleIndex / safeAngularSegments) * Math.PI * 2;
			const endAngle = ((angleIndex + 1) / safeAngularSegments) * Math.PI * 2;
			const middleAngle = (startAngle + endAngle) / 2;
			if (
				approaches.some((approach) =>
					pointFallsInsideApproach(middleRadius, middleAngle, approach),
				)
			) {
				continue;
			}
			const base = positions.length / 3;
			positions.push(
				Math.cos(startAngle) * inner,
				0,
				Math.sin(startAngle) * inner,
				Math.cos(startAngle) * outer,
				0,
				Math.sin(startAngle) * outer,
				Math.cos(endAngle) * inner,
				0,
				Math.sin(endAngle) * inner,
				Math.cos(endAngle) * outer,
				0,
				Math.sin(endAngle) * outer,
			);
			indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
		}
	}
	return { indices, positions };
}
