import { LaneMovementDecision, laneMovementId } from "./lane-movement";
import { compileProjectLaneMovements } from "../lane-movement-graph";
import { parseStreetProject, type StreetProject } from "./street-project";

/** A legal candidate must still exist at acceptance; stale identities never snap to nearby lanes. */
export function prepareLaneMovementDecision(
	input: StreetProject,
	expectedRevision: number,
	decisionInput: unknown,
): StreetProject {
	const project = parseStreetProject(input);
	if (project.revision !== expectedRevision)
		throw Error("Street project revision conflict");
	if (project.activeScenarioId !== null)
		throw Error(
			"Select the accepted baseline before correcting lane movements",
		);
	const decision = LaneMovementDecision.parse(decisionInput);
	if (decision.id !== laneMovementId(decision.fromLaneId, decision.toLaneId))
		throw Error("Movement identity does not match its lane endpoints");
	const graph = compileProjectLaneMovements(project);
	if (!graph.links.some((link) => link.id === decision.id))
		throw Error(
			"Lane movement is unavailable or forbidden by supported legal evidence",
		);
	const parent = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const baseline = structuredClone(parent);
	baseline.id = `${parent.id}:lane-movement:${project.revision + 1}`;
	baseline.parentRevisionId = parent.id;
	baseline.acceptedAt = decision.acceptedAt;
	baseline.laneMovementDecisions = {
		...baseline.laneMovementDecisions,
		[decision.id]: decision,
	};
	project.baselineRevisions[baseline.id] = baseline;
	project.activeBaselineRevisionId = baseline.id;
	project.revision++;
	return parseStreetProject(project);
}
