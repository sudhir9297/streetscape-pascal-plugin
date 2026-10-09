import {
	generatedSlotIdentity,
	retainsGeneratedProposal,
	persistedGeneratedKey,
} from "./domain/generated-item-history";
import {
	buildSignalJunctionPlacements,
	reanchorRoadAttachment,
	resolveRoadAttachmentTransform,
} from "./road-edge-attachments";
export {
	DEFAULT_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
	FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
	type RoadAutoInfrastructureSettings,
} from "./road-auto-infrastructure-settings";
import type { RoadAutoInfrastructureSettings } from "./road-auto-infrastructure-settings";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import type {
	RoadEdgeAttachment,
	RoadGraphEdge,
	RoadNetworkNode,
} from "./schema";
import {
	parseStreetInfrastructure,
	type StreetInfrastructureKind,
	type StreetInfrastructureNode,
} from "./street-infrastructure-config";

const MINIMUM_EDGE_LENGTH = 6;
const DRAINAGE_SPACING = 20;
const MANHOLE_SPACING = 35;
const HYDRANT_SPACING = 60;
const BOLLARD_SPACING = 25;
const BARRIER_SPACING = 80;

type ExistingNode = {
	id?: string;
	position?: unknown;
	rotation?: unknown;
	metadata?: unknown;
};

export type RoadAutoInfrastructurePlan = {
	attachments: Record<string, RoadEdgeAttachment>;
	nodes: StreetInfrastructureNode[];
};

export type RoadAutoInfrastructureAttachmentMigrationPlan = {
	attachments: Record<string, RoadEdgeAttachment>;
	nodeUpdates: Array<{
		id: string;
		roadAttachment: NonNullable<StreetInfrastructureNode["roadAttachment"]>;
	}>;
};

type GeneratedPlacement = {
	attachment: RoadEdgeAttachment;
	node: StreetInfrastructureNode;
};

const INITIAL_POSITION_KEY = "roadAutoInfrastructureInitialPosition";
const INITIAL_ROTATION_KEY = "roadAutoInfrastructureInitialRotation";

function sampledLength(
	points: readonly (readonly [number, number, number])[],
): number {
	let length = 0;
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index]!;
		const to = points[index + 1]!;
		length += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
	}
	return length;
}

function centeredStations(length: number, spacing: number): number[] {
	if (length < MINIMUM_EDGE_LENGTH) return [];
	const count = Math.max(1, Math.floor(length / spacing));
	return Array.from(
		{ length: count },
		(_, index) => (length * (index + 1)) / (count + 1),
	);
}

function separatedStations(
	length: number,
	spacing: number,
	singletonFraction: number,
): number[] {
	const stations = centeredStations(length, spacing);
	return stations.length === 1 ? [length * singletonFraction] : stations;
}

function generatedKey(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return null;
	const key = (metadata as Record<string, unknown>).roadAutoInfrastructureKey;
	return typeof key === "string" ? persistedGeneratedKey(key) : null;
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
	return metadata && typeof metadata === "object" && !Array.isArray(metadata)
		? (metadata as Record<string, unknown>)
		: null;
}

/** Attach legacy generated nodes without changing their current visible pose. */
export function planRoadAutoInfrastructureAttachmentMigration({
	network,
	nodes,
}: {
	network: RoadNetworkNode;
	nodes: readonly StreetInfrastructureNode[];
}): RoadAutoInfrastructureAttachmentMigrationPlan {
	const attachments: Record<string, RoadEdgeAttachment> = {};
	const nodeUpdates: RoadAutoInfrastructureAttachmentMigrationPlan["nodeUpdates"] =
		[];
	const fallbackEdgeId = Object.keys(network.edges)[0];
	if (!fallbackEdgeId) return { attachments, nodeUpdates };
	for (const node of nodes) {
		const metadata = metadataRecord(node.metadata);
		if (
			node.roadAttachment ||
			metadata?.generatedBy !== "road-auto-infrastructure" ||
			metadata.roadNetworkId !== network.id
		)
			continue;
		const generatedKey = generatedKeyFromMetadata(metadata);
		const edgeId =
			typeof metadata.roadEdgeId === "string" &&
			network.edges[metadata.roadEdgeId]
				? metadata.roadEdgeId
				: fallbackEdgeId;
		const attachmentId = `${node.id}:road`;
		const provisional: RoadEdgeAttachment = {
			id: attachmentId,
			edgeId,
			assetNodeId: node.id,
			kind: "asset",
			station:
				typeof metadata.roadStation === "number" ? metadata.roadStation : 0,
			lateralOffset: 0,
			verticalOffset: 0,
			alignment: "free",
			placementMode:
				equalPosePart(node.position, metadata[INITIAL_POSITION_KEY]) &&
				equalPosePart(node.rotation, metadata[INITIAL_ROTATION_KEY])
					? "generated"
					: "adjusted",
			...(generatedKey ? { generatedKey } : null),
		};
		const reanchored = reanchorRoadAttachment(network, provisional, node);
		if (!reanchored) continue;
		const attachment = {
			...reanchored,
			placementMode: provisional.placementMode,
			...(generatedKey ? { generatedKey } : null),
		};
		attachments[attachmentId] = attachment;
		nodeUpdates.push({
			id: node.id,
			roadAttachment: {
				networkNodeId: network.id,
				attachmentId,
				side: attachment.side,
			},
		});
	}
	return { attachments, nodeUpdates };
}

function generatedKeyFromMetadata(
	metadata: Record<string, unknown>,
): string | null {
	const key = metadata.roadAutoInfrastructureKey;
	return typeof key === "string" ? persistedGeneratedKey(key) : null;
}

function equalPosePart(current: unknown, initial: unknown): boolean {
	if (
		!Array.isArray(current) ||
		!Array.isArray(initial) ||
		current.length !== initial.length
	)
		return false;
	return current.every(
		(value, index) =>
			typeof value === "number" &&
			typeof initial[index] === "number" &&
			Math.abs(value - initial[index]) < 1e-5,
	);
}

function infrastructureKey(
	kind: StreetInfrastructureKind,
	ownerId: string,
	stationOrApproach: string,
	side?: "left" | "right",
): string {
	return ["road-auto", kind, ownerId, stationOrApproach, side]
		.filter(Boolean)
		.join(":");
}

function freeNodeAtStation({
	edge,
	kind,
	network,
	side,
	station,
	slot,
}: {
	edge: RoadGraphEdge;
	kind: Exclude<StreetInfrastructureKind, "streetscape:traffic-signal">;
	network: RoadNetworkNode;
	side: "left" | "right";
	station: number;
	slot: number;
}): GeneratedPlacement | null {
	const legacyKey = infrastructureKey(kind, edge.id, station.toFixed(2), side);
	const key = generatedSlotIdentity(kind, edge.id, side, slot);
	const node = parseStreetInfrastructure(kind, {
		parentId: network.parentId,
		visible: network.roadsideItemVisibility?.[kind] === true,
		position: [0, 0, 0],
		rotation: [0, 0, 0],
		metadata: {
			generatedBy: "road-auto-infrastructure",
			generatedItemAccepted: false,
			roadAutoInfrastructureKey: persistedGeneratedKey(key),
			roadAutoInfrastructureLegacyKey: persistedGeneratedKey(legacyKey),
			roadEdgeId: edge.id,
			roadNetworkId: network.id,
			roadStation: station,
		},
	});
	const alignment =
		kind === "streetscape:drainage-inlet"
			? "gutter"
			: kind === "streetscape:manhole-cover"
				? "carriageway"
				: "curb";
	const lateralOffset =
		kind === "streetscape:manhole-cover" ? 0 : side === "left" ? 1 : -1;
	const attachment: RoadEdgeAttachment = {
		id: `${node.id}:road`,
		edgeId: edge.id,
		assetNodeId: node.id,
		kind: "asset",
		station,
		lateralOffset,
		verticalOffset: 0,
		alignment,
		side,
		placementMode: "generated",
		generatedKey: key,
	};
	const transform = resolveRoadAttachmentTransform(network, attachment, node);
	if (!transform) return null;
	const attachedNode = parseStreetInfrastructure(kind, {
		...node,
		position: transform.position,
		rotation: transform.rotation,
		metadata: {
			...metadataRecord(node.metadata),
			[INITIAL_POSITION_KEY]: transform.position,
			[INITIAL_ROTATION_KEY]: transform.rotation,
		},
		roadAttachment: {
			networkNodeId: network.id,
			attachmentId: attachment.id,
			side,
		},
	});
	return { attachment, node: attachedNode };
}

function touchedJunctionIds(
	network: RoadNetworkNode,
	edgeIds: readonly string[],
): string[] {
	const ids = new Set<string>();
	for (const edgeId of edgeIds) {
		const edge = network.edges[edgeId];
		if (!edge) continue;
		if (network.junctions[edge.startNodeId]) ids.add(edge.startNodeId);
		if (network.junctions[edge.endNodeId]) ids.add(edge.endNodeId);
	}
	return [...ids].sort();
}

export function roadAutoInfrastructureAffectedEdgeIds(
	network: RoadNetworkNode,
	edgeIds: readonly string[],
): string[] {
	const result = new Set(edgeIds.filter((edgeId) => edgeId in network.edges));
	const junctionIds = new Set(touchedJunctionIds(network, edgeIds));
	for (const edge of Object.values(network.edges)) {
		if (junctionIds.has(edge.startNodeId) || junctionIds.has(edge.endNodeId))
			result.add(edge.id);
	}
	return [...result].sort();
}

export function roadAutoInfrastructureNodeIdsToReplace({
	edgeIds,
	existingNodes,
	network,
}: {
	edgeIds: readonly string[];
	existingNodes: readonly ExistingNode[];
	network: RoadNetworkNode;
}): string[] {
	const affectedEdgeIds = new Set(edgeIds);
	return existingNodes.flatMap((node) => {
		const metadata = metadataRecord(node.metadata);
		if (!node.id || metadata?.generatedBy !== "road-auto-infrastructure")
			return [];
		if (metadata.roadNetworkId !== network.id) return [];
		if (
			metadata.generatedItemAccepted !== false ||
			Object.values(network.generatedItemHistory ?? {}).some(
				(item) => item.assetNodeId === node.id,
			)
		)
			return [];
		const edgeId = metadata.roadEdgeId;
		if (typeof edgeId !== "string") return [];
		if (!affectedEdgeIds.has(edgeId) && edgeId in network.edges) return [];
		if (!equalPosePart(node.position, metadata[INITIAL_POSITION_KEY]))
			return [];
		if (!equalPosePart(node.rotation, metadata[INITIAL_ROTATION_KEY]))
			return [];
		return [node.id];
	});
}

export function buildRoadAutoInfrastructurePlan({
	edgeIds,
	existingNodes = [],
	network,
	settings,
}: {
	edgeIds: readonly string[];
	existingNodes?: readonly ExistingNode[];
	network: RoadNetworkNode;
	settings: RoadAutoInfrastructureSettings;
}): RoadAutoInfrastructurePlan {
	if (!settings.enabled) return { attachments: {}, nodes: [] };
	const existingKeys = new Set(
		existingNodes.flatMap((node) => {
			const metadata = metadataRecord(node.metadata);
			if (metadata?.roadNetworkId !== network.id) return [];
			const key = generatedKey(metadata);
			return key
				? [
						key,
						...(typeof metadata?.roadAutoInfrastructureLegacyKey === "string"
							? [metadata.roadAutoInfrastructureLegacyKey]
							: []),
					]
				: [];
		}),
	);
	const createdKeys = new Set<string>();
	const result: GeneratedPlacement[] = [];
	const add = (placement: GeneratedPlacement | null) => {
		if (!placement) return;
		const key = generatedKey(placement.node.metadata);
		if (
			!key ||
			network.roadsideItemSuppressed?.[key] === true ||
			existingKeys.has(key) ||
			createdKeys.has(key)
		)
			return;
		const legacyKey = metadataRecord(
			placement.node.metadata,
		)?.roadAutoInfrastructureLegacyKey;
		if (
			(typeof legacyKey === "string" &&
				(existingKeys.has(legacyKey) ||
					network.roadsideItemSuppressed?.[legacyKey] === true)) ||
			retainsGeneratedProposal(
				network.generatedItemHistory,
				key,
				typeof legacyKey === "string" ? legacyKey : undefined,
				placement.attachment.edgeId,
				placement.node.type,
			)
		)
			return;
		createdKeys.add(key);
		result.push(placement);
	};

	for (const edgeId of [...edgeIds].sort()) {
		const edge = network.edges[edgeId];
		if (!edge || edge.stackLevel !== 0) continue;
		const length = sampledLength(sampleRoadEdgePoints(network, edge, 48));
		if (settings.items["streetscape:drainage-inlet"]) {
			for (const [index, station] of centeredStations(
				length,
				DRAINAGE_SPACING,
			).entries()) {
				add(
					freeNodeAtStation({
						edge,
						kind: "streetscape:drainage-inlet",
						network,
						side: index % 2 === 0 ? "left" : "right",
						station,
						slot: index,
					}),
				);
			}
		}
		if (settings.items["streetscape:manhole-cover"]) {
			for (const [index, station] of centeredStations(
				length,
				MANHOLE_SPACING,
			).entries()) {
				add(
					freeNodeAtStation({
						edge,
						kind: "streetscape:manhole-cover",
						network,
						side: "left",
						station,
						slot: index,
					}),
				);
			}
		}
		if (settings.items["streetscape:fire-hydrant"]) {
			for (const [index, station] of centeredStations(
				length,
				HYDRANT_SPACING,
			).entries()) {
				add(
					freeNodeAtStation({
						edge,
						kind: "streetscape:fire-hydrant",
						network,
						side: "right",
						station,
						slot: index,
					}),
				);
			}
		}
		if (settings.items["streetscape:traffic-bollard"]) {
			for (const [index, station] of separatedStations(
				length,
				BOLLARD_SPACING,
				0.32,
			).entries()) {
				add(
					freeNodeAtStation({
						edge,
						kind: "streetscape:traffic-bollard",
						network,
						side: index % 2 === 0 ? "left" : "right",
						station,
						slot: index,
					}),
				);
			}
		}
		if (settings.items["streetscape:road-barrier"]) {
			for (const [index, station] of separatedStations(
				length,
				BARRIER_SPACING,
				0.68,
			).entries()) {
				add(
					freeNodeAtStation({
						edge,
						kind: "streetscape:road-barrier",
						network,
						side: "left",
						station,
						slot: index,
					}),
				);
			}
		}
	}

	if (settings.items["streetscape:traffic-signal"]) {
		for (const junctionId of touchedJunctionIds(network, edgeIds)) {
			for (const placement of buildSignalJunctionPlacements(
				network,
				junctionId,
			)) {
				const kind = "streetscape:traffic-signal" as const;
				const key = infrastructureKey(
					kind,
					junctionId,
					placement.edgeId,
					placement.side,
				);
				const position = placement.position;
				const rotation: [number, number, number] = [0, placement.rotationY, 0];
				const signal = parseStreetInfrastructure(kind, {
					parentId: network.parentId,
					visible: network.roadsideItemVisibility?.[kind] === true,
					position,
					rotation,
					mount: "mast-arm",
					headCount: "two",
					signalState: "red",
					cabinet: false,
					streetNameSign: false,
					metadata: {
						generatedBy: "road-auto-infrastructure",
						generatedItemAccepted: false,
						roadAutoInfrastructureKey: persistedGeneratedKey(key),
						roadEdgeId: placement.edgeId,
						roadJunctionId: junctionId,
						roadNetworkId: network.id,
						roadStation: placement.station,
						[INITIAL_POSITION_KEY]: position,
						[INITIAL_ROTATION_KEY]: rotation,
					},
				});
				const attachment: RoadEdgeAttachment = {
					id: `${signal.id}:road`,
					edgeId: placement.edgeId,
					assetNodeId: signal.id,
					kind: "asset",
					station: placement.station,
					lateralOffset: placement.lateralOffset,
					verticalOffset: 0,
					alignment: "junction",
					side: placement.side,
					junctionId,
					placementMode: "generated",
					generatedKey: key,
				};
				add({
					attachment,
					node: parseStreetInfrastructure(kind, {
						...signal,
						roadAttachment: {
							networkNodeId: network.id,
							attachmentId: attachment.id,
							side: placement.side,
						},
					}),
				});
			}
		}
	}

	return {
		attachments: Object.fromEntries(
			result.map(({ attachment }) => [attachment.id, attachment]),
		),
		nodes: result.map(({ node }) => node),
	};
}

export function buildRoadAutoInfrastructure(
	input: Parameters<typeof buildRoadAutoInfrastructurePlan>[0],
): StreetInfrastructureNode[] {
	return buildRoadAutoInfrastructurePlan(input).nodes;
}
