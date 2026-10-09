import { expect, test } from "bun:test";
import { parseStreetProject } from "../domain/street-project";
import { createSiteFrame } from "../domain/site-frame";
import { createManualImageReference } from "../domain/street-imagery";
import { ImageryObservationEvidence } from "../domain/imagery-observation";
import { preparePendingImageryObservation } from "./record-imagery-observation";
import {
	inspectImageryObservation,
	prepareImageryObservationReview,
} from "./review-imagery-observation";
import type { PersistedStreetProject } from "./street-project-persistence";
async function fixture() {
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
				style: {
					id: "style",
					name: "fixture",
					surfaceMaterial: "asphalt",
					laneWidth: 3.25,
					sidewalkWidth: 1.5,
				},
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
	return stored;
}
function evidence() {
	return ImageryObservationEvidence.parse({
		format: "imagery-observation",
		schemaVersion: 1,
		status: "pending",
		target: { roadId: "road-block", edgeId: "ab" },
		uncertainty:
			"Dated photograph, occluded by pedestrians, unknown positional accuracy.",
		claim: { kind: "sidewalk-presence", side: "left", present: true },
		image: createManualImageReference({
			id: "image~1",
			pageUrl: "https://example.org/photo",
			imageUrl: null,
			capturedAt: "2019-01-19",
			location: null,
			locationBasis: "unknown",
			locationAccuracyMeters: null,
			headingDegrees: null,
			panoramic: null,
			creator: { name: "Photographer", profileUrl: null },
			license: { name: "User owned", url: null },
			acquiredAt: "2026-10-09T05:00:00Z",
			availability: "linked",
			uncertainty: "Unknown GPS accuracy",
		}),
	});
}

test("imagery review preserves conflicting older evidence and accepted baseline until correction", async () => {
	const initial = await fixture();
	const old = evidence();
	old.claim = { kind: "sidewalk-presence", side: "left", present: false };
	const withOld = {
		...initial,
		project: preparePendingImageryObservation(initial, {
			id: "older",
			description: "Older image suggests no sidewalk",
			evidence: old,
		}),
	};
	const newest = evidence();
	newest.image.capturedAt = "2025-08-17";
	const stored = {
		...withOld,
		project: preparePendingImageryObservation(withOld, {
			id: "newer",
			description: "Sidewalk now visible",
			evidence: newest,
		}),
	};
	const before = JSON.stringify(stored);
	expect(inspectImageryObservation(stored, "older").contradictsCurrent).toBe(
		true,
	);
	expect(inspectImageryObservation(stored, "newer").conflicts[0]!.date).toBe(
		"2019-01-19",
	);
	const request = {
		id: "newer",
		decision: "accepted" as const,
		reason: "Reviewed newer photo and uncertainty",
		reviewedAt: "2026-10-09T06:00:00Z",
		acknowledgeConflicts: false,
	};
	expect(() => prepareImageryObservationReview(stored, request)).toThrow(
		"Acknowledge",
	);
	const accepted = prepareImageryObservationReview(stored, {
		...request,
		acknowledgeConflicts: true,
	});
	expect(JSON.stringify(stored)).toBe(before);
	expect(accepted.baselineRevisions).toEqual(stored.project.baselineRevisions);
	expect(accepted.observations!.newer!.imagery!.status).toBe("accepted");
	expect(accepted.observations!.older).toEqual(
		stored.project.observations!.older,
	);
	const rejected = prepareImageryObservationReview(
		{ ...stored, project: accepted },
		{
			...request,
			id: "older",
			decision: "rejected",
			reason: "Older occluded view does not show current condition",
		},
	);
	expect(rejected.observations!.older!.imagery!.status).toBe("rejected");
	expect(rejected.observations!.older!.imagery!.image.capturedAt).toBe(
		"2019-01-19",
	);
	expect(parseStreetProject(JSON.parse(JSON.stringify(rejected)))).toEqual(
		rejected,
	);
	expect(() =>
		prepareImageryObservationReview({ ...stored, project: accepted }, request),
	).toThrow("Only pending");
	expect(() =>
		prepareImageryObservationReview(stored, { ...request, reason: " " }),
	).toThrow();
});

test("observations of different sidewalk sides do not conflict", async () => {
	const initial = await fixture();
	const left = evidence();
	const right = evidence();
	left.claim = { kind: "sidewalk-presence", side: "left", present: true };
	right.claim = { kind: "sidewalk-presence", side: "right", present: false };
	const first = {
		...initial,
		project: preparePendingImageryObservation(initial, {
			id: "left",
			description: "Left visible",
			evidence: left,
		}),
	};
	const both = {
		...first,
		project: preparePendingImageryObservation(first, {
			id: "right",
			description: "Right absent",
			evidence: right,
		}),
	};
	expect(inspectImageryObservation(both, "left").conflicts).toEqual([]);
	expect(inspectImageryObservation(both, "right").conflicts).toEqual([]);
});
