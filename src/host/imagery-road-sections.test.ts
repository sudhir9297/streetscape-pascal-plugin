import { expect, test } from "bun:test";
import { parseStreetProject } from "../domain/street-project";
import { createSiteFrame } from "../domain/site-frame";
import { imageryRoadSections } from "./imagery-road-sections";
import type { PersistedStreetProject } from "./street-project-persistence";

test("imagery road sections use semantic site coordinates and remain read-only", async () => {
	const project = parseStreetProject(
		await Bun.file(
			new URL(
				"../../docs/fixtures/street-project-v1.evidence.json",
				import.meta.url,
			),
		).json(),
	);
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	baseline.propertyEvidence = {};
	project.scenarios = {};
	project.activeScenarioId = null;
	const road = baseline.roads["road-block"]!;
	project.siteFrames.frame = createSiteFrame({
		id: "frame",
		origin: { lat: 37.783539, lon: -122.408588 },
		orientationRadians: Math.PI / 2,
	});
	road.data = {
		coordinateFrameId: "frame",
		referenceNodes: {
			a: { id: "a", position: [0, 800, 0] },
			b: { id: "b", position: [10, 900, 0] },
		},
		referenceLines: {
			ab: {
				id: "ab",
				startNodeId: "a",
				endNodeId: "b",
				alignment: [],
				styleId: "style",
			},
		},
		sections: {
			ab: {
				id: "ab",
				edgeId: "ab",
				interval: { start: 0, end: 10 },
				style: {},
				values: {},
			},
		},
		attachments: {},
		junctions: {},
		inventory: { surfaces: [], crossings: [], laneConnectivity: [] },
		compatibility: { node: {}, unusedStyles: {}, activeStyleId: "style" },
	};
	const stored: PersistedStreetProject = {
		format: "streetscape-host-document",
		schemaVersion: 1,
		project,
		projection: {
			baselineRevisionId: baseline.id,
			scenarioId: null,
			bindings: [],
		},
	};
	const before = JSON.stringify(stored);
	const result = imageryRoadSections(stored);
	expect(JSON.stringify(stored)).toBe(before);
	expect(result).toHaveLength(1);
	expect(result[0]!.coordinates[0]).toEqual([-122.408588, 37.783539]);
	expect(result[0]!.coordinates[1]![1]).toBeGreaterThan(37.783539);
	delete project.siteFrames.frame;
	expect(imageryRoadSections(stored)).toEqual([]);
});
