import { useScene, type AnyNodeId, type AnyNode } from "@pascal-app/core";
import { StreetSectionLayout } from "../domain/street-section-layout";
import { ResolvedStreetRoadData } from "../domain/resolved-street-road";
import {
	readStreetProjectFromSite,
	prepareStreetProjectPersistence,
} from "./street-project-persistence";
import { readResolvedCurrentRoad } from "../street-project-compatibility";
import { withAcceptedStreetCommand } from "./street-command-scope";

/** Accept an explicitly reviewed layout; station geometry compilation follows in step 41. */
export function acceptStreetSectionLayout(
	siteId: string,
	expectedRevision: number,
	sectionId: string,
	input: unknown,
	reason: string,
	roadId?: string,
) {
	if (!reason.trim()) throw Error("Explain the accepted section layout");
	const scene = useScene.getState();
	const stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	if (!stored || stored.project.revision !== expectedRevision)
		throw Error("Street project revision conflict");
	if (stored.project.activeScenarioId !== null)
		throw Error("Select the accepted baseline first");
	const layout = StreetSectionLayout.parse(input);
	const project = structuredClone(stored.project);
	const parent = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const baseline = structuredClone(parent);
	const matches = Object.values(baseline.roads).flatMap((road) => {
		if (roadId && road.id !== roadId) return [];
		const data = ResolvedStreetRoadData.safeParse(road.data);
		return data.success && data.data.sections[sectionId]
			? [{ road, data: data.data }]
			: [];
	});
	if (matches.length !== 1)
		throw Error("Select an unambiguous stable section identity");
	const { road, data } = matches[0]!;
	const section = data.sections[sectionId]!;
	if (Math.abs(layout.length - section.interval.end) > 1e-6)
		throw Error("Layout length must match the section span");
	section.layout = layout;
	road.data = JSON.parse(JSON.stringify(ResolvedStreetRoadData.parse(data)));
	baseline.id = `${parent.id}:section-layout:${project.revision + 1}`;
	baseline.parentRevisionId = parent.id;
	baseline.acceptedAt = new Date().toISOString();
	baseline.propertyEvidence ??= {};
	const existingEvidence = Object.values(baseline.propertyEvidence).find(
		(property) =>
			property.target.category === "roads" &&
			property.target.featureId === road.id &&
			JSON.stringify(property.target.path) ===
				JSON.stringify(["sections", sectionId, "layout"]),
	);
	const evidenceId =
		existingEvidence?.id ?? `section-layout~${road.id}~${sectionId}`;
	baseline.propertyEvidence[evidenceId] = {
		id: evidenceId,
		target: {
			category: "roads",
			featureId: road.id,
			path: ["sections", sectionId, "layout"],
		},
		units: null,
		claims: existingEvidence?.claims ?? {},
		rejectedClaims: existingEvidence?.rejectedClaims ?? [],
		accepted: {
			kind: "correction",
			value: JSON.parse(JSON.stringify(layout)),
			reason: reason.trim(),
			acceptedAt: baseline.acceptedAt,
			observationIds: [],
			supersedesClaimId:
				existingEvidence?.accepted.kind === "claim"
					? existingEvidence.accepted.claimId
					: (existingEvidence?.accepted.supersedesClaimId ?? null),
		},
	};
	project.baselineRevisions[baseline.id] = baseline;
	project.activeBaselineRevisionId = baseline.id;
	project.revision++;
	const binding = stored.projection.bindings.find(
		(binding) => binding.category === "roads" && binding.featureId === road.id,
	);
	if (!binding || binding.nodeIds.length !== 1)
		throw Error("Section requires a single road projection binding");
	const roadNodeId = binding.nodeIds[0]! as AnyNodeId;
	const projected = readResolvedCurrentRoad(project, baseline.id, road.id);
	const projectedPatch = { edges: projected.edges };
	const afterNodes = {
		...scene.nodes,
		[roadNodeId]: {
			...scene.nodes[roadNodeId]!,
			...projectedPatch,
		} as unknown as AnyNode,
	};
	const prepared = prepareStreetProjectPersistence(
		{ ...scene, nodes: afterNodes },
		siteId,
		{
			project,
			projection: { ...stored.projection, baselineRevisionId: baseline.id },
			expectedRevision,
		},
	);
	withAcceptedStreetCommand(() =>
		scene.applyNodeChanges({
			update: [
				{ id: roadNodeId, data: projectedPatch as unknown as Partial<AnyNode> },
				{ id: siteId as AnyNodeId, data: { metadata: prepared.metadata } },
			],
		}),
	);
	return baseline.id;
}
