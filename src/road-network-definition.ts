import {
	type AnyNode,
	type AnyNodeId,
	type NodeDefinition,
} from "@pascal-app/core";
import {
	roadControlPointAffordance,
	roadCurbCornerAffordance,
	roadExtendEndpointAffordance,
	roadInsertPointAffordance,
	roadNodePointAffordance,
} from "./road-network-affordances";
import { buildRoadNetworkFloorplan } from "./road-network-floorplan";
import { roadNetworkParametrics } from "./road-network-parametrics";
import { deleteRoadSplinePoints } from "./road-network-spline-handles";
import {
	createDefaultRoadStyle,
	incidentRoadEdges,
	reconcileRoadJunctions,
	roadJunctionPrimaryCandidates,
} from "./road-network-topology";
import { buildSignalJunctionPlacements } from "./road-edge-attachments";
import { DEFAULT_ROAD_STYLE_PRESETS } from "./road-style-presets";
import { RoadNetworkNode, TrafficSignalNode } from "./schema";
import { useStreetscapeStore } from "./store";

const defaultStyle = createDefaultRoadStyle();

type RoadNetworkDefinition = NodeDefinition<typeof RoadNetworkNode> &
	Record<string, unknown>;

export const roadNetworkDefinition: RoadNetworkDefinition = {
	kind: "streetscape:road-network",
	schemaVersion: 34,
	schema: RoadNetworkNode,
	category: "structure",
	snapProfile: "structural",
	extensions: {
		"pascal:editor/floorplan": {
			tool: () => import("./road-network-floorplan-tool"),
			availableModes: ["default", "expert"],
			preferredView: "3d",
		},
	},
	migrate: {
		1: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const previousStyles =
				previous.stylePresets && typeof previous.stylePresets === "object"
					? (previous.stylePresets as Record<string, unknown>)
					: {};
			return {
				...previous,
				stylePresets: { ...DEFAULT_ROAD_STYLE_PRESETS, ...previousStyles },
				applyStyleToAll:
					typeof previous.applyStyleToAll === "boolean"
						? previous.applyStyleToAll
						: true,
			};
		},
		2: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const previousStyles =
				previous.stylePresets && typeof previous.stylePresets === "object"
					? (previous.stylePresets as Record<string, unknown>)
					: {};
			const stylePresets = { ...previousStyles };
			for (const [id, nextDefault] of Object.entries(
				DEFAULT_ROAD_STYLE_PRESETS,
			)) {
				const current = previousStyles[id];
				stylePresets[id] =
					current && typeof current === "object"
						? {
								...(current as Record<string, unknown>),
								sidewalkWidth: nextDefault.sidewalkWidth,
							}
						: { ...nextDefault };
			}
			return { ...previous, stylePresets };
		},
		3: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const previousEdges =
				previous.edges && typeof previous.edges === "object"
					? (previous.edges as Record<string, unknown>)
					: {};
			const edges = Object.fromEntries(
				Object.entries(previousEdges).map(([id, edge]) => [
					id,
					edge && typeof edge === "object"
						? {
								joinMode: "auto",
								stackLevel: 0,
								...(edge as Record<string, unknown>),
							}
						: edge,
				]),
			);
			return { ...previous, edges };
		},
		4: (old: unknown) => old,
		5: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const legacyTreatments =
				previous.junctionOverrides &&
				typeof previous.junctionOverrides === "object"
					? (previous.junctionOverrides as Record<string, unknown>)
					: {};
			const parsed = RoadNetworkNode.parse({ ...previous, junctions: {} });
			reconcileRoadJunctions(parsed);
			for (const [nodeId, treatment] of Object.entries(legacyTreatments)) {
				const junction = parsed.junctions[nodeId];
				if (!junction) continue;
				if (
					treatment === "auto" ||
					treatment === "stop" ||
					treatment === "yield" ||
					treatment === "signal" ||
					treatment === "roundabout"
				) {
					parsed.junctions[nodeId] = { ...junction, treatment };
				}
			}
			const { junctionOverrides: _legacy, ...rest } = previous;
			return { ...rest, junctions: parsed.junctions };
		},
		6: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				attachments:
					previous.attachments && typeof previous.attachments === "object"
						? previous.attachments
						: {},
			};
		},
		7: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const previousStyles =
				previous.stylePresets && typeof previous.stylePresets === "object"
					? (previous.stylePresets as Record<string, unknown>)
					: {};
			const stylePresets = { ...previousStyles };
			for (const [id, nextDefault] of Object.entries(
				DEFAULT_ROAD_STYLE_PRESETS,
			)) {
				const current = previousStyles[id];
				if (!(current && typeof current === "object")) {
					stylePresets[id] = { ...nextDefault };
					continue;
				}
				const style = current as Record<string, unknown>;
				stylePresets[id] = {
					...style,
					leftSide: style.leftSide ?? { ...nextDefault.leftSide },
					rightSide: style.rightSide ?? { ...nextDefault.rightSide },
				};
			}
			return { ...previous, stylePresets };
		},
		8: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				terrainOffset:
					typeof previous.terrainOffset === "number"
						? previous.terrainOffset
						: 0.05,
				terrainFalloff:
					typeof previous.terrainFalloff === "number"
						? previous.terrainFalloff
						: 2.5,
			};
		},
		9: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const previousEdges =
				previous.edges && typeof previous.edges === "object"
					? (previous.edges as Record<string, unknown>)
					: {};
			const edges = Object.fromEntries(
				Object.entries(previousEdges).map(([id, edge]) => [
					id,
					edge && typeof edge === "object"
						? {
								...(edge as Record<string, unknown>),
								profileMode: "legacy",
								verticalProfile: [],
							}
						: edge,
				]),
			);
			return {
				...previous,
				edges,
				maxRoadGrade:
					typeof previous.maxRoadGrade === "number"
						? previous.maxRoadGrade
						: 0.12,
			};
		},
		10: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				bridgeDeckThickness:
					typeof previous.bridgeDeckThickness === "number"
						? previous.bridgeDeckThickness
						: 0.65,
				bridgeBarrierHeight:
					typeof previous.bridgeBarrierHeight === "number"
						? previous.bridgeBarrierHeight
						: 1.05,
				bridgePierSpacing:
					typeof previous.bridgePierSpacing === "number"
						? previous.bridgePierSpacing
						: 18,
				bridgePierDiameter:
					typeof previous.bridgePierDiameter === "number"
						? previous.bridgePierDiameter
						: 1.1,
				bridgeMinimumClearance:
					typeof previous.bridgeMinimumClearance === "number"
						? previous.bridgeMinimumClearance
						: 4.5,
			};
		},
		11: (old: unknown) => old,
		12: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				embankmentSlope:
					typeof previous.embankmentSlope === "number"
						? previous.embankmentSlope
						: 2,
				excavationSlope:
					typeof previous.excavationSlope === "number"
						? previous.excavationSlope
						: 1.5,
			};
		},
		13: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				regionalPack:
					previous.regionalPack === "left-driving"
						? "left-driving"
						: "right-driving",
			};
		},
		14: (old: unknown) => old,
		15: (old: unknown) => old,
		16: (old: unknown) => old,
		17: (old: unknown) => old,
		18: (old: unknown) => old,
		19: (old: unknown) => old,
		20: (old: unknown) => old,
		21: (old: unknown) => old,
		22: (old: unknown) => old,
		23: (old: unknown) => old,
		24: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			return {
				...(old as Record<string, unknown>),
				roadsideDecorations: {},
				roadsideDecorationSpacing: 30,
				showRoadsideDecorations: false,
			};
		},
		25: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			const previousJunctions =
				previous.junctions && typeof previous.junctions === "object"
					? (previous.junctions as Record<string, unknown>)
					: {};
			return {
				...previous,
				junctions: Object.fromEntries(
					Object.entries(previousJunctions).map(([id, junction]) => [
						id,
						junction && typeof junction === "object"
							? {
									...(junction as Record<string, unknown>),
									manualBoundaryEnabled: false,
									manualBoundaryPoints: [],
								}
							: junction,
					]),
				),
			};
		},
		26: (old: unknown) => old,
		27: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = { ...(old as Record<string, unknown>) };
			for (const key of [
				"tunnelClearHeight",
				"tunnelSideClearance",
				"tunnelLiningThickness",
				"tunnelPortalCutLength",
				"tunnelCutSlope",
			] as const) {
				delete previous[key];
			}
			const graphNodes =
				previous.graphNodes && typeof previous.graphNodes === "object"
					? (previous.graphNodes as Record<string, unknown>)
					: {};
			const retiredTunnelNodeIds = new Set(
				Object.entries(graphNodes).flatMap(([id, graphNode]) =>
					graphNode && typeof graphNode === "object" &&
					(graphNode as { elevationMode?: unknown }).elevationMode === "tunnel"
						? [id]
						: [],
				),
			);
			const edges =
				previous.edges && typeof previous.edges === "object"
					? (previous.edges as Record<string, unknown>)
					: {};
			return {
				...previous,
				graphNodes: Object.fromEntries(
					Object.entries(graphNodes).map(([id, graphNode]) => [
						id,
						graphNode && typeof graphNode === "object" &&
						(graphNode as { elevationMode?: unknown }).elevationMode === "tunnel"
							? { ...(graphNode as Record<string, unknown>), elevationMode: "ground" }
							: graphNode,
					]),
				),
				edges: Object.fromEntries(
					Object.entries(edges).map(([id, edge]) => {
						if (!(edge && typeof edge === "object")) return [id, edge];
						const value = edge as Record<string, unknown>;
						return [
							id,
							retiredTunnelNodeIds.has(String(value.startNodeId)) &&
							retiredTunnelNodeIds.has(String(value.endNodeId))
								? { ...value, stackLevel: 0 }
								: edge,
						];
					}),
				),
			};
		},
		28: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = { ...(old as Record<string, unknown>) };
			const density = previous.roadsideDecorationDensity;
			delete previous.roadsideDecorationDensity;
			delete previous.roadsideDecorationRules;
			return {
				...previous,
				roadsideDecorationSpacing:
					typeof previous.roadsideDecorationSpacing === "number"
						? previous.roadsideDecorationSpacing
						: density === "sparse"
							? 45
							: density === "dense"
								? 20
								: 30,
			};
		},
		29: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				roadsideLampsBothSides:
					typeof previous.roadsideLampsBothSides === "boolean"
						? previous.roadsideLampsBothSides
						: false,
			};
		},
		30: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			return {
				...(old as Record<string, unknown>),
				roadsideItemVisibility: {},
			};
		},
		31: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			return {
				...(old as Record<string, unknown>),
				roadsideDecorationSuppressed: {},
			};
		},
		32: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			return {
				...(old as Record<string, unknown>),
				roadsideAutoFillEnabled: false,
				roadsideItemSuppressed: {},
 generatedItemHistory: {},
			};
		},
		33: (old: unknown) => {
			if (!(old && typeof old === "object")) return old;
			const previous = old as Record<string, unknown>;
			return {
				...previous,
				osmLaneConnectivity: Array.isArray(previous.osmLaneConnectivity)
					? previous.osmLaneConnectivity
					: [],
			};
		},
	},
	defaults: () => ({
		object: "node",
		parentId: null,
		visible: true,
		metadata: {},
		graphNodes: {},
		edges: {},
		roadsideDecorations: {},
		roadsideDecorationSpacing: 30,
		roadsideLampsBothSides: false,
		showRoadsideDecorations: false,
		roadsideItemVisibility: {},
		roadsideDecorationSuppressed: {},
		roadsideAutoFillEnabled: false,
		roadsideItemSuppressed: {},
 generatedItemHistory: {},
		attachments: {},
		junctions: {},
		osmMappedSurfaces: [],
		osmCrossings: [],
		osmLaneConnectivity: [],
		stylePresets: { ...DEFAULT_ROAD_STYLE_PRESETS },
		activeStyleId: defaultStyle.id,
		applyStyleToAll: true,
		regionalPack: "right-driving",
		snapTolerance: 0.5,
		terrainOffset: 0.05,
		terrainFalloff: 2.5,
		embankmentSlope: 2,
		excavationSlope: 1.5,
		maxRoadGrade: 0.12,
		bridgeDeckThickness: 0.65,
		bridgeBarrierHeight: 1.05,
		bridgePierSpacing: 18,
		bridgePierDiameter: 1.1,
		bridgeMinimumClearance: 4.5,
	}),
	capabilities: {
		selectable: { hitVolume: "bbox" },
		deletable: true,
		duplicable: false,
		groupable: false,
		presettable: false,
		drawTool: true,
	},
	parametrics: roadNetworkParametrics,
	floorplan: buildRoadNetworkFloorplan,
	floorplanAffordances: {
		"road-control-point": roadControlPointAffordance,
		"road-insert-point": roadInsertPointAffordance,
		"road-curb-corner": roadCurbCornerAffordance,
		"road-extend-endpoint": roadExtendEndpointAffordance,
		"road-node-point": roadNodePointAffordance,
	},
	quickActions: ({ node }: { node: RoadNetworkNode }) => {
		const junctions = node.junctions ?? {};
		const selected = useStreetscapeStore.getState().roadElementSelection;
		const hasSplineAlignment = Object.values(node.edges).some(
			(edge) => edge.alignment.length > 0,
		);
		const splineEditing =
			selected?.networkId === node.id &&
			(selected.kind === "spline" ||
				selected.kind === "control" ||
				selected.kind === "endpoint");
		const splineAction = hasSplineAlignment
			? {
					id: "road:edit-spline",
					label: splineEditing ? "Finish spline edit" : "Edit spline",
					title: splineEditing
						? "Hide the spline reshape handles"
						: "Show draggable controls for reshaping this spline road",
					icon: { kind: "iconify" as const, name: "lucide:move" },
					run: () => {
						useStreetscapeStore
							.getState()
							.setRoadElementSelection(
								splineEditing
									? null
									: { networkId: node.id, kind: "spline", id: node.id },
							);
						return { selectedIds: [node.id as AnyNodeId] };
					},
				}
			: null;
		const selectedControl = selected?.networkId === node.id && selected.kind === "control" ? selected : null;
		const controlIndices = selectedControl?.indices ??
			(selectedControl?.index === undefined ? [] : [selectedControl.index]);
		const removeControlAction = selectedControl &&
			deleteRoadSplinePoints(node, selectedControl.id, controlIndices)
			? {
					id: "road:remove-spline-points",
					label: controlIndices.length > 1 ? "Remove selected points" : "Remove selected point",
					title: "Remove selected spline control points while keeping the road endpoints",
					icon: { kind: "iconify" as const, name: "lucide:minus-circle" },
					history: "single" as const,
					run: ({ sceneApi }: { sceneApi: { update: (id: AnyNodeId, patch: Partial<AnyNode>) => void } }) => {
						const patch = deleteRoadSplinePoints(node, selectedControl.id, controlIndices);
						if (patch) sceneApi.update(node.id as AnyNodeId, patch as Partial<AnyNode>);
						useStreetscapeStore.getState().setRoadElementSelection({ networkId: node.id, kind: "spline", id: node.id });
						return { selectedIds: [node.id as AnyNodeId] };
					},
				}
			: null;
		const editingActions = [splineAction, removeControlAction].filter(
			(action): action is NonNullable<typeof action> => Boolean(action),
		);
		const selectedJunctionId =
			selected?.networkId === node.id &&
			(selected.kind === "junction" || selected.kind === "corner") &&
			junctions[selected.id]
				? selected.id
				: null;
		const selectedCornerKey =
			selected?.networkId === node.id &&
			selected.kind === "corner" &&
			selected.cornerKey &&
			junctions[selected.id]?.cornerRadii[selected.cornerKey] !== undefined
				? selected.cornerKey
				: null;
		const junctionNode = Object.values(node.graphNodes)
			.map((graphNode) => ({
				graphNode,
				degree: incidentRoadEdges(node, graphNode.id).length,
			}))
			.filter(
				(candidate) =>
					candidate.degree >= 3 && junctions[candidate.graphNode.id],
			)
			.sort((left, right) => right.degree - left.degree)[0];
		const junctionId = selectedJunctionId ?? junctionNode?.graphNode.id;
		if (!junctionId) return editingActions;
		const junctionRecord = junctions[junctionId]!;
		const roundabout = junctionRecord?.treatment === "roundabout";
		const primaryCandidates = roadJunctionPrimaryCandidates(node, junctionId);
		const primaryKey = [...junctionRecord.primaryEdgeIds].sort().join(":");
		const currentPrimaryIndex = primaryCandidates.findIndex(
			(pair) => [...pair].sort().join(":") === primaryKey,
		);
		const nextPrimary =
			primaryCandidates[(currentPrimaryIndex + 1) % primaryCandidates.length];
		const updateJunction = (
			sceneApi: { update: (id: AnyNodeId, patch: Partial<AnyNode>) => void },
			patch: Partial<typeof junctionRecord>,
		) => {
			sceneApi.update(
				node.id as AnyNodeId,
				{
					junctions: {
						...junctions,
						[junctionId]: { ...junctionRecord, ...patch },
					},
				} as Partial<AnyNode>,
			);
			return { selectedIds: [node.id as AnyNodeId] };
		};
		const signalized =
			junctionRecord.treatment === "signal" ||
			Object.values(junctionRecord.approachControls ?? {}).some(
				(control) => control === "signal",
			);
		const signalAttachments = Object.values(node.attachments ?? {}).filter(
			(attachment) => attachment.junctionId === junctionId,
		);
		const placeSignalAssetsAction = signalized
			? {
					id: "road:place-signal-assets",
					label: signalAttachments.length > 0 ? "Refresh signal assets" : "Place signal assets",
					title: "Create a sparse pair of editable roadside mast-arm signals",
					icon: { kind: "iconify" as const, name: "lucide:traffic-cone" },
					history: "single" as const,
					run: ({
						sceneApi,
					}: {
						sceneApi: {
							nodes: () => Record<AnyNodeId, AnyNode>;
							upsert: (node: AnyNode, parentId?: AnyNodeId) => AnyNodeId;
							update: (id: AnyNodeId, patch: Partial<AnyNode>) => void;
						};
					}) => {
						const placements = buildSignalJunctionPlacements(node, junctionId);
						const occupiedIds = new Set(Object.keys(sceneApi.nodes()));
						const nextAttachments = { ...node.attachments };
						const existingByEdge = new Set(
							signalAttachments.map((attachment) => attachment.edgeId),
						);
						const createdIds: AnyNodeId[] = [];
						const createdSignals: TrafficSignalNode[] = [];
						for (const placement of placements) {
							if (existingByEdge.has(placement.edgeId)) continue;
							let signal = TrafficSignalNode.parse({
								parentId: node.parentId,
								position: placement.position,
								rotation: [0, placement.rotationY, 0],
								mount: "mast-arm",
								headCount: "two",
								signalState: "red",
								cabinet: false,
								streetNameSign: false,
							});
							while (occupiedIds.has(signal.id)) {
								signal = TrafficSignalNode.parse({
									...signal,
									id: undefined,
								});
							}
							const attachmentId = `${signal.id}:junction:${junctionId}`;
							const attachment = {
								id: attachmentId,
								edgeId: placement.edgeId,
								assetNodeId: signal.id,
								kind: "asset" as const,
								station: placement.station,
								lateralOffset: placement.lateralOffset,
								verticalOffset: 0,
								alignment: "junction" as const,
								side: placement.side,
								junctionId,
							};
							signal = TrafficSignalNode.parse({
								...signal,
								roadAttachment: {
									networkNodeId: node.id,
									attachmentId,
									side: placement.side,
								},
							});
							nextAttachments[attachmentId] = attachment;
							occupiedIds.add(signal.id);
							createdIds.push(signal.id as AnyNodeId);
							createdSignals.push(signal);
						}
						if (createdIds.length > 0) {
							sceneApi.update(node.id as AnyNodeId, {
								attachments: nextAttachments,
							} as Partial<AnyNode>);
							for (const signal of createdSignals) {
								sceneApi.upsert(signal as unknown as AnyNode, node.parentId as AnyNodeId);
							}
						}
						return { selectedIds: createdIds.length > 0 ? createdIds : [node.id as AnyNodeId] };
					},
				}
			: null;
		return [
			...editingActions,
			...(placeSignalAssetsAction ? [placeSignalAssetsAction] : []),
			{
				id: "road:toggle-roundabout",
				label: roundabout ? "Standard junction" : "Roundabout",
				title: roundabout
					? "Convert the selected junction back to automatic"
					: "Convert the selected junction to a roundabout",
				icon: { kind: "iconify" as const, name: "lucide:circle-dot" },
				history: "single" as const,
				run: ({
					sceneApi,
				}: {
					sceneApi: {
						update: (id: AnyNodeId, patch: Partial<AnyNode>) => void;
					};
				}) => {
					return updateJunction(sceneApi, {
						treatment: roundabout ? "auto" : "roundabout",
					});
				},
			},
			{
				id: "road:cycle-primary",
				label: "Change primary road",
				title: "Cycle the through-road pair for the selected junction",
				icon: { kind: "iconify" as const, name: "lucide:route" },
				history: "single" as const,
				run: ({
					sceneApi,
				}: {
					sceneApi: {
						update: (id: AnyNodeId, patch: Partial<AnyNode>) => void;
					};
				}) =>
					updateJunction(sceneApi, {
						primaryMode: "manual",
						primaryEdgeIds: nextPrimary
							? [...nextPrimary]
							: junctionRecord.primaryEdgeIds,
					}),
			},
			...(selectedCornerKey
				? [
						{
							id: "road:tighten-corner",
							label: "Tighter corner",
							title: "Reduce only the selected curb-return radius by 1 metre",
							icon: { kind: "iconify" as const, name: "lucide:shrink" },
							history: "single" as const,
							run: ({
								sceneApi,
							}: {
								sceneApi: {
									update: (id: AnyNodeId, patch: Partial<AnyNode>) => void;
								};
							}) =>
								updateJunction(sceneApi, {
									cornerRadii: {
										...junctionRecord.cornerRadii,
										[selectedCornerKey]: Math.max(
											0.5,
											junctionRecord.cornerRadii[selectedCornerKey]! - 1,
										),
									},
									solverStatus: "manual",
								}),
						},
						{
							id: "road:widen-corner",
							label: "Wider corner",
							title: "Increase only the selected curb-return radius by 1 metre",
							icon: { kind: "iconify" as const, name: "lucide:expand" },
							history: "single" as const,
							run: ({
								sceneApi,
							}: {
								sceneApi: {
									update: (id: AnyNodeId, patch: Partial<AnyNode>) => void;
								};
							}) =>
								updateJunction(sceneApi, {
									cornerRadii: {
										...junctionRecord.cornerRadii,
										[selectedCornerKey]: Math.min(
											100,
											junctionRecord.cornerRadii[selectedCornerKey]! + 1,
										),
									},
									solverStatus: "manual",
								}),
						},
					]
				: []),
		];
	},
	renderer: {
		kind: "parametric",
		module: () => import("./road-network-renderer"),
	},
	preview: () => import("./road-network-preview"),
	tool: () => import("./road-network-tool"),
	toolHints: [
		{ key: "Left click", label: "Add road or spline point" },
		{ key: "Enter", label: "Finish current road" },
		{ key: "Double click", label: "Finish current road" },
		{ key: "Backspace", label: "Remove last draft point" },
		{
			key: "C",
			label: "Alignment",
			chip: {
				subscribe: (onChange: () => void) =>
					useStreetscapeStore.subscribe(onChange),
				value: () => useStreetscapeStore.getState().roadAlignmentMode,
				cycle: () => {
					const store = useStreetscapeStore.getState();
					store.setRoadAlignmentMode(
						store.roadAlignmentMode === "straight" ? "spline" : "straight",
					);
				},
				labels: {
					straight: "Alignment: Straight",
					spline: "Alignment: Smooth curve",
				},
				icons: {
					straight: "lucide:minus",
					spline: "lucide:spline",
				},
				tooltip: "Road alignment — click or press C to cycle",
			},
		},
		{
			key: "B",
			label: "Elevation",
			chip: {
				subscribe: (onChange: () => void) =>
					useStreetscapeStore.subscribe(onChange),
				value: () => useStreetscapeStore.getState().roadElevationMode,
				cycle: () => {
					const store = useStreetscapeStore.getState();
					store.setRoadElevationMode(
						store.roadElevationMode === "ground" ? "bridge" : "ground",
					);
				},
				labels: {
					ground: "Elevation: Ground",
					bridge: "Elevation: Bridge",
				},
				icons: {
					ground: "lucide:land-plot",
					bridge: "lucide:construction",
				},
				tooltip: "Road elevation — click or press B to cycle",
			},
		},
		{ key: "L", label: "Enter exact road length" },
		{ key: "A", label: "Enter exact bearing" },
		{ key: "R", label: "Enter bend radius" },
		{ key: "T", label: "Enter bend tangent" },
		{ key: "J", label: "Toggle automatic junctions" },
		{ key: "Esc", label: "Stop road tool" },
	] as unknown as NonNullable<RoadNetworkDefinition["toolHints"]>,
	presentation: {
		label: "Road",
		description:
			"Draw independently selectable connected roads with automatic junction topology.",
		icon: { kind: "iconify", name: "lucide:route" },
		paletteSection: "structure",
		paletteOrder: 15,
	},
	mcp: {
		description:
			"One connected road centerline component whose surface and junction shapes are generated automatically.",
	},
};
