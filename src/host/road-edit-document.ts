import { BaselineCorrectionContext } from "./baseline-correction-context";
import { useScene, type AnyNodeId } from "@pascal-app/core";
import type { RoadNetworkNode } from "../schema";
import { adaptResolvedCurrentRoad } from "../street-project-compatibility";
import { resolveStreetFeatureData } from "../domain/street-resolution";
import { parseStreetProject } from "../domain/street-project";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
import { readMapImportDisplayLift } from "../osm-import-deduplication";
import { transformRoadCoordinates } from "../road-coordinate-transform";
import {
	readStreetProjectFromSite,
	prepareStreetProjectPersistence,
} from "./street-project-persistence";

type Path = (string | number)[];
function at(value: unknown, path: Path): unknown {
	for (const key of path) {
		if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
			return undefined;
		value = (value as Record<string | number, unknown>)[key];
	}
	return value;
}
const overlaps = (a: Path, b: Path) =>
	a.slice(0, Math.min(a.length, b.length)).every((key, i) => key === b[i]);

/** Retain historical evidence; accept geometry edits as explicit authored values. */
export function prepareRoadEditDocument(
	siteId: string,
	network: RoadNetworkNode,
	patch: Partial<RoadNetworkNode>,
	correction?: BaselineCorrectionContext,
) {
	const scene = useScene.getState();
	const stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	if (!stored) return null;
	if (stored.project.activeScenarioId !== null)
		throw Error(
			"Select the accepted baseline before editing its road geometry.",
		);
	const binding = stored.projection.bindings.find(
		(b) => b.category === "roads" && b.nodeIds.includes(network.id),
	);
	if (!binding) throw Error("Road has no accepted baseline binding.");
	if (binding.nodeIds.length !== 1)
		throw Error(
			"Road edit requires an explicit mapping for a multi-node baseline projection.",
		);
	const context = correction
		? BaselineCorrectionContext.parse(correction)
		: null;
	const reason = context?.reason ?? "Road geometry edit";
	const project = structuredClone(stored.project),
		parent = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const baseline = structuredClone(parent),
		road = baseline.roads[binding.featureId]!;
	const observationIds = [
		...new Set([
			...(context?.observationIds ?? []),
			...(context?.observations.map((observation) => observation.id) ?? []),
		]),
	];
	for (const observation of context?.observations ?? []) {
		project.observations ??= {};
		const existing = project.observations[observation.id];
		if (
			existing &&
			canonicalSourceJson(existing) !== canonicalSourceJson(observation)
		)
			throw Error("Observation identity already contains different evidence.");
		project.observations[observation.id] = observation;
	}
	if (observationIds.some((id) => !project.observations?.[id]))
		throw Error("Correction observation does not exist.");
	for (const id of observationIds) {
		const imagery = project.observations?.[id]?.imagery;
		if (
			imagery &&
			(imagery.status !== "accepted" ||
				imagery.target.roadId !== road.id ||
				imagery.target.edgeId !== context?.edgeId)
		)
			throw Error(
				"Correction imagery must be accepted and belong to the selected road section.",
			);
	}
	const effective = resolveStreetFeatureData(
		project,
		parent.id,
		"roads",
		road.id,
	);
	const desired = structuredClone(effective);
	const next = { ...network, ...patch };
	const displayLift =
		road.representation === "resolved-street-v1" &&
		effective.coordinateFrameId !== null
			? readMapImportDisplayLift(network.metadata)
			: 0;
	const semanticNetwork = displayLift
		? transformRoadCoordinates(
				next,
				(point) => [point[0], point[1] - displayLift, point[2]],
				-displayLift,
			)
		: next;
	if (road.representation === "resolved-street-v1") {
		const adapted = adaptResolvedCurrentRoad({
			id: road.id,
			network: semanticNetwork,
			origin: road.origin,
			sourceReferenceIds: road.sourceReferenceIds,
			coordinateFrameId: effective.coordinateFrameId as string | null,
		});
		for (const [host, semantic] of [
			["graphNodes", "referenceNodes"],
			["edges", "referenceLines"],
			["attachments", "attachments"],
			["junctions", "junctions"],
		] as const)
			if (Object.hasOwn(patch, host))
				desired[semantic] = adapted.data[semantic]!;
		// Geometry changes alter section lengths; retain style and source-quality values.
		if (patch.graphNodes || patch.edges) {
			const sections = desired.sections as Record<
				string,
				Record<string, unknown>
			>;
			for (const [id, value] of Object.entries(
				adapted.data.sections as Record<string, Record<string, unknown>>,
			)) {
				const referenceLines = adapted.data.referenceLines as Record<
					string,
					{ parentEdgeId?: string }
				>;
				const parentEdgeId = referenceLines[String(value.edgeId)]?.parentEdgeId;
				const parentSection = Object.values(sections).find(
					(section) => section.edgeId === parentEdgeId,
				);
				if (!sections[id]) {
					sections[id] = {
						...structuredClone(parentSection ?? value),
						...value,
						values: structuredClone(parentSection?.values ?? value.values),
					};
					if (parentSection) {
						baseline.propertyEvidence ??= {};
						for (const property of Object.values(baseline.propertyEvidence)) {
							if (
								property.target.category !== "roads" ||
								property.target.featureId !== road.id ||
								property.target.path[0] !== "sections" ||
								property.target.path[1] !== parentSection.id
							)
								continue;
							const inherited = structuredClone(property);
							inherited.id = `${property.id}:split:${id}`;
							inherited.target.path[1] = id;
							baseline.propertyEvidence[inherited.id] = inherited;
						}
					}
				} else {
					sections[id]!.interval = value.interval;
					if (value.layout) sections[id]!.layout = value.layout;
				}
			}
		}
		if (
			patch.stylePresets ||
			patch.activeStyleId !== undefined ||
			patch.applyStyleToAll !== undefined
		) {
			const sections = desired.sections as Record<
				string,
				Record<string, unknown>
			>;
			for (const [id, value] of Object.entries(
				adapted.data.sections as Record<string, Record<string, unknown>>,
			)) {
				if (sections[id]) sections[id]!.style = value.style;
			}
			const compatibility = desired.compatibility as Record<string, unknown>;
			const adaptedCompatibility = adapted.data.compatibility as Record<
				string,
				unknown
			>;
			compatibility.unusedStyles = adaptedCompatibility.unusedStyles;
			compatibility.activeStyleId = adaptedCompatibility.activeStyleId;
			const compatibilityNode = compatibility.node as Record<string, unknown>;
			const adaptedNode = adaptedCompatibility.node as Record<string, unknown>;
			compatibilityNode.applyStyleToAll = adaptedNode.applyStyleToAll;
		}
	} else {
		for (const field of [
			"graphNodes",
			"edges",
			"attachments",
			"junctions",
			"stylePresets",
			"activeStyleId",
			"applyStyleToAll",
		] as const)
			if (Object.hasOwn(patch, field))
				desired[field] = JSON.parse(JSON.stringify(next[field]));
	}
	const acceptedAt = new Date().toISOString(),
		revisionId = `${parent.id}:${context ? "correction" : "edit"}:${project.revision + 1}`;
	if (project.baselineRevisions[revisionId])
		throw Error("Baseline revision identity collision");
	baseline.propertyEvidence ??= {};
	const owned: Path[] = [];
	for (const [id, property] of Object.entries(baseline.propertyEvidence)) {
		if (
			property.target.category !== "roads" ||
			property.target.featureId !== road.id
		)
			continue;
		const value = at(desired, property.target.path);
		if (value === undefined) {
			delete baseline.propertyEvidence[id];
			continue;
		}
		owned.push(property.target.path);
		if (
			canonicalSourceJson(value) !==
			canonicalSourceJson(at(effective, property.target.path))
		)
			property.accepted = {
				kind: "correction",
				value: value as never,
				reason,
				acceptedAt,
				observationIds: [
					...new Set([
						...observationIds,
						...(property.accepted.kind === "correction"
							? property.accepted.observationIds
							: []),
					]),
				],
				supersedesClaimId:
					property.accepted.kind === "claim" ? property.accepted.claimId : null,
			};
	}
	function record(before: unknown, after: unknown, path: Path) {
		if (canonicalSourceJson(before) === canonicalSourceJson(after)) return;
		if (owned.some((p) => overlaps(p, path))) {
			if (owned.some((p) => p.length <= path.length && overlaps(p, path)))
				return;
		} else if (
			path.length &&
			(Array.isArray(after) ||
				after === null ||
				typeof after !== "object" ||
				before === undefined)
		) {
			const id = JSON.stringify(["road-edit", road.id, path]),
				claimId = `${revisionId}:${id}`;
			baseline.propertyEvidence![id] = {
				id,
				target: { category: "roads", featureId: road.id, path },
				units: null,
				claims: {
					[claimId]: {
						id: claimId,
						value: after as never,
						origin: { kind: "authored", reason },
					},
				},
				rejectedClaims: [],
				accepted: context
					? {
							kind: "correction",
							value: after as never,
							reason,
							acceptedAt,
							observationIds,
							supersedesClaimId: null,
						}
					: { kind: "claim", claimId },
			};
			return;
		}
		if (after && typeof after === "object")
			for (const key of Object.keys(after))
				record(at(before, [key]), at(after, [key]), [...path, key]);
	}
	record(effective, desired, []);
	road.data = desired;
	baseline.id = revisionId;
	baseline.parentRevisionId = parent.id;
	baseline.acceptedAt = acceptedAt;
	project.baselineRevisions[revisionId] = baseline;
	project.activeBaselineRevisionId = revisionId;
	project.revision++;
	const outgoing = { ...scene, nodes: { ...scene.nodes, [network.id]: next } };
	return prepareStreetProjectPersistence(outgoing, siteId, {
		project: parseStreetProject(project),
		projection: { ...stored.projection, baselineRevisionId: revisionId },
		expectedRevision: stored.project.revision,
	});
}
