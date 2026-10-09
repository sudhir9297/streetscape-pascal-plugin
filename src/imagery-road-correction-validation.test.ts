import { expect, test } from "bun:test";
import { RoadNetworkNode, RoadStylePreset } from "./schema";
import { validateImageryRoadCorrection } from "./imagery-road-correction-validation";
import { StreetObservation } from "./domain/street-evidence";
import { createManualImageReference } from "./domain/street-imagery";
import { editRoadEdgeSide } from "./road-network-style-editing";

test("image presence cannot justify width changes; accepted calibrated matching measurement can", () => {
 const road = RoadNetworkNode.parse({ id: "road-network_evidence", graphNodes: { a: { id: "a", position: [0,0,0] }, b: { id: "b", position: [10,0,0] } }, edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b", styleId: "style" } }, stylePresets: { style: RoadStylePreset.parse({ id: "style", name: "Fixture", sidewalkWidth: 1.5 }) }, activeStyleId: "style", applyStyleToAll: false });
 const image = createManualImageReference({ id: "photo", pageUrl: "https://example.org/photo", imageUrl: null, capturedAt: null, location: null, locationBasis: "unknown", locationAccuracyMeters: null, headingDegrees: null, panoramic: null, creator: { name: "Author", profileUrl: null }, license: { name: "Owned", url: null }, acquiredAt: "2026-10-09T06:00:00Z", availability: "linked", uncertainty: "Unknown accuracy" });
 const observation = StreetObservation.parse({ id: "evidence", description: "Sidewalk", observedAt: null, sourceReferenceId: null, sourceFeatureId: null, referenceUri: image.pageUrl, imagery: { format: "imagery-observation", schemaVersion: 1, status: "accepted", target: { roadId: "road", edgeId: "ab" }, image, uncertainty: "No metric calibration", claim: { kind: "sidewalk-presence", side: "left", present: true }, review: { reason: "Reviewed", reviewedAt: "2026-10-09T06:00:00Z", acknowledgedConflicts: true } } });
 const after = RoadNetworkNode.parse({ ...road, ...editRoadEdgeSide(road, "ab", "left", "sidewalkWidth", 2.2) });
 expect(() => validateImageryRoadCorrection(road, after, "ab", [observation])).toThrow("calibrated");
 const measured = StreetObservation.parse({ ...observation, imagery: { ...observation.imagery, claim: { kind: "measurement", property: "left sidewalk width", valueMeters: 2.2, method: "Independent survey", calibrationReference: "https://example.org/survey" } } });
 expect(() => validateImageryRoadCorrection(road, after, "ab", [measured])).not.toThrow();
 expect(() => validateImageryRoadCorrection(road, after, "other", [measured])).toThrow("section");
 expect(() => validateImageryRoadCorrection(road, after, "ab", [StreetObservation.parse({ ...measured, imagery: { ...measured.imagery, claim: { kind: "measurement", property: "left sidewalk width", valueMeters: 2.3, method: "Survey", calibrationReference: "https://example.org/survey" } } })])).toThrow("agree");
});
