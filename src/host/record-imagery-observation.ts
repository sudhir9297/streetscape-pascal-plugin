import { useScene, type AnyNodeId } from "@pascal-app/core";
import { parseStreetProject } from "../domain/street-project";
import { StreetObservation } from "../domain/street-evidence";
import { ImageryObservationEvidence } from "../domain/imagery-observation";
import { imageryRoadSections } from "./imagery-road-sections";
import {
	readStreetProjectFromSite,
	prepareStreetProjectPersistence,
	type PersistedStreetProject,
} from "./street-project-persistence";
import { withAcceptedStreetCommand } from "./street-command-scope";

export function preparePendingImageryObservation(
	stored: PersistedStreetProject,
	input: {
		id: string;
		description: string;
		evidence: ImageryObservationEvidence;
	},
) {
	const evidence = ImageryObservationEvidence.parse(input.evidence);
	if (evidence.status !== "pending")
		throw Error("New imagery observations must remain pending.");
	if (
		!imageryRoadSections(stored).some(
			(section) =>
				section.roadId === evidence.target.roadId &&
				section.edgeId === evidence.target.edgeId,
		)
	)
		throw Error("Observation road section no longer exists.");
	if (
		evidence.target.assetFeatureId &&
		!stored.project.baselineRevisions[stored.project.activeBaselineRevisionId]
			?.features[evidence.target.assetFeatureId]
	)
		throw Error("Observation asset identity no longer exists.");
	const project = structuredClone(stored.project);
	if (project.observations?.[input.id])
		throw Error("Observation identity already exists.");
	const observation = StreetObservation.parse({
		id: input.id,
		description: input.description,
		observedAt: evidence.image.capturedAt?.includes("T")
			? evidence.image.capturedAt
			: null,
		sourceReferenceId: null,
		sourceFeatureId: evidence.image.providerImageId,
		referenceUri: evidence.image.pageUrl,
		imagery: evidence,
	});
	project.observations ??= {};
	project.observations[observation.id] = observation;
	project.revision++;
	return parseStreetProject(project);
}

/** One undoable metadata action; recording a claim does not accept a correction. */
export function recordImageryObservation(
	siteId: string,
	expectedRevision: number,
	input: Parameters<typeof preparePendingImageryObservation>[1],
) {
	const scene = useScene.getState();
	const stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	if (!stored || stored.project.revision !== expectedRevision)
		throw Error("Street review changed. Review the current section again.");
	const project = preparePendingImageryObservation(stored, input);
	const prepared = prepareStreetProjectPersistence(scene, siteId, {
		project,
		projection: stored.projection,
		expectedRevision,
	});
	withAcceptedStreetCommand(() =>
		scene.updateNode(siteId as AnyNodeId, { metadata: prepared.metadata }),
	);
	return input.id;
}
