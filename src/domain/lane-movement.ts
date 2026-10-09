import { z } from "zod";
const Id = z.string().min(1);
export const LaneMovementDecision = z
	.strictObject({
		id: Id,
		fromLaneId: Id,
		toLaneId: Id,
		status: z.enum(["accepted", "rejected"]),
		reason: z.string().trim().min(1),
		acceptedAt: z.iso.datetime({ offset: true }),
	})
	.superRefine((decision, ctx) => {
		if (
			decision.id !==
			JSON.stringify(["movement", decision.fromLaneId, decision.toLaneId])
		)
			ctx.addIssue({
				code: "custom",
				message: "Movement identity must match its lane endpoints",
			});
	});
export type LaneMovementDecision = z.infer<typeof LaneMovementDecision>;
export type LaneEndpoint = {
	id: string;
	roadId: string;
	edgeId: string;
	laneId: string;
	intervalId: string;
	junctionId: string;
	nodeId: string;
	role: "incoming" | "outgoing";
	direction: "forward" | "reverse";
	number: number;
	use: "general" | "bus" | "turning";
	wayId: number | null;
	viaNodeId: number | null;
};
export type LaneMovementLink = {
	id: string;
	fromLaneId: string;
	toLaneId: string;
	junctionId: string;
	turn: "left" | "right" | "through" | "reverse";
	basis: "source-connectivity" | "inferred" | "correction";
	evidenceIds: string[];
	status: "pending" | "accepted" | "rejected";
	suggested: boolean;
	requiresLaneChange: boolean;
	reason: string;
};
export type LaneMovementGraph = {
	format: "street-lane-movements";
	schemaVersion: 1;
	policyVersion: 1;
	lanes: LaneEndpoint[];
	links: LaneMovementLink[];
	diagnostics: Array<{ code: string; targetId: string; message: string }>;
};
export const laneMovementId = (from: string, to: string) =>
	JSON.stringify(["movement", from, to]);
