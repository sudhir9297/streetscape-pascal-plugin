import {
	GeneratedItemAcceptance,
	persistedGeneratedKey,
	persistedGeneratedKind,
	generatedMetadata,
	type GeneratedItemAcceptance as Acceptance,
} from "./domain/generated-item-history";
import { RoadNetworkNode } from "./schema";
import { buildRoadAutoInfrastructurePlan } from "./road-auto-infrastructure";
import { FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS } from "./road-auto-infrastructure-settings";
import { buildRoadsideDecorations } from "./roadside-decoration-rules";
import { canonicalSourceJson } from "./source/osm-source-snapshot";
type Asset = {
	id: string;
	type: string;
	metadata?: Record<string, unknown>;
	position?: unknown;
	roadAttachment?: { networkNodeId: string; attachmentId: string };
	[key: string]: unknown;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const pose = (value: unknown): [number, number, number] | null =>
	Array.isArray(value) &&
	value.length === 3 &&
	value.every((v) => typeof v === "number" && Number.isFinite(v))
		? (value as [number, number, number])
		: null;
/** Migrate only exact legacy keys evaluated against pre-command geometry; never use proximity. */
export function captureGeneratedItemAcceptance(
	old: RoadNetworkNode,
	network: RoadNetworkNode,
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	at = new Date().toISOString(),
) {
	network = RoadNetworkNode.parse(structuredClone(network));
	const history = structuredClone(network.generatedItemHistory ?? {}),
		updates: Array<{ id: string; metadata: Record<string, unknown> }> = [];
	for (const [id, item] of Object.entries(history)) {
		const safeId = persistedGeneratedKey(id);
		item.id = safeId;
		item.kind = persistedGeneratedKind(item.kind);
		item.legacyKeys = item.legacyKeys.map(persistedGeneratedKey);
		if (safeId !== id) {
			delete history[id];
			history[safeId] = item;
		}
	}
	const clean = RoadNetworkNode.parse({
		...old,
		generatedItemHistory: {},
		roadsideItemSuppressed: {},
		roadsideDecorationSuppressed: {},
	});
	const aliases = new Map<string, string>();
	for (const item of Object.values(buildRoadsideDecorations(clean))) {
		aliases.set(persistedGeneratedKey(item.id), persistedGeneratedKey(item.id));
		if (item.legacyKey)
			aliases.set(
				persistedGeneratedKey(item.legacyKey),
				persistedGeneratedKey(item.id),
			);
	}
	for (const item of buildRoadAutoInfrastructurePlan({
		network: clean,
		edgeIds: Object.keys(clean.edges),
		settings: FULL_ROAD_AUTO_INFRASTRUCTURE_SETTINGS,
	}).nodes) {
		const m = generatedMetadata(item.metadata);
		if (m) {
			aliases.set(m.key, m.key);
			if (m.legacyKey) aliases.set(m.legacyKey, m.key);
		}
	}
	const assets = new Map<string, Asset>();
	for (const value of [...Object.values(before), ...Object.values(after)]) {
		const asset = value as Asset;
		const meta = generatedMetadata(asset.metadata);
		if (
			meta &&
			(asset.roadAttachment?.networkNodeId === old.id ||
				asset.metadata?.roadNetworkId === old.id ||
				asset.roadAttachment?.networkNodeId === network.id)
		)
			assets.set(asset.id, asset);
	}
	for (const [id, asset] of assets) {
		const meta = generatedMetadata(asset.metadata)!,
			key = aliases.get(meta.key) ?? meta.key;
		const prior =
			history[key] ?? Object.values(history).find((h) => h.assetNodeId === id);
		if (prior && prior.assetNodeId && prior.assetNodeId !== id)
			throw Error(
				"Generated identity has multiple accepted assets; review the duplicate before acceptance",
			);
		const live = after[id] as Asset | undefined,
			anchor =
				Object.values(network.attachments).find((a) => a.assetNodeId === id) ??
				Object.values(old.attachments).find((a) => a.assetNodeId === id);
		const record: Acceptance =
			prior ??
			GeneratedItemAcceptance.parse({
				format: "street-generated-item-acceptance",
				schemaVersion: 1,
				id: key,
				identityStatus:
					aliases.has(meta.key) || key.startsWith("roadside-slot~")
						? "exact"
						: "legacy-unresolved",
				legacyKeys: [
					meta.key,
					...(meta.legacyKey ? [meta.legacyKey] : []),
				].filter((k) => k !== key),
				edgeId:
					anchor?.edgeId ?? String(asset.metadata?.roadEdgeId ?? "unlocated"),
				kind: persistedGeneratedKind(asset.type),
				assetNodeId: id,
				status: "accepted",
				position: pose(asset.position),
				events: [
					{
						kind: "accepted",
						at,
						data: {
							assetNodeId: id,
							position: pose(asset.position),
							origin: "procedural-proposal",
						},
					},
				],
			});
		record.legacyKeys = [
			...new Set([
				...record.legacyKeys,
				meta.key,
				...(meta.legacyKey ? [meta.legacyKey] : []),
			]),
		].filter((k) => k !== record.id);
		if (!live) {
			if (record.status !== "suppressed")
				record.events.push({
					kind: "suppressed",
					at,
					data: { assetNodeId: id },
				});
			record.status = "suppressed";
		} else {
			if (record.status === "suppressed")
				throw Error(
					"Suppressed generated identity requires an explicit restore before acceptance",
				);
			const previous = before[id] as Asset | undefined;
			const edits = previous
				? Object.fromEntries(
						Object.entries(live).filter(
							([field, value]) =>
								![
									"id",
									"parentId",
									"metadata",
									"roadAttachment",
									"visible",
								].includes(field) &&
								canonicalSourceJson(value ?? null) !==
									canonicalSourceJson(previous[field] ?? null) &&
								(!["position", "rotation"].includes(field) ||
									anchor?.placementMode === "adjusted"),
						),
					)
				: {};
			if (
				Object.keys(edits).length &&
				!(
					record.events.at(-1)?.kind === "edited" &&
					canonicalSourceJson(record.events.at(-1)?.data) ===
						canonicalSourceJson(edits)
				)
			)
				record.events.push({ kind: "edited", at, data: json(edits) });
			record.position = pose(live.position);
			record.assetNodeId = id;
			const metadata = {
				...live.metadata,
				...(meta.legacyKey
					? { roadAutoInfrastructureLegacyKey: meta.legacyKey }
					: {}),
				roadAutoInfrastructureKey: record.id,
				generatedItemAccepted: true,
				...(meta.key !== record.id
					? { roadAutoInfrastructureLegacyKey: meta.key }
					: {}),
			};
			if (
				canonicalSourceJson(metadata) !==
				canonicalSourceJson(live.metadata ?? {})
			)
				updates.push({ id, metadata });
			if (anchor) {
				if (network.attachments[anchor.id])
					network.attachments[anchor.id] = {
						...anchor,
						generatedKey: record.id,
					};
			}
		}
		history[record.id] = record;
	}
	for (const [legacyKey, suppressed] of Object.entries({
		...old.roadsideDecorationSuppressed,
		...old.roadsideItemSuppressed,
		...network.roadsideDecorationSuppressed,
		...network.roadsideItemSuppressed,
	})) {
		if (!suppressed) continue;
		const key =
			aliases.get(persistedGeneratedKey(legacyKey)) ??
			persistedGeneratedKey(legacyKey);
		if (history[key]) continue;
		// Materialization suppresses the embedded preview while retaining an accepted live fixture.
		if (
			Object.values(history).some((h) =>
				h.legacyKeys.includes(persistedGeneratedKey(legacyKey)),
			)
		)
			continue;
		const edgeId =
			Object.keys(old.edges).find((id) => legacyKey.includes(`:${id}:`)) ??
			"unlocated";
		history[key] = GeneratedItemAcceptance.parse({
			format: "street-generated-item-acceptance",
			schemaVersion: 1,
			id: key,
			identityStatus:
				aliases.has(persistedGeneratedKey(legacyKey)) ||
				key.startsWith("roadside-slot~")
					? "exact"
					: "legacy-unresolved",
			legacyKeys:
				key === persistedGeneratedKey(legacyKey)
					? []
					: [persistedGeneratedKey(legacyKey)],
			edgeId,
			kind: "legacy-suppression",
			assetNodeId: null,
			status: "suppressed",
			position: null,
			events: [
				{
					kind: "suppressed",
					at,
					data: {
						legacyKey: persistedGeneratedKey(legacyKey),
						identity: aliases.has(persistedGeneratedKey(legacyKey))
							? "exact-legacy-key"
							: "unresolved-legacy-key",
					},
				},
			],
		});
	}
	for (const item of Object.values(history)) {
		if (!network.edges[item.edgeId]) {
			item.edgeId = "unlocated";
			item.identityStatus = "legacy-unresolved";
		}
	}
	return {
		network: RoadNetworkNode.parse({
			...network,
			generatedItemHistory: history,
		}),
		updates,
	};
}
/** A source observation is evidence about reality; a nearby proposal is only a review candidate. */
export function generatedSourceDuplicateCandidates(
	records: Record<string, Acceptance>,
	source: { id: string; kind: unknown; position: unknown },
	maxDistance = 2,
) {
	const kind =
			source.kind === "street-lamp"
				? "streetscape:street-light"
				: source.kind === "road-sign"
					? "streetscape:road-sign"
					: source.kind === "traffic-signal"
						? "streetscape:traffic-signal"
						: null,
		position = pose(source.position);
	if (!kind || !position) return [];
	return Object.values(records).flatMap((item) => {
		if (
			persistedGeneratedKind(item.kind) !==
				persistedGeneratedKind(kind ?? "unknown") ||
			!item.position
		)
			return [];
		const distance = Math.hypot(
			...(position.map((v, i) => v - item.position![i]!) as [
				number,
				number,
				number,
			]),
		);
		return distance <= maxDistance
			? [
					{
						generatedItemId: item.id,
						assetNodeId: item.assetNodeId,
						status: item.status,
						evidence: {
							sourceFeatureId: source.id,
							distanceMeters: distance,
							generatedPosition: item.position,
							observedPosition: position,
							method: "same-kind-nearby-review-only",
							identityMatch: false,
						},
					},
				]
			: [];
	});
}
