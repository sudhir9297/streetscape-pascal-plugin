import { useScene, type AnyNodeId } from "@pascal-app/core";
import { prepareLaneMovementDecision } from "../domain/lane-movement-decision";
import { laneMovementId } from "../domain/lane-movement";
import {
	readStreetProjectFromSite,
	prepareStreetProjectPersistence,
} from "./street-project-persistence";
import { withAcceptedStreetCommand } from "./street-command-scope";

export function acceptLaneMovementDecision(input: {
	siteId: string;
	expectedRevision: number;
	fromLaneId: string;
	toLaneId: string;
	status: "accepted" | "rejected";
	reason: string;
}) {
	const scene = useScene.getState();
	if (scene.readOnly) throw Error("This scene is read-only");
	const stored = readStreetProjectFromSite(
		scene.nodes[input.siteId as AnyNodeId],
	);
	if (!stored) throw Error("Street project document is unavailable");
	const project = prepareLaneMovementDecision(
		stored.project,
		input.expectedRevision,
		{
			id: laneMovementId(input.fromLaneId, input.toLaneId),
			fromLaneId: input.fromLaneId,
			toLaneId: input.toLaneId,
			status: input.status,
			reason: input.reason,
			acceptedAt: new Date().toISOString(),
		},
	);
	const prepared = prepareStreetProjectPersistence(scene, input.siteId, {
		project,
		projection: {
			...stored.projection,
			baselineRevisionId: project.activeBaselineRevisionId,
		},
		expectedRevision: input.expectedRevision,
	});
	withAcceptedStreetCommand(() =>
		scene.applyNodeChanges({
			update: [
				{
					id: input.siteId as AnyNodeId,
					data: { metadata: prepared.metadata },
				},
			],
		}),
	);
	return project.activeBaselineRevisionId;
}
