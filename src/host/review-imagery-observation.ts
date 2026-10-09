import { useScene, type AnyNodeId } from "@pascal-app/core";
import { z } from "zod";
import { parseStreetProject } from "../domain/street-project";
import { resolveStreetFeatureData } from "../domain/street-resolution";
import { ResolvedStreetRoadData } from "../domain/resolved-street-road";
import { RoadStylePreset } from "../schema";
import { resolveRoadSideComponents } from "../road-cross-section";
import {
	readStreetProjectFromSite,
	prepareStreetProjectPersistence,
	type PersistedStreetProject,
} from "./street-project-persistence";
import { withAcceptedStreetCommand } from "./street-command-scope";

export function inspectImageryObservation(
	stored: PersistedStreetProject,
	id: string,
) {
	const observation = stored.project.observations?.[id];
	if (!observation?.imagery) throw Error("Imagery observation does not exist.");
	const evidence = observation.imagery,
		baseline =
			stored.project.baselineRevisions[
				stored.project.activeBaselineRevisionId
			]!;
	const road = baseline.roads[evidence.target.roadId];
	const data = road
		? ResolvedStreetRoadData.safeParse(
				resolveStreetFeatureData(stored.project, baseline.id, "roads", road.id),
			)
		: null;
	const section = data?.success
		? Object.values(data.data.sections).find(
				(section) => section.edgeId === evidence.target.edgeId,
			)
		: null;
	const targetExists =
		!!section &&
		(!evidence.target.assetFeatureId ||
			!!baseline.features[evidence.target.assetFeatureId]);
	const style = section ? RoadStylePreset.safeParse(section.style) : null;
	const claim = evidence.claim;
	let current: unknown = null,
		proposed: unknown = null;
	if (style?.success) {
		if (claim.kind === "surface") {
			current = style.data.surfaceMaterial;
			proposed = claim.material;
		}
		if (claim.kind === "sidewalk-presence") {
			current =
				resolveRoadSideComponents(style.data, claim.side).sidewalkWidth > 0;
			proposed = claim.present;
		}
		if (claim.kind === "measurement") {
			if (
				claim.property === "left sidewalk width" ||
				claim.property === "right sidewalk width"
			) {
				current = resolveRoadSideComponents(
					style.data,
					claim.property.startsWith("left") ? "left" : "right",
				).sidewalkWidth;
				proposed = claim.valueMeters;
			}
			if (claim.property === "lane width") {
				current = style.data.laneWidth;
				proposed = claim.valueMeters;
			}
		}
	}
	if (evidence.target.assetFeatureId) {
		const asset = baseline.features[evidence.target.assetFeatureId];
		if (asset && claim.kind === "sign-type") {
			current = asset.data.signId ?? null;
			proposed = claim.signType;
		}
		if (asset && claim.kind === "lamp-location")
			current = asset.data.position ?? null;
	}
	const related = Object.values(stored.project.observations ?? {}).filter(
		(other) =>
			other.id !== id &&
			other.imagery &&
			other.imagery.target.roadId === evidence.target.roadId &&
			other.imagery.target.edgeId === evidence.target.edgeId &&
			other.imagery.claim.kind === claim.kind &&
			(claim.kind !== "sidewalk-presence" ||
				(other.imagery.claim.kind === "sidewalk-presence" &&
					other.imagery.claim.side === claim.side)) &&
			(claim.kind !== "measurement" ||
				(other.imagery.claim.kind === "measurement" &&
					other.imagery.claim.property === claim.property)) &&
			other.imagery.target.assetFeatureId === evidence.target.assetFeatureId,
	);
	const conflicts = related.filter(
		(other) => JSON.stringify(other.imagery!.claim) !== JSON.stringify(claim),
	);
	return {
		targetExists,
		current,
		proposed,
		conflicts: conflicts.map((other) => ({
			id: other.id,
			date: other.imagery!.image.capturedAt,
			status: other.imagery!.status,
			description: other.description,
		})),
		contradictsCurrent:
			current !== null &&
			proposed !== null &&
			JSON.stringify(current) !== JSON.stringify(proposed),
		capturedAt: evidence.image.capturedAt,
	};
}

export function prepareImageryObservationReview(
	stored: PersistedStreetProject,
	input: {
		id: string;
		decision: "accepted" | "rejected";
		reason: string;
		reviewedAt: string;
		acknowledgeConflicts: boolean;
	},
) {
	const reason = z
		.string()
		.trim()
		.min(1, "Explain the review decision.")
		.parse(input.reason);
	z.iso.datetime({ offset: true }).parse(input.reviewedAt);
	const existing = stored.project.observations?.[input.id];
	if (!existing?.imagery || existing.imagery.status !== "pending")
		throw Error("Only pending imagery observations can be reviewed.");
	const review = inspectImageryObservation(stored, input.id);
	if (input.decision === "accepted" && !review.targetExists)
		throw Error(
			"Road section no longer exists. Resolve its identity before accepting.",
		);
	if (
		input.decision === "accepted" &&
		(review.contradictsCurrent || review.conflicts.length) &&
		!input.acknowledgeConflicts
	)
		throw Error(
			"Acknowledge conflicting facts and observations before accepting.",
		);
	const project = structuredClone(stored.project);
	const imagery = project.observations![input.id]!.imagery!;
	imagery.status = input.decision;
	imagery.review = {
		reason,
		reviewedAt: input.reviewedAt,
		acknowledgedConflicts: input.acknowledgeConflicts,
	};
	project.revision++;
	return parseStreetProject(project);
}

export function reviewImageryObservation(
	siteId: string,
	expectedRevision: number,
	input: Parameters<typeof prepareImageryObservationReview>[1],
) {
	const scene = useScene.getState(),
		stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	if (!stored || stored.project.revision !== expectedRevision)
		throw Error("Street review changed. Review its current facts again.");
	const project = prepareImageryObservationReview(stored, input);
	const prepared = prepareStreetProjectPersistence(scene, siteId, {
		project,
		projection: stored.projection,
		expectedRevision,
	});
	withAcceptedStreetCommand(() =>
		scene.updateNode(siteId as AnyNodeId, { metadata: prepared.metadata }),
	);
}
