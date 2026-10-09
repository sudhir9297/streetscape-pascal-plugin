import { captureGeneratedItemAcceptance } from "../generated-item-acceptance";
import type {
	StreetApplicationChangeSet,
	StreetIdentityReference,
} from "../domain/application-change-set";
import { RoadNetworkNode } from "../schema";
import {
	adaptResolvedCurrentRoad,
	convertStreetProjectRoads,
} from "../street-project-compatibility";
import { resolveStreetFeatureData } from "../domain/street-resolution";
import { parseStreetProject } from "../domain/street-project";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
import { readMapImportDisplayLift } from "../osm-import-deduplication";
import { transformRoadCoordinates } from "../road-coordinate-transform";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
	type PersistenceScene,
} from "./street-project-persistence";

type Path = (string | number)[];
function at(value: unknown, path: Path): unknown {
	for (const token of path) {
		if (!value || typeof value !== "object" || !Object.hasOwn(value, token))
			return undefined;
		value = (value as Record<string | number, unknown>)[token];
	}
	return value;
}
type Remap = StreetApplicationChangeSet["identityRemaps"][number];

/** Compose explicit topology lineage with document bindings; never match by proximity. */
export function prepareRoadTopologyDocument(input: {
	before: PersistenceScene;
	after: PersistenceScene;
	siteId: string;
	oldNetworks: readonly RoadNetworkNode[];
	networks: readonly RoadNetworkNode[];
	identityRemaps: readonly Remap[];
	acceptedAt?: string;
}) {
	const stored = readStreetProjectFromSite(input.before.nodes[input.siteId]);
	if (!stored) return null;
	if (stored.project.activeScenarioId !== null)
		throw Error("Select the accepted baseline before changing road topology.");
	const project = structuredClone(stored.project),
		parent = project.baselineRevisions[project.activeBaselineRevisionId]!;
	// Only the new revision is converted; accepted historical payloads remain exact.
	const converted = convertStreetProjectRoads(project);
	const baseline = structuredClone(converted.baselineRevisions[parent.id]!);
	const acceptedAt = input.acceptedAt ?? new Date().toISOString(),
		revisionId = `${parent.id}:topology:${project.revision + 1}`;
	if (project.baselineRevisions[revisionId])
		throw Error("Baseline topology revision identity collision");
	const oldHostIds = new Set<string>(input.oldNetworks.map((n) => n.id));
	const oldBindings = stored.projection.bindings.filter(
		(b) => b.category === "roads" && b.nodeIds.some((id) => oldHostIds.has(id)),
	);
	if (oldBindings.some((b) => b.nodeIds.length !== 1))
		throw Error(
			"Topology command requires explicit single-node baseline road bindings.",
		);
	const hostToFeature = new Map(
		oldBindings.map((b) => [b.nodeIds[0]!, b.featureId]),
	);
	for (const old of input.oldNetworks)
		if (!hostToFeature.has(old.id))
			throw Error(`Road has no accepted baseline binding: ${old.id}`);
	const oldFeatureIds = new Set(oldBindings.map((b) => b.featureId));
	const oldRoads = Object.fromEntries(
		[...oldFeatureIds].map((id) => [id, baseline.roads[id]!]),
	);
	const roadIds = new Map<string, string>(
		input.networks.map((network) => [
			network.id,
			hostToFeature.get(network.id) ?? `road:${network.id}`,
		]),
	);
	const remapped = (ref: StreetIdentityReference) =>
		input.identityRemaps.find(
			(r) => canonicalSourceJson(r.from) === canonicalSourceJson(ref),
		)?.to ?? [];
	const successors = (oldHostId: string) => [
		...new Set(
			input.identityRemaps
				.filter(
					(r) => r.from.kind === "road-edge" && r.from.networkId === oldHostId,
				)
				.flatMap((r) =>
					r.to.flatMap((t) => (t.kind === "road-edge" ? [t.networkId] : [])),
				),
		),
	];
	const generatedItemUpdates: Array<{
		id: string;
		data: Record<string, unknown>;
	}> = [];
	for (const id of oldFeatureIds) delete baseline.roads[id];
	for (const network of input.networks) {
		const old = input.oldNetworks.find((n) => n.id === network.id) ?? network;
		const acceptance = captureGeneratedItemAcceptance(
			old,
			network,
			input.before.nodes,
			input.after.nodes,
			acceptedAt,
		);
		Object.assign(network, acceptance.network);
		generatedItemUpdates.push({
			id: network.id,
			data: {
				generatedItemHistory: network.generatedItemHistory,
				attachments: network.attachments,
			},
		});
		for (const op of acceptance.updates) {
			const node = input.after.nodes[op.id];
			if (node) {
				input.after.nodes[op.id] = { ...node, metadata: op.metadata };
				generatedItemUpdates.push({
					id: op.id,
					data: { metadata: op.metadata },
				});
			}
		}
		const id = roadIds.get(network.id)!;
		if (baseline.roads[id])
			throw Error(`New road baseline identity collision: ${id}`);
		const contributors = input.oldNetworks.filter((old) =>
			successors(old.id).includes(network.id),
		);
		const previous = contributors.map(
			(old) => oldRoads[hostToFeature.get(old.id)!]!,
		);
		const frames = [
			...new Set(
				previous
					.map((road) => road.data.coordinateFrameId)
					.filter((id) => id !== null),
			),
		];
		if (frames.length > 1)
			throw Error("Cannot merge roads with different coordinate frames.");
		const road = adaptResolvedCurrentRoad({
			id,
			network: frames.length
				? transformRoadCoordinates(
						network,
						(point) => [
							point[0],
							point[1] - readMapImportDisplayLift(network.metadata),
							point[2],
						],
						-readMapImportDisplayLift(network.metadata),
					)
				: network,
			origin: previous.length ? previous[0]!.origin : "authored",
			sourceReferenceIds: [
				...new Set(previous.flatMap((road) => road.sourceReferenceIds)),
			],
			coordinateFrameId: (frames[0] as string | undefined) ?? null,
		});
		// Preserve source-quality section values across edge splits and inner-ID remaps.
		for (const old of contributors) {
			const prior = oldRoads[hostToFeature.get(old.id)!]!;
			for (const section of Object.values(
				prior.data.sections as Record<
					string,
					{ edgeId: string; values: unknown }
				>,
			))
				for (const target of remapped({
					kind: "road-edge",
					networkId: old.id,
					id: section.edgeId,
				})) {
					if (target.kind !== "road-edge" || target.networkId !== network.id)
						continue;
					const next = (
						road.data.sections as Record<string, Record<string, unknown>>
					)[`section:${target.id}`];
					if (next) next.values = structuredClone(section.values);
				}
		}
		baseline.roads[id] = road;
	}
	const evidence = { ...baseline.propertyEvidence };
	for (const [id, property] of Object.entries(evidence))
		if (
			property.target.category === "roads" &&
			oldFeatureIds.has(property.target.featureId)
		)
			delete evidence[id];
	for (const property of Object.values(baseline.propertyEvidence ?? {})) {
		if (
			property.target.category !== "roads" ||
			!oldFeatureIds.has(property.target.featureId)
		)
			continue;
		const oldHost = oldBindings.find(
			(b) => b.featureId === property.target.featureId,
		)!.nodeIds[0]!;
		const path = property.target.path;
		const oldRoad = oldRoads[property.target.featureId]!;
		let targets: { networkId: string; path: Path }[];
		if (
			path[0] === "referenceNodes" ||
			path[0] === "referenceLines" ||
			path[0] === "sections"
		) {
			if (typeof path[1] !== "string")
				throw Error(
					"Whole topology-map evidence requires explicit migration before this command.",
				);
			const edge =
				path[0] === "sections"
					? (oldRoad.data.sections as Record<string, { edgeId: string }>)[
							path[1]
						]?.edgeId
					: path[1];
			const kind = path[0] === "referenceNodes" ? "road-node" : "road-edge";
			targets = edge
				? remapped({ kind, networkId: oldHost, id: edge }).flatMap((ref) =>
						ref.kind === kind
							? [
									{
										networkId: ref.networkId,
										path: [
											path[0]!,
											path[0] === "sections" ? `section:${ref.id}` : ref.id,
											...path.slice(2),
										],
									},
								]
							: [],
					)
				: [];
		} else if (path[0] === "attachments" && typeof path[1] === "string") {
			const assetId = (
				oldRoad.data.attachments as Record<string, { assetNodeId: string }>
			)[path[1]]?.assetNodeId;
			targets = input.networks.flatMap((network) =>
				Object.values(network.attachments)
					.filter((a) => a.assetNodeId === assetId)
					.map((a) => ({
						networkId: network.id,
						path: ["attachments", a.id, ...path.slice(2)],
					})),
			);
		} else
			targets = successors(oldHost).map((networkId) => ({ networkId, path }));
		const oldEffective = resolveStreetFeatureData(
			converted,
			parent.id,
			"roads",
			property.target.featureId,
		);
		for (const target of targets) {
			const featureId = roadIds.get(target.networkId)!;
			const value = at(baseline.roads[featureId]!.data, target.path);
			if (value === undefined) continue;
			const id = JSON.stringify([property.id, featureId, target.path]);
			if (evidence[id]) throw Error("Topology evidence identity collision");
			const moved = structuredClone(property);
			moved.id = id;
			moved.target = { ...property.target, featureId, path: target.path };
			if (
				canonicalSourceJson(value) !==
				canonicalSourceJson(at(oldEffective, path))
			)
				moved.accepted = {
					kind: "correction",
					value: value as never,
					reason: "Road topology edit",
					acceptedAt,
					observationIds: [],
					supersedesClaimId:
						moved.accepted.kind === "claim" ? moved.accepted.claimId : null,
				};
			evidence[id] = moved;
		}
	}
	baseline.propertyEvidence = evidence;
	const bindings = stored.projection.bindings.filter(
		(b) => !(b.category === "roads" && oldFeatureIds.has(b.featureId)),
	);
	bindings.push(
		...input.networks.map((network) => ({
			category: "roads" as const,
			featureId: roadIds.get(network.id)!,
			nodeIds: [network.id],
		})),
	);
	const identityRemaps: Remap[] = oldBindings.map((binding) => ({
		from: {
			kind: "baseline-road",
			siteId: input.siteId,
			id: binding.featureId,
		},
		to: successors(binding.nodeIds[0]!).map((id) => ({
			kind: "baseline-road" as const,
			siteId: input.siteId,
			id: roadIds.get(id)!,
		})),
	}));
	const json = (value: unknown) => JSON.parse(JSON.stringify(value));
	const boundAssets = new Set<string>();
	for (const binding of [...bindings]) {
		if (binding.category !== "features") continue;
		binding.nodeIds.forEach((id) => boundAssets.add(id));
		const surviving = binding.nodeIds.filter((id) => input.after.nodes[id]);
		if (!surviving.length) {
			bindings.splice(bindings.indexOf(binding), 1);
			delete baseline.features[binding.featureId];
			for (const [id, property] of Object.entries(evidence))
				if (
					property.target.category === "features" &&
					property.target.featureId === binding.featureId
				)
					delete evidence[id];
			identityRemaps.push({
				from: {
					kind: "baseline-feature",
					siteId: input.siteId,
					id: binding.featureId,
				},
				to: [],
			});
			continue;
		}
		if (surviving.length !== 1 || binding.nodeIds.length !== 1) {
			if (
				surviving.some(
					(id) =>
						canonicalSourceJson(input.before.nodes[id]) !==
						canonicalSourceJson(input.after.nodes[id]),
				)
			)
				throw Error(
					"Changed asset requires an explicit single-node baseline binding.",
				);
			continue;
		}
		const id = surviving[0]!,
			asset = input.after.nodes[id]!;
		if (
			canonicalSourceJson(asset) === canonicalSourceJson(input.before.nodes[id])
		)
			continue;
		const feature = baseline.features[binding.featureId]!;
		feature.data = { ...feature.data, ...json(asset) };
		const previousAsset = input.before.nodes[id] as unknown as
			| Record<string, unknown>
			| undefined;
		for (const key of Object.keys(previousAsset ?? {}))
			if (
				previousAsset![key] !== undefined &&
				(asset as unknown as Record<string, unknown>)[key] === undefined
			)
				delete feature.data[key];
		feature.representation = "pascal-scene-node-v1";
		for (const property of Object.values(evidence)) {
			if (
				property.target.category !== "features" ||
				property.target.featureId !== feature.id
			)
				continue;
			const value = at(feature.data, property.target.path);
			if (value === undefined)
				throw Error("Asset evidence target requires explicit migration.");
			property.accepted = {
				kind: "correction",
				value: value as never,
				reason: "Topology-induced asset reconciliation",
				acceptedAt,
				observationIds: [],
				supersedesClaimId:
					property.accepted.kind === "claim" ? property.accepted.claimId : null,
			};
		}
	}
	for (const network of input.networks)
		for (const attachment of Object.values(network.attachments)) {
			const asset = input.after.nodes[attachment.assetNodeId];
			if (!asset || boundAssets.has(asset.id)) continue;
			const id = `asset:${asset.id}`;
			if (baseline.features[id])
				throw Error(`Generated asset baseline identity collision: ${id}`);
			baseline.features[id] = {
				id,
				kind: "scene-asset",
				origin: "authored",
				sourceReferenceIds: [],
				sourceFeatureId: null,
				representation: "pascal-scene-node-v1",
				data: json(asset),
			};
			bindings.push({
				category: "features",
				featureId: id,
				nodeIds: [asset.id],
			});
			boundAssets.add(asset.id);
		}
	baseline.id = revisionId;
	baseline.parentRevisionId = parent.id;
	baseline.acceptedAt = acceptedAt;
	project.baselineRevisions[revisionId] = baseline;
	project.activeBaselineRevisionId = revisionId;
	project.revision++;
	const prepared = prepareStreetProjectPersistence(input.after, input.siteId, {
		project: parseStreetProject(project),
		projection: {
			...stored.projection,
			baselineRevisionId: revisionId,
			bindings,
		},
		expectedRevision: stored.project.revision,
	});
	return { ...prepared, identityRemaps, generatedItemUpdates };
}
