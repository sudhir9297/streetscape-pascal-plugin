import { expect, test } from "bun:test";
import {
	importStreetsFromOsm,
	prepareOsmStreetImport,
	completeOsmStreetImport,
} from "../osm-import";
import {
	proposeStreetRegionalPolicy,
	confirmStreetRegionalPolicy,
	parseStreetSectionReport,
} from "./street-sections";
const road = (tags: Record<string, string>) => ({
	id: 10,
	tags: { highway: "residential", ...tags },
	points: [
		{ nodeId: 1, lat: 0, lon: -0.0005 },
		{ nodeId: 2, lat: 0, lon: 0.0005 },
	],
});
test("missing sidewalks remain unknown while preview widths are labelled estimates", async () => {
	const result = await importStreetsFromOsm({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [road({})],
	});
	const section = result.sectionReport!.sections[0]!;
	expect(section.interval.end).toBeGreaterThan(100);
	expect(section.values.leftSidewalkPresence!.value).toBeNull();
	expect(section.values.leftSidewalkWidth!.origin).toBe("estimate");
	expect(section.values.leftSidewalkWidth!.value).toBe(1.8);
	expect(section.values.laneWidth!.origin).toBe("estimate");
});
test("explicit absence prevents default sidewalks and retains source provenance", async () => {
	const result = await importStreetsFromOsm({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [road({ sidewalk: "no" })],
	});
	const values = result.sectionReport!.sections[0]!.values;
	expect(values.leftSidewalkPresence!.value).toBe(false);
	expect(values.leftSidewalkWidth!.value).toBe(0);
	expect(values.leftSidewalkWidth!.origin).toBe("mapped");
	expect(values.rightSidewalkPresence!.rawClaims).toEqual({ sidewalk: "no" });
});
test("incompatible widths retain raw claims and explain estimated fallback", async () => {
	const result = await importStreetsFromOsm({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [road({ width: "2", lanes: "2" })],
	});
	const section = result.sectionReport!.sections[0]!;
	expect(section.values.laneWidth!.origin).toBe("estimate");
	expect(section.values.laneWidth!.rawClaims.width).toBe("2");
	expect(section.diagnostics.some((d) => d.includes("incompatible"))).toBe(
		true,
	);
});
test("compatible dimensions resolve to mapped whole-span values", async () => {
	const result = await importStreetsFromOsm({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [
			road({
				width: "6",
				lanes: "2",
				"sidewalk:left": "yes",
				"sidewalk:left:width": "2",
			}),
		],
	});
	const values = result.sectionReport!.sections[0]!.values;
	expect(values.totalWidth!.value).toBe(6);
	expect(values.totalWidth!.origin).toBe("mapped");
	expect(values.leftSidewalkPresence!.value).toBe(true);
	expect(values.leftSidewalkWidth!.origin).toBe("mapped");
});
test("location evidence proposes policy and manual confirmation remains explicit", async () => {
	const policy = proposeStreetRegionalPolicy([{ driving_side: "left" }]);
	expect(policy.id).toBe("left-driving");
	expect(policy.status).toBe("proposed");
	const confirmed = confirmStreetRegionalPolicy(policy, "left-driving");
	expect(confirmed.status).toBe("confirmed");
	expect(confirmed.basis).toBe("location-evidence");
	expect(confirmStreetRegionalPolicy(policy, "right-driving").basis).toBe(
		"manual",
	);
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [road({ driving_side: "left" })],
	});
	const result = await completeOsmStreetImport({
		...prepared,
		regionalPolicy: confirmed,
	});
	expect(result.sectionReport!.policy).toEqual(confirmed);
	expect(
		parseStreetSectionReport(JSON.stringify(result.sectionReport)),
	).toEqual(result.sectionReport!);
	expect(() =>
		parseStreetSectionReport({
			...result.sectionReport,
			policy: { ...confirmed, version: 2 },
		}),
	).toThrow();
});
