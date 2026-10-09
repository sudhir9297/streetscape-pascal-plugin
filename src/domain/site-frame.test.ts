import { describe, expect, test } from "bun:test";
import {
	createSiteFrame,
	geographicToSite,
	siteToGeographic,
	elevationToSiteHeight,
	siteHeightToElevation,
	siteFrameVerticalOffset,
	rebaseSitePoint,
	SiteFrame,
} from "./site-frame";
import { siteToHostWorld, hostWorldToSite } from "../host/site-placement";
import { parseStreetProject } from "./street-project";
import { createLegacyStreetProject } from "../street-project-compatibility";

const frame = (lat = 40.7, lon = -74, orientationRadians = 0) =>
	createSiteFrame({
		id: "test-frame",
		origin: { lat, lon },
		orientationRadians,
	});
const elevationFrame = (elevation: number, datumId = "terrain") =>
	createSiteFrame({
		id: "height",
		origin: { lat: 0, lon: 0 },
		verticalReference: {
			kind: "relative-to-elevation",
			originElevationMeters: elevation,
			datumId,
		},
	});

describe("site frame", () => {
	test("round-trips 600 m local points at several latitudes and orientations within a micrometre", () => {
		for (const latitude of [-60, 0, 40.7, 78])
			for (const yaw of [0, Math.PI / 2, -0.47]) {
				const site = frame(latitude, 12, yaw);
				for (const [x, z] of [
					[-600, 0],
					[0, 600],
					[300, -300],
					[0, 0],
				]) {
					const actual = geographicToSite(
						siteToGeographic([x!, z!], site),
						site,
					);
					expect(Math.hypot(actual[0] - x!, actual[1] - z!)).toBeLessThan(1e-6);
				}
			}
	});
	test("uses east/south axes and applies orientation independently of the geographic origin", () => {
		const geographic = siteToGeographic([10, 20], frame(0, 0));
		const rotated = geographicToSite(geographic, frame(0, 0, Math.PI / 2));
		expect(rotated[0]).toBeCloseTo(-20, 8);
		expect(rotated[1]).toBeCloseTo(10, 8);
	});
	test("keeps measured zero distinct from unknown elevation", () => {
		expect(elevationToSiteHeight(0, elevationFrame(10))).toBe(-10);
		expect(siteHeightToElevation(-10, elevationFrame(10))).toBe(0);
		expect(elevationToSiteHeight(null, elevationFrame(10))).toBeNull();
		expect(elevationToSiteHeight(0, frame())).toBeNull();
		expect(siteHeightToElevation(0, frame())).toBeNull();
	});
	test("aligns heights only when both origins share an explicit datum", () => {
		expect(
			siteFrameVerticalOffset(elevationFrame(100), elevationFrame(90)),
		).toBe(10);
		expect(
			siteFrameVerticalOffset(
				elevationFrame(100, "a"),
				elevationFrame(90, "b"),
			),
		).toBeNull();
		expect(siteFrameVerticalOffset(frame(), elevationFrame(90))).toBeNull();
	});
	test("rebases through geography rather than translating incompatible latitude scales", () => {
		const from = frame(60.005, 12.001, 0.3),
			to = frame(60, 12, -0.2),
			point = [500, 5, -200] as const;
		const rebased = rebaseSitePoint(point, from, to);
		const expected = geographicToSite(
			siteToGeographic([point[0], point[2]], from),
			to,
		);
		expect(rebased).toEqual([expected[0], 5, expected[1]]);
		const restored = rebaseSitePoint(rebased, to, from);
		expect(
			Math.hypot(restored[0] - point[0], restored[2] - point[2]),
		).toBeLessThan(1e-6);
	});
	test("host rotation, translation and display lift invert without changing the site frame", () => {
		const site = frame(),
			before = JSON.stringify(site),
			point = [25, 3, -10] as const;
		for (const rotationY of [0, Math.PI / 2, -0.6]) {
			const placement = {
				position: [100, 4, 200] as const,
				rotationY,
				displayLiftMeters: 0.4,
			};
			const restored = hostWorldToSite(
				siteToHostWorld(point, placement),
				placement,
			);
			for (let index = 0; index < 3; index++)
				expect(restored[index]!).toBeCloseTo(point[index]!, 8);
		}
		expect(JSON.stringify(site)).toBe(before);
	});
	test("rejects invalid origins, nonfinite values and future frame versions", () => {
		expect(() => frame(90)).toThrow();
		expect(() => frame(0, 181)).toThrow();
		expect(() => frame(0, 0, Infinity)).toThrow();
		expect(() => SiteFrame.parse({ ...frame(), schemaVersion: 2 })).toThrow();
	});
	test("project documents round-trip site frames and reject dangling frame references", () => {
		const project = createLegacyStreetProject({
			id: "p",
			name: "p",
			baselineRevisionId: "b",
			acceptedAt: "2026-10-08T10:00:00Z",
			roads: [],
		});
		project.siteFrameId = "test-frame";
		expect(() => parseStreetProject(project)).toThrow(
			"Project site frame does not exist",
		);
		project.siteFrames["test-frame"] = frame();
		expect(
			parseStreetProject(JSON.stringify(project)).siteFrames["test-frame"],
		).toEqual(frame());
	});
});
