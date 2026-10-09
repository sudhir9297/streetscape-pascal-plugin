import { encodeStoredReport } from "./report-storage";
import {
	createImportedStreetProject,
	readImportedBaselineNetworks,
} from "./osm-baseline-bridge";
import { readStreetProjectFromSite } from "./host/street-project-persistence";
import {
	getImportOwnerSite,
	prepareImportedBaselinePersistence,
} from "./host/imported-baseline-persistence";
import { buildBaselineDiagnosticReport } from "./domain/baseline-diagnostics";
import { StreetApplicationChangeSet } from "./domain/application-change-set";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./host/application-change-set";
import { selectTerrainEvidence } from "./osm-terrain-evidence";
import { encodeOsmHostProjection } from "./host/osm-projection-encoding";
import { siteToHostWorld, withDisplayLift } from "./host/site-placement";
import { transformRoadCoordinates } from "./road-coordinate-transform";
import { createOsmSiteFrame, siteToGeographic } from "./domain/site-frame";
import { type AnyNode, type AnyNodeId, useScene } from "@pascal-app/core";
import {
	createMapImportMetadata,
	createOsmFeatureMetadata,
	type OsmImportSceneContext,
	type MapImportOrigin,
	readOsmFeatureSourceId,
	readMapImportDisplayLift,
} from "./osm-import-deduplication";
import type { OsmImportResult } from "./osm-import";
import { resolveMappedInventory } from "./osm-road-corridors";
import {
	createRoadSignNode,
	RoadNetworkNode,
	StreetLightNode,
	TrafficSignalNode,
} from "./schema";

const IMPORT_VIEW_PADDING_M = 24;
const IMPORT_VIEW_ASPECT_RATIO = 1.8;
const MIN_IMPORT_VIEW_WIDTH_M = 60;
const IMPORT_FLOOR_CLEARANCE_M = 0.05;

type BuildingPlanPose = {
	position: readonly [number, number, number];
	rotationY: number;
};

export type ImportedStreetFocus = {
	center: [number, number];
	max: [number, number];
	min: [number, number];
	size: [number, number];
	viewWidth: number;
};

/** Return the level-local lift needed to put imported map geometry above its floor. */
export function getOsmImportFloorOffset(activeLevelId: AnyNodeId): number {
	const nodes = useScene.getState().nodes;
	const level = nodes[activeLevelId] as
		| { children?: readonly AnyNodeId[]; type?: string }
		| undefined;
	if (level?.type !== "level") return 0.1;
	const floor = level.children
		?.map(
			(childId) =>
				nodes[childId] as
					| { elevation?: number; recessed?: boolean; type?: string }
					| undefined,
		)
		.find((child) => child?.type === "slab" && child.recessed !== true);
	const walkingSurface =
		typeof floor?.elevation === "number" && Number.isFinite(floor.elevation)
			? floor.elevation
			: 0.05;
	return walkingSurface + IMPORT_FLOOR_CLEARANCE_M;
}

/**
 * Compute a north-up view that contains every imported centerline. The extra
 * vertical allowance accounts for the editor chrome around the 2D canvas.
 */
export function getImportedStreetFocus(
	result: OsmImportResult,
	buildingPose: BuildingPlanPose | null = null,
): ImportedStreetFocus | null {
	let minX = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	const include = (point: readonly [number, number, number]) => {
		const [x, , z] = siteToHostWorld(point, {
			position: buildingPose?.position ?? [0, 0, 0],
			rotationY: buildingPose?.rotationY ?? 0,
			displayLiftMeters: 0,
		});
		minX = Math.min(minX, x);
		minZ = Math.min(minZ, z);
		maxX = Math.max(maxX, x);
		maxZ = Math.max(maxZ, z);
	};

	for (const graph of result.graphs) {
		for (const node of Object.values(graph.graphNodes)) include(node.position);
		for (const edge of Object.values(graph.edges)) {
			for (const point of edge.alignment) include(point);
		}
	}
	for (const asset of result.assets) include(asset.position);

	if (![minX, minZ, maxX, maxZ].every(Number.isFinite)) return null;

	const width = maxX - minX;
	const depth = maxZ - minZ;
	return {
		center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
		max: [maxX, maxZ],
		min: [minX, minZ],
		size: [width, depth],
		viewWidth: Math.max(
			MIN_IMPORT_VIEW_WIDTH_M,
			width + IMPORT_VIEW_PADDING_M * 2,
			(depth + IMPORT_VIEW_PADDING_M * 2) * IMPORT_VIEW_ASPECT_RATIO,
		),
	};
}

/**
 * Parse every network before touching the scene, then add the complete import
 * in one store write. A malformed later component cannot leave a partial map
 * import behind, and one undo removes the complete imported street system.
 */
export function placeOsmImport(
	result: OsmImportResult,
	activeLevelId: AnyNodeId,
	origin: MapImportOrigin = {
		baseElevation: result.source.baseElevation,
		center: result.source.center,
		...(result.coordinateFrame?.verticalReference.kind ===
		"relative-to-elevation"
			? { verticalDatumId: result.coordinateFrame.verticalReference.datumId }
			: {}),
	},
	options: {
		resolveBaseline?: boolean;
		acceptedAt?: string;
		expected?: StreetApplicationChangeSet["expected"];
	} = {},
): AnyNodeId[] {
	const scene = useScene.getState();
	if (scene.readOnly)
		throw new Error(
			"This scene is read-only. Open an editable scene to import streets.",
		);
	if (scene.nodes[activeLevelId]?.type !== "level")
		throw new Error(
			"The selected level no longer exists. Select a level and preview again.",
		);
	const expected =
		options.expected ?? captureOsmImportPreconditions(activeLevelId);
	const acceptedAt = options.acceptedAt ?? new Date().toISOString();
	const retainDocument =
		options.resolveBaseline ||
		(expected.siteId !== null &&
			readStreetProjectFromSite(scene.nodes[expected.siteId as AnyNodeId]) !==
				null);
	const baselineProject = retainDocument
		? createImportedStreetProject(result, { acceptedAt })
		: null;
	if (baselineProject) {
		result = {
			...result,
			graphs: readImportedBaselineNetworks(baselineProject).map(
				({ network }) => ({
					graphNodes: network.graphNodes,
					edges: network.edges,
					attachments: network.attachments,
					junctions: network.junctions,
					stylePresets: network.stylePresets,
					activeStyleId: network.activeStyleId,
				}),
			),
		};
	}
	const floorOffset = getOsmImportFloorOffset(activeLevelId);
	const frame = result.coordinateFrame ?? createOsmSiteFrame(origin);
	const {
		surfacesByGraph,
		crossingsByGraph,
		report: inventoryReport,
	} = resolveMappedInventory(
		result.graphs,
		result.mappedSurfaces ?? [],
		result.crossings ?? [],
		result.source.center,
		result.source.radiusMeters,
		floorOffset,
		frame,
		result.associationChoices,
	);
	inventoryReport.items.push(
		...(result.inventoryReport?.items.filter((i) => i.kind === "point-asset") ??
			[]),
	);
	const connectivityByGraph = result.graphs.map((graph) => {
		const wayIds = new Set(
			Object.values(graph.edges).flatMap((edge) =>
				edge.osmSource ? [edge.osmSource.wayId] : [],
			),
		);
		return (result.laneConnectivity ?? []).filter((relation) =>
			relation.members.some(
				(member) => member.type === "way" && wayIds.has(member.ref),
			),
		);
	});
	const diagnosticReport = buildBaselineDiagnosticReport({
		...result,
		inventoryReport,
	});
	const networks = result.graphs.map((graph, graphIndex) =>
		RoadNetworkNode.parse(
			encodeOsmHostProjection({
				...transformRoadCoordinates(
					graph,
					(point) => withDisplayLift(point, floorOffset),
					floorOffset,
				),
				osmMappedSurfaces: surfacesByGraph[graphIndex],
				osmCrossings: crossingsByGraph[graphIndex],
				osmLaneConnectivity: connectivityByGraph[graphIndex],
				applyStyleToAll: false,
				regionalPack: result.sectionReport?.policy.id ?? "right-driving",
				metadata: {
					...createMapImportMetadata(undefined, origin, floorOffset),
					...(graphIndex === 0
						? { osmBaselineDiagnostics: encodeStoredReport(diagnosticReport) }
						: {}),
					...(graphIndex === 0
						? { osmInventoryReport: JSON.stringify(inventoryReport) }
						: {}),
					...(result.normalization && graphIndex === 0
						? {
								osmNormalizationReport: encodeStoredReport(
									result.normalization,
								),
							}
						: {}),
					...(result.sectionReport && graphIndex === 0
						? { osmSectionReport: JSON.stringify(result.sectionReport) }
						: {}),
					...(result.movementEvidence && graphIndex === 0
						? {
								osmMovementEvidence: encodeStoredReport(
									result.movementEvidence,
								),
							}
						: {}),
					...(result.sourceTopology && graphIndex === 0
						? { osmSourceTopology: JSON.stringify(result.sourceTopology) }
						: {}),
					...(result.terrainEvidence
						? {
								osmTerrainEvidence: JSON.stringify(
									selectTerrainEvidence(
										result.terrainEvidence,
										new Set(
											Object.values(graph.edges).flatMap((edge) =>
												edge.osmSource ? [edge.osmSource.wayId] : [],
											),
										),
									),
								),
							}
						: {}),
					...(result.context
						? { osmImportScope: structuredClone(result.context.scope) }
						: {}),
				},
				parentId: activeLevelId,
			}),
		),
	);
	const occupiedIds = new Set(Object.keys(useScene.getState().nodes));
	for (const network of networks) occupiedIds.add(network.id);
	const assets = result.assets.map((asset) => {
		const position = withDisplayLift(asset.position, floorOffset);
		const shared = {
			metadata: {
				...createOsmFeatureMetadata(undefined, origin, asset, floorOffset),
				...(result.terrainEvidence
					? {
							osmGroundEvidence: JSON.stringify({
								source: result.terrainEvidence.source,
								sourceFrame: result.terrainEvidence.sourceFrame,
								sample:
									result.terrainEvidence.samples.find((sample) => {
										const geo = siteToGeographic(
											[asset.position[0], asset.position[2]],
											frame,
										);
										return (
											Math.abs(sample.point.lat - geo.lat) < 1e-9 &&
											Math.abs(sample.point.lon - geo.lon) < 1e-9
										);
									}) ?? null,
							}),
						}
					: {}),
			},
			parentId: activeLevelId,
			position,
			rotation: [0, asset.rotationY, 0] as [number, number, number],
		};
		if (asset.kind === "road-sign") {
			const node = createRoadSignNode(
				{ ...shared, signId: asset.signId, text: asset.text },
				occupiedIds,
			);
			occupiedIds.add(node.id);
			return node;
		}
		if (asset.kind === "street-lamp") {
			let node = StreetLightNode.parse({ ...shared, height: asset.height });
			while (occupiedIds.has(node.id)) {
				node = StreetLightNode.parse({ ...node, id: undefined });
			}
			occupiedIds.add(node.id);
			return node;
		}
		let node = TrafficSignalNode.parse({
			...shared,
			cabinet: false,
			headCount: "one",
			mount: "post",
			signalState: "red",
			streetNameSign: false,
		});
		while (occupiedIds.has(node.id)) {
			node = TrafficSignalNode.parse({ ...node, id: undefined });
		}
		occupiedIds.add(node.id);
		return node;
	});
	const placedNodes = [...networks, ...assets];
	if (placedNodes.length === 0) return [];

	const create = placedNodes.map((node) => ({
		node: node as unknown as AnyNode,
		parentId: activeLevelId,
	}));
	const update: Array<{ id: string; data: Record<string, unknown> }> = [];
	if (baselineProject) {
		const siteId = getImportOwnerSite(scene, activeLevelId);
		const prepared = prepareImportedBaselinePersistence({
			scene,
			siteId,
			result,
			networks: networks as unknown as AnyNode[],
			assets: assets as unknown as AnyNode[],
			incoming: baselineProject,
			acceptedAt,
		});
		update.push({ id: siteId, data: { metadata: prepared.metadata } });
	}
	commitHostStreetChangeSet(
		StreetApplicationChangeSet.parse({
			format: "street-application-change-set",
			schemaVersion: 1,
			id: "import-streets",
			reason: "Import reviewed street segments and mapped objects",
			expected,
			create: JSON.parse(JSON.stringify(create)),
			update: JSON.parse(JSON.stringify(update)),
			delete: [],
			identityRemaps: [],
			affectedGeometry: placedNodes.map((node) => node.id),
		}),
	);

	return placedNodes.map((node) => node.id as AnyNodeId);
}

/** Capture before asynchronous completion; legacy standalone levels have no site document. */
export function captureOsmImportPreconditions(levelId: AnyNodeId) {
	let siteId: string | null = null;
	const scene = useScene.getState();
	if (scene.nodes[levelId]?.type !== "level")
		throw Error("Select an existing level before importing.");
	if (!scene.rootNodeIds.includes(levelId))
		siteId = getImportOwnerSite(scene, levelId);
	return captureStreetChangePreconditions(siteId);
}

/** Read the active level once at the import event boundary. */
export function getOsmImportSceneContext(
	activeLevelId: AnyNodeId,
): OsmImportSceneContext {
	const networks: RoadNetworkNode[] = [];
	const featureSourceIds = new Set<string>();
	for (const candidate of Object.values(useScene.getState().nodes)) {
		const identity = candidate as unknown as {
			metadata?: unknown;
			parentId?: string | null;
			type?: string;
		};
		if (identity.parentId !== activeLevelId) continue;
		const sourceId = readOsmFeatureSourceId(identity.metadata);
		if (sourceId) featureSourceIds.add(sourceId);
		if (identity.type !== "streetscape:road-network") continue;
		const parsed = RoadNetworkNode.safeParse(candidate);
		if (parsed.success) {
			for (const item of Object.values(parsed.data.generatedItemHistory))
				for (const [sourceId, decision] of Object.entries(item.sourceDecisions))
					if (decision.decision !== "distinct") featureSourceIds.add(sourceId);
			const lift = readMapImportDisplayLift(parsed.data.metadata);
			networks.push(
				transformRoadCoordinates(
					parsed.data,
					(point) => withDisplayLift(point, -lift),
					-lift,
				),
			);
		}
	}
	return { featureSourceIds, networks };
}
