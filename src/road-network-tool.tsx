"use client";

import { reconcileRoadAttachments } from "./host/road-attachment-reconciliation";

import {
	type AlignmentAnchor,
	type AlignmentGuide,
	type AnyNode,
	type AnyNodeId,
	collectAlignmentAnchors,
	emitter,
	type GridEvent,
	resolveAlignment,
	snapPointToGrid,
	useScene,
} from "@pascal-app/core";
import * as PascalEditor from "@pascal-app/editor";
import {
	CursorSphere,
	EDITOR_LAYER,
	triggerSFX,
	useEditor,
} from "@pascal-app/editor";
import { useViewer } from "@pascal-app/viewer";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { buildRoadCrossSection } from "./road-cross-section";
import {
	buildRoadAutoInfrastructurePlan,
	roadAutoInfrastructureAffectedEdgeIds,
	roadAutoInfrastructureNodeIdsToReplace,
} from "./road-auto-infrastructure";
import { applyRoadAutoInfrastructureClearances } from "./road-auto-infrastructure-style";
import { FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS } from "./road-auto-infrastructure-settings";
import {
	movingRoadDraftAnchor,
	roadEndpointAlignmentAnchors,
	ROAD_DRAFT_ALIGNMENT_ID,
	ROAD_DRAFT_ALIGNMENT_THRESHOLD_M,
} from "./road-draft-alignment";
import {
	ROAD_ANGLE_SNAP_STEP,
	snapRoadPointAlongAngleRay,
} from "./road-draft-snapping";
import {
	applyRoadDraftDirectionConstraints,
	EMPTY_ROAD_DRAFT_DIRECTION_CONSTRAINTS,
	parseRoadDraftNumericValue,
	ROAD_DRAFT_NUMERIC_FIELDS,
	roadDraftMetrics,
	roadDraftNumericLabel,
	roadDraftNumericUnit,
	type RoadDraftDirectionConstraints,
	type RoadDraftNumericField,
} from "./road-draft-numeric";
import { buildRoadDraftStyle } from "./road-draft-style";
import {
	roadDraftInvalidState,
	type RoadDraftInvalidState,
} from "./road-draft-validity";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import { RoadDraftPreviewSurface } from "./road-network-model";
import {
	createEmptyRoadGraph,
	assignRoadStylePreset,
	insertRoadSegment,
	mergeRoadGraphs,
	previewRoadInsertion,
	type RoadDraftSnapTarget,
	type RoadInsertionOperation,
	type RoadInsertionPreview,
	type RoadNetworkGraph,
	type RoadPoint,
	snapRoadDraftPoint,
	splitRoadGraphComponents,
} from "./road-network-topology";
import { roadGraphHasBlockingIssues } from "./road-network-validation";
import { RoadNetworkNode } from "./schema";
import { resolveRoadAttachmentTransform } from "./road-edge-attachments";
import { nextRoadElevationMode, useStreetscapeStore } from "./store";

import { prepareRoadTopologyDocument } from "./host/road-topology-document";
import { createStreetCommandDraft } from "./host/street-command-draft";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./host/application-change-set";
import { getImportOwnerSite } from "./host/imported-baseline-persistence";
import type { StreetIdentityReference } from "./domain/application-change-set";

const ROAD_OPERATION_COLORS: Record<RoadInsertionOperation, string> = {
	"create-cross": "#22c55e",
	"create-tee": "#f59e0b",
	duplicate: "#ef4444",
	"extend-road": "#3b82f6",
	"join-endpoints": "#06b6d4",
	"new-road": "#60a5fa",
	"no-connection": "#ef4444",
	"too-short": "#ef4444",
};

const WALL_STYLE_CURSOR_HEIGHT = 2.5;

type RoadDraftNumericEntry = {
	buffer: string;
	field: RoadDraftNumericField;
};

type RoadDraftNumericDisplay = {
	field: RoadDraftNumericField;
	value: string;
};

function formatRoadDraftNumericValue(
	field: RoadDraftNumericField,
	value: number,
): string {
	return field === "bearing" ? value.toFixed(1) : value.toFixed(2);
}

export function RoadDraftCursor({
	color,
	invalid,
	numeric,
	numericSummary,
}: {
	color: string;
	invalid?: RoadDraftInvalidState | null;
	numeric?: RoadDraftNumericDisplay | null;
	numericSummary?: string | null;
}) {
	const showNumeric = !invalid && (numeric || numericSummary);
	return (
		<group name="road-draft-cursor">
			<CursorSphere
				color={invalid ? "#ef4444" : color}
				height={WALL_STYLE_CURSOR_HEIGHT}
				showTooltip={Boolean(showNumeric)}
				tooltipContent={
					showNumeric ? (
						<div
							data-road-draft-numeric={numeric?.field ?? "constraints"}
							role="status"
							style={{
								background: "rgba(15, 23, 42, 0.96)",
								border: "1px solid #818cf8",
								borderRadius: 8,
								boxShadow: "0 10px 24px rgba(15, 23, 42, 0.3)",
								color: "#fff",
								display: "grid",
								fontFamily: "system-ui, sans-serif",
								flexShrink: 0,
								gap: 3,
								padding: "8px 10px",
								textAlign: "left",
								width: 220,
							}}
						>
							{numeric ? (
								<>
									<span style={{ color: "#c7d2fe", fontSize: 11 }}>
										{roadDraftNumericLabel(numeric.field)}
									</span>
									<strong style={{ fontSize: 16, lineHeight: "20px" }}>
										{numeric.value || "—"}
										{roadDraftNumericUnit(numeric.field)}
									</strong>
									<span style={{ color: "#94a3b8", fontSize: 10 }}>
										Type a value · Enter to apply · Esc to cancel
									</span>
								</>
							) : (
								<>
									<strong style={{ fontSize: 12, lineHeight: "16px" }}>
										Exact road constraint
									</strong>
									<span style={{ color: "#c7d2fe", fontSize: 11 }}>
										{numericSummary}
									</span>
									<span style={{ color: "#94a3b8", fontSize: 10 }}>
										L length · A bearing · R radius · T tangent
									</span>
								</>
							)}
						</div>
					) : undefined
				}
			/>
			{invalid ? (
				<group name="road-invalid-cursor" position={[0, 0.08, 0]}>
					{[Math.PI / 4, -Math.PI / 4].map((rotation) => (
						<mesh key={rotation} rotation={[0, rotation, 0]}>
							<boxGeometry args={[0.55, 0.025, 0.075]} />
							<meshBasicMaterial color="#ef4444" depthTest={false} />
						</mesh>
					))}
				</group>
			) : null}
		</group>
	);
}

function roadNetworks(levelId: string): RoadNetworkNode[] {
	return Object.values(useScene.getState().nodes).filter(
		(node) =>
			(node.type as string) === "streetscape:road-network" &&
			(node as { parentId?: string }).parentId === levelId,
	) as unknown as RoadNetworkNode[];
}

function previewSegment(
	levelId: string,
	start: RoadPoint,
	end: RoadPoint,
	alignment: RoadPoint[],
	tangentLength?: number,
): RoadInsertionPreview {
	const existing = roadNetworks(levelId);
	const graph =
		existing.length > 0
			? mergeRoadGraphs(existing).graph
			: createEmptyRoadGraph();
	const store = useStreetscapeStore.getState();
	return previewRoadInsertion(graph, start, end, {
		alignment,
		bendRadius: store.roadBendRadius,
		tangentLength,
		elevationMode: store.roadElevationMode,
		joinMode: store.roadJoinMode,
		level: store.roadElevationMode === "ground" ? 0 : 1,
		stackLevel: store.roadElevationMode === "bridge" ? 1 : 0,
		tolerance: existing[0]?.snapTolerance ?? 0.5,
	});
}

type RoadDraftSnapMode = "angle" | "free" | "grid" | "lines";

type RoadAlignmentResult = {
	guides: AlignmentGuide[];
	snap: { dx: number; dz: number } | null;
};

type AlignmentGuideStore = {
	getState(): {
		clear(): void;
		set(guides: AlignmentGuide[]): void;
	};
};

type HostSnapApi = {
	isAlignmentGuideActive?: () => boolean;
	isAngleSnapActive?: () => boolean;
	isGridSnapActive?: () => boolean;
	isMagneticSnapActive?: () => boolean;
	resolveAlignmentForActiveBuilding?: (args: {
		candidates: readonly AlignmentAnchor[];
		moving: readonly AlignmentAnchor[];
		threshold: number;
	}) => RoadAlignmentResult;
	useAlignmentGuides?: AlignmentGuideStore;
};

const hostSnapApi = PascalEditor as unknown as HostSnapApi;

function activeRoadDraftSnapMode(): RoadDraftSnapMode {
	const hasHostSnapMode =
		typeof hostSnapApi.isAngleSnapActive === "function" &&
		typeof hostSnapApi.isGridSnapActive === "function" &&
		typeof hostSnapApi.isMagneticSnapActive === "function";
	if (hostSnapApi.isAngleSnapActive?.()) return "angle";
	if (hostSnapApi.isGridSnapActive?.()) return "grid";
	if (hostSnapApi.isMagneticSnapActive?.()) return "lines";
	if (hasHostSnapMode) return "free";

	// Compatibility with Pascal 0.9.1, before the host exposed contextual snap
	// readers. Its legacy magnetic flag represented the default grid behavior.
	return useEditor.getState().magneticSnap ? "grid" : "free";
}

function clearRoadAlignmentGuides(): void {
	hostSnapApi.useAlignmentGuides?.getState().clear();
}

function resolveRoadAlignment(
	point: RoadPoint,
	candidates: readonly AlignmentAnchor[],
): RoadAlignmentResult {
	const input = {
		candidates,
		moving: [movingRoadDraftAnchor(point)],
		threshold: ROAD_DRAFT_ALIGNMENT_THRESHOLD_M,
	};
	return (
		hostSnapApi.resolveAlignmentForActiveBuilding?.(input) ??
		resolveAlignment(input)
	);
}

function publishRoadAlignmentGuides(
	guides: AlignmentGuide[],
	mode: RoadDraftSnapMode,
): void {
	const displayActive =
		hostSnapApi.isAlignmentGuideActive?.() ?? mode === "lines";
	if (!displayActive) {
		clearRoadAlignmentGuides();
		return;
	}
	hostSnapApi.useAlignmentGuides?.getState().set(guides);
}

function rawPlanPoint(event: GridEvent): [number, number, number] {
	const elevationMode = useStreetscapeStore.getState().roadElevationMode;
	const elevation = elevationMode === "bridge" ? 5.5 : 0;
	return [
		event.localPosition[0],
		event.localPosition[1] + elevation,
		event.localPosition[2],
	];
}

function snappedPlanPoint(
	event: GridEvent,
	start: RoadPoint | null,
	mode = activeRoadDraftSnapMode(),
): [number, number, number] {
	const raw = rawPlanPoint(event);
	const gridStep = useEditor.getState().gridSnapStep;
	if (mode === "angle" && start) {
		const [x, z] = snapRoadPointAlongAngleRay(
			[start[0], start[2]],
			[raw[0], raw[2]],
			ROAD_ANGLE_SNAP_STEP,
			gridStep,
		);
		return [x, raw[1], z];
	}
	if (mode === "grid") {
		const [x, z] = snapPointToGrid([raw[0], raw[2]], gridStep);
		return [x, raw[1], z];
	}
	return raw;
}

export function RoadAngleSnapRay({
	end,
	start,
}: {
	end: RoadPoint;
	start: RoadPoint;
}) {
	const dx = end[0] - start[0];
	const dz = end[2] - start[2];
	const length = Math.hypot(dx, dz);
	if (length < 0.01) return null;
	const extension = 0.55;
	const directionX = dx / length;
	const directionZ = dz / length;
	const guideLength = length + extension;

	return (
		<mesh
			name="road-angle-snap-ray"
			position={[
				start[0] + directionX * guideLength * 0.5,
				(start[1] + end[1]) * 0.5 + 0.16,
				start[2] + directionZ * guideLength * 0.5,
			]}
			rotation={[0, -Math.atan2(directionZ, directionX), 0]}
		>
			<boxGeometry args={[guideLength, 0.018, 0.035]} />
			<meshBasicMaterial
				color="#818cf8"
				depthTest={false}
				opacity={0.92}
				transparent
			/>
		</mesh>
	);
}

function roadMagneticSnapTolerance(networks: RoadNetworkNode[]): number {
	let tolerance = Math.max(
		0.5,
		...networks.map((network) => network.snapTolerance),
	);
	for (const network of networks) {
		for (const edge of Object.values(network.edges)) {
			const styleId = network.applyStyleToAll
				? network.activeStyleId
				: edge.styleId;
			const style = network.stylePresets[styleId];
			if (!style) continue;
			// Capture anywhere over the visible road/sidewalk footprint, then pull
			// the cursor to the actual centerline before topology preview/commit.
			const crossSection = buildRoadCrossSection(style);
			tolerance = Math.max(
				tolerance,
				crossSection.sides.left.outerOffset + 0.4,
				crossSection.sides.right.outerOffset + 0.4,
			);
		}
	}
	return tolerance;
}

export function prepareRoadSegmentCommand(
	levelId: string,
	start: RoadPoint,
	end: RoadPoint,
	alignment: RoadPoint[],
	tangentLength?: number,
) {
	const state = useScene.getState();
	const expected = captureStreetChangePreconditions(
		getImportOwnerSite(state, levelId),
	);
	const existing = roadNetworks(levelId);
	const merged = mergeRoadGraphs(existing);
	const graph = existing.length > 0 ? merged.graph : createEmptyRoadGraph();
	const store = useStreetscapeStore.getState();
	const draftStyle = buildRoadDraftStyle({
		laneCount: store.roadLaneCount,
		laneWidth: store.roadLaneWidth,
		medianWidth: store.roadMedianWidth,
		presetId: store.roadStylePresetId,
		shoulderWidth: store.roadShoulderWidth,
		sides: store.roadSideComponents,
	});
	const autoInfrastructureSettings = existing.some(
		(network) => network.roadsideAutoFillEnabled,
	)
		? FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS
		: store.roadAutoInfrastructure;
	const clearedDraftStyle = applyRoadAutoInfrastructureClearances(
		draftStyle,
		autoInfrastructureSettings,
	);
	draftStyle.id = assignRoadStylePreset(graph, clearedDraftStyle);
	graph.activeStyleId = draftStyle.id;
	graph.stylePresets = {
		...graph.stylePresets,
		[draftStyle.id]: { ...clearedDraftStyle, id: draftStyle.id },
	};
	const result = insertRoadSegment(graph, start, end, {
		alignment,
		bendRadius: store.roadBendRadius,
		tangentLength,
		tolerance: existing[0]?.snapTolerance ?? 0.5,
		elevationMode: store.roadElevationMode,
		joinMode: store.roadJoinMode,
		level: store.roadElevationMode === "ground" ? 0 : 1,
		stackLevel: store.roadElevationMode === "bridge" ? 1 : 0,
	});
	if (result.status !== "inserted") return null;
	if (roadGraphHasBlockingIssues(result.graph)) return null;
	const components = splitRoadGraphComponents(result.graph);
	const targetIndex = Math.max(
		0,
		components.findIndex((component) =>
			result.createdEdgeIds.some((edgeId) => edgeId in component.edges),
		),
	);
	const scene = createStreetCommandDraft(state.nodes, expected);
	const resolvedNetworks: RoadNetworkNode[] = [];
	const template = existing[0];
	for (let index = 0; index < components.length; index++) {
		const component = components[index]!;
		const current = existing[index];
		const isTargetComponent = index === targetIndex;
		const activeStyleId = isTargetComponent
			? component.activeStyleId
			: current
				? (merged.styleIdMaps[index]?.[current.activeStyleId] ??
					current.activeStyleId)
				: component.activeStyleId;
		const applyStyleToAll = isTargetComponent
			? current?.applyStyleToAll === true &&
				current.activeStyleId === component.activeStyleId &&
				Object.values(component.edges).every(
					(edge) => edge.styleId === component.activeStyleId,
				)
			: (current?.applyStyleToAll ?? true);
		if (current) {
			scene.updateNode(
				current.id as AnyNodeId,
				{
					graphNodes: component.graphNodes,
					edges: component.edges,
					attachments: component.attachments,
					junctions: component.junctions,
					stylePresets: component.stylePresets,
					activeStyleId,
					applyStyleToAll,
				} as Partial<AnyNode>,
			);
			resolvedNetworks.push({
				...current,
				graphNodes: component.graphNodes,
				edges: component.edges,
				attachments: component.attachments,
				junctions: component.junctions,
				stylePresets: component.stylePresets,
				activeStyleId,
				applyStyleToAll,
			});
			continue;
		}
		const network = RoadNetworkNode.parse({
			parentId: levelId,
			metadata: template?.metadata,
			graphNodes: component.graphNodes,
			edges: component.edges,
			attachments: component.attachments,
			junctions: component.junctions,
			stylePresets: component.stylePresets,
			activeStyleId,
			applyStyleToAll,
			snapTolerance: template?.snapTolerance ?? 0.5,
		});
		scene.createNode(network as unknown as AnyNode, levelId as AnyNodeId);
		resolvedNetworks.push(network);
	}
	for (const network of resolvedNetworks) {
		for (const attachment of Object.values(network.attachments ?? {})) {
			const asset = Object.values(scene.nodes).find(
				(candidate) => candidate.id === attachment.assetNodeId,
			) as unknown as
				| {
						id: string;
						roadAttachment?: { networkNodeId: string; attachmentId: string };
				  }
				| undefined;
			if (!asset) continue;
			const transform = resolveRoadAttachmentTransform(
				network,
				attachment,
				asset as unknown as Parameters<
					typeof resolveRoadAttachmentTransform
				>[2],
			);
			scene.updateNode(
				asset.id as AnyNodeId,
				{
					...(transform
						? { position: transform.position, rotation: transform.rotation }
						: {}),
					roadAttachment: {
						networkNodeId: network.id,
						attachmentId: attachment.id,
						side: attachment.side,
					},
				} as Partial<AnyNode>,
			);
		}
	}
	for (const obsolete of existing.slice(components.length)) {
		scene.deleteNode(obsolete.id as AnyNodeId);
	}
	const targetNetwork = resolvedNetworks[targetIndex] ?? null;
	if (targetNetwork) {
		const affectedEdgeIds = roadAutoInfrastructureAffectedEdgeIds(
			targetNetwork,
			result.createdEdgeIds,
		);
		const nodesBeforeReconciliation = Object.values(scene.nodes);
		const nodeIdsToReplace = roadAutoInfrastructureNodeIdsToReplace({
			edgeIds: affectedEdgeIds,
			existingNodes: nodesBeforeReconciliation,
			network: targetNetwork,
		});
		const removedIds = new Set(nodeIdsToReplace);
		const generated = buildRoadAutoInfrastructurePlan({
			edgeIds: affectedEdgeIds,
			existingNodes: nodesBeforeReconciliation.filter(
				(candidate) => !removedIds.has(candidate.id),
			),
			network: targetNetwork,
			settings: targetNetwork.roadsideAutoFillEnabled
				? FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS
				: store.roadAutoInfrastructure,
		});
		const attachments = Object.fromEntries([
			...Object.entries(targetNetwork.attachments ?? {}).filter(
				([, attachment]) => !removedIds.has(attachment.assetNodeId),
			),
			...Object.entries(generated.attachments),
		]);
		if (generated.nodes.length > 0 || removedIds.size > 0) {
			scene.applyNodeChanges({
				delete: nodeIdsToReplace as AnyNodeId[],
				update: [
					{
						id: targetNetwork.id as AnyNodeId,
						data: { attachments } as Partial<AnyNode>,
					},
				],
				create: generated.nodes.map((node) => ({
					node: node as unknown as AnyNode,
					parentId: levelId as AnyNodeId,
				})),
			});
			targetNetwork.attachments = attachments;
		}
	}
	for (const network of resolvedNetworks) {
		const reconciled = reconcileRoadAttachments(network, scene.nodes);
		Object.assign(network, reconciled.network);
		scene.applyNodeChanges({
			update: [
				{
					id: network.id as AnyNodeId,
					data: { attachments: network.attachments, stylePresets: network.stylePresets, roadsideDecorations: network.roadsideDecorations } as Partial<AnyNode>,
				},
				...reconciled.update,
			],
		});
	}
	if (!targetNetwork) return null;
	const remaps: Array<{
		from: StreetIdentityReference;
		to: StreetIdentityReference[];
	}> = [];
	for (let i = 0; i < existing.length; i++) {
		const old = existing[i]!;
		for (const id of Object.keys(old.edges)) {
			const mergedId = merged.edgeIdMaps[i]![id]!;
			const descendants = result.edgeIdRemap[mergedId] ?? [mergedId];
			remaps.push({
				from: { kind: "road-edge", networkId: old.id, id },
				to: resolvedNetworks.flatMap((network) =>
					descendants
						.filter((edgeId) => Object.hasOwn(network.edges, edgeId))
						.map((edgeId) => ({
							kind: "road-edge" as const,
							networkId: network.id,
							id: edgeId,
						})),
				),
			});
		}
		for (const id of Object.keys(old.graphNodes)) {
			const mergedId = merged.nodeIdMaps[i]![id]!;
			remaps.push({
				from: { kind: "road-node", networkId: old.id, id },
				to: resolvedNetworks
					.filter((network) => Object.hasOwn(network.graphNodes, mergedId))
					.map((network) => ({
						kind: "road-node" as const,
						networkId: network.id,
						id: mergedId,
					})),
			});
		}
		if (!scene.nodes[old.id as AnyNodeId])
			remaps.push({
				from: { kind: "host-node", id: old.id },
				to: resolvedNetworks
					.filter((network) =>
						Object.values(network.edges).some((edge) =>
							Object.values(merged.edgeIdMaps[i]!).some((id) =>
								(result.edgeIdRemap[id] ?? [id]).includes(edge.id),
							),
						),
					)
					.map((network) => ({ kind: "host-node" as const, id: network.id })),
			});
	}
	for (const old of Object.values(state.nodes))
		if (
			old.type.startsWith("streetscape:") &&
			!scene.nodes[old.id] &&
			!remaps.some((r) => r.from.kind === "host-node" && r.from.id === old.id)
		)
			remaps.push({ from: { kind: "host-node", id: old.id }, to: [] });
	const document = prepareRoadTopologyDocument({
		before: state,
		after: { ...state, nodes: scene.nodes },
		siteId: expected.siteId!,
		oldNetworks: existing,
		networks: resolvedNetworks,
		identityRemaps: remaps,
	});
	if (document) {
        scene.applyNodeChanges({update:document.generatedItemUpdates as {id:AnyNodeId;data:Partial<AnyNode>}[]});
		scene.updateNode(expected.siteId as AnyNodeId, {
			metadata: document.metadata,
		});
		remaps.push(...document.identityRemaps);
	}
	return {
		network: targetNetwork,
		change: scene.finish(
			"insert-road-segment",
			"Create road segment and reconcile topology",
			remaps,
		),
	};
}

function commitSegment(
	levelId: string,
	start: RoadPoint,
	end: RoadPoint,
	alignment: RoadPoint[],
	tangentLength?: number,
): RoadNetworkNode | null {
	const prepared = prepareRoadSegmentCommand(
		levelId,
		start,
		end,
		alignment,
		tangentLength,
	);
	if (!prepared) return null;
	commitHostStreetChangeSet(prepared.change);
	return prepared.network;
}

/** Multi-click centerline drafting for incremental straight legs or one spline. */
export default function RoadNetworkTool({ renderPreview = true }: { renderPreview?: boolean } = {}) {
	const activeLevelId = useViewer((state) => state.selection.levelId);
	const cursorRef = useRef<Group>(null);
	const cursorPointRef = useRef<RoadPoint | null>(null);
	const unconstrainedCursorRef = useRef<RoadPoint | null>(null);
	const startRef = useRef<[number, number, number] | null>(null);
	const splinePointsRef = useRef<Array<[number, number, number]>>([]);
	const directionConstraintsRef = useRef<RoadDraftDirectionConstraints>({
		...EMPTY_ROAD_DRAFT_DIRECTION_CONSTRAINTS,
	});
	const numericEntryRef = useRef<RoadDraftNumericEntry | null>(null);
	const tangentLengthRef = useRef<number | null>(null);
	const [start, setStart] = useState<[number, number, number] | null>(null);
	const [splinePoints, setSplinePoints] = useState<
		Array<[number, number, number]>
	>([]);
	const [cursor, setCursor] = useState<[number, number, number] | null>(null);
	const [snapTarget, setSnapTarget] = useState<RoadDraftSnapTarget | null>(
		null,
	);
	const [draftSnapMode, setDraftSnapMode] = useState<RoadDraftSnapMode>("grid");
	const [attemptedInvalid, setAttemptedInvalid] =
		useState<RoadDraftInvalidState | null>(null);
	const [directionConstraints, setDirectionConstraints] =
		useState<RoadDraftDirectionConstraints>({
			...EMPTY_ROAD_DRAFT_DIRECTION_CONSTRAINTS,
		});
	const [numericEntry, setNumericEntry] =
		useState<RoadDraftNumericEntry | null>(null);
	const [tangentLength, setTangentLength] = useState<number | null>(null);
	const roadSideComponents = useStreetscapeStore(
		(state) => state.roadSideComponents,
	);
	const roadAutoInfrastructure = useStreetscapeStore(
		(state) => state.roadAutoInfrastructure,
	);
	const roadStylePresetId = useStreetscapeStore(
		(state) => state.roadStylePresetId,
	);
	const roadLaneCount = useStreetscapeStore((state) => state.roadLaneCount);
	const roadLaneWidth = useStreetscapeStore((state) => state.roadLaneWidth);
	const roadShoulderWidth = useStreetscapeStore(
		(state) => state.roadShoulderWidth,
	);
	const roadMedianWidth = useStreetscapeStore((state) => state.roadMedianWidth);
	const draftStyle = useMemo(
		() =>
			buildRoadDraftStyle({
				laneCount: roadLaneCount,
				laneWidth: roadLaneWidth,
				medianWidth: roadMedianWidth,
				presetId: roadStylePresetId,
				shoulderWidth: roadShoulderWidth,
				sides: roadSideComponents,
			}),
		[
			roadLaneCount,
			roadLaneWidth,
			roadMedianWidth,
			roadShoulderWidth,
			roadSideComponents,
			roadStylePresetId,
			roadAutoInfrastructure,
		],
	);
	const style = useMemo(
		() =>
			applyRoadAutoInfrastructureClearances(draftStyle, roadAutoInfrastructure),
		[draftStyle, roadAutoInfrastructure],
	);
	const alignmentMode = useStreetscapeStore((state) => state.roadAlignmentMode);
	const bendRadius = useStreetscapeStore((state) => state.roadBendRadius);
	const elevationMode = useStreetscapeStore((state) => state.roadElevationMode);
	const joinMode = useStreetscapeStore((state) => state.roadJoinMode);

	useEffect(() => {
		startRef.current = null;
		splinePointsRef.current = [];
		directionConstraintsRef.current = {
			...EMPTY_ROAD_DRAFT_DIRECTION_CONSTRAINTS,
		};
		numericEntryRef.current = null;
		tangentLengthRef.current = null;
		setStart(null);
		setSplinePoints([]);
		setDirectionConstraints({ ...EMPTY_ROAD_DRAFT_DIRECTION_CONSTRAINTS });
		setNumericEntry(null);
		setTangentLength(null);
		setSnapTarget(null);
		setAttemptedInvalid(null);
		clearRoadAlignmentGuides();
		(
			useEditor.getState() as ReturnType<typeof useEditor.getState> & {
				setDraftVertexCount?: (count: number) => void;
			}
		).setDraftVertexCount?.(0);
	}, [alignmentMode]);

	const draftPreview = useMemo<RoadInsertionPreview | null>(() => {
		if (!activeLevelId || !start || !cursor) return null;
		return previewSegment(
			activeLevelId,
			start,
			cursor,
			alignmentMode === "spline" ? splinePoints : [],
			tangentLength ?? undefined,
		);
	}, [
		activeLevelId,
		alignmentMode,
		bendRadius,
		cursor,
		elevationMode,
		joinMode,
		splinePoints,
		start,
		tangentLength,
	]);
	const previewOperation = draftPreview?.operation ?? null;
	const invalidDraft =
		attemptedInvalid ??
		(draftPreview ? roadDraftInvalidState(draftPreview) : null);
	const previewColor = invalidDraft
		? "#ef4444"
		: previewOperation
			? ROAD_OPERATION_COLORS[previewOperation]
			: undefined;
	const previewPoints = useMemo(() => {
		if (!start || !cursor) return [];
		if (alignmentMode !== "spline" || splinePoints.length === 0)
			return [start, cursor];
		return sampleRoadEdgePoints(
			{
				graphNodes: {
					previewStart: {
						id: "previewStart",
						position: start,
						level: 0,
						elevationMode: "ground",
						terminal: false,
					},
					previewEnd: {
						id: "previewEnd",
						position: cursor,
						level: 0,
						elevationMode: "ground",
						terminal: false,
					},
				},
			},
			{
				id: "previewEdge",
				startNodeId: "previewStart",
				endNodeId: "previewEnd",
				alignment: splinePoints,
				profileMode: "legacy",
				verticalProfile: [],
				styleId: style.id,
				direction: "both",
				roadClass: "local",
				joinMode: "auto",
				stackLevel: 0,
			},
			16,
		);
	}, [alignmentMode, cursor, splinePoints, start, style.id]);
	const numericDisplay = useMemo<RoadDraftNumericDisplay | null>(() => {
		if (!numericEntry) return null;
		let fallback = 0;
		if (
			(numericEntry.field === "length" || numericEntry.field === "bearing") &&
			start &&
			cursor
		) {
			fallback = roadDraftMetrics(start, cursor)[numericEntry.field];
		} else if (numericEntry.field === "radius") {
			fallback = bendRadius;
		} else if (numericEntry.field === "tangent") {
			fallback = tangentLength ?? 0;
		}
		return {
			field: numericEntry.field,
			value:
				numericEntry.buffer ||
				formatRoadDraftNumericValue(numericEntry.field, fallback),
		};
	}, [bendRadius, cursor, numericEntry, start, tangentLength]);
	const numericSummary = useMemo(() => {
		const parts: string[] = [];
		if (directionConstraints.length !== null) {
			parts.push(`L ${directionConstraints.length.toFixed(2)} m`);
		}
		if (directionConstraints.bearing !== null) {
			parts.push(`A ${directionConstraints.bearing.toFixed(1)}°`);
		}
		if (tangentLength !== null) parts.push(`T ${tangentLength.toFixed(2)} m`);
		return parts.length > 0 ? parts.join(" · ") : null;
	}, [directionConstraints, tangentLength]);

	useEffect(() => {
		if (!activeLevelId) return;
		const updateNumericEntry = (entry: RoadDraftNumericEntry | null) => {
			numericEntryRef.current = entry;
			setNumericEntry(entry);
		};
		const updateDirectionConstraints = (
			constraints: RoadDraftDirectionConstraints,
		) => {
			directionConstraintsRef.current = constraints;
			setDirectionConstraints(constraints);
		};
		const updateTangentLength = (value: number | null) => {
			tangentLengthRef.current = value;
			setTangentLength(value);
		};
		const updateCursorPoint = (
			point: RoadPoint,
			unconstrainedPoint: RoadPoint = point,
		) => {
			cursorPointRef.current = point;
			unconstrainedCursorRef.current = unconstrainedPoint;
			setCursor([...point]);
			// The shared tool may briefly remain mounted while the floorplan host
			// switches from Road to another streetscape tool. Its ref is then a DOM
			// group rather than a Three group, so only update a Three position.
			cursorRef.current?.position?.set(point[0], point[1], point[2]);
		};
		const resetSegmentNumeric = () => {
			updateDirectionConstraints({
				...EMPTY_ROAD_DRAFT_DIRECTION_CONSTRAINTS,
			});
			updateTangentLength(null);
			updateNumericEntry(null);
		};
		const updateStart = (point: [number, number, number] | null) => {
			startRef.current = point;
			setStart(point);
			(
				useEditor.getState() as ReturnType<typeof useEditor.getState> & {
					setDraftVertexCount?: (count: number) => void;
				}
			).setDraftVertexCount?.(point ? 1 : 0);
		};
		const updateSplinePoints = (points: Array<[number, number, number]>) => {
			splinePointsRef.current = points;
			setSplinePoints(points);
			(
				useEditor.getState() as ReturnType<typeof useEditor.getState> & {
					setDraftVertexCount?: (count: number) => void;
				}
			).setDraftVertexCount?.((startRef.current ? 1 : 0) + points.length);
		};
		const resolveDraftPoint = (event: GridEvent) => {
			const mode = activeRoadDraftSnapMode();
			const rawPoint = rawPlanPoint(event);
			let point = snappedPlanPoint(event, startRef.current, mode);
			const store = useStreetscapeStore.getState();
			const existing = roadNetworks(activeLevelId);
			const graph: RoadNetworkGraph | null =
				existing.length > 0 ? mergeRoadGraphs(existing).graph : null;
			const hasDirectionalConstraint =
				directionConstraintsRef.current.length !== null ||
				directionConstraintsRef.current.bearing !== null;
			// Like Pascal's wall drafting, semantic/special geometry wins before an
			// angle or grid transform. The road footprint therefore remains an easy
			// magnetic target even while angle lock is selected. Exact typed values
			// intentionally take priority over a conflicting magnetic pull.
			const target =
				graph && !hasDirectionalConstraint
					? snapRoadDraftPoint(graph, rawPoint, {
							elevationMode: store.roadElevationMode,
							joinMode: store.roadJoinMode,
							level: store.roadElevationMode === "ground" ? 0 : 1,
							nodeTolerance: Math.max(
								0.5,
								...existing.map((network) => network.snapTolerance),
							),
							stackLevel: store.roadElevationMode === "bridge" ? 1 : 0,
							tolerance: roadMagneticSnapTolerance(existing),
						})
					: null;
			if (target) {
				clearRoadAlignmentGuides();
				return {
					mode,
					point: target.point,
					target,
					unconstrainedPoint: target.point,
				};
			}

			const candidates = collectAlignmentAnchors(
				useScene.getState().nodes,
				ROAD_DRAFT_ALIGNMENT_ID,
				activeLevelId,
			);
			if (graph) {
				candidates.push(
					...roadEndpointAlignmentAnchors(graph, {
						elevationMode: store.roadElevationMode,
						excludePoint: startRef.current,
						level: store.roadElevationMode === "ground" ? 0 : 1,
					}),
				);
			}
			const alignment = resolveRoadAlignment(point, candidates);
			publishRoadAlignmentGuides(alignment.guides, mode);
			if (mode === "lines" && alignment.snap && !hasDirectionalConstraint) {
				point = [
					point[0] + alignment.snap.dx,
					point[1],
					point[2] + alignment.snap.dz,
				];
			}
			const unconstrainedPoint = point;
			if (startRef.current && hasDirectionalConstraint) {
				point = applyRoadDraftDirectionConstraints(
					startRef.current,
					point,
					directionConstraintsRef.current,
				);
			}
			return { mode, point, target: null, unconstrainedPoint };
		};
		const onMove = (event: GridEvent) => {
			const { mode, point, target, unconstrainedPoint } =
				resolveDraftPoint(event);
			setAttemptedInvalid(null);
			setDraftSnapMode(mode);
			setSnapTarget(target);
			updateCursorPoint(point, unconstrainedPoint);
		};
		const onClick = (event: GridEvent) => {
			const { mode, point, target, unconstrainedPoint } =
				resolveDraftPoint(event);
			clearRoadAlignmentGuides();
			setDraftSnapMode(mode);
			setSnapTarget(target);
			updateCursorPoint(point, unconstrainedPoint);
			const previous = startRef.current;
			if (!previous) {
				setAttemptedInvalid(null);
				updateStart(point);
				triggerSFX("sfx:item-place");
				return;
			}
			if (useStreetscapeStore.getState().roadAlignmentMode === "spline") {
				const last = splinePointsRef.current.at(-1) ?? previous;
				if (Math.hypot(point[0] - last[0], point[2] - last[2]) < 0.05) return;
				setAttemptedInvalid(null);
				setSnapTarget(null);
				updateSplinePoints([...splinePointsRef.current, point]);
				resetSegmentNumeric();
				triggerSFX("sfx:item-place");
				return;
			}
			const invalid = roadDraftInvalidState(
				previewSegment(
					activeLevelId,
					previous,
					point,
					[],
					tangentLengthRef.current ?? undefined,
				),
			);
			if (invalid) {
				setAttemptedInvalid(invalid);
				return;
			}
			setAttemptedInvalid(null);
			const network = commitSegment(
				activeLevelId,
				previous,
				point,
				[],
				tangentLengthRef.current ?? undefined,
			);
			if (!network) return;
			useViewer
				.getState()
				.setSelection({ selectedIds: [network.id as AnyNodeId] });
			triggerSFX("sfx:item-place");
			// Continue from the last committed point so successive clicks form
			// L, V, and free polyline roads without changing tools.
			updateStart(point);
			updateSplinePoints([]);
			setSnapTarget(null);
			resetSegmentNumeric();
		};
		const clearDraft = () => {
			updateSplinePoints([]);
			updateStart(null);
			setSnapTarget(null);
			setAttemptedInvalid(null);
			resetSegmentNumeric();
			clearRoadAlignmentGuides();
		};
		const finish = () => {
			if (
				useStreetscapeStore.getState().roadAlignmentMode === "spline" &&
				startRef.current &&
				splinePointsRef.current.length > 0
			) {
				const end = splinePointsRef.current.at(-1)!;
				const alignment = splinePointsRef.current.slice(0, -1);
				const invalid = roadDraftInvalidState(
					previewSegment(
						activeLevelId,
						startRef.current,
						end,
						alignment,
						tangentLengthRef.current ?? undefined,
					),
				);
				if (invalid) {
					setAttemptedInvalid(invalid);
					return;
				}
				const network = commitSegment(
					activeLevelId,
					startRef.current,
					end,
					alignment,
					tangentLengthRef.current ?? undefined,
				);
				if (network) {
					useViewer
						.getState()
						.setSelection({ selectedIds: [network.id as AnyNodeId] });
					triggerSFX("sfx:item-place");
				}
			} else if (startRef.current && cursorPointRef.current) {
				const start = startRef.current;
				const end = cursorPointRef.current;
				if (Math.hypot(end[0] - start[0], end[2] - start[2]) >= 0.05) {
					const invalid = roadDraftInvalidState(
						previewSegment(
							activeLevelId,
							start,
							end,
							[],
							tangentLengthRef.current ?? undefined,
						),
					);
					if (invalid) {
						setAttemptedInvalid(invalid);
						return;
					}
					const network = commitSegment(
						activeLevelId,
						start,
						end,
						[],
						tangentLengthRef.current ?? undefined,
					);
					if (network) {
						useViewer
							.getState()
							.setSelection({ selectedIds: [network.id as AnyNodeId] });
						triggerSFX("sfx:item-place");
					}
				}
			}
			clearDraft();
			// Leaving `mode: 'build'` with the Road tool still armed keeps every
			// road mesh intentionally click-through. Return to Select so the road
			// that was just committed can immediately receive selection events.
			useEditor.getState().setTool(null);
			useEditor.getState().setMode("select");
		};
		const onDoubleClick = finish;
		const numericFallbackValue = (field: RoadDraftNumericField) => {
			if (field === "radius") {
				return useStreetscapeStore.getState().roadBendRadius;
			}
			if (field === "tangent") return tangentLengthRef.current ?? 0;
			if (!startRef.current || !cursorPointRef.current) return null;
			return roadDraftMetrics(startRef.current, cursorPointRef.current)[field];
		};
		const openNumericEntry = (field: RoadDraftNumericField) => {
			if ((field === "length" || field === "bearing") && !startRef.current) {
				return false;
			}
			updateNumericEntry({ buffer: "", field });
			setAttemptedInvalid(null);
			return true;
		};
		const refreshConstrainedCursor = () => {
			const basis = unconstrainedCursorRef.current ?? cursorPointRef.current;
			if (!startRef.current || !basis) return;
			const next = applyRoadDraftDirectionConstraints(
				startRef.current,
				basis,
				directionConstraintsRef.current,
			);
			updateCursorPoint(next, basis);
			setSnapTarget(null);
		};
		const applyNumericEntry = () => {
			const entry = numericEntryRef.current;
			if (!entry) return false;
			const fallback = numericFallbackValue(entry.field);
			const source = entry.buffer || (fallback === null ? "" : `${fallback}`);
			const value = parseRoadDraftNumericValue(entry.field, source);
			if (value === null) return false;

			if (entry.field === "length" || entry.field === "bearing") {
				updateDirectionConstraints({
					...directionConstraintsRef.current,
					[entry.field]: value,
				});
				refreshConstrainedCursor();
			} else if (entry.field === "radius") {
				useStreetscapeStore.getState().setRoadBendRadius(value);
				updateTangentLength(null);
			} else {
				updateTangentLength(value);
			}
			updateNumericEntry(null);
			return true;
		};
		const consumeNumericKey = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(
					'input, textarea, select, [contenteditable="true"], [role="textbox"]',
				)
			) {
				return;
			}
			const key = event.key.toLowerCase();
			const entry = numericEntryRef.current;
			if (entry) {
				if (key === "escape") {
					consumeNumericKey(event);
					updateNumericEntry(null);
					return;
				}
				if (key === "enter") {
					consumeNumericKey(event);
					applyNumericEntry();
					return;
				}
				if (key === "tab") {
					consumeNumericKey(event);
					const currentIndex = ROAD_DRAFT_NUMERIC_FIELDS.indexOf(entry.field);
					if (applyNumericEntry()) {
						openNumericEntry(
							ROAD_DRAFT_NUMERIC_FIELDS[
								(currentIndex + 1) % ROAD_DRAFT_NUMERIC_FIELDS.length
							]!,
						);
					}
					return;
				}
				if (key === "backspace") {
					consumeNumericKey(event);
					updateNumericEntry({
						...entry,
						buffer: entry.buffer.slice(0, -1),
					});
					return;
				}
				if (
					/^[0-9]$/.test(key) ||
					(key === "." && !entry.buffer.includes(".")) ||
					(key === "-" && entry.buffer.length === 0)
				) {
					consumeNumericKey(event);
					updateNumericEntry({ ...entry, buffer: `${entry.buffer}${key}` });
					return;
				}
				const requestedField: Record<
					string,
					RoadDraftNumericField | undefined
				> = {
					a: "bearing",
					l: "length",
					r: "radius",
					t: "tangent",
				};
				if (requestedField[key]) {
					consumeNumericKey(event);
					openNumericEntry(requestedField[key]!);
				}
				return;
			}

			const requestedField: Record<string, RoadDraftNumericField | undefined> =
				{
					a: "bearing",
					l: "length",
					r: "radius",
					t: "tangent",
				};
			if (requestedField[key] && openNumericEntry(requestedField[key]!)) {
				consumeNumericKey(event);
				return;
			}
			if (
				key === "backspace" &&
				(splinePointsRef.current.length > 0 || startRef.current)
			) {
				if (splinePointsRef.current.length > 0) {
					updateSplinePoints(splinePointsRef.current.slice(0, -1));
				} else if (startRef.current) {
					updateStart(null);
				}
				setAttemptedInvalid(null);
				event.preventDefault();
				return;
			}
			if (event.key === "Enter") finish();
			if (key === "c") {
				const store = useStreetscapeStore.getState();
				store.setRoadAlignmentMode(
					store.roadAlignmentMode === "straight" ? "spline" : "straight",
				);
				clearDraft();
			}
			if (key === "b") {
				const store = useStreetscapeStore.getState();
				store.setRoadElevationMode(
					nextRoadElevationMode(store.roadElevationMode),
				);
				clearDraft();
			}
			if (key === "j") {
				const store = useStreetscapeStore.getState();
				store.setRoadJoinMode(
					store.roadJoinMode === "auto" ? "suppress" : "auto",
				);
			}
		};

		emitter.on("grid:move", onMove);
		emitter.on("grid:click", onClick);
		emitter.on("grid:double-click", onDoubleClick);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			emitter.off("grid:move", onMove);
			emitter.off("grid:click", onClick);
			emitter.off("grid:double-click", onDoubleClick);
			window.removeEventListener("keydown", onKeyDown, true);
			clearRoadAlignmentGuides();
			(
				useEditor.getState() as ReturnType<typeof useEditor.getState> & {
					setDraftVertexCount?: (count: number) => void;
				}
			).setDraftVertexCount?.(0);
		};
	}, [activeLevelId]);

	if (!activeLevelId || !renderPreview) return null;
	return (
		<group layers={EDITOR_LAYER} ref={cursorRef}>
			{snapTarget ? (
				<group
					name={`road-draft-snap-${snapTarget.kind}`}
					position={[0, 0.095, 0]}
				>
					<mesh rotation={[Math.PI / 2, 0, 0]}>
						<torusGeometry args={[0.36, 0.055, 10, 32]} />
						<meshBasicMaterial
							color={snapTarget.kind === "node" ? "#06b6d4" : "#22c55e"}
							depthTest={false}
						/>
					</mesh>
					<mesh position={[0, 0.015, 0]}>
						<cylinderGeometry args={[0.075, 0.075, 0.035, 20]} />
						<meshBasicMaterial color="#ffffff" depthTest={false} />
					</mesh>
				</group>
			) : null}
			{previewPoints.length >= 2 && cursor ? (
				<group position={[-cursor[0], -cursor[1], -cursor[2]]}>
					{draftSnapMode === "angle" && !snapTarget && start ? (
						<RoadAngleSnapRay end={cursor} start={start} />
					) : null}
					<RoadDraftPreviewSurface
						color={previewColor}
						points={previewPoints}
						style={style}
					/>
				</group>
			) : null}
			<RoadDraftCursor
				color={
					previewColor ??
					(elevationMode === "bridge"
						? "#f59e0b"
						: joinMode === "suppress"
							? "#ef4444"
							: splinePoints.length > 0
								? "#14b8a6"
								: alignmentMode === "spline"
									? "#22d3ee"
									: start
										? "#3b82f6"
										: "#818cf8")
				}
				invalid={invalidDraft}
				numeric={numericDisplay}
				numericSummary={numericDisplay ? null : numericSummary}
			/>
			{previewOperation &&
			["create-tee", "create-cross", "no-connection"].includes(
				previewOperation,
			) ? (
				<mesh
					name={`road-operation-${previewOperation}`}
					position={[0, 0.08, 0]}
					rotation={[Math.PI / 2, 0, 0]}
				>
					<torusGeometry args={[0.3, 0.055, 8, 24]} />
					<meshBasicMaterial color={previewColor} depthTest={false} />
				</mesh>
			) : null}
		</group>
	);
}
