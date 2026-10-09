import { expect, test } from "bun:test";
import {
	normalizeOsmAcquisition,
	normalizeOsmRoadTags,
	normalizeOsmWays,
	parseNormalizedOsmSource,
	parseOsmLength,
	parseOsmLengthList,
	parseOsmLaneCount,
	parseOsmBearing,
	OsmNormalizationError,
} from "./osm-normalization";
import { parseOsmAcquisition, type OsmAcquisition } from "./osm-acquisition";
import { interpretOsmAcquisition } from "./osm-interpretation";
import {
	prepareOsmStreetImport,
	completeOsmStreetImport,
	localToGeo,
	mapOsmTags,
} from "../osm-import";
import { buildOsmRoadStyle } from "../osm-road-style";
const bbox = { south: -0.01, west: -0.01, north: 0.01, east: 0.01 };
const road = (
	id = 10,
	tags: Record<string, string> = {},
	geometry: unknown[] = [
		{ lat: 0, lon: -0.001 },
		{ lat: 0, lon: 0.001 },
	],
) => ({
	type: "way",
	id,
	tags: { highway: "residential", ...tags },
	nodes: geometry.map((_, index) => id * 10 + index),
	geometry,
});
const capture = (elements: unknown[]) =>
	parseOsmAcquisition({
		format: "osm-acquisition",
		schemaVersion: 1,
		bbox,
		responses: [{ bbox, payload: { elements } }],
		diagnostics: [],
	});

test('OSM map API geometry resolves from captured nodes without rewriting raw ways',()=>{
 const input=capture([{type:'node',id:1,lat:0,lon:-.001},{type:'node',id:2,lat:0,lon:.001},{type:'way',id:10,nodes:[1,2],tags:{highway:'residential'}}]);
 const before=JSON.stringify(input),normalized=normalizeOsmAcquisition(input),feature=normalized.features.find(f=>f.id===10)!;
 expect(feature.disposition).toBe('accepted');expect(feature.raw.geometry).toBeUndefined();
 expect(feature.geometry?.kind).toBe('way');expect(interpretOsmAcquisition(input).ways[0]!.points).toHaveLength(2);
 expect(JSON.stringify(input)).toBe(before);
 const incomplete=capture([{type:'node',id:1,lat:0,lon:-.001},{type:'way',id:10,nodes:[1,2],tags:{highway:'residential'}}]);
 expect(normalizeOsmAcquisition(incomplete).features.find(f=>f.id===10)!.disposition).toBe('rejected');
});

test("normalization is pure, canonical and invariant to source ordering", () => {
	const input = capture([
		road(20, { width: "20 ft", lanes: "2", source: "US:NY" }),
		road(10, { highway: "primary", oneway: "-1" }),
	]);
	const before = JSON.stringify(input),
		first = normalizeOsmAcquisition(input),
		second = normalizeOsmAcquisition(input);
	expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	expect(JSON.stringify(input)).toBe(before);
	const reversed = structuredClone(input);
	(reversed.responses[0]!.payload.elements as unknown[]).reverse();
	expect(JSON.stringify(normalizeOsmAcquisition(reversed))).toBe(
		JSON.stringify(first),
	);
	expect(first.features[1]!.raw.tags).toMatchObject({
		width: "20 ft",
		source: "US:NY",
	});
	expect(first.features[1]!.road!.dimensions.width).toBeCloseTo(6.096);
	expect(first.features[0]!.road!.direction).toBe("reverse");
	expect(first.policy).toEqual({ id: "osm-source-normalization", version: 1 });
});
test("pure unit, lane and bearing parsers reject ambiguous and partial values", () => {
	expect(parseOsmLength("10 ft")).toBeCloseTo(3.048);
	expect(parseOsmLength("10'")).toBeCloseTo(3.048);
	expect(parseOsmLength("-.5 m", true)).toBe(-0.5);
	expect(parseOsmLength("0", true)).toBe(0);
	for (const raw of ["3;4", "3m rubbish", "NaN", "Infinity", "-2", "0"])
		expect(parseOsmLength(raw)).toBeNull();
	expect(parseOsmLengthList("3m|10 ft")).toEqual([3, 3.048]);
	expect(parseOsmLengthList("3|")).toBeNull();
	expect(parseOsmLaneCount("3abc")).toBeNull();
	expect(parseOsmLaneCount("0", true)).toBe(0);
	expect(parseOsmBearing("northeast")).toBe(45);
	expect(parseOsmBearing("450°")).toBe(90);
	expect(parseOsmBearing("90bad")).toBeNull();
});
test("road semantics retain unknowns, negative ordering and malformed or conflicting claims", () => {
	const { road, diagnostics } = normalizeOsmRoadTags(
		{
			highway: "primary",
			oneway: "alternating",
			layer: "-2oops",
			lanes: "3",
			"lanes:forward": "2",
			"lanes:backward": "2",
			width: "3;4",
			bridge: "maybe",
			sidewalk: "mystery",
		},
		"osm~way~1",
	);
	expect(road.direction).toBeNull();
	expect(road.layer).toBeNull();
	expect(road.bridge).toBeNull();
	expect(road.dimensions.width).toBeNull();
	expect(diagnostics.map((item) => item.field)).toEqual(
		expect.arrayContaining([
			"oneway",
			"layer",
			"lanes",
			"width",
			"bridge",
			"sidewalk",
		]),
	);
	expect(normalizeOsmRoadTags({ highway: "residential" }).road).toMatchObject({
		layer: null,
		bridge: null,
		tunnel: null,
		directionOrigin: "inferred",
		dimensions: {},
		laneCounts: {},
	});
	expect(normalizeOsmRoadTags({ highway: "motorway" }).road.direction).toBe(
		"forward",
	);
	expect(
		mapOsmTags({ highway: "primary", layer: "-2oops", bridge: "false" })!
			.osmVertical,
	).toEqual({});
	expect(
		normalizeOsmRoadTags({ highway: "primary", layer: "-2" }).road.layer,
	).toBe(-2);
});
test("incomplete and degenerate road geometry is rejected without losing original points", () => {
	const input = capture([
		road(10, {}, [{ lat: 0, lon: -0.001 }, null, { lat: 0, lon: 0.001 }]),
		road(20, {}, [
			{ lat: 0, lon: 0 },
			{ lat: 0, lon: 0 },
		]),
		road(30, { highway: "construction" }),
	]);
	const report = normalizeOsmAcquisition(input);
	expect(
		report.features.every((feature) => feature.disposition === "rejected"),
	).toBe(true);
	expect((report.features[0]!.raw.geometry as unknown[])[1]).toBeNull();
	expect(report.features[0]!.diagnostics.map((item) => item.code)).toContain(
		"geometry-incomplete",
	);
	expect(interpretOsmAcquisition(input).ways).toEqual([]);
});
test("source variants select the highest version deterministically and retain alternatives", () => {
	const old = { ...road(10, { width: "6" }), version: 1 },
		newer = { ...road(10, { width: "7" }), version: 2 };
	const a = normalizeOsmAcquisition(capture([old, newer])),
		b = normalizeOsmAcquisition(capture([newer, old]));
	expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	expect(a.features).toHaveLength(1);
	expect(a.features[0]!.road!.dimensions.width).toBe(7);
	expect(a.features[0]!.variants).toHaveLength(2);
	expect(a.features[0]!.diagnostics.map((item) => item.code)).toContain(
		"source-conflict",
	);
});
test("surface relations and connectivity keep malformed member evidence without bridging gaps", () => {
	const input = capture([
		{
			type: "relation",
			id: 1,
			tags: { "area:highway": "residential" },
			members: [
				{
					type: "way",
					ref: 10,
					role: "outer",
					geometry: [{ lat: 0, lon: 0 }, null, { lat: 0, lon: 0.001 }],
				},
			],
		},
		{
			type: "relation",
			id: 2,
			tags: { type: "connectivity" },
			members: [{ type: "way", ref: 10, role: "from" }],
		},
		{
			type: "relation",
			id: 3,
			tags: { "area:highway": "residential" },
			members: [
				{
					type: "way",
					ref: 10,
					role: "outer",
					geometry: [
						{ lat: 0, lon: 0 },
						{ lat: 0, lon: 0.001 },
					],
				},
			],
		},
	]);
	const report = normalizeOsmAcquisition(input);
	expect(
		report.features.every((feature) => feature.disposition === "rejected"),
	).toBe(true);
	expect(interpretOsmAcquisition(input).mappedSurfaces).toEqual([]);
	expect(interpretOsmAcquisition(input).laneConnectivity).toEqual([]);
});
test("node inventory uses pure length and bearing semantics with source diagnostics", () => {
	const report = normalizeOsmAcquisition(
		capture([
			{
				type: "node",
				id: 1,
				lat: 0,
				lon: 0,
				tags: { highway: "street_lamp", height: "30 ft", direction: "NE" },
			},
			{
				type: "node",
				id: 2,
				lat: 0,
				lon: 0.001,
				tags: { highway: "traffic_signals", direction: "90bad" },
			},
		]),
	);
	expect(report.features[0]!.measurements.dimensions.height).toBeCloseTo(9.144);
	expect(report.features[0]!.measurements.bearingDegrees).toBe(45);
	expect(report.features[1]!.measurements.bearingDegrees).toBeNull();
	expect(
		report.features[1]!.diagnostics.some((item) => item.field === "direction"),
	).toBe(true);
});
test("prepared and completed imports carry accepted semantics and rejected inputs linked to snapshot", async () => {
	const input = capture([
		road(10, { width: "6.4", lanes: "2" }),
		road(20, {}, [{ lat: 0, lon: -0.001 }, null, { lat: 0, lon: 0.001 }]),
	]);
	const before = JSON.stringify(input);
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 250, {
		loadAcquisition: async () => input,
	});
	expect(prepared.normalization.sourceContentIdentity).toBe(
		prepared.sourceSnapshot!.contentIdentity,
	);
	expect(
		prepared.normalization.features.filter(
			(feature) => feature.disposition === "rejected",
		),
	).toHaveLength(1);
	const result = await completeOsmStreetImport(prepared);
	expect(result.normalization).toEqual(prepared.normalization);
	expect(result.normalization).not.toBe(prepared.normalization);
	expect(
		result.graphs
			.flatMap((graph) => Object.values(graph.edges))
			.every((edge) => edge.osmSource!.wayId === 10),
	).toBe(true);
	expect(JSON.stringify(input)).toBe(before);
});
test("an all-rejected import exposes its report on the typed error", async () => {
	let failure: unknown;
	try {
		await prepareOsmStreetImport({ lat: 0, lon: 0 }, 250, {
			loadAcquisition: async () =>
				capture([
					road(10, {}, [{ lat: 0, lon: -0.001 }, null, { lat: 0, lon: 0.001 }]),
				]),
		});
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(OsmNormalizationError);
	if (!(failure instanceof OsmNormalizationError))
		throw Error("Expected normalization error");
	expect(failure.normalization.features[0]!.raw.geometry).toHaveLength(3);
});
test("injected road compatibility is explicit and uses the selected normalized source variant", async () => {
	const points = [-50, 50].map((x, index) => ({
		...localToGeo([x, 0], { lat: 0, lon: 0 }),
		nodeId: index + 1,
	}));
	const report = normalizeOsmWays([
		{ id: 1, tags: { highway: "residential" }, points },
	]);
	expect(report.inputKind).toBe("interpreted-roads");
	expect(report.sourceContentIdentity).toBeNull();
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadStreets: async () => [
			{ id: 1, tags: { highway: "residential", width: "6" }, points },
			{ id: 1, tags: { highway: "residential", width: "7" }, points },
		],
	});
	expect(prepared.preview.segmentCount).toBe(1);
});
test("generated fallback widths and counts are not marked as mapped source values", () => {
	const style = buildOsmRoadStyle(
		{ highway: "residential", width: "bad", lanes: "2bad" },
		"local-street",
		false,
	);
	expect(style.dimensionSources!.laneCount!.kind).toBe("default");
	expect(style.dimensionSources!.laneWidth!.kind).toBe("default");
	expect(style.dimensionSources!.totalWidth!.kind).toBe("default");
	const contradictory = buildOsmRoadStyle(
		{
			highway: "primary",
			lanes: "3",
			"lanes:forward": "2",
			"lanes:backward": "2",
		},
		"arterial",
		false,
	);
	expect(contradictory.laneDirections).toHaveLength(contradictory.laneCount);
});
test("normalized report round trips and rejects future policy/version or inconsistent identity", () => {
	const report = normalizeOsmAcquisition(capture([road()]));
	expect(parseNormalizedOsmSource(JSON.stringify(report))).toEqual(report);
	expect(() =>
		parseNormalizedOsmSource({ ...report, schemaVersion: 2 }),
	).toThrow("Unsupported OSM normalization version");
	expect(() =>
		parseNormalizedOsmSource({
			...report,
			policy: { id: "osm-source-normalization", version: 2 },
		}),
	).toThrow();
	const bad = structuredClone(report);
	bad.features[0]!.id = 999;
	expect(() => parseNormalizedOsmSource(bad)).toThrow("Normalized identity");
});
