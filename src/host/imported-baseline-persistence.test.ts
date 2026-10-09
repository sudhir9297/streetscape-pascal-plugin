import { expect, test } from "bun:test";
import { RoadNetworkNode } from "../schema";
import {
	createLegacyStreetProject,
	convertStreetProjectRoads,
} from "../street-project-compatibility";
import { mergeImportedBaseline } from "./imported-baseline-persistence";
import { parseStreetProject } from "../domain/street-project";
const date = "2026-10-08T10:00:00Z";
const project = (id: string) =>
	convertStreetProjectRoads(
		createLegacyStreetProject({
			id,
			name: id,
			baselineRevisionId: "baseline",
			acceptedAt: date,
			roads: [
				RoadNetworkNode.parse({
					id: `road-network_${id}`,
					graphNodes: {
						a: { id: "a", position: [0, 0, 0] },
						b: { id: "b", position: [20, 0, 0] },
					},
					edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
				}),
			],
		}),
	);
test("adding a baseline preserves historical values, sources and existing diagnostics", () => {
	const old = project("old"),
		incoming = project("new");
	old.baselineRevisions.baseline!.diagnostics = {
		format: "street-baseline-diagnostics",
		schemaVersion: 1,
		stage: "resolved",
		status: "review-required",
		items: [
			{
				id: "uncertain",
				category: "elevation",
				severity: "review",
				targetId: null,
				property: null,
				code: "missing-terrain",
				message: "Existing terrain remains unknown",
				evidence: {},
			},
		],
	};
	const before = JSON.stringify(old),
		merged = mergeImportedBaseline(old, incoming),
		active = merged.baselineRevisions[merged.activeBaselineRevisionId]!;
	expect(Object.keys(active.roads)).toHaveLength(2);
	expect(active.diagnostics!.items[0]!.message).toBe(
		"Existing terrain remains unknown",
	);
	expect(merged.baselineRevisions.baseline).toEqual(
		old.baselineRevisions.baseline,
	);
	expect(JSON.stringify(old)).toBe(before);
	expect(parseStreetProject(merged)).toEqual(merged);
	expect(() => mergeImportedBaseline(merged, incoming)).toThrow(
		"identity already exists",
	);
});
