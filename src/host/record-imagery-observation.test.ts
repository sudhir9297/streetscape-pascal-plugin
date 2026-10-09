import { z } from "zod";
import { expect, test } from "bun:test";
import { ResolvedStreetRoadData } from "../domain/resolved-street-road";
import { parseStreetProject } from "../domain/street-project";
import { createSiteFrame } from "../domain/site-frame";
import { createManualImageReference } from "../domain/street-imagery";
import { ImageryObservationEvidence } from "../domain/imagery-observation";
import { preparePendingImageryObservation } from "./record-imagery-observation";
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
test("recording pending imagery retains exact evidence without accepting or changing baseline", async () => {
	const stored = await fixture(),
		before = JSON.stringify(stored);
	const imageEvidence = evidence();
	const next = preparePendingImageryObservation(stored, {
		id: "observation~1",
		description: "Sidewalk visible",
		evidence: imageEvidence,
	});
	expect(JSON.stringify(stored)).toBe(before);
	expect(next.baselineRevisions).toEqual(stored.project.baselineRevisions);
	expect(next.activeBaselineRevisionId).toBe(
		stored.project.activeBaselineRevisionId,
	);
	expect(next.revision).toBe(stored.project.revision + 1);
	expect(next.observations!["observation~1"]!.imagery).toEqual(imageEvidence);
	expect(next.observations!["observation~1"]!.observedAt).toBeNull();
	expect(parseStreetProject(JSON.parse(JSON.stringify(next)))).toEqual(next);
 const premature = structuredClone(next);
 const current = premature.baselineRevisions[premature.activeBaselineRevisionId]!;
 const data = ResolvedStreetRoadData.parse(current.roads["road-block"]!.data);
 data.compatibility.node.sidewalkWidth = 2.2;
 current.roads["road-block"]!.data = z.record(z.string(), z.json()).parse(data);
current.propertyEvidence ??= {};
 current.propertyEvidence.width = { id: "width", target: { category: "roads", featureId: "road-block", path: ["compatibility", "node", "sidewalkWidth"] }, units: "m", claims: {}, rejectedClaims: [], accepted: { kind: "correction", value: 2.2, reason: "Premature image correction", acceptedAt: "2026-10-09T05:00:00Z", observationIds: ["observation~1"], supersedesClaimId: null } };
 expect(() => parseStreetProject(premature)).toThrow("explicitly accepted");

	expect(() =>
		preparePendingImageryObservation(
			{ ...stored, project: next },
			{
				id: "observation~1",
				description: "Duplicate",
				evidence: imageEvidence,
			},
		),
	).toThrow("already exists");
	expect(() =>
		preparePendingImageryObservation(stored, {
			id: "x",
			description: "Missing section",
			evidence: {
				...imageEvidence,
				target: { roadId: "road-block", edgeId: "missing" },
			},
		}),
	).toThrow("no longer exists");
	expect(() =>
		preparePendingImageryObservation(stored, {
			id: "x",
			description: "Premature acceptance",
			evidence: { ...imageEvidence, status: "accepted", review: { reason: "Reviewed", reviewedAt: "2026-10-09T05:00:00Z", acknowledgedConflicts: true } },
		}),
	).toThrow("must remain pending");
});
test("supported image claims retain explicit values and require calibration for metric measurements", () => {
	const base = evidence();
	const claims: ImageryObservationEvidence["claim"][] = [
		{ kind: "surface", material: "asphalt" },
		{ kind: "sign-type", signType: "stop" },
		{
			kind: "lamp-location",
			locationDescription: "Left corner, unknown precise station",
		},
		{
			kind: "measurement",
			valueMeters: 2.2,
			property: "left sidewalk width",
			method: "Tape survey corroborated by photo",
			calibrationReference: "https://example.org/survey",
		},
	];
	for (const claim of claims)
		expect(ImageryObservationEvidence.parse({ ...base, claim }).claim).toEqual(
			claim,
		);
	expect(
		ImageryObservationEvidence.safeParse({
			...base,
			claim: {
				kind: "measurement",
				valueMeters: 2.2,
				property: "sidewalk width",
				method: "Pixel estimate",
				calibrationReference: "",
			},
		}).success,
	).toBe(false);
	expect(
		ImageryObservationEvidence.safeParse({ ...base, uncertainty: "" }).success,
	).toBe(false);
});
