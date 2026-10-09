import { validateImageryRoadCorrection } from "./imagery-road-correction-validation";
import { validateRoadGraph } from "./road-network-validation";
import { useScene } from "@pascal-app/core";
import { RoadNetworkNode, type RoadNetworkNode as Road } from "./schema";
import { BaselineCorrectionContext } from "./host/baseline-correction-context";
import {
	captureRoadEditPreconditions,
	prepareRoadGeometryEdit,
} from "./road-edit-commit";
import { commitHostStreetChangeSet } from "./host/application-change-set";
import { readStreetProjectFromSite } from "./host/street-project-persistence";

/** Baseline correction only; topology creation/deletion and scenario edits use other commands. */
export function prepareBaselineRoadCorrection(
	node: Road,
	patch: Partial<Road>,
	context: BaselineCorrectionContext,
	expected = captureRoadEditPreconditions(node),
) {
	const parsed = BaselineCorrectionContext.parse(context);
	const scene = useScene.getState();
	if (
		!expected.siteId ||
		!readStreetProjectFromSite(
			scene.nodes[expected.siteId as keyof typeof scene.nodes],
		)
	)
		throw Error(
			"Import or capture an accepted street baseline before correcting it.",
		);
	const allowed = new Set([
		"stylePresets",
		"activeStyleId",
		"applyStyleToAll",
		"edges",
		"graphNodes",
		"junctions",
	]);
	if (Object.keys(patch).some((key) => !allowed.has(key)))
		throw Error("Correction contains an unsupported road property.");
	const next = RoadNetworkNode.parse({ ...node, ...patch });
	const stored = expected.siteId
		? readStreetProjectFromSite(
				scene.nodes[expected.siteId as keyof typeof scene.nodes],
			)
		: null;
	const linked = parsed.observationIds
		.map((id) => stored?.project.observations?.[id])
		.filter(
			(observation): observation is NonNullable<typeof observation> =>
				!!observation,
		);
	validateImageryRoadCorrection(node, next, parsed.edgeId, [
		...linked,
		...parsed.observations,
	]);
	for (const key of ["edges", "graphNodes"] as const)
		if (
			JSON.stringify(Object.keys(node[key]).sort()) !==
			JSON.stringify(Object.keys(next[key]).sort())
		)
			throw Error("Use a topology command to add or remove road elements.");
	const priorErrors = new Set(
		validateRoadGraph(node)
			.filter((issue) => issue.severity === "error")
			.map((issue) => JSON.stringify([issue.code, issue.edgeId, issue.nodeId])),
	);
	const newError = validateRoadGraph(next).find(
		(issue) =>
			issue.severity === "error" &&
			!priorErrors.has(
				JSON.stringify([issue.code, issue.edgeId, issue.nodeId]),
			),
	);
	if (newError) throw Error(newError.message);
	return prepareRoadGeometryEdit(node, patch, expected, parsed);
}
export function commitBaselineRoadCorrection(
	change: ReturnType<typeof prepareBaselineRoadCorrection>,
) {
	return commitHostStreetChangeSet(change);
}
