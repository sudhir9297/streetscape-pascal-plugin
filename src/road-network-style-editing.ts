import { resolveRoadSideComponents, type RoadSide } from "./road-cross-section";
import { DEFAULT_ROAD_STYLE_PRESETS } from "./road-style-presets";
import type {
	RoadNetworkNode,
	RoadSideComponents,
	RoadStylePreset,
} from "./schema";

export type RoadwayStyleNumberKey =
	| "laneCount"
	| "laneWidth"
	| "shoulderWidth"
	| "medianWidth"
	| "surfaceThickness";

export type RoadSideStyleNumberKey = keyof RoadSideComponents;

export type RoadSharedSideStyleNumberKey = Extract<
	RoadSideStyleNumberKey,
	"curbWidth" | "gutterWidth" | "sidewalkWidth" | "vergeWidth"
>;

export type RoadStyleEditingPatch = Pick<
	RoadNetworkNode,
	"applyStyleToAll" | "edges" | "stylePresets"
>;

const ROADWAY_LIMITS: Record<
	RoadwayStyleNumberKey,
	readonly [minimum: number, maximum: number]
> = {
	laneCount: [1, 12],
	laneWidth: [2.4, 5],
	shoulderWidth: [0, 4],
	medianWidth: [0, 12],
	surfaceThickness: [0.02, 1],
};

const SIDE_LIMITS: Record<
	RoadSideStyleNumberKey,
	readonly [minimum: number, maximum: number]
> = {
	parkingLaneWidth: [0, 4],
	busLaneWidth: [0, 4],
	bikeLaneWidth: [0, 3],
	gutterWidth: [0, 2],
	curbWidth: [0, 1],
	vergeWidth: [0, 8],
	sidewalkWidth: [0, 6],
};

function clamp(value: number, limits: readonly [number, number]): number {
	return Math.max(limits[0], Math.min(limits[1], value));
}

export function resolveRoadNetworkDefaultStyle(
	node: RoadNetworkNode,
): RoadStylePreset {
	return (
		node.stylePresets[node.activeStyleId] ??
		DEFAULT_ROAD_STYLE_PRESETS[
			node.activeStyleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS
		] ??
		DEFAULT_ROAD_STYLE_PRESETS["local-street"]
	);
}

/** Edit one roadway dimension on the network default without mutating the node. */
export function editRoadNetworkDefaultRoadway(
	node: RoadNetworkNode,
	key: RoadwayStyleNumberKey,
	value: number,
): RoadNetworkNode["stylePresets"] {
	const style = resolveRoadNetworkDefaultStyle(node);
	const safeValue = clamp(
		key === "laneCount" ? Math.round(value) : value,
		ROADWAY_LIMITS[key],
	);
	return {
		...node.stylePresets,
		[node.activeStyleId]: { ...style, [key]: safeValue },
	};
}

/** Edit one left/right component on the network default without mirroring it. */
export function editRoadNetworkDefaultSide(
	node: RoadNetworkNode,
	side: RoadSide,
	key: RoadSideStyleNumberKey,
	value: number,
): RoadNetworkNode["stylePresets"] {
	const style = resolveRoadNetworkDefaultStyle(node);
	const sideKey = side === "left" ? "leftSide" : "rightSide";
	return {
		...node.stylePresets,
		[node.activeStyleId]: {
			...style,
			[sideKey]: {
				...resolveRoadSideComponents(style, side),
				[key]: clamp(value, SIDE_LIMITS[key]),
			},
		},
	};
}

function roadNetworkStyleIds(node: RoadNetworkNode): string[] {
	return Array.from(
		new Set([
			node.activeStyleId,
			...Object.values(node.edges).map((edge) =>
				node.applyStyleToAll ? node.activeStyleId : edge.styleId,
			),
		]),
	);
}

/** Resolve one mirrored roadside value across every segment style in this connected road. */
export function resolveRoadNetworkSharedSideValue(
	node: RoadNetworkNode,
	key: RoadSharedSideStyleNumberKey,
): number {
	return Math.max(
		...roadNetworkStyleIds(node).flatMap((styleId) => {
			const style =
				node.stylePresets[styleId] ?? resolveRoadNetworkDefaultStyle(node);
			return [
				resolveRoadSideComponents(style, "left")[key],
				resolveRoadSideComponents(style, "right")[key],
			];
		}),
	);
}

/** Mirror one common roadside dimension onto both sides of every connected segment. */
export function editRoadNetworkSharedSide(
	node: RoadNetworkNode,
	key: RoadSharedSideStyleNumberKey,
	value: number,
): RoadNetworkNode["stylePresets"] {
	const safeValue = clamp(value, SIDE_LIMITS[key]);
	const stylePresets = { ...node.stylePresets };
	for (const styleId of roadNetworkStyleIds(node)) {
		const style = stylePresets[styleId] ?? resolveRoadNetworkDefaultStyle(node);
		stylePresets[styleId] = {
			...style,
			leftSide: {
				...resolveRoadSideComponents(style, "left"),
				[key]: safeValue,
			},
			rightSide: {
				...resolveRoadSideComponents(style, "right"),
				[key]: safeValue,
			},
		};
	}
	return stylePresets;
}

function edgeStyleId(edgeId: string): string {
	// Host foreign-node validation treats scheme-shaped values as asset URLs.
	return `edge-style~${edgeId}`;
}

function prepareEdgeStyle(
	node: RoadNetworkNode,
	edgeId: string,
): {
	patch: RoadStyleEditingPatch;
	style: RoadStylePreset;
	styleId: string;
} | null {
	const edge = node.edges[edgeId];
	if (!edge) return null;
	const styleId = edgeStyleId(edgeId);
	const existing =
		!node.applyStyleToAll && edge.styleId === styleId
			? node.stylePresets[styleId]
			: undefined;
	const source =
		existing ??
		(node.applyStyleToAll
			? resolveRoadNetworkDefaultStyle(node)
			: (node.stylePresets[edge.styleId] ??
				resolveRoadNetworkDefaultStyle(node)));
	const style = existing ?? {
		...source,
		id: styleId,
		name: `${source.name} — Segment`,
	};
	return {
		patch: {
			applyStyleToAll: false,
			edges: {
				...Object.fromEntries(
					Object.entries(node.edges).map(([id, value]) => [
						id,
						node.applyStyleToAll
							? { ...value, styleId: node.activeStyleId }
							: value,
					]),
				),
				[edgeId]: { ...edge, styleId },
			},
			stylePresets: {
				...node.stylePresets,
				[styleId]: style,
			},
		},
		style,
		styleId,
	};
}

export function resolveRoadStyleEditingScope(
	node: RoadNetworkNode,
	edgeId: string | null,
): { edgeId: string | null; style: RoadStylePreset } {
	const edge = edgeId ? node.edges[edgeId] : undefined;
	if (!edge)
		return { edgeId: null, style: resolveRoadNetworkDefaultStyle(node) };
	return {
		edgeId,
		style:
			(node.applyStyleToAll ? undefined : node.stylePresets[edge.styleId]) ??
			resolveRoadNetworkDefaultStyle(node),
	};
}

/** Create or update an edge-local style while leaving the active network preset intact. */
export function editRoadEdgeRoadway(
	node: RoadNetworkNode,
	edgeId: string,
	key: RoadwayStyleNumberKey,
	value: number,
): RoadStyleEditingPatch | null {
	const prepared = prepareEdgeStyle(node, edgeId);
	if (!prepared) return null;
	const safeValue = clamp(
		key === "laneCount" ? Math.round(value) : value,
		ROADWAY_LIMITS[key],
	);
	return {
		...prepared.patch,
		stylePresets: {
			...prepared.patch.stylePresets,
			[prepared.styleId]: { ...prepared.style, [key]: safeValue },
		},
	};
}

export function editRoadEdgeSide(
	node: RoadNetworkNode,
	edgeId: string,
	side: RoadSide,
	key: RoadSideStyleNumberKey,
	value: number,
): RoadStyleEditingPatch | null {
	const prepared = prepareEdgeStyle(node, edgeId);
	if (!prepared) return null;
	const sideKey = side === "left" ? "leftSide" : "rightSide";
	return {
		...prepared.patch,
		stylePresets: {
			...prepared.patch.stylePresets,
			[prepared.styleId]: {
				...prepared.style,
				[sideKey]: {
					...resolveRoadSideComponents(prepared.style, side),
					[key]: clamp(value, SIDE_LIMITS[key]),
				},
			},
		},
	};
}

/** Reattach one segment to the network default and remove its unused generated style. */
export function resetRoadEdgeStyle(
	node: RoadNetworkNode,
	edgeId: string,
): RoadStyleEditingPatch | null {
	const edge = node.edges[edgeId];
	if (!edge) return null;
	const styleId = edgeStyleId(edgeId);
	const stylePresets = { ...node.stylePresets };
	if (
		!Object.values(node.edges).some(
			(candidate) => candidate.id !== edgeId && candidate.styleId === styleId,
		)
	) {
		delete stylePresets[styleId];
	}
	return {
		applyStyleToAll: false,
		edges: {
			...node.edges,
			[edgeId]: { ...edge, styleId: node.activeStyleId },
		},
		stylePresets,
	};
}
