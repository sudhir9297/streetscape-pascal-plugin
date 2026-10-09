import { expect, test } from "bun:test";
import { RoadNetworkNode } from "./schema";
import {
	createLegacyStreetProject,
	convertStreetProjectRoads,
} from "./street-project-compatibility";
import {
	parseStreetProject,
	serializeStreetProject,
} from "./domain/street-project";
import { asymmetricLayout } from "./domain/street-section-layout-fixture";
import {
	compileStreetProject,
	resolveEffectiveStreetModel,
} from "./effective-street-model";
import {
	editStreetScenarioSection,
	setStreetScenarioSectionLock,
	setStreetScenarioPropertyLock,
	setStreetScenarioInventorySuppression,
} from "./domain/street-scenario-edits";
import {
	streetInventoryItemId,
	streetSectionDesignId,
} from "./domain/street-scenario";
import { setStreetScenarioOverride } from "./domain/street-resolution";
import { StreetSectionLayout } from "./domain/street-section-layout";
import { resolveScenarioMovementEvidence } from "./domain/scenario-movement-evidence";
const date = "2026-10-09T12:00:00Z",
	roadId = "road-network_effective";
function fixture() {
	const node = RoadNetworkNode.parse({
		id: roadId,
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [30, 0, 0] },
		},
		edges: {
			ab: {
				id: "ab",
				startNodeId: "a",
				endNodeId: "b",
				sectionLayout: asymmetricLayout,
			},
		},
		osmMappedSurfaces: [
			{
				id: 10,
				sourceType: "way",
				partIndex: 0,
				kind: "sidewalk",
				tags: {},
				points: [
					[0, 0, 3],
					[30, 0, 3],
					[30, 0, 5],
				],
			},
			{
				id: 10,
				sourceType: "relation",
				partIndex: 0,
				kind: "sidewalk",
				tags: {},
				points: [
					[0, 0, -3],
					[30, 0, -3],
					[30, 0, -5],
				],
			},
		],
		osmCrossings: [{ id: 20, point: [15, 0, 0], tags: {} }],
		osmLaneConnectivity: [{ id: 30, members: [], tags: {} }],
		attachments: {
			lamp: {
				id: "lamp",
				edgeId: "ab",
				assetNodeId: "street-light_effective",
				station: 10,
				lateralOffset: 4,
				verticalOffset: 0,
			},
		},
	});
	const p = convertStreetProjectRoads(
		createLegacyStreetProject({
			id: "effective",
			name: "Effective",
			baselineRevisionId: "b",
			acceptedAt: date,
			roads: [node],
		}),
	);
	p.baselineRevisions.b!.features["street-light_effective"] = {
		id: "street-light_effective",
		kind: "scene-asset",
		origin: "authored",
		sourceReferenceIds: [],
		sourceFeatureId: null,
		representation: "pascal-scene-node-v1",
		data: { id: "street-light_effective", visible: true },
	};
	for (const id of ["one", "two"])
		p.scenarios[id] = { id, name: id, baselineRevisionId: "b" };
	return parseStreetProject(p);
}
test("scenarios compile independently with stable section edits, inherited style and immutable baseline", () => {
	let p = fixture();
	const baseline = serializeStreetProject(p);
	const layout = StreetSectionLayout.parse(asymmetricLayout);
	layout.intervals[0]!.leftBands[0]!.width += 2;
	p = editStreetScenarioSection(
		p,
		"one",
		roadId,
		"section:ab",
		{ layout, style: { surfaceMaterial: "concrete" } },
		"Walkable proposal",
	);
	const one = compileStreetProject(p, "b", "one"),
		two = compileStreetProject(p, "b", "two"),
		accepted = compileStreetProject(p, "b");
	expect(one.effective.roads[roadId]!.edges.ab!.sectionLayout).toEqual(layout);
	expect(two.effective.roads[roadId]).toEqual(
		accepted.effective.roads[roadId]!,
	);
	const style =
		one.effective.roads[roadId]!.stylePresets[
			one.effective.roads[roadId]!.edges.ab!.styleId
		]!;
	expect(style.surfaceMaterial).toBe("concrete");
	expect(style.laneWidth).toBe(
		accepted.effective.roads[roadId]!.stylePresets[
			accepted.effective.roads[roadId]!.edges.ab!.styleId
		]!.laneWidth,
	);
	expect(one.roads[roadId]!.sectionSurfaces).not.toEqual(
		two.roads[roadId]!.sectionSurfaces,
	);
	expect(p.baselineRevisions).toEqual(
		parseStreetProject(baseline).baselineRevisions,
	);
	expect(() =>
		editStreetScenarioSection(
			p,
			"one",
			roadId,
			"section:nearby",
			{ layout },
			"Wrong identity",
		),
	).toThrow();
	expect(() =>
		editStreetScenarioSection(
			p,
			"one",
			roadId,
			"section:ab",
			{ layout: { ...layout, length: 100 } },
			"Wrong span",
		),
	).toThrow();
	expect(
		resolveEffectiveStreetModel(
			parseStreetProject(serializeStreetProject(p)),
			"b",
			"one",
		),
	).toEqual(one.effective);
});
test("property and section locks pin effective values and reject edits until explicitly unlocked", () => {
	let p = fixture();
	const baseline = p.baselineRevisions.b!;
	const property = Object.values(baseline.propertyEvidence!).find(
		(e) => e.target.path.at(-1) === "surfaceColor",
	)!;
	p = setStreetScenarioOverride(p, "one", property.id, {
		value: "#ababab",
		reason: "Design pavement",
		authoredAt: date,
	});
	p = setStreetScenarioPropertyLock(
		p,
		"one",
		property.id,
		true,
		"Pin pavement",
	);
	expect(() =>
		setStreetScenarioOverride(p, "one", property.id, {
			value: "#123456",
			reason: "Replace",
			authoredAt: date,
		}),
	).toThrow("Unlock");
	expect(() =>
		editStreetScenarioSection(
			p,
			"one",
			roadId,
			"section:ab",
			{ style: { surfaceColor: "#123456" } },
			"Replace",
		),
	).toThrow("Unlock");
	p = setStreetScenarioPropertyLock(p, "one", property.id, false, "Release");
	p = setStreetScenarioSectionLock(
		p,
		"one",
		roadId,
		"section:ab",
		true,
		"Pin section",
	);
	const before = resolveEffectiveStreetModel(p, "b", "one");
	expect(() =>
		editStreetScenarioSection(
			p,
			"one",
			roadId,
			"section:ab",
			{ style: { surfaceMaterial: "concrete" } },
			"Replace",
		),
	).toThrow("Unlock");
	expect(() =>
		setStreetScenarioOverride(p, "one", property.id, {
			value: "#123456",
			reason: "Replace",
			authoredAt: date,
		}),
	).toThrow("Unlock");
	const reloaded = parseStreetProject(serializeStreetProject(p));
	expect(resolveEffectiveStreetModel(reloaded, "b", "one")).toEqual(before);
	p = setStreetScenarioSectionLock(
		p,
		"one",
		roadId,
		"section:ab",
		false,
		"Release",
	);
	p = editStreetScenarioSection(
		p,
		"one",
		roadId,
		"section:ab",
		{ style: { surfaceColor: "#123456" } },
		"Replace",
	);
	expect(
		p.scenarios.one!.sectionEdits![streetSectionDesignId(roadId, "section:ab")]!
			.locked,
	).toBe(false);
});
test("inventory suppression uses exact multipart identities and restores baseline without deleting source facts", () => {
	let p = fixture();
	const baseline = structuredClone(p.baselineRevisions);
	const surface = resolveEffectiveStreetModel(p, "b").roads[roadId]!
		.osmMappedSurfaces[0]!;
	p = setStreetScenarioInventorySuppression(
		p,
		"one",
		{
			category: "surfaces",
			roadId,
			itemId: streetInventoryItemId("surfaces", surface),
		},
		true,
		"Remove one mapped part",
	);
	p = setStreetScenarioInventorySuppression(
		p,
		"one",
		{ category: "crossings", roadId, itemId: "20" },
		true,
		"Remove crossing in proposal",
	);
	p = setStreetScenarioInventorySuppression(
		p,
		"one",
		{ category: "features", featureId: "street-light_effective" },
		true,
		"Remove lamp in proposal",
	);
	const effective = compileStreetProject(p, "b", "one");
	expect(effective.effective.roads[roadId]!.osmMappedSurfaces).toHaveLength(1);
	expect(
		effective.effective.roads[roadId]!.osmMappedSurfaces[0]!.sourceType,
	).toBe("relation");
	expect(effective.effective.roads[roadId]!.osmCrossings).toHaveLength(0);
	expect(effective.effective.roads[roadId]!.attachments).toEqual({});
	expect(effective.effective.features).toEqual({});
	expect(p.baselineRevisions).toEqual(baseline);
	expect(
		resolveEffectiveStreetModel(p, "b", "two").roads[roadId]!.osmMappedSurfaces,
	).toHaveLength(2);
	expect(
		resolveEffectiveStreetModel(p, "b").features["street-light_effective"],
	).toBeDefined();
	expect(() =>
		setStreetScenarioInventorySuppression(
			p,
			"one",
			{ category: "crossings", roadId, itemId: "999" },
			true,
			"Nearby is not identity",
		),
	).toThrow();
	p = setStreetScenarioInventorySuppression(
		p,
		"one",
		{ category: "features", featureId: "street-light_effective" },
		false,
		"Restore",
	);
	expect(
		resolveEffectiveStreetModel(p, "b", "one").features[
			"street-light_effective"
		],
	).toBeDefined();
	p = setStreetScenarioInventorySuppression(
		p,
		"one",
		{ category: "attachments", roadId, itemId: "lamp" },
		true,
		"Suppress attachment",
	);
	expect(resolveEffectiveStreetModel(p, "b", "one").features).toEqual({});
});
test("connectivity suppression filters generation evidence while retaining legal restrictions", () => {
	let p = fixture();
	p = setStreetScenarioInventorySuppression(
		p,
		"one",
		{ category: "laneConnectivity", roadId, itemId: "30" },
		true,
		"Remove mapped connectivity",
	);
	const c = {
		featureId: "osm~relation~30",
		kind: "connectivity" as const,
		fromWayId: 1,
		toWayId: 2,
		viaNodeId: 3,
		fromDirection: "forward" as const,
		toDirection: "forward" as const,
		lanes: [],
	};
	const evidence = {
		format: "osm-movement-evidence" as const,
		schemaVersion: 1 as const,
		mode: "motor_vehicle" as const,
		constraints: [c, { ...c, kind: "no" as const }],
		diagnostics: [],
		roads: [],
	};
	expect(
		resolveScenarioMovementEvidence(evidence, p.scenarios.one)!.constraints.map(
			(c) => c.kind,
		),
	).toEqual(["no"]);
	expect(evidence.constraints).toHaveLength(2);
	expect(
		resolveEffectiveStreetModel(p, "b", "one").roads[roadId]!
			.osmLaneConnectivity,
	).toHaveLength(0);
});
